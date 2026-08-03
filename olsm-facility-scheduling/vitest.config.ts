import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests share one Postgres database; run files serially so
    // exclusion-constraint assertions are not fighting each other.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Modules that must not reach the browser carry `import "server-only"`,
      // which throws anywhere that is not a React Server Component -- including
      // here. Stub it so those modules stay testable without weakening the
      // guard in the application itself.
      "server-only": fileURLToPath(
        new URL("./tests/helpers/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
