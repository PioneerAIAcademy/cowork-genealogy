import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  { ignores: ['**/node_modules', '**/dist', '**/out'] },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    // Plain-JS build scripts. The TS recommended set is applied unscoped above,
    // so `explicit-function-return-type` fires on every function in a .mjs file,
    // where there is no syntax to satisfy it. Nothing else here needs relaxing:
    // `no-unused-vars` already applies to these files and reports correctly
    // (verified by removing this block and re-running).
    //
    // An unused import did ship in `check-packaged-deps.mjs`, but not because a
    // rule was missing — nothing runs eslint at all. There is no `lint` task in
    // turbo.json and no workflow invokes it, so the rule that would have caught
    // it never ran. (#1070 review)
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  eslintConfigPrettier
)
