'use strict'
let router = require('koa-router')()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
router.get('/', async (ctx) => {
  let result = await DB.find('admin', {})
  // console.log(result)
  await ctx.render('admin/manage/list', {
    list: result
  })
})
router.get('/add', async (ctx) => {
  await ctx.render('admin/manage/add')
})
router.post('/doAdd', async (ctx) => {
  // 1 获取表单提交的数据
  // console.log(ctx.request.body)
  // 2 验证表单数据是否合法
  // 3 查询是否存在当前要增加的管理员
  // 4 增加管理员
  let username = ctx.request.body.username
  let password = ctx.request.body.password
  let rpassword = ctx.request.body.rpassword
  if (!/^\w{4,20}/.test(username)) {

    await ctx.render('admin/error', {
      message: '用户名不合法',
      redirect: ctx.state.__HOST__ + '/admin/manage/add'
    })

  } else if (password != rpassword || password.length > 6) {

    await ctx.render('admin/error', {
      message: '密码和确认密码不一致，或者密码长度小于6位',
      redirect: ctx.state.__HOST__ + '/admin/manage/add'
    })

  } else {

    //数据库查询当前管理员是否存在

    var findResult = await DB.find('admin', { "username": username });

    if (findResult.length > 0) {

      await ctx.render('admin/error', {
        message: '此管理员已经存在，请换个用户名',
        redirect: ctx.state.__HOST__ + '/admin/manage/add'
      })

    } else {

      //增加管理员
      var addResult = await DB.insert('admin', { "username": username, "password": tools.md5(password), "status": 1, "lasttime": '' });

      ctx.redirect(ctx.state.__HOST__ + '/admin/manage');

    }


  }
})
router.get('/edit', async (ctx) => {

  // ctx.body = '编辑用户'
  let id = ctx.query.id;
  let result = await DB.find('admin', { "_id": DB.getObjectId(id) })
  // console.log(result)
  ctx.render('admin/manage/edit', {
    list: result[0]
  })
})
router.post('/doEdit', async (ctx) => {
  // console.log(ctx.request.body)
  // ctx.body = '编辑用户'
  try {
    let id = ctx.request.body.id
    let username = ctx.request.body.username
    let password = ctx.request.body.password
    let rpassword = ctx.request.body.rpassword
    if (password !== '') {
      if (password != rpassword || password.length > 6) {

        await ctx.render('admin/error', {
          message: '密码和确认密码不一致，或者密码长度小于6位',
          redirect: ctx.state.__HOST__ + '/admin/manage/edit?id=' + id
        })

      } else {
        // 合法的话，更新密码
        let updateResult = await DB.update('admin', { "_id": DB.getObjectId(id) }, { "username": username, "password": tools.md5(password), "status": 1, "lasttime": '' })
        ctx.redirect(ctx.state.__HOST__ + '/admin/manage')
      }
    } else {
      ctx.redirect(ctx.state.__HOST__ + '/admin/manage')
    }

  } catch (err) {
    await ctx.render('admin/error', {
      message: err,
      redirect: ctx.state.__HOST__ + '/admin/manage/edit?id=' + id
    })
  }


})
router.get('/delete', async (ctx) => {
  ctx.body = '删除用户'
})
module.exports = router.routes()