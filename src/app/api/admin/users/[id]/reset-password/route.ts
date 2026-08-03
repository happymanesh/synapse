import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { passwordResetSchema } from "@/lib/admin-schemas";
import { adminErrorResponse } from "@/lib/admin-crud";
import { checkPasswordPolicy, isPasswordReused } from "@/lib/password-policy";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await context.params;
  const uid = Number(id);
  try {
    const { password } = passwordResetSchema.parse(await request.json());

    const user = await prisma.userDetails.findUnique({ where: { uid } });
    if (!user) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const policy = checkPasswordPolicy(password, user.username);
    if (!policy.valid) {
      return NextResponse.json({ error: policy.errors.join(" ") }, { status: 400 });
    }

    const history = await prisma.passwordHistory.findMany({
      where: { userUid: uid },
      orderBy: { changedDate: "desc" },
      take: 3,
    });
    const reused = await isPasswordReused(
      password,
      history.map((h) => h.passwordHash)
    );
    if (reused) {
      return NextResponse.json(
        { error: "Password must not match any of the last 3 passwords used." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.userDetails.update({ where: { uid }, data: { passwordHash, lastPasswordChangedDate: new Date() } }),
      prisma.passwordHistory.create({ data: { userUid: uid, passwordHash } }),
    ]);

    return NextResponse.json({ success: true });
  } catch (err) {
    return adminErrorResponse(err);
  }
}
