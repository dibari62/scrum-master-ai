import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Type errors must break the build: the pipeline is the judge (AGENTS.md R5).
  // Never set this to `true` to unblock a deploy.
  // Linting is not part of `next build` since Next 16: it runs as its own step
  // in `npm run verify` and in the CI `quality` job.
  typescript: { ignoreBuildErrors: false },

  // `next dev` otherwise appends a block of its own to AGENTS.md on every run.
  // That file is this project's constitution, versioned and reviewed by a human:
  // no tool gets to edit it silently, and a dev server must never dirty the
  // working tree.
  agentRules: false,
};

export default nextConfig;
