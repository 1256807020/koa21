'use strict'
const Router = require('@koa/router')
const router = new Router()
let tools = require('../../model/tools')
let DB = require('../../model/db')
// 验证码模块
let svgCaptcha = require('svg-captcha')
const log = require('../../model/logger')('admin:login')
const { checkLock, onFailure, onSuccess } = require('../../middleware/loginRateLimit')

// 登录失败时统一渲染的错误页（复用到验证码错/密码错/锁定）
function loginError (ctx, message) {
  ctx.render('admin/error', {
    message,
    redirect: ctx.state.__HOST__ + '/admin/login'
  })
}
router.get('/', async (ctx) => {
  await ctx.render('admin/login')
})
router.post('/doLogin', async (ctx) => {
  // 登陆首先的去数据库匹配账号和密码
  let username = ctx.request.body.username
  let password = ctx.request.body.password
  let code = ctx.request.body.code

  // —— P0 安全：登录失败限流 / 账户锁定 ——
  // 先查锁定：被锁期间直接拒绝，连验证码都不用校验，省资源也堵爆破
  const lock = await checkLock(username)
  if (lock) {
    log.warn(`登录被锁定（账户=${username}）：还需 ${lock.retryAfter}s`)
    return await loginError(ctx, `尝试次数过多，账户已临时锁定，请 ${Math.ceil(lock.retryAfter / 60)} 分钟后再试`)
  }

  // —— 验证码：目前【只展示、不校验】——
  // 决策（2026-09-19）：svg-captcha 暂时保留（登录页仍然渲染、/code 端点仍在），但**不做比对**，
  // 后续会更换验证码方案（备选见 E:\360Data\FE_Note\验证码）。
  //
  // ⚠️ 安全说明（重要）：去掉验证码后，登录的**主要防护就是失败限流**
  //    （middleware/loginRateLimit.js：同账号 15 分钟内失败 5 次 → 锁定 15 分钟）。
  //    限流绝不能省 —— 没有验证码又没有限流，就等于允许纯爆破。
  //
  // 想重新启用校验：把下面的 VERIFY_CAPTCHA 改成 true 即可，校验逻辑完整保留。
  const VERIFY_CAPTCHA = false

  const inputCode = String(code || '').trim().toLowerCase()
  const sessionCode = String(ctx.session.code || '').trim().toLowerCase()
  const captchaOk = !VERIFY_CAPTCHA || (sessionCode && inputCode === sessionCode)
  if (captchaOk) {
    // 先按用户名查出用户（不再把密码拼进查询条件），再在应用层比对，
    // 这样既能兼容历史 md5，也能用 bcrypt 校验，且不泄露"用户是否存在"
    let result = await DB.find('admin', { 'username': username })
    if (result.length > 0) {
      const matched = await tools.comparePassword(password, result[0].password)
      if (matched && Number(result[0].status) !== 1) {
        // 账号存在、密码对，但已被禁用 → 必须在这里就拦住（不能只靠后续接口的 requireLogin 复核）
        log.warn(`登录失败（账号已禁用）：${username}`)
        await onFailure(username)
        await ctx.render('admin/error', {
          message: '该账号已被禁用，请联系管理员',
          redirect: ctx.state.__HOST__ + '/admin/login'
        })
      } else if (matched) {
        log.info(`管理员登录成功：${username}`)
        await onSuccess(username)  // P0 安全：登录成功 → 清零失败计数
        ctx.session.code = null   /* 验证码一次性使用 */
        // P1 安全 · session 瘦身：
        // 原来是把整行 admin（含 password 哈希、add_time 等）塞进会话。
        // 而 cookie-session 的会话是 base64(JSON) **未加密**的 → 会话里放什么，客户端就能读到什么。
        // 所以只保留界面确实要用的最小字段（模板只用到 username）。
        ctx.session.userinfo = {
          _id: result[0]._id,
          username: result[0].username,
          status: result[0].status,
          role_id: result[0].role_id   // RBAC：鉴权时用它解析权限集合（见 middleware/rbac.js）
        }
        // 若仍是旧 md5 哈希（不可逆），本次登录成功后自动升级为 bcrypt，避免长期留 md5
        if (!tools.isBcryptHash(result[0].password)) {
          await DB.update('admin', { '_id': DB.getObjectId(result[0]._id) }, {
            password: await tools.hashPassword(password)
          })
        }
        // 更新用户列表 改变用户登陆的时间
        await DB.update('admin', { '_id': DB.getObjectId(result[0]._id) }, {
          lasttime: new Date()
        })
        ctx.redirect(ctx.state.__HOST__ + '/admin')
      } else {
        log.warn(`登录失败（账号或密码错误）：${username}`)
        await onFailure(username)        // P0 安全：失败计数 +（达阈值）锁定
        ctx.render('admin/error', {
          message: '用户名或者密码错误',
          redirect: ctx.state.__HOST__ + '/admin/login'
        })
      }
    } else {
      log.warn(`登录失败（账号不存在）：${username}`)
      await onFailure(username)          // P0 安全：即使账号不存在也计数，防枚举
      ctx.render('admin/error', {
        message: '用户名或者密码错误',
        redirect: ctx.state.__HOST__ + '/admin/login'
      })
    }
  } else {
    log.warn(`登录失败（验证码错误）：${username}`)
    await onFailure(username)            // P0 安全：验证码错也算一次尝试
    ctx.render('admin/error', {
      message: '验证码失败',
      redirect: ctx.state.__HOST__ + '/admin/login'
    })
  }

})
// 验证码路由
router.get('/code', async (ctx) => {
  // ctx.body = '验证码'
  // await ctx.render('admin/login')
  //加法的验证码
  //var captcha = svgCaptcha.createMathExpr({
  //    size:4,
  //    fontSize: 50,
  //    width: 100,
  //    height:40,
  //    background:"#cc9966"
  //});

  var captcha = svgCaptcha.create({
    size: 4,
    fontSize: 50,
    width: 120,
    height: 34,
    background: "#cc9966"
  });
  // ⚠️ 安全：旧代码这里曾 `console.log(captcha.text)` 把验证码明文打到日志，
  // 等于把一次性口令永久留存，严重泄露风险。已删除（P0 安全项）。调试如需看码，临时打到 stderr 也仅限开发环境。

  //保存生成的验证码
  ctx.session.code = captcha.text;
  //设置响应头
  ctx.response.type = 'image/svg+xml';
  ctx.body = captcha.data;
})
// 登出（P0 安全）
// 登出会改变登录态，属于"状态变更"操作，必须防 CSRF ——
// 否则攻击者只要在任意页面塞一张 `<img src="/admin/login/loginOut">`，
// 就能把正在浏览的已登录管理员**强制踢下线**（拒绝服务，且可反复触发）。
// 因为它是导航栏里的 <a> 链接（GET），带不了请求体/自定义头，所以把 token 放 query 上。
// 双提交 Cookie 模式下这样是安全的：跨站攻击者读不到受害者的 csrfToken Cookie，拼不出这个链接。
router.get('/loginOut', async (ctx) => {
  const cookie = ctx.cookies.get('csrfToken')
  const token = String(ctx.query._csrf || '')
  if (!cookie || !token || cookie !== token) {
    ctx.status = 403
    return ctx.render('admin/error', {
      message: 'CSRF 校验失败，无法退出登录',
      redirect: (ctx.state.__HOST__ || '') + '/admin'
    })
  }
  // 彻底销毁会话（而不是只把 userinfo 置空）：避免残留的会话数据被后续请求复用
  ctx.session = null
  ctx.redirect(ctx.state.__HOST__ + '/admin/login')
})
module.exports = router.routes()
