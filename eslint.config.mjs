export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2018,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        location: 'writable',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        module: 'writable',
        self: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error'
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        globalThis: 'readonly',
        global: 'writable',
        console: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': 'warn'
    }
  }
];
