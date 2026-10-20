/**
 * Process B — Synapse lifecycle. Reads hr_employee (the canonical contract) and acts on
 * Synapse users. Never reads raw/ingest tables and never imports ../ingest, so it is
 * unchanged when the HR source is replaced.
 *
 * State-based, not event-based: every run re-evaluates every employee, so a future last
 * working day seen once is acted on the day after it passes, and a missed run is caught up by
 * the next one.
 *
 * Without `apply`, nothing is written: the result is a report. With it, for LINKED users:
 *   DEACTIVATE  flips user_details.is_active off (permanent);
 *   SUSPEND     sets is_suspended (HR freeze) — restorable;
 *   UNSUSPEND   clears a suspension this process set, when HR unfreezes;
 *   REVIEW      is queued in hr_lifecycle_action for an admin;
 *   profile     designation / department / reporting manager copied from HR.
 * getSession() re-checks the block flags on every request, so a block takes effect at once.
 *
 * With `apply` AND `provision`, unlinked ACTIVE employees get an account: username SIHL-<code>,
 * first password SIHL@<code> (SIHL's rule, see initialEmployeePassword), must change it at first
 * sign-in, company + hierarchy ONLY from hr_branch_hierarchy_map. No roles are granted — HR
 * never implies access (rule 2); an admin assigns roles, until then the user sees no menus.
 * With `mailer` as well, a welcome email goes to the employee — never to a mailbox shared by
 * several employees, where the password would reach colleagues.
 */
import bcrypt from "bcryptjs";
import { prisma } from "../../db";
import { fromDbDate, toDbDate, type IsoDate } from "../dates";
import type { EmploymentStatus } from "../employee";
import { employeeWelcomeEmail } from "../../mail/employee-welcome.template";
import {
  HR_SUSPENDER,
  decideLifecycle,
  isUnprovisionedJoiner,
  planProfileSync,
  planProvision,
  resolveHierarchy,
  type FreezeDecision,
  type LeaverDecision,
  type Successor,
} from "./lifecycle-core";
import { initialEmployeePassword, planEmployeeUsername } from "./username-core";

/** The slice of the mailer this needs, so callers can pass the real one or a fake. */
export interface WelcomeMailer {
  send(email: { to: string; subject: string; text: string; html: string }): Promise<{ accepted: boolean; failureReason: string | null }>;
}

export interface LifecycleOutcome {
  hrEmployeeId: number;
  sourceEmployeeId: string;
  uid: number;
  username: string;
  decision: LeaverDecision;
  freeze: FreezeDecision;
  /** True only when this run changed the user row for `decision` / `freeze`. */
  applied: boolean;
  freezeApplied: boolean;
  /** Profile fields copied from HR this run (names only). */
  profileUpdated: string[];
}

export interface ProvisionReport {
  /** Could be created (dry run) or were created (apply + provision). */
  ready: { sourceEmployeeId: string; username: string }[];
  created: { sourceEmployeeId: string; username: string; uid: number }[];
  blocked: { sourceEmployeeId: string; reason: string }[];
  emailed: string[];
  emailSkipped: { username: string; reason: string }[];
}

export interface LifecycleResult {
  outcomes: LifecycleOutcome[];
  /** Active employees with no Synapse user (company moves excluded). */
  unprovisionedJoiners: number;
  provisioning: ProvisionReport;
  /** Employees currently on leave. Recorded only — leave never changes access. */
  onLeave: number;
}

export interface LifecycleOptions {
  today: IsoDate;
  apply: boolean;
  /** Also create accounts for unlinked active employees. Needs `apply`. */
  provision?: boolean;
  /** Send welcome emails to newly created accounts. */
  mailer?: WelcomeMailer;
  loginUrl?: string;
  productName?: string;
}

