import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getClientIp, isIpAllowed } from "@/lib/ip-match";
import { createSession } from "@/lib/session";
import { accountBlock } from "@/lib/auth-core";
import { countFrom, lockoutMessage, lockoutReason, windowStart } from "@/lib/login-throttle-core";

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

  // Checked before the user lookup, so an unknown username is throttled too — otherwise
  // username enumeration stays free. Matched case-insensitively, as the lookup below is.
  const now = new Date();
  const lastSuccess = await prisma.loginLog.findFirst({
    where: { username: { equals: username, mode: "insensitive" }, status: "SUCCESS" },
    orderBy: { loginTime: "desc" },
    select: { loginTime: true },
  });
  const [usernameFailures, ipFailures] = await Promise.all([
    prisma.loginLog.count({
      where: {
        username: { equals: username, mode: "insensitive" },
        status: "FAILURE",
        loginTime: { gt: countFrom(now, lastSuccess?.loginTime ?? null) },
      },
    }),
    prisma.loginLog.count({
      where: { ipAddress, status: "FAILURE", loginTime: { gt: windowStart(now) } },
    }),
  ]);
  const locked = lockoutReason(usernameFailures, ipFailures);
  if (locked) {
    // Logged as an attempt in its own right: a lockout that leaves no trace is invisible
    // to whoever has to work out afterwards what happened.
    await logAttempt({
      username,
      userUid: null,
      status: "FAILURE",
      failureReason: locked === "USERNAME" ? "LOCKED_OUT_USERNAME" : "LOCKED_OUT_IP",
      ipAddress,
      userAgent,
    });
    return NextResponse.json({ error: lockoutMessage(locked) }, { status: 429 });
  }

  const user = await prisma.userDetails.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    include: { company: true, hierarchy: true, ipMappings: true },
  });

  if (!user) {
    await logAttempt({ username, userUid: null, status: "FAILURE", failureReason: "UNKNOWN_USERNAME", ipAddress, userAgent });
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  }

  const block = accountBlock(user);
  if (block === "INACTIVE") {
    await logAttempt({ username, userUid: user.uid, status: "FAILURE", failureReason: "USER_INACTIVE", ipAddress, userAgent });
    return NextResponse.json({ error: "This account is inactive. Contact your administrator." }, { status: 401 });
  }
  if (block === "SUSPENDED") {
    await logAttempt({ username, userUid: user.uid, status: "FAILURE", failureReason: "USER_SUSPENDED", ipAddress, userAgent });
    return NextResponse.json({ error: "This account is suspended. Contact your administrator." }, { status: 401 });
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
    ...(user.mustChangePassword ? { mustChangePassword: true } : {}),
  });

  return NextResponse.json({ success: true, mustChangePassword: user.mustChangePassword });
}
