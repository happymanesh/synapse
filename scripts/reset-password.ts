/**
 * Reset a Synapse user's password from the command line.
 *
 * The admin UI route (/api/admin/users/[id]/reset-password) needs an admin
 * session, which is no help when the admin account is the one locked out.
 * This does the same work through the same helpers, so the password policy and
 * the reuse check still apply and PasswordHistory is still written.
 *
 *   npx tsx scripts/reset-password.ts Admin001
 *
 * Prompts for the password rather than taking it as an argument - an argument
 * ends up in the shell history and in the process list.
 */
import { createInterface } from "node:readline";
import { stdin, stdout } from "node:process";
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db";
import { checkPasswordPolicy, isPasswordReused } from "../src/lib/password-policy";

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    // Hide the typed characters.
    const onData = (char: Buffer) => {
      const s = char.toString();
      if (s === "\n" || s === "\r" || s === "\u0004") stdin.removeListener("data", onData);
      else stdout.write("\u001b[2K\u001b[200D" + question + "*".repeat(rl.line.length));
    };
    stdin.on("data", onData);
    rl.question(question, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("Usage: npx tsx scripts/reset-password.ts <username>");
    process.exit(1);
  }

  const user = await prisma.userDetails.findFirst({ where: { username } });
  if (!user) {
    console.error(`No Synapse user named "${username}".`);
    process.exit(1);
  }

  console.log(`Resetting password for ${user.username} (uid ${user.uid}, ${user.fullName}).`);
  console.log("At least 8 characters, one uppercase, one number, one special character (!@#$%^&*).\n");

  const password = await ask("New password: ");
  const again = await ask("Confirm:      ");

  if (password !== again) {
    console.error("They do not match. Nothing changed.");
    process.exit(1);
  }

  const policy = checkPasswordPolicy(password, user.username);
  if (!policy.valid) {
    console.error(policy.errors.join("\n"));
    process.exit(1);
  }

  const history = await prisma.passwordHistory.findMany({
    where: { userUid: user.uid },
    orderBy: { changedDate: "desc" },
    take: 3,
  });
  if (await isPasswordReused(password, history.map((h) => h.passwordHash))) {
    console.error("That matches one of the last 3 passwords. Choose another.");
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

  console.log(`\nDone. ${user.username} can sign in with the new password.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
