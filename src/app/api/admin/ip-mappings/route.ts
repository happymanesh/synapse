import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ipMappingSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET() {
  await requireAdmin();
  const mappings = await prisma.userIpMapping.findMany({
    orderBy: { id: "asc" },
    include: { user: { select: { username: true, fullName: true } } },
  });
  return NextResponse.json(
    mappings.map((m) => ({
      id: m.id,
      userUid: m.userUid,
      username: `${m.user.username} (${m.user.fullName})`,
      ipMapping: m.ipMapping,
      isActive: m.isActive,
    }))
  );
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = ipMappingSchema.parse(await request.json());
    const created = await prisma.userIpMapping.create({
      data: body,
      include: { user: { select: { username: true, fullName: true } } },
    });
    return NextResponse.json(
      {
        id: created.id,
        userUid: created.userUid,
        username: `${created.user.username} (${created.user.fullName})`,
        ipMapping: created.ipMapping,
        isActive: created.isActive,
      },
      { status: 201 }
    );
  } catch (err) {
    return adminErrorResponse(err);
  }
}
