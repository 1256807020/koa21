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

const log = createLogger('app')
const app = new Koa()

// 反向代理（Nginx 等）下正确取到客户端协议与 IP
app.proxy = config.trustProxy
app.keys = [config.session.secret]

// ---------------- 1. 全局异常处理：别让一个错误把服务带崩 ----------------
app.use(async (ctx, next) => {
  try {
    await next()
    if (ctx.status === 404 && !ctx.body) {
      ctx.status = 404
      ctx.body = '<h3>404 Not Found</h3><p>页面不存在</p>'
    }
  } catch (err) {
    log.error(`${ctx.method} ${ctx.url} 处理失败:`, err.stack || err.message)
    ctx.status = err.status && err.status >= 400 ? err.status : 500
    if (ctx.path.startsWith('/api')) {
      ctx.body = { success: false, message: config.isProd ? '服务器内部错误' : err.message }
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
app.use(serve(path.join(config.root, 'public'), {
  maxage: config.isProd ? 7 * 24 * 60 * 60 * 1000 : 0
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

router.use('/admin', admin)
router.use('/api', api)
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

  const server = app.listen(config.port, config.host, () => {
    log.info(`环境：${config.env} | 监听：http://${config.host}:${config.port}`)
    log.info(`后台：http://localhost:${config.port}/admin/login`)
  })

  const shutdown = async (signal) => {
    log.info(`收到 ${signal}，正在优雅关闭…`)
    server.close(async () => {
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
