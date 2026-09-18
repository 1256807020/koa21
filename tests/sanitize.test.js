'use strict'
// tests/sanitize.test.js —— 富文本 XSS 净化（utils/sanitize.js）
// 这些用例就是"安全回归测试"：以后换白名单/升级 sanitize-html 时，跑一遍就知道有没有放开口子。
const test = require('node:test')
const assert = require('node:assert/strict')

const { sanitizeArticle } = require('../utils/sanitize')

test('剥离 <script>', () => {
  const out = sanitizeArticle('<script>alert(1)</script><p>正文</p>')
  assert.ok(!out.includes('<script'), '不能残留 script')
  assert.ok(out.includes('<p>正文</p>'), '正常标签应保留')
})

test('剥离事件属性（onerror/onclick 等）', () => {
  const out = sanitizeArticle('<img src=x onerror=alert(1)>')
  assert.ok(!/onerror/i.test(out), 'on* 事件属性必须被剥离')
})

test('剥离 javascript: 协议', () => {
  const out = sanitizeArticle('<a href="javascript:alert(1)">x</a>')
  assert.ok(!/javascript:/i.test(out), 'javascript: 协议必须被剥离')
})

test('保留合法标签，并给外链补 rel=noopener', () => {
  const out = sanitizeArticle('<b>粗体</b><a href="https://example.com">链</a>')
  assert.ok(out.includes('<b>粗体</b>'), '<b> 属于白名单')
  assert.ok(out.includes('rel="noopener noreferrer"'), '外链必须补 rel，防 tabnabbing')
})

test('非字符串 / 空值返回空串（不抛异常）', () => {
  assert.equal(sanitizeArticle(null), '')
  assert.equal(sanitizeArticle(undefined), '')
  assert.equal(sanitizeArticle(''), '')
  assert.equal(sanitizeArticle(123), '')
})
