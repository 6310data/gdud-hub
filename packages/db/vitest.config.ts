import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // the flow tests replay every migration on PGlite; under `pnpm test` they share the CPU with the other packages
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
