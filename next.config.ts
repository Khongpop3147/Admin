import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  // Lets the dev server accept requests coming through the ngrok tunnel
  // (used to give Thunder a publicly reachable slip URL for testing locally).
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.io"],
};

export default nextConfig;
