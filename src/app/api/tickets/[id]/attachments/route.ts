import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { addAttachment, getTicketForViewer } from "@/lib/tickets";
import { MAX_FILES_PER_TICKET } from "@/lib/attachment-core";

/**
 * Uploads files against a ticket.
 *
 * Authorised through `getTicketForViewer`, so the same rule that decides who may read a
 * ticket decides who may attach to it — rather than a second, drifting notion of access.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { id } = await context.params;
  const ticketId = Number(id);
  if (!Number.isInteger(ticketId)) {
    return NextResponse.json({ error: "Unknown ticket." }, { status: 400 });
  }

  const ticket = await getTicketForViewer(ticketId, session.userUid, session.username);
  if (!ticket) {
    // Same response for "no such ticket" and "not yours", so this cannot be used to probe
    // which ticket numbers exist.
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Could not read the uploaded files." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were attached." }, { status: 400 });
  }
  if (files.length > MAX_FILES_PER_TICKET) {
    return NextResponse.json(
      { error: `At most ${MAX_FILES_PER_TICKET} files can be attached at once.` },
      { status: 400 }
    );
  }

  const saved: { id: number; fileName: string; byteSize: number }[] = [];
  const rejected: string[] = [];

  // Sequential, not parallel: each file's admissibility depends on the running total of what
  // has already been stored, so checking them concurrently could let the cap be overshot.
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      saved.push(
        await addAttachment(ticketId, { fileName: file.name, mimeType: file.type, bytes }, session.username)
      );
    } catch (err) {
      // One bad file should not discard the good ones the user also chose.
      rejected.push(err instanceof Error ? err.message : `${file.name} could not be attached.`);
    }
  }

  return NextResponse.json({ saved, rejected }, { status: saved.length > 0 ? 201 : 400 });
}
