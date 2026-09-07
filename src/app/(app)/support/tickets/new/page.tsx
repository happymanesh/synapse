import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canLogForOthers, listApplications, listSegments } from "@/lib/tickets";
import { formatDateTimeSeconds } from "@/lib/report-format";
import RaiseTicketForm from "./RaiseTicketForm";

export default async function RaiseTicketPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [applications, segments, logForOthers] = await Promise.all([
    listApplications(),
    listSegments(),
    canLogForOthers(session.userUid),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Raise a Ticket</h1>
      <p className="mb-5 text-sm text-foreground/60">
        Tell us what&apos;s wrong and we&apos;ll track it through to resolution.
      </p>
      <RaiseTicketForm
        applications={applications}
        segments={segments}
        canLogForOthers={logForOthers}
        // Formatted server-side so the time shown is the server's, which is the clock the
        // ticket will actually be stamped with — a browser clock can be minutes out.
        raisedAtLabel={formatDateTimeSeconds(new Date())}
      />
    </div>
  );
}
