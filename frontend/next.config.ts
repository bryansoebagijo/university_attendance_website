import type { NextConfig } from "next";

// Where the Express backend lives. Read at BUILD time for the /api rewrite below
// (Docker: http://backend:4000), and at runtime by server components (lib/server-session.ts).
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",
  // Lets a local production test build go to a separate folder without disturbing `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The browser only talks to this origin; /api/* is proxied to the Express backend.
  // Same-origin keeps the session cookie first-party and avoids CORS in the browser.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
