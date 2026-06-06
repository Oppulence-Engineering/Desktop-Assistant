import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Architecture boundary (main / preload / renderer). The renderer is a
      // browser context: it must not pull in Node business logic (@x/core),
      // Electron, or Node built-ins — those belong to the main process and reach
      // the renderer only through the preload IPC bridge (window.ipc). Shared
      // types/utils live in @x/shared, which is allowed. See
      // docs/ENGINEERING_QUALITY_GATES_PLAN.md §6 (Layer 3 / P3).
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@x/core',
              message:
                'Renderer is a browser context — use @x/shared for types and window.ipc (preload) for main-process access, not @x/core.',
            },
            {
              name: 'electron',
              message:
                'Do not import electron in the renderer; go through the preload IPC bridge (window.ipc).',
            },
          ],
          patterns: [
            {
              group: ['@x/core', '@x/core/*'],
              message: 'Renderer must not reach into @x/core (main-process business logic).',
            },
            {
              group: ['node:*'],
              message:
                'No Node built-ins in the renderer (browser context). Use the preload IPC bridge.',
            },
          ],
        },
      ],
    },
  },
])
