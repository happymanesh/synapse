# SIHL Synapse — UAT Deployment Guide

**Applies to:** Synapse platform including the Issue Tracker & Service Request module (BRS
Phase 1, steps 0–8).
**Repository:** `https://github.com/happymanesh/synapse` (private) — **one repository, not two.**
**Last updated:** 17-Sep-2026

---

## 1. What you are deploying

One Next.js application and one PostgreSQL database. That is the whole system.

The Issue Tracker is **not** a separate application, repository or database — it is a module
inside Synapse, surfaced as a "Support" app in the app switcher. This was a deliberate
architectural decision (BRS §10): the design treats the Synapse app itself as one of its
intake channels, and reads Synapse's `user_details` master data directly to identify who
raised a ticket. Splitting it out would have required an API into that data and a second
auth system.

So: clone one repository, provision one database, set one set of variables.

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Runtime | Node.js 20+ (developed on 24.15) |
| Package manager | **npm** (not pnpm — see §9) |
| Database | PostgreSQL 16 |
| ORM | Prisma 7 with the `@prisma/adapter-pg` driver adapter |
| Auth | `jose` JWT in an httpOnly cookie, 8h expiry |

---

## 2. Environment variables

Set these on the UAT host. `.env` is gitignored and intentionally not in the repository — you
are creating these values, not copying them from anywhere.

### Required — the app will not work without these

| Key | Example / format | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/sihl_synapse_uat` | Main connection. Read by the app, Prisma CLI and the seed. |
| `SESSION_SECRET` | 64 hex characters | Signs the session JWT. **Generate a new one for UAT — do not reuse production's.** |

`SESSION_SECRET` is read at module load in `src/lib/session.ts` and **throws if missing**.
That is deliberate: a missing secret fails loudly at boot rather than silently issuing tokens
nobody can verify. If the app refuses to start, check this first.

Generate one with:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

### Strongly recommended

| Key | Value for UAT | Purpose |
|---|---|---|
| `TZ` | `Asia/Kolkata` | Without it the container runs UTC and **every timestamp displays 5h30m behind IST** — ticket raised times, the audit trail, triage-queue ages. Display-only (Postgres stores UTC either way), but for a system whose purpose is measuring turnaround and holding an audit trail, wrong wall-clock times are materially misleading. This never reproduces on an IST developer machine, so it is invisible until deployed. |
| `SEED_DEMO` | `false` | Omits the demo fixtures — the sample accounts `Manesh001`/`Client001`, the hand-created `sample_sales` table and the Sales Report/Summary/Entry worked example. Leave unset (or `true`) only if UAT explicitly wants that sample data. |
| `DATABASE_URL_READONLY` | connection string for a SELECT-only role | Second connection used **only** to execute administrator-authored report SQL. `assertSelectOnly()` already rejects non-SELECT statements, but that is an application guard; pointing report execution at a role with no write grants makes it structural. Without this the app falls back to the main connection and `REPORT_DB_IS_READONLY` reports `false`. |

### Chat-hub widget — optional, and off unless all of it is set

The in-app chat widget. Unset, the app logs `[chat-hub] not configured` once and carries
on without it; nothing else is affected.

| Key | Value for UAT | Purpose |
|---|---|---|
| `CHAT_HUB_BASE_URL` | chat-hub deployment URL | Server-side calls into chat-hub. |
| `CHAT_HUB_SERVICE_SECRET` | **secret** | Authenticates Synapse to chat-hub as a service. |
| `NEXT_PUBLIC_CHAT_HUB_SUPABASE_URL` | chat-hub's Supabase URL | Read by the browser for live delivery. `NEXT_PUBLIC_` means **it ships to the client** — only ever put public values here. |
| `NEXT_PUBLIC_CHAT_HUB_SUPABASE_ANON_KEY` | chat-hub's anon key | Same: public by design, and not a substitute for the service secret above. |

### HR ingestion from Spine — optional, and off unless all of it is set

Only needed if you are running §3.5. Without these the HR scripts stop immediately and
change nothing; the rest of Synapse is unaffected.

| Key | Value for UAT | Purpose |
|---|---|---|
| `SPINE_CLIENT_KEY` | from the Spine vendor | Half of the credentials that mint an access token. |
| `SPINE_PRODUCT_KEY` | from the Spine vendor | Identifies which product the feed belongs to. |
| `SPINE_CLIENT_SECRET` | from the Spine vendor | **Secret.** Treat like a password; it is not in the repository. |
| `SPINE_BASE_URL` | defaults to `https://v2.spineapi.in` | Only set it to point at a different Spine host. The v2 host is the one that works; v1 does not serve this feed. |
| `HR_RAW_RETENTION_DAYS` | e.g. `90` | How long raw Spine payloads are kept in `hr_raw_employee`. They contain personal data, so keeping them forever is a liability, and deleting them immediately removes the ability to re-derive a bad mapping. |

