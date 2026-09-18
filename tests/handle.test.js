'use strict'
// tests/handle.test.js —— 统一错误处理包装（utils/handle.js）
const test = require('node:test')
const assert = require('node:assert/strict')

const { handle, STATUS_BY_CODE } = require('../utils/handle')
const CODE = require('../utils/code')

const fakeCtx = () => ({ status: 200, body: null })

test('业务错误（带 .code）→ 映射成语义化 HTTP status + 统一响应体', async () => {
  const ctx = fakeCtx()
  await handle(async () => {
    const e = new Error('资源不存在')
    e.code = CODE.NOT_FOUND
    throw e
  })(ctx)

  assert.equal(ctx.status, 404)
  assert.equal(ctx.body.code, CODE.NOT_FOUND)
  assert.equal(ctx.body.message, '资源不存在')
})

test('无权限 → 403；参数错误 → 400；未登录 → 401', async () => {
  for (const [codeValue, expected] of [
    [CODE.FORBIDDEN, 403],
    [CODE.PARAM_ERROR, 400],
    [CODE.UNAUTHENTICATED, 401],
    [CODE.CSRF_FAIL, 403],
    [CODE.RATE_LIMIT, 429]
  ]) {
    const ctx = fakeCtx()
    await handle(async () => {
      const e = new Error('x')
      e.code = codeValue
      throw e
    })(ctx)
    assert.equal(ctx.status, expected, `code=${codeValue} 应映射到 ${expected}`)
  }
})

test('非业务错误（没有 .code）必须继续抛出，交给全局 500 兜底', async () => {
  await assert.rejects(
    () => handle(async () => { throw new Error('数据库炸了') })(fakeCtx()),
    /数据库炸了/
  )
})

test('STATUS_BY_CODE 覆盖了所有"客户端类"错误码（防止漏配变成 200）', () => {
  for (const key of ['UNAUTHENTICATED', 'FORBIDDEN', 'PARAM_ERROR', 'NOT_FOUND', 'CSRF_FAIL', 'RATE_LIMIT']) {
    assert.ok(STATUS_BY_CODE[CODE[key]], `${key} 未配置 HTTP status`)
  }
})
