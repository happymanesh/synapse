import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { canLogForOthers, listActiveCategories } from "@/lib/tickets";
import RaiseTicketForm from "./RaiseTicketForm";

export default async function RaiseTicketPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const [categories, logForOthers] = await Promise.all([
    listActiveCategories(),
    canLogForOthers(session.userUid),
  ]);

  return (
    <div className="max-w-3xl">
      <h1 className="mb-1 text-xl font-semibold text-foreground">Raise a Ticket</h1>
      <p className="mb-5 text-sm text-foreground/60">
        Tell us what&apos;s wrong and we&apos;ll track it through to resolution.
      </p>
      <RaiseTicketForm categories={categories} canLogForOthers={logForOthers} />
    </div>
  );
}
