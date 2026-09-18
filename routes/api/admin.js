// routes/api/admin.js
// ============================================================
// 后台管理 JSON API（P0 底座）
// 响应约定：统一走 utils/response 的 { code, message, data }
// 路由（资源驱动，一张表配置所有资源）：
//   GET   /api/admin/:resource/list           列表（分页/搜索）
//   POST  /api/admin/:resource/add            新增
//   GET   /api/admin/:resource/:id            详情
//   POST  /api/admin/:resource/:id/edit       编辑
//   POST  /api/admin/:resource/:id/delete     删除（重构自原 GET /admin/remove 占位）
// 说明：本阶段先把"能用 + 参数化防注入 + 统一出参"落地；
//       CSRF / 权限(RBAC) 在后续步骤补，届时在 handle 外再包一层鉴权中间件即可。
// ============================================================
const Router = require('@koa/router')
const router = new Router({ prefix: '/admin' })

const { ok, fail } = require('../../utils/response')
const code = require('../../utils/code')
const { z, parse, pageSchema } = require('../../utils/validate')

const adminService = require('../../services/adminService')
const articleService = require('../../services/articleService')

// 资源名 -> service 映射：新增一个资源只需在这里加一行 + 一个 add schema
const services = {
  manage: adminService,
  article: articleService
}

// 各资源"新增"字段校验 schema（zod 声明式校验，替代散落正则）
const addSchemas = {
  manage: z.object({
    username: z.string().min(2, '用户名至少 2 位').max(30),
    password: z.string().min(6, '密码至少 6 位').max(30),
    status: z.coerce.number().int().min(0).max(1).optional()
  }),
  article: z.object({
    title: z.string().min(1, '标题必填').max(200),
    author: z.string().max(50).optional(),
    pid: z.string().optional(),
    content: z.string().optional(),
    status: z.coerce.number().int().min(0).max(1).optional()
  })
}

// —— 统一错误处理包装：业务错误（带 .code）转 fail；系统异常冒泡到全局 500 ——
// 踩坑：koa 会捕获 async 路由里 throw 并冒泡到全局 error 中间件。
// 如果我们不在这里显式 fail，业务错误会被当成 500、返回旧风格 {success:false}，与 {code} 不一致。
function handle (fn) {
  return async (ctx) => {
    try {
      await fn(ctx)
    } catch (err) {
      const c = err.code || code.UNKNOWN
      // 部分业务错误给更语义化的 HTTP 状态（方便网关识别），其余默认 200 由 code 区分
      const status = c === code.UNAUTHENTICATED ? 401
        : c === code.FORBIDDEN ? 403
          : c === code.PARAM_ERROR ? 400
            : c === code.NOT_FOUND ? 404
              : 200
      fail(ctx, c, err.message, null, status)
    }
  }
}

function getService (ctx) {
  const svc = services[ctx.params.resource]
  if (!svc) {
    const e = new Error('未知资源')
    e.code = code.NOT_FOUND
    throw e
  }
  return svc
}

// 列表
router.get('/:resource/list', handle(async (ctx) => {
  const svc = getService(ctx)
  const { page, pageSize } = parse(pageSchema, ctx.query)
  // 其余查询参数（title / cateId / username）透传给 service，由 service 自行取舍
  const data = await svc.list({ page, pageSize, ...ctx.query })
  ok(ctx, data)
}))

// 详情
router.get('/:resource/:id', handle(async (ctx) => {
  const svc = getService(ctx)
  const item = await svc.getById(ctx.params.id)
  if (!item) {
    const e = new Error('资源不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  ok(ctx, item)
}))

// 新增
router.post('/:resource/add', handle(async (ctx) => {
  const svc = getService(ctx)
  const schema = addSchemas[ctx.params.resource]
  if (!schema) {
    const e = new Error('该资源不支持新增')
    e.code = code.NOT_FOUND
    throw e
  }
  const payload = parse(schema, ctx.request.body)
  const item = await svc.create(payload)
  ok(ctx, item, '新增成功')
}))

// 编辑
router.post('/:resource/:id/edit', handle(async (ctx) => {
  const svc = getService(ctx)
  const schema = addSchemas[ctx.params.resource]
  if (!schema) {
    const e = new Error('该资源不支持编辑')
    e.code = code.NOT_FOUND
    throw e
  }
  // 编辑允许部分字段，用 .partial() 放开必填
  const payload = parse(schema.partial(), ctx.request.body)
  const item = await svc.update(ctx.params.id, payload)
  ok(ctx, item, '编辑成功')
}))

// 删除（重构自原 GET /admin/remove 占位，真正调用 DB.remove）
router.post('/:resource/:id/delete', handle(async (ctx) => {
  const svc = getService(ctx)
  await svc.remove(ctx.params.id)
  ok(ctx, null, '删除成功')
}))

module.exports = router.routes()
