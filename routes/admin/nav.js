'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
// P1：SSR 表单也走 zod 校验；写操作按"表名 + 动作"声明 RBAC 权限
const { z, validatePageBody } = require('../../utils/validate')
const { requirePermissionPageByTable } = require('../../middleware/rbac')

// 导航表单 schema（表单提交的都是字符串，用 coerce 转数字后再入库，类型才正确）
// ⚠️ 刻意不写 .default()：后台表单"没提交的字段"原本语义是"不修改"，
//    若给默认值（如 sort=0），编辑时未提交的字段会被重置，属于隐蔽的行为变更。
const navSchema = z.object({
  // 注意 zod 4 的写法：字段**缺失**时抛的是"类型错误"，必须用 { error } 指定中文，
  // 否则用户会看到英文的 "Invalid input: expected string, received undefined"。
  title: z.string({ error: '导航名称必填' }).trim().min(1, '导航名称必填').max(100),
  url: z.string({ error: '链接地址必填' }).trim().min(1, '链接地址必填').max(255),
  sort: z.coerce.number().int().min(0).max(9999).optional(),
  status: z.coerce.number().int().min(0).max(1).optional()
})

router.get('/', async (ctx) => {
  // ctx.body = "导航管理"
  let result = await DB.find('nav', {})
  await ctx.render('admin/nav/index', { list: result })
})
router.get('/add', async (ctx) => {
  await ctx.render('admin/nav/add')
})
router.post('/doAdd', requirePermissionPageByTable('nav', 'create'), validatePageBody(navSchema, '/admin/nav/add'), async (ctx) => {
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
router.post('/doEdit', requirePermissionPageByTable('nav', 'update'), validatePageBody(navSchema, (ctx) => `/admin/nav/edit?id=${ctx.request.body.id || ''}`), async (ctx) => {
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