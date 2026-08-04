# Issue Tracker & Service Request System — Business Requirements Specification

**Module of:** SIHL Synapse
**Status:** Draft — Phase 1 ready for build; Phase 2/3 directional
**Author:** Manesh Mukherjee (captured via NeoSapien recording, 2026-08-04) + design review
**Last updated:** 2026-08-04

---

## 1. Purpose & Objective

Replace ad-hoc issue handling (phone calls to RMS, informal WhatsApp threads, undocumented email chases) with a single ticketing and service-request system embedded in Synapse. Goals:

- One intake surface for issues and service requests, regardless of channel
- A visible audit trail for every ticket — who raised it, who touched it, how long it took
- Remove recurring manual work (document downloads) via automated service requests
- Lay groundwork for later phases: management visibility (CEO dashboard) and after-hours self-service (solutions repository + bot)

## 2. Scope

**In scope for Phase 1:** ticket intake across Website, WhatsApp, Phone (manual entry), and the Synapse app itself; identity resolution against Synapse master data; a predefined issue taxonomy; duplicate merge; resolution workflow with audit trail; change-request conversion; automated document-download service requests; basic stats reporting.

**Deferred (Phase 2/3, see §8–9):** CEO Command Center dashboard, Google API email intake/auto-categorization, the solutions repository, and the after-hours bot.

**Out of scope entirely (for now):** OTP/MFA on document requests (explicitly decided against — email match is sufficient), severity-tiered SLAs (explicitly decided against — flat 12–24h response for all issues).

## 3. Actors

| Actor | Role |
|---|---|
| Employee | Raises internal issues; may also raise on behalf of a client |
| B2B customer / Client | Raises issues and service requests; already exists in Synapse master data (hierarchy code `0800`, per `userdetails`) |
| Associate partner / Prospect | Raises issues; typically **not** in master data — see guest ticket flow |
| Support desk staff | Triages, resolves, or forwards tickets |
| Support lead / desk head | Owns and revises the issue-category taxonomy |
| Product/Ops management | Approves conversion of tickets to change requests |

## 4. Functional Requirements — Phase 1

### 4.1 Ticket Intake

- **Channels:** Website (predefined subject lines mapped to prescribed reasons), WhatsApp, Phone (staff manually logs the ticket), Synapse app (native ticket-raise screen for internal employee queries).
- Email intake is **not** included in Phase 1 — see §9, Google API is deferred, so email-originated issues are handled manually until then.
- Every ticket captures: raiser identity (or guest details), channel, category, description, timestamp, initial status.

### 4.2 Identity Resolution

- On ticket creation, resolve the raiser against Synapse master data by email or mobile number:
  - **Employees** → match against `userdetails` (hierarchy codes for Management/CSO/Employee/Branch/Franchisee/SubBroker/Remisior)
  - **Clients** → match against `userdetails` where hierarchy code = `0800` (Client)
  - **Associate partners / Prospects** → generally absent from master data
- **Unmatched raiser → Guest ticket:** capture name + contact as given, proceed with the ticket, reconcile to master data later (e.g., once a prospect is onboarded as a client). Does not block ticket creation.
- On creation, send an automated registration notification (email or SMS) confirming the ticket number and that the matter is being looked into.

### 4.3 Categorization

- Predefined issue taxonomy, two axes: **Product/Module** (e.g., Equities, Derivatives, Back Office, RMS) × **Issue Type** (query, complaint, bug, service request). This taxonomy doubles as the reporting dimension in §4.8.
- **Owner:** Support lead / desk head — adds/revises categories as new issue patterns emerge. No formal review cadence mandated; owned reactively by the desk head.
- Category is selected at intake (by the raiser on Website/app, or by staff when logging a Phone/WhatsApp ticket).

### 4.4 Duplicate Detection & Merge

