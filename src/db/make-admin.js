import { pathToFileURL } from "node:url";
import { pool } from "./pool.js";

// Gives an existing account the admin role and approves it. The person must
// have logged in to the app once, so their account exists.
// Usage: npm run make-admin -- someone@example.org
export async function makeAdmin(email) {
  const { rows } = await pool.query(
    `UPDATE users SET role = 'admin', status = 'approved', updated_at = now()
     WHERE lower(email) = lower($1)
     RETURNING name, email`,
    [email]
  );
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const email = process.argv[2];
  try {
    if (!email) {
      console.error("Usage: npm run make-admin -- someone@example.org");
      process.exitCode = 1;
    } else {
      const updated = await makeAdmin(email);
      if (updated.length === 0) {
        console.error(`No account with email ${email}. Log in to the app once first.`);
        process.exitCode = 1;
      } else {
        updated.forEach((user) => console.log(`${user.name} (${user.email}) is now an admin.`));
      }
    }
  } finally {
    await pool.end();
  }
}
