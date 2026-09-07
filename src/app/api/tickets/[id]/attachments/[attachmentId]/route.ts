import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { getAttachmentForViewer } from "@/lib/tickets";

/**
 * Streams one attachment back.
 *
 * Deliberately NOT named via buildDownloadFilename(): that convention exists for files this
 * app generates (exports, reports), where a username and timestamp identify the export. This
 * is the user's own file coming back, and renaming "Q3 statement.pdf" to
 * "Admin001_20260907-121500.pdf" would destroy the only thing that makes it recognisable.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id, attachmentId } = await context.params;
  const ticketId = Number(id);
  const fileId = Number(attachmentId);
  if (!Number.isInteger(ticketId) || !Number.isInteger(fileId)) {
    return NextResponse.json({ error: "Unknown attachment." }, { status: 400 });
  }

  const file = await getAttachmentForViewer(ticketId, fileId, session.userUid, session.username);
  if (!file) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.byteSize),
      // Always an attachment, never inline: a stored file must not be rendered in the app's
      // own origin, where a crafted document could act with the viewer's session.
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      // The type was allow-listed on upload; this stops a browser second-guessing it anyway.
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
