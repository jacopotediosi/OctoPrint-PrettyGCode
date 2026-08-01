const neostandard = require('neostandard')

module.exports = [
  ...neostandard({
    ts: true,
    env: ['browser'],
    globals: ['$', 'ko', 'OctoPrint', 'OCTOPRINT_VIEWMODELS', 'PrettyGCode', 'VERSION', 'PLUGIN_BASEURL'],
    ignores: ['octoprint_prettygcode/static/js/*.bundle.js']
  }),
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }]
    }
  }
]
