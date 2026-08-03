import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/admin",
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  // Lets the dev server accept requests coming through the ngrok tunnel
  // (used to give Thunder a publicly reachable slip URL for testing locally).
  allowedDevOrigins: ["*.ngrok-free.dev", "*.ngrok-free.app", "*.ngrok.io"],
  // The bare domain root sits outside basePath's URL space entirely — Next
  // 404s it before proxy.ts ever runs (verified empirically: no middleware
  // execution for paths outside the basePath prefix). redirects() runs even
  // earlier in the pipeline and, with basePath: false, can match/target
  // paths outside that space, which is the only way to bridge "/" into "/admin".
  async redirects() {
    return [
      {
        source: "/",
        destination: "/admin",
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
