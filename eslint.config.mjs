// ESLint's flat config for the repo's JavaScript: the hook, the installer, the tools, the media scripts
// and the tests. pre-commit's eslint hook and CI's lint step run it (README.md, "CI").
//
// No imports: pre-commit installs eslint in an environment of its own, from which this file cannot
// resolve @eslint/js, so the rules are listed here. They are @eslint/js 10.0.1's recommended set.
const RECOMMENDED = `constructor-super for-direction getter-return no-async-promise-executor no-case-declarations
  no-class-assign no-compare-neg-zero no-cond-assign no-const-assign no-constant-binary-expression no-constant-condition
  no-control-regex no-debugger no-delete-var no-dupe-args no-dupe-class-members no-dupe-else-if no-dupe-keys
  no-duplicate-case no-empty no-empty-character-class no-empty-pattern no-empty-static-block no-ex-assign
  no-extra-boolean-cast no-fallthrough no-func-assign no-global-assign no-import-assign no-invalid-regexp
  no-irregular-whitespace no-loss-of-precision no-misleading-character-class no-new-native-nonconstructor
  no-nonoctal-decimal-escape no-obj-calls no-octal no-prototype-builtins no-redeclare no-regex-spaces no-self-assign
  no-setter-return no-shadow-restricted-names no-sparse-arrays no-this-before-super no-unassigned-vars no-undef
  no-unexpected-multiline no-unreachable no-unsafe-finally no-unsafe-negation no-unsafe-optional-chaining
  no-unused-labels no-unused-private-class-members no-unused-vars no-useless-assignment no-useless-backreference
  no-useless-catch no-useless-escape no-with preserve-caught-error require-yield use-isnan valid-typeof`.split(/\s+/);
const NODE_GLOBALS = ['process', 'console', 'Buffer', 'URL', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
  'setImmediate', 'structuredClone', 'TextDecoder', 'TextEncoder', 'AbortController', 'fetch', 'queueMicrotask', 'performance'];

export default [
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: Object.fromEntries(NODE_GLOBALS.map((g) => [g, 'readonly'])),
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: Object.fromEntries(RECOMMENDED.map((r) => [r, 'error'])),
  },
];
