'use strict'
// middleware/rateLimit.js
// ============================================================
// 全局请求限流（P2 · 可观测性 / 抗刷）
//
// 与 middleware/loginRateLimit.js 的区别：
//   - 本文件：按 **IP** 统计"请求总次数"，目的是防接口被刷、保护服务端；
//   - loginRateLimit：按 **账号** 统计"登录失败次数"，目的是防爆破 + 账号锁定。
//   两者维度不同，互补。
//
// 存储：统一走 model/store.js —— 配了 Redis 就用 Redis（**多实例共享计数**），
//       没配则自动降级为进程内 Map（单实例可用；多实例会各算一份，限额被放大 N 倍）。
//
// 教学点：
//   1) 固定窗口限流：把"窗口编号"拼进 key（`...:<floor(now/window)>`），
//      这样不需要在自增后再去设置过期时间，天然没有"先 incr 再 expire"之间的竞态，
//      也保证每个窗口都是全新的计数。
//   2) 限流器故障要 **fail-open**：如果计数存储挂了，宁可放行也不要让全站 5xx。
//      限流是"最后一道护栏"，不是安全边界——真正的安全在鉴权/CSRF/RBAC。
// ============================================================
const CODE = require('../utils/code')
const { fail } = require('../utils/response')
const createLogger = require('../model/logger')
const store = require('../model/store')

const log = createLogger('rateLimit')

/**
 * 创建限流中间件
 * @param {object} opts
 * @param {number} [opts.windowMs] 统计窗口（毫秒）
 * @param {number} [opts.max] 窗口内允许的最大请求数
 * @param {(ctx)=>boolean} [opts.skip] 返回 true 则跳过限流（如静态资源、健康检查）
 */
function createRateLimit ({ windowMs = 60 * 1000, max = 300, skip } = {}) {
  return async function rateLimit (ctx, next) {
    if (typeof skip === 'function' && skip(ctx)) return next()

    const ip = ctx.ip || 'unknown'
    // 窗口编号：同一窗口内共享同一个 key，窗口一换 key 就变（旧 key 靠 TTL 自动回收）
    const windowIndex = Math.floor(Date.now() / windowMs)
    const key = `ratelimit:${ip}:${windowIndex}`

    let count
    try {
      count = await store.incr(key, windowMs)
    } catch (err) {
      // fail-open：计数存储不可用时放行，避免"限流器故障"升级成"全站不可用"
      log.error(`限流计数失败，本次放行（${err.message}）`)
      return next()
    }

    const remaining = Math.max(0, max - count)
    // 把配额信息放进响应头，方便前端/网关感知（业界惯例）
    ctx.set('X-RateLimit-Limit', String(max))
    ctx.set('X-RateLimit-Remaining', String(remaining))

    if (count > max) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (Date.now() % windowMs)) / 1000))
      ctx.set('Retry-After', String(retryAfter))
      if (ctx.path.startsWith('/api')) {
        return fail(ctx, CODE.RATE_LIMIT, '请求过于频繁，请稍后再试', null, 429)
      }
      ctx.status = 429
      ctx.body = '请求过于频繁，请稍后再试'
      return
    }

    return next()
  }
}

module.exports = { createRateLimit }
