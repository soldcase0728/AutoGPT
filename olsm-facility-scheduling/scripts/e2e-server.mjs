import { spawn } from "node:child_process";
import { e2eEnv, E2E_PORT } from "./e2e-env.mjs";

/**
 * Start the built app against the e2e database with test fixtures enabled.
 *
 * E2E_FIXTURES is set only here. Nothing else in the project sets it, so the
 * fixture endpoints under /api/test are unreachable in development and refuse
 * to run at all when NODE_ENV is production.
 */
const portFlagIndex = process.argv.indexOf("--port");
const port = portFlagIndex !== -1 ? process.argv[portFlagIndex + 1] : E2E_PORT;

const child = spawn("npx", ["next", "start", "--port", String(port)], {
  stdio: "inherit",
  env: e2eEnv({ E2E_FIXTURES: "1", PORT: String(port) }),
});

child.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
