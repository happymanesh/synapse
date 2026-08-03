import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { userCreateSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";
import { checkPasswordPolicy } from "@/lib/password-policy";
import { getUsersPage } from "@/lib/admin-users";

export async function GET(request: NextRequest) {
  await requireAdmin();
  const searchParams = request.nextUrl.searchParams;
  const page = Number(searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(searchParams.get("pageSize") ?? "20") || 20;
  const company = searchParams.get("company") || undefined;
  const search = searchParams.get("search") || undefined;

  const { rows, total } = await getUsersPage({ page, pageSize, company, search });
  return NextResponse.json({ rows, total });
}

export async function POST(request: NextRequest) {
  await requireAdmin();
  try {
    const body = userCreateSchema.parse(await request.json());

    const policy = checkPasswordPolicy(body.password, body.username);
    if (!policy.valid) {
      return NextResponse.json({ error: policy.errors.join(" ") }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.userDetails.create({
        data: {
          companyCode: body.companyCode,
          username: body.username,
          passwordHash,
          customerId: body.customerId,
          fullName: body.fullName,
          mobile: body.mobile,
          email: body.email,
          hierarchyCode: body.hierarchyCode,
          clientCategoryCode: body.clientCategoryCode,
          isActive: body.isActive,
          lastPasswordChangedDate: new Date(),
        },
      });
      await tx.passwordHistory.create({ data: { userUid: user.uid, passwordHash } });
      return user;
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
