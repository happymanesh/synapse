import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { notificationSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const notifications = await prisma.notification.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(notifications);
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  try {
    const body = notificationSchema.parse(await request.json());
    const created = await prisma.notification.create({ data: { ...body, senderUid: session.userUid } });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
