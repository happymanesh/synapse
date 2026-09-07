-- Issue Tracker & Service Request System — Phase 1 (docs/04-issue-tracker-brs.md).
--
-- Applied by hand, not through `prisma migrate dev` / `db push`: those want to drop the
-- unmanaged `sample_sales` table to reconcile drift. See CLAUDE.md.
--
-- Written to be re-runnable: every object uses IF NOT EXISTS and all constraints are
-- declared inline in CREATE TABLE, so a partial application can simply be re-executed.

-- ---------------------------------------------------------------------------
-- Human-facing reference numbers.
--
-- Sequences, not max()+1: tickets arrive concurrently on four channels (§4.1) and a
-- read-then-increment would collide. The year is a display prefix only — the sequence
-- deliberately does NOT reset annually, so a number is unique for the life of the system
-- and can never be reused after a year rolls over.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS "ticket_no_seq";
CREATE SEQUENCE IF NOT EXISTS "change_request_no_seq";
CREATE SEQUENCE IF NOT EXISTS "service_request_no_seq";


-- ---------------------------------------------------------------------------
-- §4.3 Issue taxonomy — two axes, product/module x issue type.
-- Owned reactively by the support lead via /admin/issue-categories. The axes are separate
-- columns rather than one opaque label because §4.8 reports (and the Phase 2 dashboard)
-- group by them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "issue_category" (
    "category_code"  TEXT         NOT NULL,
    "category_name"  TEXT         NOT NULL,
    "product_module" TEXT         NOT NULL,
    "issue_type"     TEXT         NOT NULL,   -- QUERY | COMPLAINT | BUG | SERVICE_REQUEST
    "description"    TEXT,
    "display_order"  INTEGER      NOT NULL DEFAULT 0,
    "is_active"      BOOLEAN      NOT NULL DEFAULT true,

    CONSTRAINT "issue_category_pkey" PRIMARY KEY ("category_code")
);

CREATE INDEX IF NOT EXISTS "issue_category_is_active_display_order_idx"
    ON "issue_category" ("is_active", "display_order");
CREATE INDEX IF NOT EXISTS "issue_category_product_module_issue_type_idx"
    ON "issue_category" ("product_module", "issue_type");


-- ---------------------------------------------------------------------------
-- §4.1/§4.2/§4.4 The ticket itself.
--
-- Never hard-deleted: merge and closure are state changes, so the audit trail in
-- ticket_event always resolves to a live row (§5, auditability / dispute resolution).
-- Every FK to user_details is RESTRICT for the same reason — attribution must survive,
-- and this app's convention is to deactivate users, not delete them.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ticket" (
    "id"        SERIAL NOT NULL,
    -- Allocated by the database so no intake path can create a ticket without a number.
    "ticket_no" TEXT   NOT NULL UNIQUE
        DEFAULT ('TKT-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
                 lpad(nextval('ticket_no_seq')::text, 6, '0')),

    -- Identity (§4.2). raiser_uid is NULL for a guest ticket and is backfilled on
    -- reconciliation; the guest_* columns are never cleared, so the row always shows what
    -- was actually captured at intake.
    "raiser_uid"       INTEGER REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "raiser_type"      TEXT    NOT NULL,   -- EMPLOYEE | CLIENT | PARTNER | PROSPECT | GUEST
    "guest_name"       TEXT,
    "guest_email"      TEXT,
    "guest_mobile"     TEXT,
    -- Set when an employee logs a ticket for a client (phone / WhatsApp intake).
    "on_behalf_of_uid" INTEGER REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "client_code"      TEXT,

    -- Classification and content (§4.1, §4.3).
    "channel"       TEXT NOT NULL,   -- WEBSITE | WHATSAPP | PHONE | SYNAPSE
    "category_code" TEXT NOT NULL REFERENCES "issue_category" ("category_code") ON DELETE RESTRICT ON UPDATE CASCADE,
    "subject"       TEXT NOT NULL,
    "description"   TEXT NOT NULL,
    "company_code"  TEXT NOT NULL REFERENCES "company_master" ("company_code") ON DELETE RESTRICT ON UPDATE CASCADE,

    -- Lifecycle (§4.5).
    "status"          TEXT    NOT NULL DEFAULT 'OPEN',
    -- OPEN | IN_PROGRESS | FORWARDED | AWAITING_CR_APPROVAL | RESOLVED | CLOSED | MERGED
    "assigned_to_uid" INTEGER REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "revised_eta"     TIMESTAMP(3),

    -- Timestamps.
    -- raised_at is immutable: when THIS ticket was actually raised. Never rewritten,
    -- including by a merge.
    "raised_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- The turnaround clock (§4.4, confirmed rule: earliest of the two on merge). Normally
    -- equals raised_at. Deliberately has NO default — the caller must set it explicitly, so
    -- a back-dated phone ticket cannot silently start its clock at now() and understate
    -- elapsed time in the §4.8 average-turnaround metric.
    "sla_clock_start_at" TIMESTAMP(3) NOT NULL,
    "first_response_at"  TIMESTAMP(3),
    "resolved_at"        TIMESTAMP(3),
    "closed_at"          TIMESTAMP(3),

    -- Merge (§4.4). Set on the ABSORBED ticket, pointing at the surviving thread.
    -- Non-NULL means this row is no longer tracked separately, so every report filters
    -- `merged_into_ticket_id IS NULL` and a merged pair counts once.
    "merged_into_ticket_id" INTEGER REFERENCES "ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "merged_at"             TIMESTAMP(3),

    "created_by" TEXT         NOT NULL,
    "updated_by" TEXT,
    "updated_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ticket_status_raised_at_idx"        ON "ticket" ("status", "raised_at");
