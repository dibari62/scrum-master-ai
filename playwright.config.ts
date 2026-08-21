import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * These tests cover the one path unit tests cannot reach: a server action
 * invoked from a real form. The action identifier is generated at build time,
 * so no HTTP client can call it by hand — only a browser that loaded the page.
 *
 * They write to a real database, so they are opt-in through `RUN_E2E=1` for the
 * same reason as the integration suite: `npm run verify` and CI must never touch
 * whatever database a developer happens to have configured.
 */

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = 3210;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests-e2e",
  // A shared database means parallel workers would collide on the fixtures they
  // create and delete. Correctness first; the suite is small.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: process.env["CI"] ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chrome",
      use: {
        ...devices["Desktop Chrome"],
        // The Google Chrome already installed, rather than a downloaded
        // Chromium: behind a TLS-inspecting proxy the download fails, and this
        // also tests the browser people actually use.
        channel: "chrome",
      },
    },
  ],

  webServer: {
    // A production build, not `next dev`: the development server hides
    // behaviours that only appear in the build that gets deployed.
    command: `npm run build && npm start -- -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env["CI"],
    timeout: 180_000,
    env: {
      // Auth.js gives AUTH_URL precedence over `trustHost`, so a value
      // inherited from .env.local would redirect every successful sign-in to
      // the wrong port and fail the suite for the wrong reason.
      AUTH_URL: BASE_URL,
    },
  },
});
