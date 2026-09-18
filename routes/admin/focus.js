'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
// multipart 表单的 CSRF 校验必须放在 multer 之后（multer 解析完 body 才有 _csrf 字段）
const { csrfGuardPage } = require('../../middleware/guard')
const { z, validatePageBody } = require('../../utils/validate')
const { requirePermissionPageByTable } = require('../../middleware/rbac')

// 轮播图表单 schema（不加 .default()：未提交字段保持"不修改"语义）
const focusSchema = z.object({
  title: z.string({ error: '标题必填' }).trim().min(1, '标题必填').max(100),
  url: z.string().max(255).optional(),
  sort: z.coerce.number().int().min(0).max(9999).optional(),
  status: z.coerce.number().int().min(0).max(1).optional()
})

router.get('/', async (ctx) => {
  let page = ctx.query.page || 1;
  let pageSize = 3;

  let count = await DB.count('article', {});
  let result = await DB.find('focus', {}, {}, {
    page, pageSize,
    sortJson: {
      'add_time': -1
    }
  })
  await ctx.render('admin/focus/index', {
    list: result,
    page: page,
    totalPages: Math.ceil(count / pageSize)
  })
  // ctx.body = "轮播图"
})
router.get('/add', async (ctx) => {
  await ctx.render('admin/focus/add')
})
// 顺序：权限 → multer → CSRF（multer 之后才能读到 _csrf）→ zod → 业务
router.post('/doAdd', requirePermissionPageByTable('focus', 'create'), tools.multer().single('pic'), csrfGuardPage, validatePageBody(focusSchema, '/admin/focus/add'), async (ctx) => {
  // enctype="multipart/form-data"  注意在add模版中添加这部分代码，否则图片上传不成功
  // ctx.body = {
  //   filename: ctx.req.file ? ctx.req.file.filename : '',  //返回文件名
  //   body: ctx.req.body
  // }
  // 增加到数据库
  let title = ctx.req.body.title
  let pic = tools.imgUrl(ctx.req.file);
  let url = ctx.req.body.url
  let sort = ctx.req.body.sort
  let status = ctx.req.body.status
  let add_time = tools.getTime()
  await DB.insert('focus', {
    title, pic, url, sort, status, add_time
  })
  // 跳转
  ctx.redirect(ctx.state.__HOST__ + '/admin/focus')
})
router.get('/edit', async (ctx) => {
  var id = ctx.query.id
  var result = await DB.find('focus', { "_id": DB.getObjectId(id) });
  // console.log(result)
  await ctx.render('admin/focus/edit', {
    list: result[0]
  })
})
router.post('/doEdit', requirePermissionPageByTable('focus', 'update'), tools.multer().single('pic'), csrfGuardPage, validatePageBody(focusSchema, (ctx) => `/admin/focus/edit?id=${ctx.request.body.id || ''}`), async (ctx) => {
  let id = ctx.req.body.id;
  console.log(id)
  let title = ctx.req.body.title
  let pic = tools.imgUrl(ctx.req.file);
  let url = ctx.req.body.url
  let sort = ctx.req.body.sort
  let status = ctx.req.body.status
  let add_time = tools.getTime()
  let json
  if (pic) {
    json = { title, pic, url, sort, status, add_time }
  } else {
    json = { title, url, sort, status, add_time }
  }
  console.log(json)
  // await DB.update('focus', { '_id': DB.getObjectId(id) }, json)
  await DB.update('focus', { "_id": DB.getObjectId(id) }, json);
  // 跳转
  ctx.redirect(ctx.state.__HOST__ + '/admin/focus')
})
module.exports = router.routes()