export async function runLifecycle(opts: LifecycleOptions): Promise<LifecycleResult> {
  const employees = await prisma.hrEmployee.findMany({
    select: {
      id: true,
      sourceSystem: true,
      sourceEmployeeId: true,
      previousSourceEmployeeId: true,
      sourceCompanyCode: true,
      sourceStatus: true,
      employmentStatus: true,
      lastWorkingDate: true,
      lastWorkingDateInvalid: true,
      onLeave: true,
      accountFrozen: true,
      firstName: true,
      lastName: true,
      email: true,
      mobile: true,
      branch: true,
      department: true,
      designation: true,
      reportingManagerCode: true,
      user: {
        select: {
          uid: true,
          username: true,
          isActive: true,
          hrManuallyManaged: true,
          isSuspended: true,
          suspendedBy: true,
          designation: true,
          department: true,
          reportingManagerCode: true,
          reportingManagerSource: true,
        },
      },
    },
  });

  // Successor lookup: a record whose previousSourceEmployeeId names another record in the
  // same source is that person's next employment (a move between group companies).
  const successorOf = new Map<string, (typeof employees)[number]>();
  for (const e of employees) {
    if (e.previousSourceEmployeeId) successorOf.set(`${e.sourceSystem}|${e.previousSourceEmployeeId}`, e);
  }
  const toSuccessor = (s: (typeof employees)[number] | undefined): Successor | null =>
    s ? { sourceEmployeeId: s.sourceEmployeeId, sourceCompanyCode: s.sourceCompanyCode, employmentStatus: s.employmentStatus as EmploymentStatus } : null;

  // Records whose user is linked; a successor of one of these is a company move awaiting
  // re-link (queued as a review on the old record), not a new joiner.
  const linkedCodes = new Set(employees.filter((e) => e.user).map((e) => `${e.sourceSystem}|${e.sourceEmployeeId}`));

  // Mailboxes shared by more than one ACTIVE employee: never sent a password.
  const activeByEmail = new Map<string, number>();
  for (const e of employees) {
    if (e.employmentStatus === "ACTIVE" && e.email) activeByEmail.set(e.email.toLowerCase(), (activeByEmail.get(e.email.toLowerCase()) ?? 0) + 1);
  }

  const users = await prisma.userDetails.findMany({ select: { username: true, email: true, hrEmployeeId: true } });
  // Usernames in use, lower-cased (login matches case-insensitively). Names planned in this
  // run are added as they are assigned, so two joiners can never be given the same one.
  const taken = new Set(users.map((u) => u.username.toLowerCase()));
  // Accounts NOT linked to HR, by email: one of these may be the joiner themself, made by hand.
  // HR-linked accounts are excluded — they are definitely other people (shared team mailbox).
  const unlinkedByEmail = new Map(
    users.filter((u) => u.email && u.hrEmployeeId === null).map((u) => [u.email!.toLowerCase(), u.username]),
  );
  const hierarchyMap = await prisma.hrBranchHierarchyMap.findMany({
    select: { hrCompanyCode: true, hrBranch: true, hrDepartment: true, companyCode: true, hierarchyCode: true, isActive: true },
  });

  const provisioning: ProvisionReport = { ready: [], created: [], blocked: [], emailed: [], emailSkipped: [] };
  const outcomes: LifecycleOutcome[] = [];
  let unprovisionedJoiners = 0;
  let onLeave = 0;

  for (const e of employees) {
    const emp = {
      employmentStatus: e.employmentStatus as EmploymentStatus,
      sourceStatus: e.sourceStatus,
      lastWorkingDate: fromDbDate(e.lastWorkingDate),
      lastWorkingDateInvalid: e.lastWorkingDateInvalid,
    };
    if (e.onLeave) onLeave++;

    // ---- Joiners ---------------------------------------------------------------------
    const predecessorLinked = !!e.previousSourceEmployeeId && linkedCodes.has(`${e.sourceSystem}|${e.previousSourceEmployeeId}`);
    if (isUnprovisionedJoiner(emp, !!e.user || predecessorLinked)) {
      unprovisionedJoiners++;
      const plan = planProvision(
        planEmployeeUsername(e.sourceEmployeeId, taken),
        resolveHierarchy({ sourceCompanyCode: e.sourceCompanyCode, branch: e.branch, department: e.department }, hierarchyMap),
        e.email ? (unlinkedByEmail.get(e.email.toLowerCase()) ?? null) : null,
      );
      if (plan.kind === "BLOCKED") {
        provisioning.blocked.push({ sourceEmployeeId: e.sourceEmployeeId, reason: plan.reason });
      } else {
        taken.add(plan.username.toLowerCase());
        provisioning.ready.push({ sourceEmployeeId: e.sourceEmployeeId, username: plan.username });
        if (opts.apply && opts.provision) {
          const created = await createEmployeeUser(e, plan);
          if (created) {
            provisioning.created.push({ sourceEmployeeId: e.sourceEmployeeId, username: plan.username, uid: created });
            await sendWelcome(e, plan.username, opts, activeByEmail, provisioning);
          }
        }
      }
    }
    if (!e.user) continue;

    // ---- Linked users ------------------------------------------------------------------
    const user = e.user;
    const successor = toSuccessor(successorOf.get(`${e.sourceSystem}|${e.sourceEmployeeId}`));
    const { leaver: decision, freeze } = decideLifecycle({ ...emp, accountFrozen: e.accountFrozen }, user, opts.today, successor);
    let applied = false;
    let freezeApplied = false;
    let profileUpdated: string[] = [];

    if (opts.apply && decision.kind === "DEACTIVATE") {
      // Re-check active + not-manual in the WHERE: an admin may have changed either since the
      // read above, and the manual override must win (rule 7).
      applied = await prisma.$transaction(async (tx) => {
        const { count } = await tx.userDetails.updateMany({
          where: { uid: user.uid, isActive: true, hrManuallyManaged: false },
          data: { isActive: false },
        });
        if (count === 0) return false;
        await tx.hrLifecycleAction.create({
          data: {
            hrEmployeeId: e.id,
            userUid: user.uid,
            action: "DEACTIVATE",
            status: "APPLIED",
            reason: decision.reason,
            effectiveDate: toDbDate(decision.effectiveDate),
          },
        });
        return true;
      });
    } else if (opts.apply && decision.kind === "REVIEW") {
      const open = await prisma.hrLifecycleAction.findFirst({
        where: { hrEmployeeId: e.id, action: "REVIEW", status: "PENDING_REVIEW" },
        select: { id: true },
      });
      if (!open) {
        await prisma.hrLifecycleAction.create({
          data: { hrEmployeeId: e.id, userUid: user.uid, action: "REVIEW", status: "PENDING_REVIEW", reason: decision.reason },
        });
      }
    }

    if (opts.apply && freeze.kind !== "NONE") {
      const suspend = freeze.kind === "SUSPEND";
      freezeApplied = await prisma.$transaction(async (tx) => {
        // Guards re-checked in the WHERE (state may have moved since the read). UNSUSPEND only
        // matches a suspension this process set, on an account that is still active.
        const { count } = await tx.userDetails.updateMany({
          where: suspend
            ? { uid: user.uid, isActive: true, hrManuallyManaged: false, isSuspended: false }
            : { uid: user.uid, isActive: true, hrManuallyManaged: false, isSuspended: true, suspendedBy: HR_SUSPENDER },
          data: suspend
            ? { isSuspended: true, suspendedAt: new Date(), suspendedBy: HR_SUSPENDER, suspendedReason: freeze.reason }
            : { isSuspended: false, suspendedAt: null, suspendedBy: null, suspendedReason: null },
        });
        if (count === 0) return false;
        await tx.hrLifecycleAction.create({
          data: { hrEmployeeId: e.id, userUid: user.uid, action: freeze.kind, status: "APPLIED", reason: freeze.reason },
        });
        return true;
      });
    }

    const profile = planProfileSync(
      { designation: e.designation, department: e.department, reportingManagerCode: e.reportingManagerCode },
      user,
    );
    if (profile) {
      profileUpdated = Object.keys(profile).filter((k) => k !== "reportingManagerSource");
      if (opts.apply) {
        await prisma.userDetails.updateMany({ where: { uid: user.uid, hrManuallyManaged: false }, data: profile });
      }
    }

    outcomes.push({
      hrEmployeeId: e.id,
      sourceEmployeeId: e.sourceEmployeeId,
      uid: user.uid,
      username: user.username,
      decision,
      freeze,
      applied,
      freezeApplied,
      profileUpdated,
    });
  }
  return { outcomes, unprovisionedJoiners, provisioning, onLeave };
}

