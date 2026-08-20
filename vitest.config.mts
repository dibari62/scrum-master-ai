import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
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
