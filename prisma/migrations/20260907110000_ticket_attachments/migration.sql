-- Ticket attachments (multi-file upload on the raise screen).
--
-- Applied by hand, not through `prisma migrate dev` / `db push`. See CLAUDE.md.
--
-- Bytes live in Postgres rather than on disk or in object storage, for two reasons: BRS §5
-- requires "no new datastore", and the app runs in an ephemeral container where anything
-- written to the filesystem is lost on the next deploy. It also means attachments are
-- covered by the database backup instead of needing a second backup story.
--
-- The size caps in src/lib/attachment-core.ts are what keeps this reasonable — without them
-- an unbounded upload becomes a database problem, not merely a disk one.

CREATE TABLE IF NOT EXISTS "ticket_attachment" (
    "id"          SERIAL  NOT NULL,
    "ticket_id"   INTEGER NOT NULL REFERENCES "ticket" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    "file_name"   TEXT    NOT NULL,
    "mime_type"   TEXT    NOT NULL,
    "byte_size"   INTEGER NOT NULL,
    -- The file itself. Postgres TOASTs this out of the main heap automatically, so a wide
    -- SELECT on ticket_attachment stays cheap as long as it does not ask for "content".
    "content"     BYTEA   NOT NULL,
    "uploaded_by" TEXT    NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachment_pkey" PRIMARY KEY ("id"),
    -- Belt and braces against the application-level cap: 5 MB, matching MAX_FILE_BYTES.
    CONSTRAINT "ticket_attachment_size_chk" CHECK ("byte_size" > 0 AND "byte_size" <= 5242880)
);

CREATE INDEX IF NOT EXISTS "ticket_attachment_ticket_id_idx" ON "ticket_attachment" ("ticket_id");
