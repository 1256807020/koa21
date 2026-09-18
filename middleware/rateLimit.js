'use strict'
// middleware/rateLimit.js
// ============================================================
// 全局请求限流（P2 · 可观测性 / 抗刷）
// 教学点：
//   1) 与 middleware/loginRateLimit.js 的区别：
//      - loginRateLimit：**按账号**统计"登录失败次数"，目的是防爆破与账号锁定；
//      - 本文件：**按 IP** 统计"请求总次数"，目的是防止接口被刷、被打爆（保护服务端）。
//      两者维度不同，互补，可同时启用。
//   2) 算法：固定窗口计数（实现最简单、够用）。更平滑可用"滑动窗口/令牌桶"（如 rate-limiter-flexible）。
//   3) 存储：进程内 Map，**只适合单实例**；多实例/集群必须换 Redis（各实例计数不共享，
//      否则 N 个实例等于把限额放大 N 倍）。
//   4) 限流是"最后一道护栏"，不是安全边界：真正的安全还在鉴权/CSRF/RBAC。
// ============================================================
const CODE = require('../utils/code')
const { fail } = require('../utils/response')

/**
 * 创建限流中间件
 * @param {object} opts
 * @param {number} [opts.windowMs] 统计窗口（毫秒）
 * @param {number} [opts.max] 窗口内允许的最大请求数
 * @param {(ctx)=>boolean} [opts.skip] 返回 true 则跳过限流（如静态资源、健康检查）
 */
function createRateLimit ({ windowMs = 60 * 1000, max = 300, skip } = {}) {
  // key = 客户端 IP，value = { count, resetAt }
  const hits = new Map()

  // 周期性清理过期记录，避免 Map 无限增长（内存泄漏）。
  // unref() 让定时器不阻止进程退出（很关键：否则优雅关闭/测试会挂住）。
  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, rec] of hits) {
      if (rec.resetAt <= now) hits.delete(key)
    }
  }, windowMs)
  if (typeof timer.unref === 'function') timer.unref()

  return async function rateLimit (ctx, next) {
    if (typeof skip === 'function' && skip(ctx)) return next()

    const key = ctx.ip || 'unknown'
    const now = Date.now()
    let rec = hits.get(key)

    // 窗口过期则重置
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs }
      hits.set(key, rec)
    }
    rec.count += 1

    // 把配额信息放进响应头，方便前端/网关感知（业界惯例）
    ctx.set('X-RateLimit-Limit', String(max))
    ctx.set('X-RateLimit-Remaining', String(Math.max(0, max - rec.count)))

    if (rec.count > max) {
      const retryAfter = Math.max(1, Math.ceil((rec.resetAt - now) / 1000))
      ctx.set('Retry-After', String(retryAfter))
      if (ctx.path.startsWith('/api')) {
        // JSON 接口：统一 { code, message, data }，HTTP 429
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
