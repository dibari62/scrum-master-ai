import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

/**
 * Flat config. Encodes the rules of AGENTS.md §7 and
 * .github/instructions/typescript.instructions.md that a linter can enforce:
 * no `any`, no `console.log` in application code.
 */
const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "coverage/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // R4/§7: `any` disables the type system, which is the whole safety net here.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // §7: application code logs through src/lib/logger, never console.
      "no-console": "error",
      // §7: a silent catch hides failures instead of handling them.
      "no-empty": ["error", { allowEmptyCatch: false }],
      eqeqeq: ["error", "smart"],
    },
  },

  {
    // The logger is the single place allowed to touch the console: it *is* the
    // sink the rule above redirects everyone to.
    files: ["src/lib/logger.ts"],
    rules: { "no-console": "off" },
  },

  {
    // Tooling, tests and eval runners are not application code.
    files: [
      "scripts/**",
      "tests/**",
      "evals/**",
      "*.config.{ts,mts,js,mjs}",
      "*.config.*.{ts,mts,js,mjs}",
    ],
    rules: { "no-console": "off" },
  },
];

export default config;
