/**
 * Pure rules for ticket attachments: what may be uploaded, and how much.
 *
 * Deliberately free of `server-only` and of any Prisma import so it can be unit tested
 * directly (see tests/attachment-core.test.ts).
 *
 * The caps exist because the bytes live in Postgres (BRS §5: "no new datastore"), so an
 * unbounded upload is a database problem, not just a disk one.
 */

/** Per file. Comfortably covers a screenshot, a contract note or a statement. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Per ticket, across all its attachments. */
export const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
export const MAX_FILES_PER_TICKET = 5;

/**
 * Allow-list, not a block-list.
 *
 * A block-list is the wrong shape here: anything not thought of gets through, and these
 * files are handed back to other staff later. Everything here is inert when downloaded —
 * notably absent are archives (which hide their contents from this check) and anything
 * executable or script-like.
 */
export const ALLOWED_TYPES: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "text/plain": [".txt", ".log"],
  "text/csv": [".csv"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
};

export const ALLOWED_EXTENSIONS = Object.values(ALLOWED_TYPES).flat();

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i === -1 ? "" : fileName.slice(i).toLowerCase();
}

/**
 * Strips any directory component from an uploaded name.
 *
 * Browsers send only a basename, but the field is attacker-controlled: a crafted request can
 * put `../` or a Windows path in it. Nothing here writes to disk today, yet the name is echoed
 * back in a download header, so it is normalised at the boundary rather than trusted because
 * of how the happy path happens to behave.
 */
export function safeFileName(fileName: string): string {
  // Split on BOTH separators: a Windows client sends backslashes, and matching only "/"
  // would let "C:\Users\bob\ledger.pdf" through intact.
  const base = fileName.split(/[\\/]/).pop() ?? "";
  // Drop control characters and double quotes: both would break out of the quoted filename
  // in the Content-Disposition header this name ends up in. Filtering by code point rather
  // than a regex range keeps the intent legible and avoids an accidental range like [ -"],
  // which would silently strip ordinary spaces too. Spaces and punctuation are kept —
  // mangling "Q3 statement.pdf" would be unhelpful, not safer.
  const cleaned = [...base]
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && ch !== '"';
    })
    .join("")
    .trim();
  return cleaned.slice(0, 200) || "attachment";
}

export interface IncomingFile {
  fileName: string;
  mimeType: string;
  byteSize: number;
}

export type AttachmentCheck = { ok: true; fileName: string } | { ok: false; reason: string };

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Whether one file may be attached, given what the ticket already carries.
 *
 * The declared MIME type and the extension must agree. Either alone is trivially spoofed,
 * and a mismatch between them is a much better signal of something odd than either value
 * taken at face value.
 */
export function checkAttachment(
  file: IncomingFile,
  existing: { count: number; totalBytes: number }
): AttachmentCheck {
  const fileName = safeFileName(file.fileName);

  if (file.byteSize <= 0) return { ok: false, reason: `${fileName} is empty.` };
  if (file.byteSize > MAX_FILE_BYTES) {
    return { ok: false, reason: `${fileName} is ${formatBytes(file.byteSize)} — the limit is ${formatBytes(MAX_FILE_BYTES)} per file.` };
  }
  if (existing.count + 1 > MAX_FILES_PER_TICKET) {
    return { ok: false, reason: `A ticket can carry at most ${MAX_FILES_PER_TICKET} attachments.` };
  }
  if (existing.totalBytes + file.byteSize > MAX_TOTAL_BYTES) {
    return { ok: false, reason: `That would take the ticket past ${formatBytes(MAX_TOTAL_BYTES)} of attachments.` };
  }

  const allowedExtensions = ALLOWED_TYPES[file.mimeType];
  if (!allowedExtensions) {
    return { ok: false, reason: `${fileName} is a type we don't accept. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.` };
  }
  if (!allowedExtensions.includes(extensionOf(fileName))) {
    return { ok: false, reason: `${fileName} doesn't match its declared file type.` };
  }

  return { ok: true, fileName };
}