type EmployeeRow = {
  id: number;
  sourceEmployeeId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  mobile: string | null;
  designation: string | null;
  department: string | null;
  reportingManagerCode: string | null;
};

/** Create the account, link it to the HR record, record the action. Returns the uid, or null if
 * someone created/linked it concurrently (the unique constraints decide). */
async function createEmployeeUser(
  e: EmployeeRow,
  plan: { username: string; companyCode: string; hierarchyCode: string },
): Promise<number | null> {
  const passwordHash = await bcrypt.hash(initialEmployeePassword(plan.username), 10);
  const fullName = [e.firstName, e.lastName].filter(Boolean).join(" ") || plan.username;
  try {
    return await prisma.$transaction(async (tx) => {
      const user = await tx.userDetails.create({
        data: {
          companyCode: plan.companyCode,
          hierarchyCode: plan.hierarchyCode,
          username: plan.username,
          passwordHash,
          fullName,
          email: e.email,
          mobile: e.mobile,
          employeeCode: e.sourceEmployeeId,
          designation: e.designation,
          department: e.department,
          reportingManagerCode: e.reportingManagerCode,
          reportingManagerSource: e.reportingManagerCode ? "HR" : null,
          hrEmployeeId: e.id,
          mustChangePassword: true,
          lastPasswordChangedDate: new Date(),
        },
      });
      await tx.passwordHistory.create({ data: { userUid: user.uid, passwordHash } });
      await tx.hrLifecycleAction.create({
        data: { hrEmployeeId: e.id, userUid: user.uid, action: "PROVISION", status: "APPLIED", reason: `Created ${plan.username} from HR` },
      });
      return user.uid;
    });
  } catch (err) {
    // P2002: username / employee code / HR link taken since the read. Skip; next run reports it.
    if ((err as { code?: string }).code === "P2002") return null;
    throw err;
  }
}

async function sendWelcome(
  e: EmployeeRow,
  username: string,
  opts: LifecycleOptions,
  activeByEmail: Map<string, number>,
  report: ProvisionReport,
): Promise<void> {
  if (!opts.mailer) return;
  if (!e.email) {
    report.emailSkipped.push({ username, reason: "no email in HR — hand the credentials over in person" });
    return;
  }
  if ((activeByEmail.get(e.email.toLowerCase()) ?? 0) > 1) {
    report.emailSkipped.push({ username, reason: "mailbox is shared with other employees — hand the credentials over in person" });
    return;
  }
  const mail = employeeWelcomeEmail({
    recipientName: [e.firstName, e.lastName].filter(Boolean).join(" ") || username,
    username,
    initialPassword: initialEmployeePassword(username),
    loginUrl: opts.loginUrl ?? "http://localhost:3010/login",
    productName: opts.productName ?? "SIHL Synapse",
    when: new Date(),
  });
  const r = await opts.mailer.send({ to: e.email, ...mail });
  if (r.accepted) report.emailed.push(username);
  else report.emailSkipped.push({ username, reason: r.failureReason ?? "not accepted by the mailer" });
}
