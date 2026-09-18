// routes/api/admin.js
// ============================================================
// 后台管理 JSON API（P0 底座）
// 响应约定：统一走 utils/response 的 { code, message, data }
//
// 路由（资源驱动，一张表配置所有资源）：
//   GET   /api/admin/:resource/list           列表（分页/搜索）
//   POST  /api/admin/:resource/add            新增
//   GET   /api/admin/:resource/:id            详情
//   POST  /api/admin/:resource/:id/edit       编辑
//   POST  /api/admin/:resource/:id/delete     删除（重构自原 GET /admin/remove 占位）
//
// 路由前缀写法说明（踩坑已验证 · 关键）：
//   本文件路由写成【相对路径】 /:resource/*（不带 /admin），因为 /api/admin 两段前缀由两层剥离提供：
//     1) api.js 的 Router({ prefix:'/api' }) 剥离 /api
//     2) api.js 的 router.use('/admin', adminApi) 再剥离 /admin
//   两层剥离后 adminApi 实际拿到的路径是 /manage/list，正好匹配本文件的 /:resource/list。
//   若本文件写成 /admin/:resource/list（带前缀）会"三层" → /manage/list 匹配不上 → 404；
//   若 api.js 写成 router.use(adminApi) 不带 /admin，则 adminApi 拿到 /api/admin/manage/list（带了 /api）→ 也 404。
//   详见 docs/dev-notes.md 阶段二踩坑 C。
// ============================================================
const Router = require('@koa/router')
const router = new Router()

const { ok, fail } = require('../../utils/response')
const code = require('../../utils/code')
const { z, parse, pageSchema } = require('../../utils/validate')
const { handle } = require('../../utils/handle')
const { requireLogin, csrfGuard } = require('../../middleware/guard')
const { requirePermissionByResource } = require('../../middleware/rbac')
const { auditLog } = require('../../middleware/auditLog')

const adminService = require('../../services/adminService')
const articleService = require('../../services/articleService')

// 资源名 -> service 映射：新增一个资源只需在这里加一行 + 一个 add schema
const services = {
  manage: adminService,
  article: articleService
}

// 请求 schema 统一来自 utils/schemas.js（**单一来源**）：
// 路由用它做运行时校验，utils/openapi.js 用它生成文档 —— 一份定义两处消费，避免契约与实现漂移。
const { resourceAddSchemas: addSchemas, resourceUpdateSchemas } = require('../../utils/schemas')

// —— 统一错误处理包装已抽到 utils/handle.js（rbac/audit/public 等路由共用同一套语义）——
// 它的作用：业务错误（带 .code）→ 映射语义化 HTTP status → fail() 统一出参；
// 未预期异常继续冒泡到全局 500 兜底。详见 utils/handle.js 注释。

function getService (ctx) {
  const svc = services[ctx.params.resource]
  if (!svc) {
    const e = new Error('未知资源')
    e.code = code.NOT_FOUND
    throw e
  }
  return svc
}

// —— 安全与审计闸门（顺序有讲究）——
//   1) requireLogin：你是谁？（未登录 401）
//   2) csrfGuard：写请求是否来自本站（防 CSRF）
//   3) auditLog：包住后续流程，业务成功后才写审计（只记写方法）
//   4) 每个路由再声明自己的权限点（RBAC），实现"能读≠能写"
// 三道守卫都用 fail() 直接出参、不 throw，避免被判成 500。
router.use(requireLogin)
router.use(csrfGuard)
router.use(auditLog)

// 资源存在性校验：未知资源直接 404。
// 必须放在**权限校验之前**——否则超管访问 /admin/foo/list 会因"没有 foo:list 权限"得到 403，
// 把"资源不存在"错报成"无权限"，排查时非常费解。
//
// ⚠️ 必须作为**路由级**中间件（写在每个路由的中间件链里），不能用 router.use()：
// router.use 的中间件在"路由尚未匹配"时就执行，那时 ctx.params 还是空的
// （实测会变成 `未知资源：undefined`，把正常请求全打回 404）。
function knownResource (ctx, next) {
  if (!services[ctx.params.resource]) {
    return fail(ctx, code.NOT_FOUND, `未知资源：${ctx.params.resource || '(空)'}`, null, 404)
  }
  return next()
}

// 列表（需要 xxx:list）
router.get('/:resource/list', knownResource, requirePermissionByResource('list'), handle(async (ctx) => {
  const svc = getService(ctx)
  const { page, pageSize } = parse(pageSchema, ctx.query)
  // ⚠️ 展开顺序：page/pageSize 必须放最后。
  // 若写成 { page, pageSize, ...ctx.query }，ctx.query 里的原始字符串会**覆盖**已校验转换的值
  // （下游虽然还会 Number() 一次，但"校验结果被无声覆盖"本身就是隐患，语义也错了）。
  const data = await svc.list({ ...ctx.query, page, pageSize })
  ok(ctx, data)
}))

// 详情（同样按"查看"权限，不额外区分）
router.get('/:resource/:id', knownResource, requirePermissionByResource('list'), handle(async (ctx) => {
  const svc = getService(ctx)
  const item = await svc.getById(ctx.params.id)
  if (!item) {
    const e = new Error('资源不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  ok(ctx, item)
}))

// 新增（需要 xxx:create）
router.post('/:resource/add', knownResource, requirePermissionByResource('create'), handle(async (ctx) => {
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

// 编辑（需要 xxx:update）
router.post('/:resource/:id/edit', knownResource, requirePermissionByResource('update'), handle(async (ctx) => {
  const svc = getService(ctx)
  const schema = addSchemas[ctx.params.resource]
  if (!schema) {
    const e = new Error('该资源不支持编辑')
    e.code = code.NOT_FOUND
    throw e
  }
  // 编辑允许部分字段（PATCH 语义），这里换成"已放开必填"的 update schema
  const payload = parse(resourceUpdateSchemas[ctx.params.resource], ctx.request.body)
  const item = await svc.update(ctx.params.id, payload)
  ok(ctx, item, '编辑成功')
}))

// 删除（需要 xxx:delete；真正调用 DB.remove）
router.post('/:resource/:id/delete', knownResource, requirePermissionByResource('delete'), handle(async (ctx) => {
  const svc = getService(ctx)
  await svc.remove(ctx.params.id)
  ok(ctx, null, '删除成功')
}))

module.exports = router.routes()
