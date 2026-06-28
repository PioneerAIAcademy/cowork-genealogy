import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// eslint-config-next@15.5.x ships only the legacy eslintrc format, so the
// configs are loaded through FlatCompat rather than imported as native flat
// config arrays. When eslint-config-next gains native flat-config exports
// (16+), this shim can be dropped in favor of direct imports.
const eslintConfig = [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'lib/schema/**',
    ],
  },
];

export default eslintConfig;
