'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
// P1：SSR 表单也走 zod 校验；写操作按"表名 + 动作"声明 RBAC 权限
const { z, validatePageBody } = require('../../utils/validate')
const { requirePermissionPageByTable } = require('../../middleware/rbac')

// ⚠️ 不写 .default()：未提交的字段语义是"不修改"，给默认值会把编辑时没动的字段重置
const cateSchema = z.object({
  title: z.string({ error: '分类名称必填' }).trim().min(1, '分类名称必填').max(100),
  pid: z.string().trim().max(64).optional(), // '0' 表示一级分类
  keywords: z.string().max(255).optional(),
  description: z.string().optional(),
  status: z.coerce.number().int().min(0).max(1).optional()
})
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
router.post('/doAdd', requirePermissionPageByTable('articlecate', 'create'), validatePageBody(cateSchema, '/admin/articlecate/add'), async (ctx) => {
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
router.post('/doEdit', requirePermissionPageByTable('articlecate', 'update'), validatePageBody(cateSchema, (ctx) => `/admin/articlecate/edit?id=${ctx.request.body.id || ''}`), async (ctx) => {
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
// 说明：原来这里有个 `GET /delete` 占位路由（只返回文本"删除用户"），已删除。
// 真正的删除走 POST /admin/remove（带 CSRF + 权限点 + 子分类/文章占用校验）。
module.exports = router.routes()
