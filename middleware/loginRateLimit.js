'use strict'
// middleware/loginRateLimit.js
// ============================================================
// 登录失败限流 / 账户锁定（P0 安全 · 防爆破 + 防账号枚举）
//
// 存储：统一走 model/store.js —— 配 Redis 则多实例共享失败计数，
//      否则降级为进程内 Map（多实例下攻击者可以轮着打不同实例，务必配 Redis）。
//
// 键设计（Redis 友好，全部是原子操作）：
//   login:fail:<user>  用 INCR + TTL(WINDOW_MS)：窗口内失败次数，窗口到期自动归零
//   login:lock:<user>  SET 带 TTL(LOCK_MS)：锁定标记，过期即自动解锁
//
// 教学点：
//   - 为什么不用"读-改-写"？多实例并发下 read-modify-write 会丢计数（经典竞态）。
//     INCR / SET NX EX 这类原子命令才是正确姿势。
//   - 用 TTL 表达"窗口"和"锁定期"，就不需要定时任务去清理过期数据。
// ============================================================
const store = require('../model/store')

const MAX_FAILS = 5 // 连续失败达到此数 → 锁定
const WINDOW_MS = 15 * 60 * 1000 // 失败计数窗口 15 分钟
const LOCK_MS = 15 * 60 * 1000 // 锁定时长 15 分钟

const failKey = (username) => `login:fail:${String(username || '').trim().toLowerCase()}`
const lockKey = (username) => `login:lock:${String(username || '').trim().toLowerCase()}`

/**
 * 检查是否处于锁定中
 * @returns {Promise<null|{locked:true, retryAfter:number}>} retryAfter 单位秒
 */
async function checkLock (username) {
  const remainMs = await store.ttl(lockKey(username))
  if (remainMs > 0) return { locked: true, retryAfter: Math.ceil(remainMs / 1000) }
  return null
}

/**
 * 记录一次失败（密码错 / 账号不存在 / 验证码错都算一次尝试），达到阈值则锁定
 */
async function onFailure (username) {
  const fails = await store.incr(failKey(username), WINDOW_MS)
  if (fails >= MAX_FAILS) {
    await store.set(lockKey(username), '1', LOCK_MS)
  }
  return fails
}

/** 登录成功 → 清零该用户的失败计数与锁定 */
async function onSuccess (username) {
  await store.del(failKey(username), lockKey(username))
}

module.exports = { checkLock, onFailure, onSuccess, MAX_FAILS, WINDOW_MS, LOCK_MS }

// —— 进阶：按 IP 的全局限速（防"换用户名枚举"）——
//   全局限流（middleware/rateLimit.js）已按 IP 限制 /admin 的请求总量，
//   如需更细的策略（例如登录接口单独 30 次/分钟），可在此再加一层 IP 维度计数。
