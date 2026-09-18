'use strict'
// tests/response.test.js —— 统一响应体与错误码表
const test = require('node:test')
const assert = require('node:assert/strict')

const { ok, fail } = require('../utils/response')
const CODE = require('../utils/code')

test('ok：默认 code=0 / message=success', () => {
  const ctx = {}
  ok(ctx, { a: 1 })
  assert.deepEqual(ctx.body, { code: 0, message: 'success', data: { a: 1 } })
})

test('ok：不传 data 时为 null（字段始终存在，前端不必判 undefined）', () => {
  const ctx = {}
  ok(ctx)
  assert.deepEqual(ctx.body, { code: 0, message: 'success', data: null })
})

test('fail：默认 HTTP 200，业务错误靠 code 区分', () => {
  const ctx = {}
  fail(ctx, CODE.PARAM_ERROR, '参数错误')
  assert.equal(ctx.status, 200)
  assert.deepEqual(ctx.body, { code: CODE.PARAM_ERROR, message: '参数错误', data: null })
})

test('fail：允许覆盖 HTTP status（未登录 401 / 限流 429）', () => {
  const ctx = {}
  fail(ctx, CODE.UNAUTHENTICATED, '未登录', null, 401)
  assert.equal(ctx.status, 401)
})

test('错误码表：取值唯一，避免前端判错分支', () => {
  const values = Object.values(CODE)
  const unique = new Set(values)
  assert.equal(values.length, unique.size, '存在重复的错误码')
})

test('错误码表：SUCCESS 必须为 0（前后端约定的成功基准）', () => {
  assert.equal(CODE.SUCCESS, 0)
})
