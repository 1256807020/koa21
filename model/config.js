'use strict'
/**
 * 统一配置中心
 * 按 NODE_ENV 加载对应的 .env 文件（.env.development / .env.test / .env.production）
 * 加载顺序：.env.<NODE_ENV> 优先，.env 作为兜底（不存在也没关系）
 */
const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const ROOT = path.resolve(__dirname, '..')
const NODE_ENV = process.env.NODE_ENV || 'development'

for (const file of [`.env.${NODE_ENV}`, '.env']) {
  const full = path.join(ROOT, file)
  if (fs.existsSync(full)) {
    dotenv.config({ path: full, override: false, quiet: true })
  }
}

const str = (value, fallback = '') => {
  if (value === undefined || value === null) return fallback
  const v = String(value).trim()
  return v === '' ? fallback : v
}
const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}
const bool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

const port = num(process.env.PORT, 3000)
const host = str(process.env.HOST, '0.0.0.0')
const uploadDir = str(process.env.UPLOAD_DIR, 'public/upload')

const config = {
  env: NODE_ENV,
  isDev: NODE_ENV === 'development',
  isTest: NODE_ENV === 'test',
  isProd: NODE_ENV === 'production',
  root: ROOT,
  port,
  host,
  trustProxy: bool(process.env.TRUST_PROXY, NODE_ENV === 'production'),

  // 站点地址：留空时按请求头自动推导（兼容 Nginx / https）
  site: {
    protocol: str(process.env.SITE_PROTOCOL, ''),
    host: str(process.env.SITE_HOST, '')
  },

  pg: {
    host: str(process.env.PG_HOST, 'localhost'),
    port: num(process.env.PG_PORT, 5432),
    user: str(process.env.PG_USER, 'postgres'),
    password: process.env.PG_PASSWORD === undefined ? '' : String(process.env.PG_PASSWORD),
    database: str(process.env.PG_DATABASE, 'koa_cms'),
    ssl: bool(process.env.PG_SSL, false) ? { rejectUnauthorized: false } : false,
    max: num(process.env.PG_POOL_MAX, 10),
    idleTimeoutMillis: num(process.env.PG_IDLE_TIMEOUT, 30000),
    connectionTimeoutMillis: num(process.env.PG_CONNECT_TIMEOUT, 10000)
  },

  session: {
    key: 'koa:sess',
    secret: str(process.env.SESSION_KEY, 'koa21_dev_fallback_secret_please_change'),
    maxAge: num(process.env.SESSION_MAX_AGE, 3600000),
    rolling: bool(process.env.SESSION_ROLLING, true),
    secure: bool(process.env.COOKIE_SECURE, false),
    sameSite: str(process.env.COOKIE_SAME_SITE, 'lax')
  },

  upload: {
    dir: uploadDir,
    dirAbs: path.isAbsolute(uploadDir) ? uploadDir : path.join(ROOT, uploadDir),
    maxSize: num(process.env.UPLOAD_MAX_SIZE, 5 * 1024 * 1024)
  },

  log: {
    level: str(process.env.LOG_LEVEL, NODE_ENV === 'production' ? 'warn' : 'debug'),
    dir: str(process.env.LOG_DIR, 'logs')
  },

  // 全局限流（按 IP 计算，见 middleware/rateLimit.js）
  // 生产可按压测结果调大；多实例部署需把存储换成 Redis 后才准确
  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX, 300)
  },

  // 前台展示配置：把原先散落在 routes/index.js 里的"魔法值"集中到一处，并支持 env 覆盖。
  // cateIds 必须与 db/seed.sql 里的一级分类 _id 一致（种子数据是这些 ID 的最终来源）。
  frontend: {
    cateIds: {
      case: str(process.env.FRONTEND_CATE_CASE, '5bdaf166e67d082570b10a21'), // 成功案例
      service: str(process.env.FRONTEND_CATE_SERVICE, '5bdaf17fe67d082570b10a22'), // 服务
      news: str(process.env.FRONTEND_CATE_NEWS, '5bdaf18de67d082570b10a23') // 新闻
    },
    pageSize: num(process.env.FRONTEND_PAGE_SIZE, 3)
  },

  // 后台列表每页条数（原代码在多个路由里硬编码 3，既是重复也是"改一处漏三处"的隐患）
  adminPageSize: num(process.env.ADMIN_PAGE_SIZE, 10),

  // Redis：限流计数、权限缓存、会话复核缓存的共享存储（见 model/store.js）
  // REDIS_URL 留空 = 不启用 Redis，自动降级为进程内存储（单实例开发够用）
  // ⚠️ 多实例部署必须配置，否则每台机器的限额/缓存各算一份
  redis: {
    url: str(process.env.REDIS_URL, ''),
    keyPrefix: str(process.env.REDIS_KEY_PREFIX, 'koa21:'),
    connectTimeout: num(process.env.REDIS_CONNECT_TIMEOUT, 3000),
    // 缓存 TTL（毫秒），可按需调整
    permissionTtlMs: num(process.env.PERMISSION_CACHE_TTL, 30 * 1000),
    sessionTtlMs: num(process.env.SESSION_CACHE_TTL, 10 * 1000)
  }
}

/**
 * 生成模板里使用的 __HOST__（协议 + 域名，不带结尾斜杠）
 * 优先取环境变量，其次按 x-forwarded-proto / 请求头推导
 * 好处：上线换 https 或换域名只需改 .env，不用再动代码
 */
config.getOrigin = function getOrigin (ctx) {
  let protocol = config.site.protocol
  let host = config.site.host

  if (ctx) {
    if (!protocol) {
      const forwarded = ctx.request.get ? ctx.request.get('x-forwarded-proto') : ''
      protocol = (forwarded || '').split(',')[0].trim() || ctx.protocol || 'http'
    }
    if (!host) {
      const forwardedHost = ctx.request.get ? ctx.request.get('x-forwarded-host') : ''
      host = (forwardedHost || '').split(',')[0].trim() ||
        (ctx.request.header && ctx.request.header.host) ||
        `localhost:${config.port}`
    }
  }

  return `${protocol || 'http'}://${host || `localhost:${config.port}`}`
}

module.exports = config
