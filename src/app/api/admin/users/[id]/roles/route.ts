import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { codesSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  const uid = Number(id);

  const user = await prisma.userDetails.findUnique({ where: { uid } });
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const [roles, mappings] = await Promise.all([
    // Scoped by company only — a role's hierarchy tier shouldn't gate whether it can be
    // assigned to a user in a different hierarchy (e.g. granting ADMIN to a CSO-tier user).
    prisma.roleMaster.findMany({
      where: { companyCode: user.companyCode, isActive: true },
      include: { hierarchy: true },
      orderBy: { roleCode: "asc" },
    }),
    prisma.userRoleMap.findMany({ where: { userUid: uid } }),
  ]);

  return NextResponse.json({
    items: roles.map((r) => ({
      code: r.roleCode,
      cells: {
        code: r.roleCode,
        name: r.roleName,
        hierarchy: r.hierarchy.hierarchyName,
        company: r.companyCode,
      },
    })),
    selected: mappings.map((m) => m.roleCode),
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  const uid = Number(id);
  try {
    const { codes } = codesSchema.parse(await request.json());

    await prisma.$transaction([
      prisma.userRoleMap.deleteMany({ where: { userUid: uid } }),
      prisma.userRoleMap.createMany({ data: codes.map((roleCode) => ({ userUid: uid, roleCode })) }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
