'use strict'
// tests/redirect.test.js —— 开放重定向防护（utils/redirect.js）
// 安全回归测试：这些用例保证"回跳地址"永远出不了本站。
const test = require('node:test')
const assert = require('node:assert/strict')

const { isSafeBackPath, safeBackPath } = require('../utils/redirect')

test('允许站内相对路径', () => {
  for (const p of ['/admin', '/admin/nav', '/admin/article/edit?id=abc', '/a?x=1&y=2#frag']) {
    assert.equal(isSafeBackPath(p), true, `应允许 ${p}`)
  }
})

test('拒绝外部绝对 URL（开放重定向的核心攻击面）', () => {
  for (const p of [
    'https://evil.example.com/steal',
    'http://evil.example.com',
    '//evil.example.com',      // 协议相对地址，浏览器会当跨站处理
    'javascript:alert(1)',
    'data:text/html,x'
  ]) {
    assert.equal(isSafeBackPath(p), false, `必须拒绝 ${p}`)
  }
})

test('拒绝反斜杠（部分浏览器会当斜杠解析）与空值', () => {
  assert.equal(isSafeBackPath('/\\evil.example.com'), false)
  assert.equal(isSafeBackPath(''), false)
  assert.equal(isSafeBackPath(null), false)
  assert.equal(isSafeBackPath(undefined), false)
  assert.equal(isSafeBackPath(123), false)
})

test('safeBackPath：不安全时回退到 fallback', () => {
  assert.equal(safeBackPath('https://evil.example.com'), '/admin')
  assert.equal(safeBackPath('/admin/nav'), '/admin/nav')
  assert.equal(safeBackPath(null, '/admin'), '/admin')
  assert.equal(safeBackPath('', '/fallback'), '/fallback')
})
