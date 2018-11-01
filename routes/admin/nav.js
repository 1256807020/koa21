'use strict'
let router = require('koa-router')()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')

router.get('/', async (ctx) => {
  // ctx.body = "导航管理"
  let result = await DB.find('nav', {})
  await ctx.render('admin/nav/index', { list: result })
})
router.get('/add', async (ctx) => {
  await ctx.render('admin/nav/add')
})
router.post('/doAdd', async (ctx) => {
  // 增加到数据库
  // 当不使用上传模块时，要用request,而不是req,同时表单中不能有enctype="multipart/form-data"
  let title = ctx.request.body.title
  let url = ctx.request.body.url
  let sort = ctx.request.body.sort
  let status = ctx.request.body.status
  let add_time = tools.getTime()
  await DB.insert('nav', {
    title, url, sort, status, add_time
  })
  // 跳转
  ctx.redirect(ctx.state.__HOST__ + '/admin/nav')
})
router.get('/edit', async (ctx) => {
  var id = ctx.query.id
  var result = await DB.find('nav', { "_id": DB.getObjectId(id) });
  // console.log(result)
  await ctx.render('admin/nav/edit', {
    list: result[0],
    prevPage: ctx.state.G.prevPage   /*保存上一页的值*/
  })
})
router.post('/doEdit', async (ctx) => {
  console.log(ctx.request.body)
  let id = ctx.request.body.id;
  let title = ctx.request.body.title
  let url = ctx.request.body.url
  let sort = ctx.request.body.sort
  let status = ctx.request.body.status
  let add_time = tools.getTime()
  let prevPage = ctx.request.body.prevPage || '';  /*上一页的地址*/
  await DB.update('nav', { "_id": DB.getObjectId(id) }, { title, url, sort, status, add_time });
  //跳转
  if (prevPage) {
    ctx.redirect(prevPage);
  } else {
    // 跳转
    ctx.redirect(ctx.state.__HOST__ + '/admin/nav')
  }
})
module.exports = router.routes()