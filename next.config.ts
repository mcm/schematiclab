import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["3000--main--schematiclab-v2--steve.dev.smcm.xyz"],
  output: "standalone",
  // Native module; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@napi-rs/canvas"],
  // Files the MCP renderer (`src/lib/mcp/render.ts`), vanilla appearance
  // descriptors (`src/lib/mcp/vanilla-appearance.ts`), camo shape packs
  // (`src/lib/mcp/camo-options.ts`) and the build language
  // spec resource (`src/lib/mcp/build-tools.ts`) read from disk.
  outputFileTracingIncludes: {
    // A glob, so "[transport]" can't be written literally.
    "/api/mcp/*": [
      "./public/minecraft-assets/block-colors.json",
      "./public/minecraft-assets/atlas.png",
      "./public/minecraft-assets/atlas-uvs.json",
      "./public/minecraft-assets/blockstates.json",
      "./public/minecraft-assets/models.json",
      "./public/camo-shapes/*.json",
      "./src/lib/mcp/fonts/*.ttf",
      "./src/lib/buildlang/SPEC.md",
    ],
  },
  // The MCP route lives at `api/mcp/[transport]`; serve it at `/api/mcp`.
  async rewrites() {
    return [{ source: "/api/mcp", destination: "/api/mcp/mcp" }];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
