'use strict'
let router = require('koa-router')()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')

router.get('/', async (ctx) => {
  let page = ctx.query.page || 1;
  let pageSize = 3;

  let count = await DB.count('article', {});
  let result = await DB.find('link', {}, {}, {
    page, pageSize,
    sortJson: {
      'add_time': -1
    }
  })
  await ctx.render('admin/link/index', {
    list: result,
    page: page,
    totalPages: Math.ceil(count / pageSize)
  })
  // ctx.body = "轮播图"
})
router.get('/add', async (ctx) => {
  await ctx.render('admin/link/add')
})
router.post('/doAdd', tools.multer().single('pic'), async (ctx) => {
  // enctype="multipart/form-data"  注意在add模版中添加这部分代码，否则图片上传不成功
  // ctx.body = {
  //   filename: ctx.req.file ? ctx.req.file.filename : '',  //返回文件名
  //   body: ctx.req.body
  // }
  // 增加到数据库
  let title = ctx.req.body.title
  let pic = ctx.req.file ? ctx.req.file.path.substr(7) : '';
  let url = ctx.req.body.url
  let sort = ctx.req.body.sort
  let status = ctx.req.body.status
  let add_time = tools.getTime()
  await DB.insert('link', {
    title, pic, url, sort, status, add_time
  })
  // 跳转
  ctx.redirect(ctx.state.__HOST__ + '/admin/link')
})
router.get('/edit', async (ctx) => {
  var id = ctx.query.id
  var result = await DB.find('link', { "_id": DB.getObjectId(id) });
  // console.log(result)
  await ctx.render('admin/link/edit', {
    list: result[0]
  })
})
router.post('/doEdit', tools.multer().single('pic'), async (ctx) => {
  let id = ctx.req.body.id;
  let title = ctx.req.body.title
  let pic = ctx.req.file ? ctx.req.file.path.substr(7) : '';
  let url = ctx.req.body.url
  let sort = ctx.req.body.sort
  let status = ctx.req.body.status
  let add_time = tools.getTime()
  if (pic) {
    var json = { title, pic, url, sort, status, add_time }
  } else {
    var json = { title, url, sort, status, add_time }
  }
  // console.log(json)
  // await DB.update('link', { '_id': DB.getObjectId(id) }, json)
  await DB.update('link', { "_id": DB.getObjectId(id) }, json);
  // 跳转
  ctx.redirect(ctx.state.__HOST__ + '/admin/link')
})
module.exports = router.routes()