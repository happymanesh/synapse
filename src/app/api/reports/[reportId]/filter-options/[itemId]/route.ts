import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/session";
import { runParameterizedQuery } from "@/lib/report-sql";

export async function POST(request: NextRequest, context: { params: Promise<{ reportId: string; itemId: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const { itemId } = await context.params;

  const item = await prisma.filterDefinitionItem.findUnique({
    where: { id: Number(itemId) },
    include: { component: true },
  });
  if (!item) {
    return NextResponse.json({ error: "Filter item not found." }, { status: 404 });
  }
  if (item.component.dataSourceType !== "SQL" || !item.component.dataSourceQuery) {
    return NextResponse.json({ options: [] });
  }

  const body = await request.json().catch(() => ({}));
  const parentValue = body?.parentValue ?? null;

  try {
    const rows = await runParameterizedQuery<{ value: unknown; label: unknown }>(item.component.dataSourceQuery, {
      parentValue,
    });
    return NextResponse.json({ options: rows.map((r) => ({ value: String(r.value), label: String(r.label) })) });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Unable to load options." }, { status: 500 });
  }
}
