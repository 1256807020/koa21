'use strict'
// tests/rateLimit.test.js —— 两个限流器
//   1) middleware/rateLimit.js       按 IP 的全局请求限流
//   2) middleware/loginRateLimit.js  按账号的登录失败锁定
const test = require('node:test')
const assert = require('node:assert/strict')

const { createRateLimit } = require('../middleware/rateLimit')
const loginLimit = require('../middleware/loginRateLimit')
const CODE = require('../utils/code')

/** 最小可用的假 ctx（限流中间件只用到 path/ip/set/status/body） */
function fakeCtx (path, ip) {
  return {
    path,
    ip,
    _headers: {},
    set (k, v) { this._headers[k] = v },
    status: 0,
    body: null
  }
}

test('全局限流：超过上限返回 429，且 API 走统一 JSON 响应体', async () => {
  const mw = createRateLimit({ windowMs: 1000, max: 2, skip: () => false })
  let passed = 0
  const next = async () => { passed++ }

  await mw(fakeCtx('/api/x', '10.0.0.1'), next)
  await mw(fakeCtx('/api/x', '10.0.0.1'), next)
  const third = fakeCtx('/api/x', '10.0.0.1')
  await mw(third, next)

  assert.equal(passed, 2, '前两次应放行')
  assert.equal(third.status, 429)
  assert.equal(third.body.code, CODE.RATE_LIMIT, '必须复用统一错误码表')
})

test('全局限流：不同 IP 各自计数，互不影响', async () => {
  const mw = createRateLimit({ windowMs: 1000, max: 1, skip: () => false })
  const next = async () => {}

  await mw(fakeCtx('/api/x', '10.0.0.2'), next)
  const other = fakeCtx('/api/x', '10.0.0.3') // 另一个 IP，仍应放行
  await mw(other, next)
  assert.equal(other.status, 0, '不同 IP 不应被误伤')
})

test('全局限流：skip 返回 true 的请求（如静态资源/healthz）不计入', async () => {
  const mw = createRateLimit({ windowMs: 1000, max: 1, skip: (ctx) => ctx.path === '/healthz' })
  const next = async () => {}
  for (let i = 0; i < 5; i++) {
    const ctx = fakeCtx('/healthz', '10.0.0.4')
    await mw(ctx, next)
    assert.equal(ctx.status, 0, 'healthz 永远不该被限流')
  }
})

test('登录限流：连续失败达阈值后锁定，成功后立即解锁', async () => {
  const user = `test_user_${Date.now()}`
  for (let i = 0; i < loginLimit.MAX_FAILS; i++) await loginLimit.onFailure(user)

  const lock = await loginLimit.checkLock(user)
  assert.ok(lock && lock.locked, `连续 ${loginLimit.MAX_FAILS} 次失败后必须锁定`)
  assert.ok(lock.retryAfter > 0, '应给出 retryAfter（秒）')

  await loginLimit.onSuccess(user)
  assert.equal(await loginLimit.checkLock(user), null, '登录成功后必须解锁')
})

test('登录限流：未达阈值不锁定', async () => {
  const user = `test_user_under_${Date.now()}`
  await loginLimit.onFailure(user)
  assert.equal(await loginLimit.checkLock(user), null)
})
