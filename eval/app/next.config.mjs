import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to this app dir. Without it, Next.js walks up
  // and finds both eval/app/package-lock.json and the repo's pnpm-lock.yaml,
  // can't pick a workspace root, and warns. eval/app is npm-managed and not a
  // pnpm workspace member, so it is its own root.
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
};

export default nextConfig;
