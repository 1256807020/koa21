'use strict'
const Router = require('@koa/router')
const router = new Router()
let tools = require('../../model/tools')
let DB = require('../../model/db')
// 验证码模块
let svgCaptcha = require('svg-captcha')
const log = require('../../model/logger')('admin:login')
router.get('/', async (ctx) => {
  await ctx.render('admin/login')
})
router.post('/doLogin', async (ctx) => {
  // 登陆首先的去数据库匹配账号和密码
  let username = ctx.request.body.username
  let password = ctx.request.body.password
  let code = ctx.request.body.code
  // 1 先验证合法性（原代码在 session 里没有验证码时会直接抛错，这里做兜底）
  // 2 再去数据库匹配
  const inputCode = String(code || '').trim().toLowerCase()
  const sessionCode = String(ctx.session.code || '').trim().toLowerCase()
  if (sessionCode && inputCode === sessionCode) {
    // 先按用户名查出用户（不再把密码拼进查询条件），再在应用层比对，
    // 这样既能兼容历史 md5，也能用 bcrypt 校验，且不泄露"用户是否存在"
    let result = await DB.find('admin', { 'username': username })
    if (result.length > 0) {
      const matched = await tools.comparePassword(password, result[0].password)
      if (matched) {
        log.info(`管理员登录成功：${username}`)
        ctx.session.code = null   /* 验证码一次性使用 */
        ctx.session.userinfo = result[0]
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
        ctx.render('admin/error', {
          message: '用户名或者密码错误',
          redirect: ctx.state.__HOST__ + '/admin/login'
        })
      }
    } else {
      log.warn(`登录失败（账号不存在）：${username}`)
      ctx.render('admin/error', {
        message: '用户名或者密码错误',
        redirect: ctx.state.__HOST__ + '/admin/login'
      })
    }
  } else {
    log.warn(`登录失败（验证码错误）：${username}`)
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
  console.log(captcha.text);

  //保存生成的验证码
  ctx.session.code = captcha.text;
  //设置响应头
  ctx.response.type = 'image/svg+xml';
  ctx.body = captcha.data;
})
router.get('/loginOut', async (ctx) => {
  ctx.session.userinfo = null;
  ctx.redirect(ctx.state.__HOST__ + '/admin/login');
})
module.exports = router.routes()
