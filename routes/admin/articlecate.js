'use strict'
let router = require('koa-router')()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
router.get('/', async (ctx) => {
  // 一旦打印出promise，肯定是少加了await
  let result = await DB.find('articlecate', {});
  // console.log(result)
  await ctx.render('admin/articlecate/index', {
    list: tools.cateToList(result)
  })
})
router.get('/add', async (ctx) => {
  // 获取一级分类
  let result = await DB.find('articlecate', { 'pid': '0' })
  // console.log(result)
  await ctx.render('admin/articlecate/add', {
    catelist: result
  })
})
router.post('/doAdd', async (ctx) => {
  // console.log(ctx.request.body)
  let addData = ctx.request.body
  let result = await DB.insert('articlecate', addData)
  ctx.redirect(ctx.state.__HOST__ + '/admin/articlecate')
})
router.get('/edit', async (ctx) => {
  // ctx.body = '编辑用户'
  let id = ctx.query.id
  // console.log(id)
  let result = await DB.find('articlecate', { "_id": DB.getObjectId(id) })
  let articlecate = await DB.find('articlecate', { 'pid': '0' })
  await ctx.render('admin/articlecate/edit', {

    list: result[0],
    catelist: articlecate
  });
})
router.post('/doEdit', async (ctx) => {
  // console.log(ctx.request.body)
  let editData = ctx.request.body
  let id = editData.id /*前台设置隐藏表单域传过来*/
  let title = editData.title
  let description = editData.description
  let keywords = editData.keywords
  let pid = editData.pid
  let status = editData.status
  let result = await DB.update('articlecate', { '_id': DB.getObjectId(id) }, {
    title, pid, keywords, status, description
  })
  ctx.redirect(ctx.state.__HOST__ + '/admin/articlecate')
})
router.get('/delete', async (ctx) => {
  ctx.body = '删除用户'
})
module.exports = router.routes()
