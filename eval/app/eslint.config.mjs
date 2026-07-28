import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

// eslint-config-next@16+ ships native flat config, so these are imported
// directly rather than through the FlatCompat shim the 15.x line required.
// eslint stays on ^9: config-next 16 still bundles eslint-plugin-react 7.37.5,
// eslint-plugin-import 2.32.0 and eslint-plugin-jsx-a11y 6.10.2, all of which
// cap their eslint peer at 9 and break on 10 (removed `context.getFilename()`).
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
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
