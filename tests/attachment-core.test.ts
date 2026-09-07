import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkAttachment,
  safeFileName,
  extensionOf,
  formatBytes,
  MAX_FILE_BYTES,
  MAX_FILES_PER_TICKET,
  MAX_TOTAL_BYTES,
} from "../src/lib/attachment-core";

const empty = { count: 0, totalBytes: 0 };
const pdf = { fileName: "statement.pdf", mimeType: "application/pdf", byteSize: 1000 };

describe("safeFileName", () => {
  test("keeps an ordinary name, spaces and all", () => {
    assert.equal(safeFileName("Q3 statement (final).pdf"), "Q3 statement (final).pdf");
  });

  test("strips any directory component", () => {
    assert.equal(safeFileName("../../etc/passwd"), "passwd");
    assert.equal(safeFileName("C:\\Users\\bob\\ledger.pdf"), "ledger.pdf");
  });

  test("removes quotes, which would break out of the download header", () => {
    assert.equal(safeFileName('in"voice.pdf'), "invoice.pdf");
  });

  test("removes control characters", () => {
    assert.equal(safeFileName("bad\u0000name\u001f.pdf"), "badname.pdf");
  });

  test("never returns an empty name", () => {
    assert.equal(safeFileName(""), "attachment");
    assert.equal(safeFileName("///"), "attachment");
  });
});

describe("extensionOf", () => {
  test("is case insensitive and takes the last dot", () => {
    assert.equal(extensionOf("REPORT.PDF"), ".pdf");
    assert.equal(extensionOf("archive.tar.gz"), ".gz");
  });

  test("no extension yields empty", () => {
    assert.equal(extensionOf("README"), "");
  });
});

describe("checkAttachment — accepted", () => {
  test("a normal PDF passes and comes back with a cleaned name", () => {
    const r = checkAttachment({ ...pdf, fileName: "../statement.pdf" }, empty);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.fileName, "statement.pdf");
  });

  test("images, text and office documents are allowed", () => {
    for (const [name, type] of [
      ["shot.png", "image/png"],
      ["shot.jpeg", "image/jpeg"],
      ["notes.txt", "text/plain"],
      ["rows.csv", "text/csv"],
      ["book.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    ] as const) {
      assert.equal(checkAttachment({ fileName: name, mimeType: type, byteSize: 500 }, empty).ok, true, name);
    }
  });
});

describe("checkAttachment — rejected", () => {
  test("an empty file is rejected", () => {
    assert.equal(checkAttachment({ ...pdf, byteSize: 0 }, empty).ok, false);
  });

  test("a file over the per-file cap is rejected", () => {
    const r = checkAttachment({ ...pdf, byteSize: MAX_FILE_BYTES + 1 }, empty);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.reason.includes("per file"));
  });

  test("exactly at the per-file cap is allowed", () => {
    assert.equal(checkAttachment({ ...pdf, byteSize: MAX_FILE_BYTES }, empty).ok, true);
  });

  test("a disallowed type is rejected — the list is an allow-list", () => {
    // Archives hide their contents from this check; executables need no explanation.
    for (const [name, type] of [
      ["payload.zip", "application/zip"],
      ["run.exe", "application/x-msdownload"],
      ["page.html", "text/html"],
      ["script.js", "text/javascript"],
    ] as const) {
      assert.equal(checkAttachment({ fileName: name, mimeType: type, byteSize: 100 }, empty).ok, false, name);
    }
  });

  test("a type/extension mismatch is rejected", () => {
    // Either value alone is trivially spoofed; disagreement between them is the signal.
    const r = checkAttachment({ fileName: "invoice.exe", mimeType: "application/pdf", byteSize: 100 }, empty);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.reason.includes("doesn't match"));
  });

  test("the per-ticket file count is enforced", () => {
    assert.equal(checkAttachment(pdf, { count: MAX_FILES_PER_TICKET, totalBytes: 0 }).ok, false);
    assert.equal(checkAttachment(pdf, { count: MAX_FILES_PER_TICKET - 1, totalBytes: 0 }).ok, true);
  });

  test("the per-ticket total size is enforced across files already attached", () => {
    const r = checkAttachment({ ...pdf, byteSize: 1024 }, { count: 1, totalBytes: MAX_TOTAL_BYTES });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.reason.includes("past"));
  });
});

describe("formatBytes", () => {
  test("scales the unit so limits read plainly in an error message", () => {
    assert.equal(formatBytes(512), "512 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
  });
});
