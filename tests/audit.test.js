'use strict'
// tests/audit.test.js —— 审计日志脱敏（services/auditService.sanitize）
// 这是**安全回归测试**：脱敏规则一旦被改坏，凭据就会被写进审计表。
const test = require('node:test')
const assert = require('node:assert/strict')

const audit = require('../services/auditService')

test('脱敏：password / token / csrf / captcha 一律替换为 [REDACTED]', () => {
  const out = audit.sanitize({
    username: 'admin',
    password: '123456',
    rpassword: '123456',
    token: 'abc',
    csrfToken: 'xyz',
    code: 'AB12'
  })
  assert.equal(out.username, 'admin', '非敏感字段应原样保留')
  assert.equal(out.password, '[REDACTED]')
  assert.equal(out.rpassword, '[REDACTED]')
  assert.equal(out.token, '[REDACTED]')
  assert.equal(out.csrfToken, '[REDACTED]')
  assert.equal(out.code, '[REDACTED]')
})

test('脱敏：超长字符串（富文本正文）会被截断，避免撑爆审计表', () => {
  const long = 'a'.repeat(5000)
  const out = audit.sanitize({ content: long })
  assert.ok(out.content.length < long.length, '必须被截断')
  assert.ok(out.content.includes('[truncated'), '应标注截断信息')
})

test('脱敏：非对象输入返回 null（不抛异常）', () => {
  assert.equal(audit.sanitize(null), null)
  assert.equal(audit.sanitize('abc'), null)
  assert.equal(audit.sanitize(undefined), null)
})
