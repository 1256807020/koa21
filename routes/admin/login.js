'use strict'
let router = require('koa-router')()
let tools = require('../../model/tools')
let DB = require('../../model/db')
// 验证码模块
let svgCaptcha = require('svg-captcha')
router.get('/', async (ctx) => {
  await ctx.render('admin/login')
})
router.post('/doLogin', async (ctx) => {
  // console.log(ctx.request.body)
  // 登陆首先的去数据库匹配账号和密码
  let username = ctx.request.body.username
  let password = ctx.request.body.password
  let code = ctx.request.body.code
  // console.log(tools.md5(password))
  // 1 先验证合法性
  // 2 再去数据库匹配
  if (code.toLocaleLowerCase() == ctx.session.code.toLocaleLowerCase()) {
    let result = await DB.find('admin', { 'username': username, 'password': tools.md5(password) })
    if (result.length > 0) {
      console.log('登陆成功')
      // console.log(result)
      ctx.session.userinfo = result[0]
      // 更新用户列表 改变用户登陆的时间
      await DB.update('admin', { '_id': DB.getObjectId(result[0]._id) }, {
        lasttime: new Date()
      })
      ctx.redirect(ctx.state.__HOST__ + '/admin')
    } else {
      // console.log('登陆失败')
      ctx.render('admin/error', {
        message: '用户名或者密码错误',
        redirect: ctx.state.__HOST__ + '/admin/login'
      })
    }
  } else {
    // console.log('验证码失败')
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
