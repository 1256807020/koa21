'use strict'
/**
 * Koa CMS 应用入口
 * 运行环境、端口、数据库、Session、上传目录、日志全部由 .env.<NODE_ENV> 驱动
 */
const path = require('path')
const Koa = require('koa')
const Router = require('@koa/router')
const render = require('koa-art-template')
const serve = require('koa-static')
// koa-session 7 起改为具名导出 createSession(opts, app)
const { createSession } = require('koa-session')
const bodyParser = require('koa-bodyparser')
const cors = require('@koa/cors')

const config = require('./model/config')
const createLogger = require('./model/logger')
const tools = require('./model/tools')
const DB = require('./model/db')
const CODE = require('./utils/code')
const { fail } = require('./utils/response')
const { STATUS_BY_CODE } = require('./utils/handle')
const store = require('./model/store')
const { createRateLimit } = require('./middleware/rateLimit')

const log = createLogger('app')
const app = new Koa()

// 反向代理（Nginx 等）下正确取到客户端协议与 IP
app.proxy = config.trustProxy
app.keys = [config.session.secret]

// ---------------- 1. 全局异常处理 + 统一 404 ----------------
// 教学点：这里是"最后一道兜底出口"，必须和业务接口用**同一套响应体**。
// 修复前的问题：`/api` 走到这里返回的是旧风格 `{ success:false, message }`，
// 而业务接口返回 `{ code, message, data }` —— 前端要写两套解析逻辑，属于响应体不统一。
// 现在 API 一律走 fail()，前端只需判 code。
app.use(async (ctx, next) => {
  try {
    await next()

    // 统一 404：API 回 JSON，页面回 HTML（API 之前会吐 HTML 片段，前端 JSON.parse 直接炸）
    if (ctx.status === 404 && !ctx.body) {
      if (ctx.path.startsWith('/api')) {
        fail(ctx, CODE.NOT_FOUND, '接口不存在', null, 404)
      } else {
        ctx.status = 404
        ctx.body = '<h3>404 Not Found</h3><p>页面不存在</p>'
      }
    }
  } catch (err) {
    const c = err.code || CODE.UNKNOWN
    // 状态码优先级：显式 err.status > 业务错误码映射（如 PARAM_ERROR→400、NOT_FOUND→404） > 500。
    // 若不看 err.code，像"非法 id 参数"这种客户端错误会被笼统地报成 500，
    // 既误导调用方，也会污染错误日志/告警。业务错误码 → HTTP 状态的映射表在 utils/handle.js。
    const status = err.status && err.status >= 400
      ? err.status
      : (STATUS_BY_CODE[c] || 500)
    log.error(`${ctx.method} ${ctx.url} 处理失败:`, err.stack || err.message)

    if (ctx.path.startsWith('/api')) {
      // 生产环境对"未知错误"隐藏细节，避免把栈/表结构泄露给外部
      const message = (config.isProd && c === CODE.UNKNOWN) ? '服务器内部错误' : err.message
      fail(ctx, c, message, null, status)
    } else {
      await ctx.render('admin/error', {
        message: config.isProd ? '服务器内部错误' : err.message,
        redirect: ctx.state.__HOST__ || '/'
      })
    }
  }
})

// ---------------- 2. 访问日志 ----------------
app.use(async (ctx, next) => {
  const start = Date.now()
  await next()
  const cost = Date.now() - start
  const line = `${ctx.method} ${ctx.originalUrl} ${ctx.status} ${cost}ms`
  if (ctx.status >= 500) log.error(line)
  else if (ctx.status >= 400) log.warn(line)
  else log.debug(line)
})

// ---------------- 2.5 全局限流（按 IP）----------------
// 只罩 /api 与 /admin：静态资源（图片/CSS/JS）不限流，否则正常浏览页面就会被误伤。
// /healthz 不在这两个前缀内，因此自动豁免（探活不能被限流）。
// ⚠️ 内存计数仅适合单实例；多实例须换 Redis（见 middleware/rateLimit.js 注释）。
app.use(createRateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  skip: (ctx) => !(ctx.path.startsWith('/api') || ctx.path.startsWith('/admin'))
}))

// ---------------- 3. CORS：只对 /api 开放，后台接口不对外跨域 ----------------
const apiCors = cors({ origin: '*', allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] })
app.use(async (ctx, next) => {
  if (ctx.path.startsWith('/api')) return apiCors(ctx, next)
  return next()
})

// ---------------- 4. POST 数据解析 ----------------
app.use(bodyParser({
  enableTypes: ['json', 'form'],
  jsonLimit: '5mb',
  formLimit: '5mb',
  textLimit: '5mb'
}))

// ---------------- 5. Session ----------------
app.use(createSession({
  key: config.session.key,
  maxAge: config.session.maxAge,
  overwrite: true,
  httpOnly: true,
  signed: true,
  rolling: config.session.rolling,
  renew: false,
  sameSite: config.session.sameSite,
  secure: config.session.secure
}, app))

