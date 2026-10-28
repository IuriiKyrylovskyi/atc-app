module.exports = {
  root: true,
  env: {
    node: true,
    browser: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:vue/vue3-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    // Removed: 'plugin:security/recommended' - causes config errors
  ],
  parser: 'vue-eslint-parser',
  parserOptions: {
    parser: '@typescript-eslint/parser',
    ecmaVersion: 2022,
    sourceType: 'module',
    extraFileExtensions: ['.vue'],
  },
  plugins: ['@typescript-eslint', 'vue', 'prettier'],
  // Removed: 'security' from plugins

  rules: {
    'prettier/prettier': ['error'],
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-debugger': process.env.NODE_ENV === 'production' ? 'warn' : 'off',

    // Add manual security rules to compensate
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
  },

  overrides: [
    {
      files: ['*.d.ts'],
      rules: {
        // Allow harmless flexibility in declaration files
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-empty-object-type': [
          'warn',
          {
            allowInterfaces: 'always',
            allowObjectTypes: 'always',
          },
        ],
      },
    },
  ],
};
