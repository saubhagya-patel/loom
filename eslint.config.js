import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'agent-cache/**',
      'backend/prisma/**',
      'backend/generated/**',
    ],
  },
  js.configs.recommended,
  {
    // Type-aware rules only for backend TypeScript. no-floating-promises alone
    // justifies the extra config: an unawaited promise is the classic Node bug
    // and it cannot be caught without type information.
    files: ['backend/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: ['./backend/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // node:test's test() returns a promise the runner awaits itself.
    files: ['backend/tests/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
)
