/**
 * Reset a Synapse password using raw SQL.
 *
 * The Prisma-based scripts cannot run here: Synapse's schema declares columns
 * (user_details.hr_employee_id) that the local database does not have yet,
 * because the HR-sync migration is unapplied. Prisma selects every column of a
 * model, so any read of UserDetails fails with P2022 until that lands.
 *
 * This touches only the three columns it needs, so it works either side of
 * that migration. Local development only.
 *
 *   npx tsx scripts/reset-password-raw.ts Admin001 --out C:/tmp/pw.txt
 *
 * The generated password goes to the file, never to stdout.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { Client } from "pg";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGIT = "23456789";
const SPECIAL = "!@#$%^&*";

/** Mirrors src/lib/password-policy.ts: 8+, upper, digit, special, not the username. */
function generate(username: string): string {
  const pick = (s: string) => s[randomInt(s.length)];
  for (let attempt = 0; attempt < 50; attempt++) {
    const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)];
    const all = UPPER + LOWER + DIGIT + SPECIAL;
    while (chars.length < 14) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const pw = chars.join("");
    if (pw.toLowerCase() === username.toLowerCase()) continue;
    if (!/[A-Z]/.test(pw) || !/[0-9]/.test(pw) || !/[!@#$%^&*]/.test(pw)) continue;
    return pw;
  }
  throw new Error("Could not generate a compliant password");
}

async function main() {
  const username = process.argv[2];
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx > -1 ? process.argv[outIdx + 1] : null;
  if (!username || !out) {
    console.error("Usage: npx tsx scripts/reset-password-raw.ts <username> --out <file>");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ uid: number; username: string }>(
      "SELECT uid, username FROM user_details WHERE username = $1",
      [username],
    );
    const user = rows[0];
    if (!user) throw new Error(`No Synapse user named "${username}"`);

    // Honour the "not one of the last 3" rule the admin route enforces.
    const history = await client.query<{ password_hash: string }>(
      "SELECT password_hash FROM password_history WHERE user_uid = $1 ORDER BY changed_date DESC LIMIT 3",
      [user.uid],
    );

    let password = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const candidate = generate(user.username);
      let reused = false;
      for (const h of history.rows) {
        if (h.password_hash && (await bcrypt.compare(candidate, h.password_hash))) reused = true;
      }
      if (!reused) {
        password = candidate;
        break;
      }
    }
    if (!password) throw new Error("Could not find a password that is not a recent reuse");

    const hash = await bcrypt.hash(password, 10);
    await client.query("BEGIN");
    await client.query(
      "UPDATE user_details SET password_hash = $1, last_password_changed_date = NOW() WHERE uid = $2",
      [hash, user.uid],
    );
    await client.query(
      "INSERT INTO password_history (user_uid, password_hash, changed_date) VALUES ($1, $2, NOW())",
      [user.uid, hash],
    );
    await client.query("COMMIT");

    writeFileSync(out, `Synapse login\nusername: ${user.username}\npassword: ${password}\n`, "utf8");
    console.log(`Reset ${user.username} (uid ${user.uid}). Password written to ${out}`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