The legacy names `CLIENT_KEY`, `PRODUCT_KEY` and `CLIENT_SECRET` are still read as
fallbacks. Prefer the `SPINE_` names — the unprefixed ones are ambiguous in a file that
will eventually hold credentials for more than one vendor.

### Outbound email — optional, and off unless all of it is set

One email exists in this release: the notice sent to a member of staff when a ticket is
**forwarded** to them. Nothing else sends (see §6).

| Key | Value | Purpose |
|---|---|---|
| `MAIL_DRIVER` | `sendgrid` | **The switch.** Anything else — including unset — means no email is sent. |
| `SENDGRID_API_KEY` | `SG.…` | SendGrid API key with Mail Send permission. |
| `MAIL_FROM` | e.g. `no-reply@sihl.com` | Sender address. **Must be a verified sender or domain in the SendGrid account**, or SendGrid rejects every message with a 403. |
| `MAIL_FROM_NAME` | `SIHL Synapse` | Display name. Defaults to `SIHL Synapse`. |
| `MAIL_APP_URL` | `https://<uat-host>` | Base URL for the "Open ticket" link in the email. Defaults to `http://localhost:3010`, which is useless in a deployed environment — **set it, or every email links back to nowhere.** |

**The sending host's IP must be on SendGrid's allowlist.** The SIHL SendGrid account has IP
Access Management switched on, so it refuses API calls from any address not on its list — the
call is rejected at authentication, before the message or the recipient is ever considered.
SIHL's own UAT and production server IPs are already whitelisted, so a deployment onto those
hosts needs nothing further. **Any other host does**: a cloud deployment (this module was
trialled on Railway, refused at `152.55.177.219`), a new server, or a changed egress IP will
be blocked until the address is added under Settings → IP Access Management.

Before believing email works from a new host, ask SendGrid directly — it answers without
sending anything:

    curl -s -o /dev/null -w "%{http_code}\n" \
      -H "Authorization: Bearer $SENDGRID_API_KEY" https://api.sendgrid.com/v3/scopes

`200` means the host is allowed. `403 The requestor's IP Address is not whitelisted` means it
is not, and no email will ever leave, whatever the app reports.

Leaving these unset is a supported state, not a broken one. Forwarding still works; the
attempt is recorded in `channel_message` as `TICKET_FORWARDED … [FAILED] No mailer configured
(MAIL_DRIVER=noop)` and a `NOTIFICATION` event on the ticket tells the forwarding staff member
to pass the message on by hand. The no-op driver deliberately reports **failure** rather than
success: a system that claims to have emailed someone when nothing left the building is worse
than one that admits it, because the recipient waits for something that is never coming.

### Used by the seed only

| Key | Purpose |
|---|---|
| `SEED_USER_PASSWORD` | Password for the account(s) the seed creates. Falls back to the placeholder `ChangeMe@2026` if unset, so a clone can never contain a working credential. **Set this to something disposable for UAT.** Must satisfy the password policy: 8+ characters, at least one uppercase, one digit, one of `!@#$%^&*`, not equal to the username, and at most 72 bytes. |

### Set by the platform

| Key | Notes |
|---|---|
| `NODE_ENV` | `production`. Most hosts set this. Affects Prisma client caching and cookie `secure` flag. |
| `PORT` | Next.js binds this if present. Managed hosts inject it. |

