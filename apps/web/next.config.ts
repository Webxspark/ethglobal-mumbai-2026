import type { NextConfig } from "next";
import { allowedDevOriginsFromEnv } from "./src/lib/public-url";

const mcpUpstream =
  process.env.PROOFWORK_MCP_URL ??
  process.env.MCP_URL ??
  "http://127.0.0.1:38472";

const nextConfig: NextConfig = {
  transpilePackages: ["@proofwork/shared"],
  // Cloudflare / ngrok tunnels need the public host for HMR + assets.
  allowedDevOrigins: allowedDevOriginsFromEnv(),
  // Hide the Next.js corner indicator — its full-screen hit target can eat
  // demo clicks in automated / agent browsers (sheets still work when clear).
  devIndicators: false,
  // Interactive sheets (Agent Pass / IDKit) need full client hydration for the demo.
  cacheComponents: false,
  partialPrefetching: false,
  // wagmi / WalletConnect / pino optional deps that blow up Turbopack + webpack
  serverExternalPackages: [
    "pino",
    "pino-pretty",
    "thread-stream",
    "lokijs",
    "encoding",
    "@walletconnect/logger",
    "@walletconnect/relay-auth",
    "@walletconnect/universal-provider",
    "@walletconnect/ethereum-provider",
  ],
  // Fallback rewrite if the App Router proxy at app/api/mcp/[...path] is absent.
  // Prefer the route handler — it forwards Authorization / X-PROOFWORK-CONNECT.
  async rewrites() {
    return [
      {
        source: "/api/mcp/:path*",
        destination: `${mcpUpstream.replace(/\/$/, "")}/:path*`,
      },
    ];
  },
  // Production + `next dev --webpack`: strip `node:` scheme then stub builtins
  // when a shared barrel leaks into a client chunk (attachments / rp crypto).
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: {
          request: string;
        }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        crypto: false,
        stream: false,
        net: false,
        tls: false,
        "fs/promises": false,
      };
    }
    return config;
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: {
      "node:fs": { browser: "./src/lib/empty-module.ts" },
      "node:fs/promises": { browser: "./src/lib/empty-module.ts" },
      "node:path": { browser: "./src/lib/empty-module.ts" },
      "node:crypto": { browser: "./src/lib/empty-module.ts" },
    },
  },
};

export default nextConfig;
