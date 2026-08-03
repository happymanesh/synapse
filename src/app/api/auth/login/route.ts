import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getClientIp, isIpAllowed } from "@/lib/ip-match";
import { createSession } from "@/lib/session";

async function logAttempt(params: {
  username: string;
  userUid: number | null;
  status: "SUCCESS" | "FAILURE";
  failureReason?: string;
  ipAddress: string;
  userAgent: string | null;
}) {
  await prisma.loginLog.create({
    data: {
      username: params.username,
      userUid: params.userUid ?? undefined,
      status: params.status,
      failureReason: params.failureReason,
      ipAddress: params.ipAddress,
      userAgent: params.userAgent ?? undefined,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const ipAddress = getClientIp(request.headers);
  const userAgent = request.headers.get("user-agent");

  if (!username || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const user = await prisma.userDetails.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    include: { company: true, hierarchy: true, ipMappings: true },
  });

  if (!user) {
    await logAttempt({ username, userUid: null, status: "FAILURE", failureReason: "UNKNOWN_USERNAME", ipAddress, userAgent });
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  if (!user.isActive) {
    await logAttempt({ username, userUid: user.uid, status: "FAILURE", failureReason: "USER_INACTIVE", ipAddress, userAgent });
    return NextResponse.json({ error: "This account is inactive. Contact your administrator." }, { status: 401 });
  }

  if (!user.company.isActive || !user.hierarchy.isActive) {
    await logAttempt({
      username,
      userUid: user.uid,
      status: "FAILURE",
      failureReason: "COMPANY_OR_HIERARCHY_INACTIVE",
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ error: "This account is not available. Contact your administrator." }, { status: 401 });
  }

  if (!isIpAllowed(ipAddress, user.ipMappings)) {
    await logAttempt({ username, userUid: user.uid, status: "FAILURE", failureReason: "IP_NOT_ALLOWED", ipAddress, userAgent });
    return NextResponse.json({ error: "Access is not allowed from this network." }, { status: 403 });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    await logAttempt({ username, userUid: user.uid, status: "FAILURE", failureReason: "BAD_PASSWORD", ipAddress, userAgent });
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  await logAttempt({ username, userUid: user.uid, status: "SUCCESS", ipAddress, userAgent });

  await createSession({
    userUid: user.uid,
    username: user.username,
    fullName: user.fullName,
    companyCode: user.companyCode,
    hierarchyCode: user.hierarchyCode,
    hierarchyName: user.hierarchy.hierarchyName,
    roles: [],
  });

  return NextResponse.json({ success: true });
}
