/**
 * Reset a Synapse user's password to a GENERATED value and write it to a file.
 *
 * Companion to reset-password.ts, for when the interactive prompt is not
 * practical. The value is never printed to stdout - it goes to the file named
 * by --out, so it does not end up in a shell history, a scrollback buffer, or
 * a chat transcript.
 *
 *   npx tsx scripts/reset-password-generated.ts Admin001 --out C:/tmp/pw.txt
 *
 * Local development only. Same policy and history checks as the admin route.
 */
import { writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { checkPasswordPolicy, isPasswordReused } from "../src/lib/password-policy";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%^&*";

function generate(): string {
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
  const all = UPPER + LOWER + DIGIT + SPECIAL;
  while (chars.length < 14) chars.push(pick(all));
  // Fisher-Yates, so the guaranteed character classes are not always in front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function main() {
  const username = process.argv[2];
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx > -1 ? process.argv[outIdx + 1] : null;

  if (!username || !out) {
    console.error("Usage: npx tsx scripts/reset-password-generated.ts <username> --out <file>");
    process.exit(1);
  }

  const user = await prisma.userDetails.findFirst({ where: { username } });
  if (!user) {
    console.error(`No Synapse user named "${username}".`);
    process.exit(1);
  }

  const history = await prisma.passwordHistory.findMany({
    where: { userUid: user.uid },
    orderBy: { changedDate: "desc" },
    take: 3,
  });

  let password = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generate();
    if (!checkPasswordPolicy(candidate, user.username).valid) continue;
    if (await isPasswordReused(candidate, history.map((h) => h.passwordHash))) continue;
    password = candidate;
    break;
  }
  if (!password) {
    console.error("Could not generate a password meeting the policy. Nothing changed.");
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    prisma.userDetails.update({
      where: { uid: user.uid },
      data: { passwordHash, lastPasswordChangedDate: new Date() },
    }),
    prisma.passwordHistory.create({ data: { userUid: user.uid, passwordHash } }),
  ]);

  writeFileSync(out, `Synapse login\nusername: ${user.username}\npassword: ${password}\n`, "utf8");
  console.log(`Reset ${user.username} (uid ${user.uid}). Password written to ${out}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
