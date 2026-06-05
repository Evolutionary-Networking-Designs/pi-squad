import { defineConfig } from "vitest/config";

const RUN_WEB_SMOKE = process.env.PISQUAD_WEB_SMOKE === "1";

export default defineConfig({
  test: {
    include: RUN_WEB_SMOKE
      ? ["src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.smoke.ts"]
      : ["src/**/*.test.ts"],
    passWithNoTests: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
