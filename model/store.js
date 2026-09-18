'use strict'
// model/store.js
// ============================================================
// 统一"缓存 / 计数器"存储：**优先 Redis，不可用时自动降级为进程内实现**
//
// 为什么要有这一层抽象？
//   限流、权限缓存、会话复核都需要"带过期时间的、跨请求共享的"存储。
//   单实例用进程内 Map 就够；一旦多实例，每台机器各存一份 → 限流形同虚设（N 台就放大 N 倍）、
//   权限变更各机器生效时间不一致。
//   把差异收敛在**这一个文件**里，上层业务代码完全不用关心后端是 Redis 还是内存。
//
// 教学点：
//   1) 降级（graceful degradation）：Redis 连不上不能让整个服务起不来，
//      而是记一条 warn 然后退回进程内实现——**可用性优先**，同时把风险讲清楚。
//   2) 遍历 key 用 SCAN，不用 KEYS：KEYS 在大库上会阻塞 Redis 单线程（生产事故级）。
//   3) 计数器用 INCR + 过期：INCR 是原子操作，天然适合"多实例并发计数"；
//      而且把"首次设置过期"与自增合并成一个原子语义（见 incr 实现）。
//   4) 固定窗口限流可以用"窗口编号拼进 key"来避免竞态（见 middleware/rateLimit.js）。
// ============================================================
const config = require('./config')
const createLogger = require('./logger')

const log = createLogger('store')

// ---------------- 进程内实现（默认 / 降级）----------------
function createMemoryBackend () {
  const data = new Map() // key -> { value, expireAt(0=永不过期) }
  const now = () => Date.now()
  const alive = (rec) => !!rec && (rec.expireAt === 0 || rec.expireAt > now())

  // 定期清理过期键，避免内存无上限增长。
  // unref() 很关键：否则这个定时器会阻止进程退出、让测试跑完挂住。
  const timer = setInterval(() => {
    for (const [key, rec] of data) {
      if (!alive(rec)) data.delete(key)
    }
  }, 60 * 1000)
  if (typeof timer.unref === 'function') timer.unref()

  return {
    kind: 'memory',
    async get (key) {
      const rec = data.get(key)
      return alive(rec) ? rec.value : null
    },
    async set (key, value, ttlMs) {
      data.set(key, { value, expireAt: ttlMs ? now() + ttlMs : 0 })
    },
    async del (...keys) {
      for (const key of keys) data.delete(key)
    },
    async delByPrefix (prefix) {
      for (const key of [...data.keys()]) {
        if (key.startsWith(prefix)) data.delete(key)
      }
    },
    async incr (key, ttlMs) {
      const rec = data.get(key)
      const current = alive(rec) ? Number(rec.value) || 0 : 0
      const next = current + 1
      // 已有未过期计数则保留原过期时间（窗口不重置），否则按 ttl 新建窗口
      const expireAt = alive(rec) && rec.expireAt ? rec.expireAt : (ttlMs ? now() + ttlMs : 0)
      data.set(key, { value: next, expireAt })
      return next
    },
    async ttl (key) {
      const rec = data.get(key)
      if (!alive(rec)) return -2
      return rec.expireAt ? rec.expireAt - now() : -1
    },
    async close () {
      clearInterval(timer)
      data.clear()
    }
  }
}

// ---------------- Redis 实现 ----------------
function createRedisBackend (client, prefix) {
  const k = (key) => `${prefix}${key}`
  return {
    kind: 'redis',
    async get (key) {
      return client.get(k(key))
    },
    async set (key, value, ttlMs) {
      if (ttlMs) await client.set(k(key), value, { PX: ttlMs })
      else await client.set(k(key), value)
    },
    async del (...keys) {
      if (keys.length) await client.del(keys.map(k))
    },
    async delByPrefix (prefix2) {
      // 用 SCAN 游标遍历，避免 KEYS 阻塞 Redis 单线程
      const pattern = `${k(prefix2)}*`
      for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 200 })) {
        // ⚠️ 踩坑：node-redis v6 的 scanIterator **每批产出一个"数组"**（不是单个 key 字符串）。
        //    实测 `typeof batch === 'object' && Array.isArray(batch) === true`，形如 ['k1','k2']。
        //    （早期版本是逐个 yield 字符串；为兼容两种行为这里显式归一化。）
        const keys = Array.isArray(batch) ? batch : [batch]
        if (keys.length) await client.del(keys)
      }
    },
    async incr (key, ttlMs) {
      const full = k(key)
      const count = await client.incr(full)
      // 只在"第一次自增"时设置过期，这样窗口内计数不会被不断续期
      if (count === 1 && ttlMs) await client.pExpire(full, ttlMs)
      return count
    },
    async ttl (key) {
      // pTTL：毫秒；-2 表示 key 不存在，-1 表示无过期（与内存实现的返回值对齐）
      return client.pTTL(k(key))
    },
    async close () {
      await client.quit()
    }
  }
}

// ---------------- 对外门面 ----------------
let backend = createMemoryBackend()
let redisClient = null

/** 连接 Redis（失败则降级，不抛异常、不阻断启动） */
async function connect () {
  if (!config.redis.url) {
    log.warn('未配置 REDIS_URL，使用进程内存储（单实例开发可用；多实例部署请配置 Redis）')
    return
  }

  try {
    // 延迟 require：没配 Redis 的部署就完全不加载这个依赖
    const { createClient } = require('redis')
    const client = createClient({
      url: config.redis.url,
      socket: {
        connectTimeout: config.redis.connectTimeout,
        reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(retries * 200, 2000))
      }
    })
    client.on('error', (err) => log.error('Redis 连接异常:', err.message))
    await client.connect()
    await client.ping()

    redisClient = client
    backend = createRedisBackend(client, config.redis.keyPrefix)
    log.info(`Redis 已连接：${config.redis.url}（限流/缓存走 Redis，key 前缀 ${config.redis.keyPrefix}）`)
  } catch (err) {
    log.warn(`Redis 连接失败（${err.message}）→ 已降级为进程内存储。多实例部署下限额与缓存将不共享！`)
    backend = createMemoryBackend()
  }
}

async function close () {
  if (redisClient) {
    try {
      await backend.close()
    } catch (err) {
      log.error('关闭 Redis 失败:', err.message)
    }
    redisClient = null
  } else {
    await backend.close()
  }
}

module.exports = {
  connect,
  close,
  /** 当前后端类型：'redis' | 'memory' */
  get kind () { return backend.kind },
  isRedis () { return backend.kind === 'redis' },
  get (key) { return backend.get(key) },
  set (key, value, ttlMs) { return backend.set(key, value, ttlMs) },
  del (...keys) { return backend.del(...keys) },
  delByPrefix (prefix) { return backend.delByPrefix(prefix) },
  incr (key, ttlMs) { return backend.incr(key, ttlMs) },
  ttl (key) { return backend.ttl(key) },
  /** 供测试使用：把后端换成进程内实现 */
  _useMemory () { backend = createMemoryBackend() }
}
