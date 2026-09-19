const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  {
    ignores: ['node_modules/**', 'public/**', 'logs/**', 'views/**', 'db/*.sql']
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-console': 'off',
      semi: ['warn', 'never'],
      quotes: ['warn', 'single', { avoidEscape: true, allowTemplateLiterals: true }]
    }
  },
  {
    // 后台前端源码：浏览器 ESM（经 esbuild 打包到 public/console/editor.js）
    files: ['src/console/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser }
    }
  }
]