**Nothing else is read.** The full list of variables the code touches is exactly:
`DATABASE_URL`, `DATABASE_URL_READONLY`, `SESSION_SECRET`, `SEED_USER_PASSWORD`, `SEED_DEMO`,
`MAIL_DRIVER`, `SENDGRID_API_KEY`, `MAIL_FROM`, `MAIL_FROM_NAME`, `MAIL_APP_URL`, `NODE_ENV`.

---

## 3. Deployment steps

### 3.1 One-time database setup

Create an empty PostgreSQL 16 database. Do not restore anything into it — the migrations
build the whole schema.

Optionally create the read-only role for the report engine:

    CREATE ROLE synapse_ro LOGIN PASSWORD '<password>';
    GRANT CONNECT ON DATABASE sihl_synapse_uat TO synapse_ro;
    GRANT USAGE ON SCHEMA public TO synapse_ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO synapse_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO synapse_ro;

Then point `DATABASE_URL_READONLY` at it.

### 3.2 Install and build

    npm ci          # runs `prisma generate` via postinstall
    npm run build

`prisma generate` must run before `next build`; the `postinstall` hook handles it. If you
build in a container that prunes dev dependencies, make sure it happens after install.

### 3.3 Apply the schema

    npx prisma migrate deploy

This applies the 19 committed migration files in order. **See §9 — do not use
`prisma migrate dev` or `prisma db push`.**

### 3.4 Seed reference data

    npx prisma db seed

Creates: the company, 10 hierarchies, client categories, the apps (Broking, Back Office,
Support), the full menu tree, roles (`ADMIN`, `SUPPORT_DESK`, `SUPPORT_LEAD`, `PRODUCT_OPS`),
role→menu grants, the 8 applications and 7 segments, and the ticket report definitions —
plus one `ADMIN` account using `SEED_USER_PASSWORD`.

The seed is **idempotent** (upserts throughout) and safe to re-run. It deliberately does not
touch `passwordHash` on an existing account, so re-seeding never resets a password someone
has changed.

### 3.5 Load the employee master from Spine — optional, and only once credentials exist

    npm run hr:ingest       # Spine -> hr_raw_employee -> hr_employee
    npm run hr:lifecycle    # act on what the ingestion found

The two halves are deliberately separate. **Ingestion** reads Spine's employee feed into
`hr_raw_employee`, projects it onto `hr_employee`, and records what changed in
`hr_employee_change` and each run in `hr_ingest_run`. Keeping the raw payload means a
mapping mistake can be re-derived without asking the vendor to send the file again.
**Lifecycle** acts on the result: a leaver gets their Synapse account suspended, recorded
in `hr_lifecycle_action`.

Run ingestion first and read `hr_ingest_run` before running lifecycle. Lifecycle suspends
real people's accounts, and a bad ingestion is a bad list of leavers.

Needs `SPINE_CLIENT_KEY`, `SPINE_PRODUCT_KEY` and `SPINE_CLIENT_SECRET` (§2). Without
them the scripts stop with a clear message and change nothing. Skipping this entirely is a
supported state: the rest of Synapse works, and `hr_employee` simply stays empty.

**`reporting_manager_code` arrives empty from the vendor** and is not populated yet, so
nothing may depend on the reporting line until it is.

### 3.6 Start

    npm run start

Note that `start` is wired as `npm run db:deploy && next start`, so steps 3.3 and 3.4 run
automatically on every start. That is intentional for a single-instance deployment and both
steps are idempotent. **If UAT runs more than one instance**, remove `db:deploy` from `start`
and run it as a separate release step instead — concurrent container starts would otherwise
race on the same migration.

---

## 4. First login

Sign in at `/login` with the username `Admin001` and whatever you set `SEED_USER_PASSWORD` to.

Immediately afterwards:

1. **Change the password** — click your name (top right) → Settings → Change password. It asks
   for the current password as well as the new one; a session alone is not enough to change it.
   The new password must meet the policy in §2 and must not repeat any of the last 3.
2. Create real staff accounts in **Administration → User Master**. **An employee code is
   now required** on every account: workPulse joins users to staff by employee code and
   never by email, because roughly a hundred people here share a mailbox. An account
   created without one cannot be matched to a person later without an administrator going
   back and editing it.
3. Assign roles in **Administration → Roles**, or via the 🛡️ action on a user.

### What a newly created user sees