CREATE INDEX IF NOT EXISTS "ticket_assigned_to_uid_status_idx"  ON "ticket" ("assigned_to_uid", "status");
CREATE INDEX IF NOT EXISTS "ticket_company_code_raised_at_idx"  ON "ticket" ("company_code", "raised_at");
CREATE INDEX IF NOT EXISTS "ticket_merged_into_ticket_id_idx"   ON "ticket" ("merged_into_ticket_id");
CREATE INDEX IF NOT EXISTS "ticket_raiser_uid_status_idx"       ON "ticket" ("raiser_uid", "status");
-- Serves the §4.4 duplicate probe: same category + still open + inside a rolling window.
CREATE INDEX IF NOT EXISTS "ticket_category_code_status_raised_at_idx"
    ON "ticket" ("category_code", "status", "raised_at");


-- ---------------------------------------------------------------------------
-- §4.5 Audit trail. Append-only: never updated, never deleted.
--
-- No foreign keys to user_details, and usernames are denormalised — same reasoning as
-- menu_usage_log. An audit row used to settle a dispute months later must stay readable
-- after the user it names is removed or renamed. ticket_id IS a real FK (RESTRICT), since
-- events are only ever read in the context of a ticket that must therefore still exist.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "ticket_event" (
    "id"         SERIAL  NOT NULL,
    "ticket_id"  INTEGER NOT NULL REFERENCES "ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "event_type" TEXT    NOT NULL,
    -- CREATED | STATUS_CHANGE | FORWARD | ASSIGN | REMARK | ETA_REVISED | MERGE
    -- | IDENTITY_RECONCILED | CR_PROPOSED | CR_APPROVED | CR_REJECTED | NOTIFICATION

    "from_status" TEXT,
    "to_status"   TEXT,

    "from_user_uid"  INTEGER,
    "from_username"  TEXT,
    "to_user_uid"    INTEGER,
    "to_username"    TEXT,

    -- §4.5 requires who, when AND why on every forward — the API makes this mandatory
    -- for FORWARD events.
    "remarks"     TEXT,
    "revised_eta" TIMESTAMP(3),
    -- MERGE only: the other ticket in the pair, so the trail reads two-way.
    "related_ticket_id" INTEGER REFERENCES "ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,

    "actor_uid"      INTEGER,
    "actor_username" TEXT         NOT NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ticket_event_ticket_id_created_at_idx"  ON "ticket_event" ("ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "ticket_event_event_type_created_at_idx" ON "ticket_event" ("event_type", "created_at");


-- ---------------------------------------------------------------------------
-- §4.6 Change request. One per originating ticket.
--
-- Two-step by design: the desk PROPOSES (approval_status PENDING, ticket moves to
-- AWAITING_CR_APPROVAL) and Product/Ops APPROVES — only then is the ticket closed and the
-- item parked in the backlog. §4.6 is explicit that the support desk cannot unilaterally
-- park an item, so approval cannot be a field simply set at creation time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "change_request" (
    "id"        SERIAL  NOT NULL,
    "cr_no"     TEXT    NOT NULL UNIQUE
        DEFAULT ('CR-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
                 lpad(nextval('change_request_no_seq')::text, 6, '0')),
    "ticket_id" INTEGER NOT NULL UNIQUE REFERENCES "ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,

    "title"       TEXT NOT NULL,
    "description" TEXT NOT NULL,

    "requested_by_uid" INTEGER      NOT NULL REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "requested_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approval_status"  TEXT         NOT NULL DEFAULT 'PENDING',   -- PENDING | APPROVED | REJECTED
    "approved_by_uid"  INTEGER REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "approved_at"      TIMESTAMP(3),
    "approval_remarks" TEXT,

    -- Only meaningful once approval_status = APPROVED.
    "backlog_status" TEXT,   -- BACKLOG | PLANNED | IN_DEVELOPMENT | RELEASED | DROPPED
    "target_release" TEXT,

    "created_by" TEXT         NOT NULL,
    "updated_by" TEXT,
    "updated_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "change_request_approval_status_requested_at_idx"
    ON "change_request" ("approval_status", "requested_at");


-- ---------------------------------------------------------------------------
-- §4.7 Document service requests. Deliberately NOT a ticket: no triage, no assignment,
-- no SLA clock.
--
-- deliver_to_email is resolved SERVER-SIDE from the matched client's registered email and
-- is never accepted from the request body. With no OTP step, that resolution IS the
-- verification — a caller-supplied address would make the control a no-op.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "service_request" (
    "id"            SERIAL NOT NULL,
    "request_no"    TEXT   NOT NULL UNIQUE
        DEFAULT ('SRQ-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
                 lpad(nextval('service_request_no_seq')::text, 6, '0')),
    "document_type" TEXT   NOT NULL,   -- LEDGER | MARGIN_REPORT | CONTRACT_NOTE
    "client_code"   TEXT,
    "from_date"     TIMESTAMP(3),
    "to_date"       TIMESTAMP(3),

    "requested_by_uid" INTEGER NOT NULL REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "for_client_uid"   INTEGER REFERENCES "user_details" ("uid") ON DELETE RESTRICT ON UPDATE CASCADE,
    "channel"          TEXT    NOT NULL,

    "deliver_to_email" TEXT NOT NULL,
    -- Employee-raised requests CC the client, so a document pulled on their account is
    -- always visible to them (§4.7).
    "cc_email"         TEXT,

    -- Which ReportDefinition produced the delivered PDF. Recorded because this flow
    -- replaces an OTP-verified one: "which query generated the document we emailed" has to
    -- be answerable long after the fact.
    "report_id" TEXT REFERENCES "report_definition" ("report_id") ON DELETE RESTRICT ON UPDATE CASCADE,

    "status"         TEXT         NOT NULL DEFAULT 'PENDING',   -- PENDING | GENERATED | SENT | FAILED
    "requested_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generated_at"   TIMESTAMP(3),
    "delivered_at"   TIMESTAMP(3),
    "failure_reason" TEXT,

    "created_by" TEXT         NOT NULL,
    "updated_by" TEXT,
    "updated_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_pkey" PRIMARY KEY ("id"),
    -- §4.7: a ledger request is meaningless without a client code. Mirrored in the zod
    -- schema so the user sees a field error rather than a 500.
    CONSTRAINT "service_request_ledger_client_chk"
        CHECK ("document_type" <> 'LEDGER' OR "client_code" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "service_request_status_requested_at_idx"
    ON "service_request" ("status", "requested_at");
CREATE INDEX IF NOT EXISTS "service_request_requested_by_uid_requested_at_idx"
    ON "service_request" ("requested_by_uid", "requested_at");
CREATE INDEX IF NOT EXISTS "service_request_client_code_document_type_idx"
    ON "service_request" ("client_code", "document_type");


-- ---------------------------------------------------------------------------
-- Outbound queue + inbound log. Not in BRS §6, but Phase 1 cannot be built without it:
-- §4.2 sends a registration notification, §4.7 emails a PDF, and WhatsApp needs both
-- directions. Synapse has no delivery infrastructure today (forgot-userid and
-- reset-password are capture-only), so rows are written QUEUED and nothing transmits
-- until a provider is wired behind sendMessage().
--
-- Both directions share one table so a ticket's WhatsApp thread is just this table
-- ordered by created_at.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "channel_message" (
    "id"        SERIAL NOT NULL,
    "direction" TEXT   NOT NULL,   -- INBOUND | OUTBOUND
    "channel"   TEXT   NOT NULL,   -- EMAIL | SMS | WHATSAPP
    "purpose"   TEXT   NOT NULL,
    -- TICKET_REGISTERED | STATUS_UPDATE | CR_CLOSURE | DOCUMENT_DELIVERY | INBOUND_INTAKE

    "ticket_id"          INTEGER REFERENCES "ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "service_request_id" INTEGER REFERENCES "service_request" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,

    "counterparty" TEXT NOT NULL,   -- email address or E.164 mobile
    "cc_list"      TEXT,
    "subject"      TEXT,
    "body"         TEXT NOT NULL,

    -- The provider's own id. UNIQUE is what makes WhatsApp intake idempotent: the Cloud API
    -- redelivers a webhook on any non-2xx, and without this a slow response creates
    -- duplicate tickets that then trip our own §4.4 duplicate detection.
    -- NULL until sent; Postgres permits many NULLs in a unique column, so queued outbound
    -- rows do not collide.
    "provider_message_id" TEXT UNIQUE,
    -- WhatsApp template used when replying outside the 24-hour customer service window.
    "template_name"       TEXT,

    "status"         TEXT         NOT NULL DEFAULT 'QUEUED',
    -- QUEUED | SENT | DELIVERED | FAILED | RECEIVED
    "attempts"       INTEGER      NOT NULL DEFAULT 0,
    "sent_at"        TIMESTAMP(3),
    "failure_reason" TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "channel_message_status_created_at_idx"
    ON "channel_message" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "channel_message_ticket_id_created_at_idx"
    ON "channel_message" ("ticket_id", "created_at");
CREATE INDEX IF NOT EXISTS "channel_message_service_request_id_idx"
    ON "channel_message" ("service_request_id");
