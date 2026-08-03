import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { codesSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: roleCode } = await context.params;

  const role = await prisma.roleMaster.findUnique({ where: { roleCode } });
  if (!role) {
    return NextResponse.json({ error: "Role not found." }, { status: 404 });
  }

  const [menus, mappings] = await Promise.all([
    prisma.menuMaster.findMany({
      where: { companyCode: role.companyCode, hierarchyCode: role.hierarchyCode },
      orderBy: [{ level: "asc" }, { displayOrder: "asc" }],
    }),
    prisma.roleMenuMap.findMany({ where: { roleCode } }),
  ]);

  return NextResponse.json({
    items: menus.map((m) => ({
      code: m.menuCode,
      cells: {
        code: m.menuCode,
        name: m.menuName,
        level: String(m.level),
        parent: m.parentMenuCode ?? "—",
        route: m.routePath ?? "—",
      },
    })),
    selected: mappings.map((m) => m.menuCode),
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id: roleCode } = await context.params;
  try {
    const { codes } = codesSchema.parse(await request.json());
    const role = await prisma.roleMaster.findUnique({ where: { roleCode } });
    if (!role) {
      return NextResponse.json({ error: "Role not found." }, { status: 404 });
    }

    await prisma.$transaction([
      prisma.roleMenuMap.deleteMany({ where: { roleCode } }),
      prisma.roleMenuMap.createMany({
        data: codes.map((menuCode) => ({
          roleCode,
          menuCode,
          companyCode: role.companyCode,
          hierarchyCode: role.hierarchyCode,
        })),
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