- While a staff member is answering any ticket, the system surfaces other **open** tickets as likely duplicates using: same category + same client/entity + within a rolling time window (24–48h). This is deterministic matching on structured fields — no NLP/text-similarity in Phase 1.
- Staff manually confirms via a checkbox; confirmed duplicates are **combined into a single thread** (both tickets' history merges; the original tickets are no longer tracked separately).
- **Assumption pending confirmation:** the combined thread's SLA/turnaround clock uses the **earliest** of the two tickets' raised timestamps, so merging cannot be used to understate elapsed time in the average-turnaround metric (§4.8). Flag if a different rule is wanted.

### 4.5 Resolution Lifecycle

- Support desk staff resolve directly, or forward to another team member. Every forward is logged (who, when, why) to preserve a complete audit trail.
- Daily morning reminder to staff listing their pending tickets and burn-down status.
- Staff must update status and remarks on each ticket to mark it solved, or provide a revised timeline if still open.
- Initial response target: **flat 12–24 hours** for all tickets, regardless of category (no severity tiers in Phase 1).

### 4.6 Change Request Conversion

- If an issue is identified as a larger development requirement rather than a fixable bug, it converts to a **change request**.
- **Approval authority: Product/Ops management** — the support desk cannot unilaterally park an item in the backlog; management signs off first.
- On conversion: the originating ticket is closed with a notification to the user that it's "considered for a future release," and the item is parked as an enhancement in the application backlog.

### 4.7 Automated Service Requests (Document Downloads)

- Separate, lighter-weight flow (not a full support ticket) for automated document delivery: **ledgers, margin reports, contract notes**.
- Ledger requests require a mandatory client code.
- **Verification: email match is sufficient** — no OTP/MFA step (explicit decision; revisit if abuse patterns emerge).
- The system emails the PDF directly to the client's registered email. If an employee raises the request on the client's behalf, the client is **CC'd** for transparency.

### 4.8 Reporting (Basic)

- A stats report tracking: daily ticket closures, new tickets raised, tickets forwarded, and **average turnaround time**.
- No dashboard UI in Phase 1 — this is a report, not the CEO Command Center (that's §8).

## 5. Non-Functional Requirements — Phase 1

- **Data residency / ownership:** ticketing tables live in the existing Synapse Postgres database — no new datastore.
- **Auditability:** every status change and forward must be attributable and timestamped (supports both the audit-trail requirement and future dispute resolution — relevant given prior incidents like the ₹2.98L RMS penalty case).
- **Access control:** reuses Synapse's existing session/role model; no new auth system.
- **Availability of guest path:** ticket creation must never hard-block on an identity-resolution failure — the guest ticket path is the fallback, not an error state.

## 6. Data Model — Phase 1 (high-level)

New Prisma entities to add to the existing Synapse schema:

- `Ticket` — id, raiser (linked `userdetails.UID` or null for guest), guestName/guestContact, channel, categoryId, description, status, createdAt, resolvedAt, forwardedTo, mergedIntoTicketId (nullable, self-referencing)
- `IssueCategory` — code, product/module, issue type, isActive
- `TicketEvent` — ticket audit log: forwards, status changes, remarks, actor, timestamp
- `ServiceRequest` — separate from `Ticket`; type (ledger/margin report/contract note), clientCode, requestedBy, deliveredAt
- `ChangeRequest` — linked to originating ticket, approvedBy (Product/Ops), backlogStatus

Exact column-level design (types, constraints, indexes) to be finalized at implementation time, following Synapse's existing hand-written-migration convention (see `CLAUDE.md` — no `prisma migrate dev`/`db push`).

## 7. Roadmap

| Phase | Contents | Depends on |
|---|---|---|
| **Phase 1** | Core ticketing loop: multi-channel intake (Website/WhatsApp/Phone/Synapse), identity resolution + guest tickets, categorization, duplicate merge, resolution + audit trail, change-request conversion, document service requests, basic stats report | Synapse's existing auth + master data (`userdetails`, `hierarchy`) |
| **Phase 2** | CEO Command Center dashboard (see §8) | Phase 1 data (tickets, categories, turnaround metrics) must exist and be reliable first |
| **Phase 3** | Google API email intake/auto-categorization; Solutions Repository; After-hours bot (see §9) | Phase 1 (ticket resolution history feeds the repository); repository must have curated content before the bot is useful |

Sequencing rationale: Phase 2 is purely additive reporting on top of Phase 1 data, so it can start once Phase 1 is stable in production. Phase 3's bot is the highest-risk, highest-dependency piece (needs a populated, curated repository) and should not start until there's a real backlog of curated resolutions to draw from — otherwise the bot has nothing reliable to answer from.

## 8. Phase 2 (directional — CEO Command Center Dashboard)

- Summarized dashboard integrated into the existing CEO Command Center.
- Ticket aging shown in buckets: **6h / 24h / 48h / >48h**.
- Product-wise table of issue counts, expandable per product to show which specific topics are driving the highest volume (surfacing systemic problems, not just raw counts).
- Open question carried over from the design review: exact KPI set for the dashboard is not yet finalized — to be scoped at the start of Phase 2.

## 9. Phase 3 (directional)

- **Google API email integration:** read incoming support emails and auto-categorize as problem vs. general query, replacing the current manual email handling. Specific Google APIs to use — not yet chosen, to be scoped at the start of this phase.
- **Solutions Repository:** built from resolved tickets, but **not** auto-populated — a staff member must mark a resolution "reusable" before it's added to the bot's answerable corpus, to avoid propagating one-off or incorrect fixes.
- **After-hours bot:** operates on **WhatsApp + Website chat only** (not email, since Google API intake is still a Phase 3 dependency, not a Phase 1/2 capability). Answers strictly from the curated repository — no open-ended generation, given the compliance/financial sensitivity of this domain. On no confident match, it **auto-creates a ticket for next-business-day human response** rather than attempting a guess.

## 10. Tech Stack

Builds directly on Synapse's existing, verified stack — no new stack decisions required for Phase 1:

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | Matches Synapse exactly |
| Database | PostgreSQL via Prisma | Same database as Synapse — no new datastore; extend schema per `CLAUDE.md` hand-written-migration convention |
| Auth | Existing Synapse session auth (jose + bcryptjs) | Reused as-is; no new auth system |
| Validation | Zod | Already in use |
| UI | Tailwind CSS 4 | Already in use |
| Reporting/Charts | Recharts | Already in use; covers Phase 1 stats report and Phase 2 dashboard |
| **New for Phase 1** | WhatsApp Business Cloud API (or a provider such as Gupshup/Twilio) | Only genuinely new integration required for Phase 1 — needed for the WhatsApp channel |
| **New for Phase 3** | Google Workspace API (Gmail) | For email intake/auto-categorization |
| **New for Phase 3** | An LLM API for the after-hours bot (e.g., Claude via the Anthropic API) | Retrieval over the curated solutions repository; keyword/category matching may suffice initially — consider `pgvector` on the same Postgres instance only if semantic search proves necessary |

**Architectural decision:** built as a module *inside* Synapse rather than a standalone service, since the design already treats "Synapse application" as a native intake channel and depends on Synapse's existing master data for identity resolution. Tradeoff: couples this module's release cycle and database load to Synapse's — acceptable at current scale; revisit if Synapse needs to stay lightweight.

## 11. Open Items Carried Into Implementation

1. Confirm the merge SLA-clock rule in §4.4 (earliest-timestamp assumption).
2. Finalize exact `IssueCategory` seed list (Product/Module × Issue Type) with the support lead before build.
3. Phase 2: finalize CEO dashboard KPI set.
4. Phase 3: choose specific Google APIs for email intake.
5. Phase 3: define the "reusable" curation workflow/UI for the solutions repository.
