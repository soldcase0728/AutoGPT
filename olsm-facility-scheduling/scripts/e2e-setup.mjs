import { execSync } from "node:child_process";
import { e2eEnv, E2E_DATABASE_URL } from "./e2e-env.mjs";

/**
 * Prepare the end-to-end database: migrate, then seed. Runs against its own
 * database so a run never touches development or unit-test data.
 */
const env = e2eEnv();
const run = (cmd) => execSync(cmd, { stdio: "inherit", env });

console.log(`e2e database: ${E2E_DATABASE_URL.replace(/:[^:@]*@/, ":***@")}`);

run("npx prisma migrate deploy");
// Clear anything a previous run created, so the suite is repeatable.
run("npx tsx prisma/e2e-reset.ts");
run("npx tsx prisma/seed.ts");

console.log("e2e database ready.");
