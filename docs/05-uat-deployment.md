# SIHL Synapse — UAT Deployment Guide

**Applies to:** Synapse platform including the Issue Tracker & Service Request module (BRS
Phase 1, steps 0–8).
**Repository:** `https://github.com/happymanesh/synapse` (private) — **one repository, not two.**
**Last updated:** 08-Sep-2026

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

### Used by the seed only

| Key | Purpose |
|---|---|
| `SEED_USER_PASSWORD` | Password for the account(s) the seed creates. Falls back to the placeholder `ChangeMe@2026` if unset, so a clone can never contain a working credential. **Set this to something disposable for UAT.** Must satisfy the password policy: 8+ characters, at least one uppercase, one digit, and one of `!@#$%^&*`, and not equal to the username. |

### Set by the platform

| Key | Notes |
|---|---|
| `NODE_ENV` | `production`. Most hosts set this. Affects Prisma client caching and cookie `secure` flag. |
| `PORT` | Next.js binds this if present. Managed hosts inject it. |

**Nothing else is read.** The full list of variables the code touches is exactly:
`DATABASE_URL`, `DATABASE_URL_READONLY`, `SESSION_SECRET`, `SEED_USER_PASSWORD`, `SEED_DEMO`,
`NODE_ENV`.

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

This applies the 15 committed migration files in order. **See §9 — do not use
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

### 3.5 Start

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

1. **Change the password** — user menu → Settings → Change password.
2. Create real staff accounts in **Administration → User Master**.
3. Assign roles in **Administration → Roles**, or via the 🛡️ action on a user.

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

---

## 6. What is deliberately incomplete in this release

These are known and agreed, not defects. Tell UAT testers so they do not raise them as bugs.

| Area | State |
|---|---|
| **Outbound delivery** | **Nothing is ever sent.** Acknowledgements, change-request closure notices and document deliveries are written to the `channel_message` table with status `QUEUED`. Synapse has no email or SMS provider wired. A raiser will hear nothing. |
| **Document generation (§4.7)** | Stubbed. A request is recorded and its delivery address resolved and verified, but no PDF is produced — the ledger/margin/contract-note source tables do not exist and no PDF renderer is installed. |
| **Website intake (§4.1)** | Not built. There is no public, unauthenticated intake route. Only the Synapse app and staff-logged Phone/WhatsApp entries create tickets. |
| **WhatsApp intake (§4.1)** | Parked, pending a centralised WhatsApp system. Requires Meta credentials and a public HTTPS callback. |
| **Email intake, CEO dashboard, solutions bot** | Phase 2/3 by design (BRS §7). |
| **Issue taxonomy** | The 8 applications and 7 segments seeded are provisional and were not signed off by the support lead (BRS §11.2). They are editable in-app under Support → Applications / Segments. |
| **Daily morning reminder (§4.5)** | Surfaces as counters on the Triage Queue rather than a pushed reminder, because pushing depends on delivery being wired. |

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

Run `npm test` for the unit suite (223 tests, no framework dependency — `node:test` via `tsx`).
