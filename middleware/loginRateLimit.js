'use strict'
// middleware/loginRateLimit.js
// ============================================================
// 登录失败限流 / 账户锁定（P0 安全 · 防爆破 + 防账号枚举）
// 教学点：
//   1) 为什么需要：后台登录只有「账号+密码+验证码」，验证码一旦被刷过/日志泄露，
//      暴力破解与账号枚举就是主要风险。限制「连续失败次数 + 锁定时长」是最低成本的有效防线。
//   2) 这里用**内存 Map** 实现滑动窗口计数：key=用户名（小写），记录 fails / 首败时间 / 锁定截止。
//      连续 MAX_FAILS 次失败 → 锁 LOCK_MS。成功登录即清零。
//   3) 生产多实例/集群**不能**用内存 Map（各实例计数不共享）→ 必须换 Redis（如 ioredis + INCR/EXPIRE）。
//      代码里把存储抽象成 `store`，将来替换实现即可，业务逻辑不动。
//   4) 只按用户名锁（覆盖爆破 + 枚举）；若还想防「同一 IP 狂试不同账号」，可再加一层按 IP 的全局限速（见文件末注释）。
// ============================================================
const MAX_FAILS = 5            // 连续失败达到此数 → 锁定
const WINDOW_MS = 15 * 60 * 1000  // 失败计数窗口 15 分钟（窗口外自动重置）
const LOCK_MS = 15 * 60 * 1000    // 锁定时长 15 分钟

// —— 可替换的存储（当前：进程内 Map；生产：换 Redis）——
const store = new Map() // key -> { fails, firstFail, lockUntil }

function keyOf (username) {
  return String(username || '').trim().toLowerCase()
}

/** 检查是否处于锁定中；返回 { locked:true, retryAfter } 或 null */
function checkLock (username) {
  const rec = store.get(keyOf(username))
  if (!rec || !rec.lockUntil) return null
  if (rec.lockUntil > Date.now()) {
    return { locked: true, retryAfter: Math.ceil((rec.lockUntil - Date.now()) / 1000) }
  }
  return null
}

/** 记录一次失败（密码错/账号不存在/验证码错都算一次尝试），达到阈值则锁定 */
function onFailure (username) {
  const k = keyOf(username)
  const now = Date.now()
  let rec = store.get(k)
  // 窗口已过期 → 重新起算
  if (!rec || !rec.firstFail || now - rec.firstFail > WINDOW_MS) {
    rec = { fails: 0, firstFail: now, lockUntil: 0 }
  }
  rec.fails += 1
  if (rec.fails >= MAX_FAILS) {
    rec.lockUntil = now + LOCK_MS
  }
  store.set(k, rec)
  return rec
}

/** 登录成功 → 清零该用户失败记录 */
function onSuccess (username) {
  store.delete(keyOf(username))
}

module.exports = { checkLock, onFailure, onSuccess, MAX_FAILS, WINDOW_MS, LOCK_MS, store }

// —— 进阶：按 IP 的全局限速（防「换用户名枚举」）——
//   可在 app 层用另一个 Map<ip, {count, ts}>，对 /admin/login/doLogin 统一计数，
//   例如每分钟超过 30 次即 429。本教学案例先实现「按账户锁定」这层，足够覆盖主要风险。