An account created by an administrator is flagged to change its password, and until it
does, **it can do nothing else**: every page redirects to the change-password screen and
every API call is refused. That is deliberate — accounts are created with a password
somebody else generated, and nothing previously obliged the owner to replace it.

So hand over the temporary password, and expect the first thing they see to be the
change-password screen rather than the dashboard. If somebody reports being "stuck on a
password page", that is the control working, not a fault.

### Suspended is not deactivated

Two separate states, and the difference matters when somebody asks why an account stopped
working:

- **Suspended** keeps `is_active = true` and is restorable. It is what the HR lifecycle
  (§3.5) sets when Spine reports a leaver.
- **Deactivated** is the permanent "this person has left".

Both are refused at login *and* on every subsequent request, so neither waits for the
8-hour token to expire.

### Roles and what they mean

| Role | Can |
|---|---|
| `SUPPORT_DESK` | Triage, resolve, forward, merge tickets; log tickets for others; **propose** change requests |
| `SUPPORT_LEAD` | All of the above, plus maintain the Applications and Segments master lists |
| `PRODUCT_OPS` | **Approve or reject** change requests and manage the backlog |
| `ADMIN` | Everything, including all Administration screens |

The split between proposing and approving a change request is a stated requirement (BRS §4.6:
the support desk cannot unilaterally park work in the backlog) and is enforced server-side by
a role check, not by hiding a button.

**Important quirk of the access model:** menu grants are filtered by the *user's own
hierarchy*. A role granted menus at hierarchy `0200` shows nothing to a user at `0100`. The
seed grants the support roles across `0000/0100/0200/0300`, so assigning a support role to any
staff user works — but if you add new roles by hand, grant them at the hierarchies your users
actually hold or they will see an empty app.

---

## 5. Verification checklist

After deploying, confirm:

- [ ] `/login` returns **200** and shows the SIHL logo and sign-in form
- [ ] An unauthenticated page request (e.g. `/support/queue`) **redirects** to `/login`
- [ ] An unauthenticated API request (e.g. `/api/notifications`) returns **401 with a JSON body** — not an HTML redirect
- [ ] Signing in lands on the dashboard with **Support** in the app switcher (🎧)
- [ ] **Raise a Ticket** shows three dropdowns: Type, Application, Segment
- [ ] The "Raising at" line shows **IST**, not UTC — this is the `TZ` check
- [ ] Selecting type **Others** reveals the "Please mention the type" field
- [ ] Selecting **+ Add a new application…** reveals a name field
- [ ] A raised ticket appears in **My Tickets** and **Triage Queue**
- [ ] The ticket detail page shows the History panel with a `CREATED` event
- [ ] **Daily Ticket Stats** and **Tickets by Application** run and export CSV
- [ ] **Change password** (your name → Settings) opens a dialog; a deliberately wrong current
      password is refused with *"Your current password is not correct."*
- [ ] Forwarding a ticket to another user assigns it and adds a `FORWARDED` event — and, **if
      the mail variables are set**, the recipient receives an email whose "Open ticket" link
      resolves on the UAT host. If they are not set, confirm the ticket instead carries a
      `NOTIFICATION` event saying the email could not be sent; that is the expected state

---

## 6. What is deliberately incomplete in this release

These are known and agreed, not defects. Tell UAT testers so they do not raise them as bugs.

| Area | State |
|---|---|
| **Outbound delivery** | **One email exists: the ticket-forwarded notice to the staff member it was forwarded to**, and only when the mail variables in §2 are set. Everything a *raiser* would receive — acknowledgements, resolution notices, change-request closure notices, document deliveries — is still only written to `channel_message` with status `QUEUED` and never sent. **A raiser will hear nothing.** No SMS or WhatsApp provider is wired at all. |
| **Document generation (§4.7)** | Stubbed. A request is recorded and its delivery address resolved and verified, but no PDF is produced — the ledger/margin/contract-note source tables do not exist and no PDF renderer is installed. |
| **Website intake (§4.1)** | Not built. There is no public, unauthenticated intake route. Only the Synapse app and staff-logged Phone/WhatsApp entries create tickets. |
| **WhatsApp intake (§4.1)** | Parked, pending a centralised WhatsApp system. Requires Meta credentials and a public HTTPS callback. |
| **Email intake, CEO dashboard, solutions bot** | Phase 2/3 by design (BRS §7). |
| **Issue taxonomy** | The 8 applications and 7 segments seeded are provisional and were not signed off by the support lead (BRS §11.2). They are editable in-app under Support → Applications / Segments. |
| **Daily morning reminder (§4.5)** | Surfaces as counters on the Triage Queue rather than a pushed reminder, because pushing depends on delivery being wired. |
| **HR reporting line (§3.5)** | `reporting_manager_code` arrives empty from the vendor, so the employee master has no manager hierarchy. Anything that would escalate to "your manager" has nothing to resolve against until the vendor delivers it. The rest of the employee record is complete. |
| **HR ingestion scheduling** | The two scripts are run by hand. Nothing schedules them yet, so the employee master is as current as the last time somebody ran `npm run hr:ingest`. |

