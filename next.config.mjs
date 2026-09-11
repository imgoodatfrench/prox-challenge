/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Agent SDK spawns the bundled Claude Code runtime as a subprocess and
  // must not be bundled/traced by webpack. Keep it external on the server.
  experimental: {
    serverComponentsExternalPackages: [
      "@anthropic-ai/claude-agent-sdk",
      "@anthropic-ai/sdk",
    ],
  },
};

export default nextConfig;