// ---------------- 6. 模板引擎 ----------------
// 模板里用的过滤器必须注册到 art-template 的 imports，
// 直接写成 dateFormat 顶层选项（老教程的写法）在新版本下会报 $imports.dateFormat is not a function
const artTemplate = require('art-template')
artTemplate.defaults.imports.dateFormat = tools.formatDate
artTemplate.defaults.imports.timeFormat = (value) => tools.formatDate(value, 'YYYY-MM-DD HH:mm:ss')
artTemplate.defaults.imports.dateOnly = (value) => tools.formatDate(value, 'YYYY-MM-DD')

render(app, {
  root: path.join(config.root, 'views'),
  extname: '.html',
  debug: config.isDev,
  imports: {
    dateFormat: tools.formatDate,
    timeFormat: (value) => tools.formatDate(value, 'YYYY-MM-DD HH:mm:ss'),
    dateOnly: (value) => tools.formatDate(value, 'YYYY-MM-DD')
  }
})

// ---------------- 7. 静态资源 ----------------
// setHeaders：给所有静态文件加 X-Content-Type-Options: nosniff，
// 强制浏览器严格按响应 Content-Type 解析，禁止「嗅探」成可执行的 HTML/JS——
// 这是防「上传 .png 实为 HTML」被当脚本执行（MIME 嗅探 XSS）的关键补丁（配合 tools.multer 白名单）。
app.use(serve(path.join(config.root, 'public'), {
  maxage: config.isProd ? 7 * 24 * 60 * 60 * 1000 : 0,
  setHeaders (res) {
    res.setHeader('X-Content-Type-Options', 'nosniff')
  }
}))

// ---------------- 8. 站点地址（模板里用的 __HOST__） ----------------
app.use(async (ctx, next) => {
  ctx.state.__HOST__ = config.getOrigin(ctx)
  await next()
})

// ---------------- 9. 路由 ----------------
const router = new Router()
const index = require('./routes/index.js')
const api = require('./routes/api.js')
const admin = require('./routes/admin.js')

// 健康检查：给负载均衡 / K8s / 监控探活用（不鉴权、不限流、不渲染模板）
// 教学点：探活要"轻"，只查最关键的依赖（DB）；不要把业务校验塞进来，否则探活本身会拖垮服务。
router.get('/healthz', async (ctx) => {
  const startedAt = Date.now()
  let db = 'up'
  try {
    await DB.query('SELECT 1')
  } catch (err) {
    db = 'down'
  }
  // 缓存/限流存储的实际后端：'redis' 表示已连上 Redis，'memory' 表示降级为进程内
  // （多实例部署时如果是 memory，需要立刻关注——限额与权限缓存都不共享）
  const cache = store.kind
  const healthy = db === 'up'
  ctx.status = healthy ? 200 : 503
  ctx.body = {
    status: healthy ? 'ok' : 'degraded',
    env: config.env,
    uptime: Math.floor(process.uptime()), // 进程已运行秒数
    db,
    cache,
    latencyMs: Date.now() - startedAt,
    time: new Date().toISOString()
  }
})

router.use('/admin', admin)

// —— API 版本化（P1）——
// 同一套路由挂两个前缀：新代码/新前端统一用 /api/v1，/api 作为兼容旧路径保留。
// 注意顺序：'/api/v1' 必须写在 '/api' 前面，因为 '/api' 的前缀匹配也会命中 '/api/v1/xxx'，
// 先注册的更具体的那个才会优先处理。
router.use('/api/v1', api) // 正式版本
router.use('/api', api)    // 兼容旧路径（deprecated，后续可加告警或下线）
router.use(index)

app.use(router.routes())
app.use(router.allowedMethods())

// ---------------- 10. 启动 ----------------
async function bootstrap () {
  try {
    const version = await DB.ping()
    log.info(`PostgreSQL 已连接：${version.split(',')[0]}`)
  } catch (err) {
    log.error(`数据库连接失败：${err.message}`)
    log.error(`请检查 .env.${config.env} 中的 PG_HOST/PG_PORT/PG_USER/PG_PASSWORD`)
    process.exit(1)
  }

  const { rows } = await DB.query("SELECT to_regclass('public.admin') AS tbl")
  if (!rows[0].tbl) {
    log.error('数据表不存在，请先执行：pnpm db:init')
    process.exit(1)
  }

  // 缓存/限流存储：优先 Redis，连不上会自动降级为进程内实现（不阻断启动）
  await store.connect()

  const server = app.listen(config.port, config.host, () => {
    log.info(`环境：${config.env} | 监听：http://${config.host}:${config.port}`)
    log.info(`后台：http://localhost:${config.port}/admin/login`)
  })

  const shutdown = async (signal) => {
    log.info(`收到 ${signal}，正在优雅关闭…`)
    server.close(async () => {
      await store.close()
      await DB.close()
      log.info('已关闭')
      process.exit(0)
    })
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

process.on('unhandledRejection', (reason) => {
  log.error('未处理的 Promise 异常:', reason)
})

bootstrap()
