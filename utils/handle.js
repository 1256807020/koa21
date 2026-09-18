'use strict'
// utils/handle.js
// ============================================================
// 统一错误处理包装（JSON API 路由复用）
// 教学点（踩坑回顾）：koa 会捕获 async 路由里 throw 的错误并冒泡到全局错误中间件，
// 而全局中间件是"兜底层"（返回 500 + 统一响应体）。业务错误应该走**可控出口**：
//   - service 抛出带 .code 的错误（如 NOT_FOUND / PARAM_ERROR）
//   - 由 handle 捕获 → 映射成语义化 HTTP status → fail() 统一出参
// 这样业务错误不会被误判成 500，也不会污染错误日志的严重级别。
// ============================================================
const { fail } = require('./response')
const CODE = require('./code')

// 业务错误码 → 语义化 HTTP 状态（便于网关/前端按 status 做通用处理）
const STATUS_BY_CODE = {
  [CODE.UNAUTHENTICATED]: 401,
  [CODE.FORBIDDEN]: 403,
  [CODE.CSRF_FAIL]: 403,
  [CODE.PARAM_ERROR]: 400,
  [CODE.NOT_FOUND]: 404,
  [CODE.RATE_LIMIT]: 429
}

/**
 * 包装路由处理函数：业务错误 → fail()；未预期的异常继续冒泡（交给全局 500 兜底）
 * @param {(ctx: import('koa').Context) => Promise<any>} fn
 */
function handle (fn) {
  return async (ctx) => {
    try {
      await fn(ctx)
    } catch (err) {
      const c = err.code || CODE.UNKNOWN
      // 未知错误（非业务错误）继续抛出，让全局中间件记录堆栈并返回 500
      if (!err.code) throw err
      fail(ctx, c, err.message, err.details || null, STATUS_BY_CODE[c] || 200)
    }
  }
}

module.exports = { handle, STATUS_BY_CODE }
