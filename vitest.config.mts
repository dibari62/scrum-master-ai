import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // `tests-e2e/` belongs to Playwright: Vitest would try to run those specs
    // and fail on an import it knows nothing about.
    exclude: ["node_modules/**", "tests-e2e/**"],
    // Explicit imports from "vitest": no implicit globals, so a test file
    // reads the same way as any other module.
    globals: false,
    passWithNoTests: false,
    coverage: {
      reporter: ["text", "lcov"],
      include: ["src/**"],
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
