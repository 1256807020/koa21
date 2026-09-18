'use strict'
const Router = require('@koa/router')
const router = new Router()
let DB = require('../../model/db.js')
let tools = require('../../model/tools.js')
// P1：SSR 表单也走 zod 校验；写操作按"表名 + 动作"声明 RBAC 权限
const { z, validatePageBody } = require('../../utils/validate')
const { requirePermissionPageByTable } = require('../../middleware/rbac')

// { error } 用于"字段缺失"时的中文提示（zod 4 写法），min/regex 用于"值非法"时的提示
const usernameRule = z.string({ error: '用户名必填' }).trim().min(4, '用户名至少 4 位').max(20)
  .regex(/^\w+$/, '用户名只能是字母、数字或下划线')

// 新增：密码必填且两次一致
// （顺带修掉原代码的校验 bug：原判断写的是 password.length > 6 才报错，与提示"长度小于6位"完全相反）
const manageAddSchema = z.object({
  username: usernameRule,
  password: z.string({ error: '密码必填' }).min(6, '密码至少 6 位').max(30),
  rpassword: z.string({ error: '请再次输入密码' }),
  status: z.coerce.number().int().min(0).max(1).optional()
}).refine((d) => d.password === d.rpassword, { message: '两次输入的密码不一致' })

// 编辑：密码留空表示"不修改密码"，因此允许空串
const manageEditSchema = z.object({
  username: usernameRule,
  password: z.union([z.literal(''), z.string().min(6, '密码至少 6 位').max(30)]).optional(),
  rpassword: z.string().optional(),
  status: z.coerce.number().int().min(0).max(1).optional()
}).refine((d) => !d.password || d.password === d.rpassword, { message: '两次输入的密码不一致' })

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
router.post('/doAdd', requirePermissionPageByTable('manage', 'create'), validatePageBody(manageAddSchema, '/admin/manage/add'), async (ctx) => {
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

  } else if (password != rpassword || password.length < 6) {

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

      //增加管理员（密码用 bcrypt 哈希存储）
      var addResult = await DB.insert('admin', { "username": username, "password": await tools.hashPassword(password), "status": 1, "lasttime": '' });

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
router.post('/doEdit', requirePermissionPageByTable('manage', 'update'), validatePageBody(manageEditSchema, (ctx) => `/admin/manage/edit?id=${ctx.request.body.id || ''}`), async (ctx) => {
  // id 需要声明在 try 之外，否则 catch 里访问不到（原代码的 ReferenceError 隐患）
  const id = ctx.request.body.id
  try {
    let username = ctx.request.body.username
    let password = ctx.request.body.password
    let rpassword = ctx.request.body.rpassword
    if (password !== '') {
      if (password != rpassword || password.length < 6) {

        await ctx.render('admin/error', {
          message: '密码和确认密码不一致，或者密码长度小于6位',
          redirect: ctx.state.__HOST__ + '/admin/manage/edit?id=' + id
        })

      } else {
        // 合法的话，更新密码（bcrypt 哈希）
        await DB.update('admin', { "_id": DB.getObjectId(id) }, { "username": username, "password": await tools.hashPassword(password), "status": 1, "lasttime": '' })
        ctx.redirect(ctx.state.__HOST__ + '/admin/manage')
      }
    } else {
      ctx.redirect(ctx.state.__HOST__ + '/admin/manage')
    }

  } catch (err) {
    await ctx.render('admin/error', {
      message: err.message,
      redirect: ctx.state.__HOST__ + '/admin/manage/edit?id=' + id
    })
  }


})
router.get('/delete', async (ctx) => {
  ctx.body = '删除用户'
})
module.exports = router.routes()