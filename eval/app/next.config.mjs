import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to the repo root. eval/app is a pnpm workspace
  // member (#1488), so its dependencies are symlinked from the root store and
  // tracing from this dir alone would miss them. There is one lockfile now, so
  // the ambiguity this setting originally worked around is gone.
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  // @genealogy/schema ships raw TypeScript (its `main` is ./src/index.ts), so
  // Next has to compile it rather than treat it as a built dependency. Only the
  // two value exports (getPreferredName, getPrimaryFact) need this; the type
  // imports erase at build.
  transpilePackages: ['@genealogy/schema'],
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
  // @genealogy/schema does `export * from './enums.generated.js'` against a file
  // that is really .ts (and gitignored — its own postinstall generates it).
  // TypeScript rewrites that specifier under moduleResolution: bundler and Vite
  // does too, which is why the package's other three consumers need nothing;
  // webpack does not, and fails `next build` with "Can't resolve
  // './enums.generated.js'". Measured, not anticipated (#1488). Keep `.js` last
  // so a genuine .js import still resolves.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