---

## 7. Rolling forward

Future releases: pull, then

    npm ci && npm run build && npx prisma migrate deploy && npx prisma db seed

Schema changes in this project use **hand-written migration SQL**, committed under
`prisma/migrations/`. `migrate deploy` applies them in order and never inspects the live
schema, so it is safe. See §9.

---

## 8. Rollback

The application is stateless — redeploy the previous commit.

The database is not. Migrations here have no down-scripts, so **take a database snapshot
before applying a release that includes new migrations**. For UAT the practical rollback is:
restore the snapshot, then redeploy the matching application commit.

---

## 9. Traps — read before deploying

These cost real debugging time. None are guessable from the code.

**1. Never run `prisma migrate dev` or `prisma db push`.**
The database contains `sample_sales`, a hand-created table that is not a Prisma model. Both
commands plan to **drop it** to reconcile drift. Only `prisma migrate deploy` is safe: it
applies committed migration files in order and never diffs the live schema.

**2. A page that queries the database must not be statically prerendered.**
`next build` will try to reach the database at build time, which fails in any environment
whose build step cannot see it. Every route in this app is already dynamic (`/login` carries
an explicit `export const dynamic = "force-dynamic"`), but keep it that way when adding pages.
This passes locally, where build and app share one database, and fails only in CI.

**3. `TZ` must be set, or timestamps are 5h30m out.**
Invisible on an IST developer machine. See §2.

**4. A raw `node-postgres` script disagrees with the app about timestamps.**
`pg` parses `timestamp without time zone` as *local* time; Prisma reads it as UTC. The same
row therefore reads 5h30m apart depending on which client you use. **The app is correct.**
Do not "fix" a timestamp based on an ad-hoc `psql`/`pg` probe.

**5. Menu grants are filtered by the user's hierarchy.** See §4.

**6. Use npm, not pnpm.** pnpm had approve-builds problems on the original machine.

**7. After `prisma generate`, restart the server.** A running process keeps the old Prisma
client in memory, so new models appear "missing" at runtime while the code type-checks fine.

**8. Mail fails quietly by design, in four different ways.** The variables get set on the
*database* service instead of the app; a bulk or raw variable editor is filled in but never
saved; `MAIL_FROM` is an address the SendGrid account has not verified; or **the host's IP is
not on SendGrid's allowlist**. In every case forwarding still succeeds and the app looks
healthy — the only evidence is a `[FAILED]` row in `channel_message` and a `NOTIFICATION`
event on the ticket. All four have now happened at least once during this project, the last
two on the first real attempt to send. If email is expected, run the `/v3/scopes` check in
§2.3 from the deployment host, then forward one ticket deliberately and read
`channel_message` before believing it works.

---

## 10. Reference

| Document | Contents |
|---|---|
| `REBUILD.md` | Full product brief — data model, architecture rules, feature spec, traps |
| `CLAUDE.md` | Day-to-day conventions (migrations, report SQL, ownership columns, formatting) |
| `docs/01-business-requirements.*` | Synapse platform BRS |
| `docs/02-technical-architecture.*` | Architecture document |
| `docs/03-user-guidelines.*` | User guide |
| `docs/04-issue-tracker-brs.*` | Issue Tracker BRS — the spec this module implements |

Run `npm test` for the unit suite (259 tests, no framework dependency — `node:test` via `tsx`).
