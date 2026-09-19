'use strict'
const Router = require('@koa/router')
const router = new Router()
const DB = require('../../model/db')
const tools = require('../../model/tools')
const svgCaptcha = require('svg-captcha')
const log = require('../../model/logger')('admin:login')
const { checkLock, onFailure, onSuccess } = require('../../middleware/loginRateLimit')

// 登录失败统一渲染的错误页（复用 backend/error.liquid）
function loginError (ctx, message) {
  ctx.render('backend/error', {
    message,
    redirect: ctx.state.__HOST__ + '/admin/login'
  })
}
router.get('/', async (ctx) => {
  await ctx.render('backend/login')
})
router.post('/doLogin', async (ctx) => {
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
        await ctx.render('backend/error', {
          message: '该账号已被禁用，请联系管理员',
          redirect: ctx.state.__HOST__ + '/admin/login'
        })
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
        ctx.redirect(ctx.state.__HOST__ + '/backend')
      } else {
        log.warn(`登录失败（账号或密码错误）：${username}`)
        await onFailure(username)
        ctx.render('backend/error', {
          message: '用户名或者密码错误',
          redirect: ctx.state.__HOST__ + '/admin/login'
        })
      }
    } else {
      log.warn(`登录失败（账号不存在）：${username}`)
      await onFailure(username)
      ctx.render('backend/error', {
        message: '用户名或者密码错误',
        redirect: ctx.state.__HOST__ + '/admin/login'
      })
    }
  } else {
    log.warn(`登录失败（验证码错误）：${username}`)
    await onFailure(username)
    ctx.render('backend/error', {
      message: '验证码失败',
      redirect: ctx.state.__HOST__ + '/admin/login'
    })
  }
})
// 验证码（仍生成，登录页当前不展示/不校验）
router.get('/code', async (ctx) => {
  const captcha = svgCaptcha.create({ size: 4, fontSize: 50, width: 120, height: 34, background: '#cc9966' })
  ctx.session.code = captcha.text
  ctx.response.type = 'image/svg+xml'
  ctx.body = captcha.data
})
// 登出（GET + CSRF，双提交 Cookie）
router.get('/loginOut', async (ctx) => {
  const cookie = ctx.cookies.get('csrfToken')
  const token = String(ctx.query._csrf || '')
  if (!cookie || !token || cookie !== token) {
    ctx.status = 403
    return ctx.render('backend/error', {
      message: 'CSRF 校验失败，无法退出登录',
      redirect: (ctx.state.__HOST__ || '') + '/admin'
    })
  }
  ctx.session = null
  ctx.redirect(ctx.state.__HOST__ + '/admin/login')
})
module.exports = router.routes()
