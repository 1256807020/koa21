'use strict'
// routes/login.js
// ============================================================
// 后台登录（挂载点：/backend/login）
//   GET  /backend/login            登录页（渲染 Liquid 新模板）
//   POST /backend/login/doLogin    提交登录（CSRF 双提交 Cookie 校验）
//   GET  /backend/login/code       验证码 SVG（当前登录页不展示、不校验，仅保留能力）
//   GET  /backend/login/loginOut   登出（兼容旧 GET 链接；新后台用 POST /backend/logout）
//
// 为什么独立挂载（不走 routes/backend.js）：登录页本身**不需要登录态**，
//   而 routes/backend.js 的全局中间件会拦住未登录用户 → 放在那里会死循环。
// 本路由组自带 CSRF 初始化（种可读 Cookie + ctx.state.csrfToken），因此可独立挂载。
// ============================================================
const Router = require('@koa/router')
const router = new Router()
const config = require('../model/config')
const DB = require('../model/db')
const tools = require('../model/tools')
const svgCaptcha = require('svg-captcha')
const log = require('../model/logger')('login')
const { ensureCsrfToken, csrfGuardPage } = require('../middleware/guard')
const { checkLock, onFailure, onSuccess } = require('../middleware/loginRateLimit')

const LOGIN_PATH = '/backend/login'
const HOME_PATH = '/backend'

// 登录失败统一渲染的错误页（复用 backend/error.liquid）
function loginError (ctx, message) {
  return ctx.render('backend/error', {
    message,
    redirect: (ctx.state.__HOST__ || '') + LOGIN_PATH
  })
}

// 本路由组统一的上下文准备：站点地址（模板用）+ CSRF token（种 Cookie + 挂 ctx.state）
router.use(async (ctx, next) => {
  ctx.state.__HOST__ = config.getOrigin(ctx)
  ensureCsrfToken(ctx)
  await next()
})

router.get('/', async (ctx) => {
  await ctx.render('backend/login')
})

router.post('/doLogin', csrfGuardPage, async (ctx) => {
  const username = ctx.request.body.username
  const password = ctx.request.body.password
  const code = ctx.request.body.code

  // 登录失败限流 / 账户锁定
  const lock = await checkLock(username)
  if (lock) {
    return await loginError(ctx, `尝试次数过多，账户已临时锁定，请 ${Math.ceil(lock.retryAfter / 60)} 分钟后再试`)
  }

  // 验证码目前【只展示、不校验】（见历史决策）；主要防护是失败限流
  const VERIFY_CAPTCHA = false
  const inputCode = String(code || '').trim().toLowerCase()
  const sessionCode = String(ctx.session.code || '').trim().toLowerCase()
  const captchaOk = !VERIFY_CAPTCHA || (sessionCode && inputCode === sessionCode)
  if (captchaOk) {
    const result = await DB.find('admin', { username })
    if (result.length > 0) {
      const matched = await tools.comparePassword(password, result[0].password)
      if (matched && Number(result[0].status) !== 1) {
        log.warn(`登录失败（账号已禁用）：${username}`)
        await onFailure(username)
        await loginError(ctx, '该账号已被禁用，请联系管理员')
      } else if (matched) {
        log.info(`管理员登录成功：${username}`)
        await onSuccess(username)
        ctx.session.code = null
        ctx.session.userinfo = {
          _id: result[0]._id,
          username: result[0].username,
          status: result[0].status,
          role_id: result[0].role_id
        }
        // 旧 md5 哈希在本次登录成功后自动升级为 bcrypt
        if (!tools.isBcryptHash(result[0].password)) {
          await DB.update('admin', { _id: DB.getObjectId(result[0]._id) }, {
            password: await tools.hashPassword(password)
          })
        }
        await DB.update('admin', { _id: DB.getObjectId(result[0]._id) }, { lasttime: new Date() })
        ctx.redirect((ctx.state.__HOST__ || '') + HOME_PATH)
      } else {
        log.warn(`登录失败（账号或密码错误）：${username}`)
        await onFailure(username)
        await loginError(ctx, '用户名或者密码错误')
      }
    } else {
      log.warn(`登录失败（账号不存在）：${username}`)
      await onFailure(username)
      await loginError(ctx, '用户名或者密码错误')
    }
  } else {
    log.warn(`登录失败（验证码错误）：${username}`)
    await onFailure(username)
    await loginError(ctx, '验证码失败')
  }
})

// 验证码（仍生成，登录页当前不展示/不校验）
router.get('/code', async (ctx) => {
  const captcha = svgCaptcha.create({ size: 4, fontSize: 50, width: 120, height: 34, background: '#cc9966' })
  ctx.session.code = captcha.text
  ctx.response.type = 'image/svg+xml'
  ctx.body = captcha.data
})

// 登出（GET + CSRF，双提交 Cookie；兼容旧链接）
router.get('/loginOut', async (ctx) => {
  const cookie = ctx.cookies.get('csrfToken')
  const token = String(ctx.query._csrf || '')
  if (!cookie || !token || cookie !== token) {
    ctx.status = 403
    return ctx.render('backend/error', {
      message: 'CSRF 校验失败，无法退出登录',
      redirect: (ctx.state.__HOST__ || '') + HOME_PATH
    })
  }
  ctx.session = null
  ctx.redirect((ctx.state.__HOST__ || '') + LOGIN_PATH)
})

module.exports = router.routes()
