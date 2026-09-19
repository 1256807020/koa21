'use strict'
// routes/backend.js
// ============================================================
// 新后台（Console）路由 —— 服务端渲染 + Liquid 模板
//
// 与老后台（routes/admin.js）**并存**：
//   /admin   → 老后台（Ace Admin + art-template）
//   /backend → 新后台（Tailwind + Liquid）
// 等新后台模块全部完成并验证后，再切换入口并删除老后台。
//
// 设计：资源 CRUD 页面**配置驱动**（utils/backendConfig.js），
//       列表/表单共用一套模板；表单经 fetch 提交到既有的 /api/v1/admin/* JSON API，
//       因此新后台"零后端改动"即可用，且复用 RBAC / CSRF / 审计。
// ============================================================
const Router = require('@koa/router')
const DB = require('../model/db')
const { toSite } = require('../utils/site.js')
const rbacService = require('../services/rbacService')
const { ensureCsrfToken } = require('../middleware/guard')
const { fail } = require('../utils/response')
const code = require('../utils/code')
const { RESOURCES } = require('../utils/backendConfig')

const adminService = require('../services/adminService')
const articleService = require('../services/articleService')
const {
  articlecateService, navService, focusService, linkService, settingService
} = require('../services/simpleResources')

// 资源名 → service（与 routes/api/admin.js 保持一致，权限点才能对上）
const serviceMap = {
  manage: adminService,
  article: articleService,
  articlecate: articlecateService,
  nav: navService,
  focus: focusService,
  link: linkService,
  setting: settingService
}

const router = new Router()

// 登录守卫 + 全局变量契约
// 页面场景应**重定向到登录页**，而不是像 JSON API 那样返回 401
// （middleware/guard.js 的 requireLogin 是给接口用的，这里自己写更符合页面语义）。
router.use(async (ctx, next) => {
  if (!ctx.session.userinfo) return ctx.redirect('/admin/login')

  ctx.state.userinfo = ctx.session.userinfo
  ctx.state.pathname = ctx.path
  const settingRows = await DB.find('setting', {})
  ctx.state.site = toSite(settingRows[0] || {})
  // 权限点集合（数组），供侧栏菜单按权限显隐；真实数据闸门在 /api/v1/admin/*（RBAC 中间件）
  const perms = await rbacService.getAdminPermissions(ctx.session.userinfo._id)
  ctx.state.perms = [...perms]
  // 签发可读 CSRF Cookie（写操作 / 登出双提交校验用）
  ctx.state.csrfToken = ensureCsrfToken(ctx)
  await next()
})

/** 当前用户是否拥有某权限点 */
function can (ctx, permCode) {
  return ctx.state.perms.includes(permCode)
}

/** 统一 404 / 无权限 页面 */
async function renderMessage (ctx, title, message, status = 404) {
  ctx.status = status
  await ctx.render('backend/pages/message', { title, message })
}

/** 取表单里用到的下拉数据源（分类 / 角色） */
async function getSelectOptions () {
  const { list: cats } = await articlecateService.list({ page: 1, pageSize: 999 })
  const categories = cats.map((c) => ({ value: c._id, label: c.title }))
  const roles = (await rbacService.listRoles()).map((r) => ({ value: r._id, label: r.name }))
  return { categories, roles }
}

/** 取分类 id→名称 映射（列表里显示 pid 用） */
async function getCategoryMap () {
  const { list } = await articlecateService.list({ page: 1, pageSize: 999 })
  const map = {}
  list.forEach((c) => { map[c._id] = c.title })
  return map
}

/** 由 service.list 的返回构造分页信息 */
function buildPageInfo (data) {
  const page = Number(data.page) || 1
  const pageSize = Number(data.pageSize) || 10
  const total = Number(data.total) || 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  return { page, pageSize, total, totalPages, hasPrev: page > 1, hasNext: page < totalPages }
}

/** 组装列表页 / 列表片段需要的渲染数据 */
async function listRenderData (ctx, cfg, service, page, keyword) {
  const data = await service.list({ page, pageSize: 10, keyword })
  return {
    resource: ctx.params.resource,
    cfg,
    columns: cfg.columns,
    rows: data.list,
    pageInfo: buildPageInfo(data),
    keyword: keyword || '',
    canEdit: can(ctx, `${cfg.perm}:update`),
    canDelete: can(ctx, `${cfg.perm}:delete`),
    categoryMap: (cfg.columns.some((c) => c.type === 'pid')) ? await getCategoryMap() : {}
  }
}

// ---------------- 仪表盘 ----------------
router.get('/', async (ctx) => {
  const [article, cate] = await Promise.all([
    DB.count('article', {}),
    DB.count('articlecate', {})
  ])
  await ctx.render('backend/pages/dashboard', { stats: { article, cate } })
})

// ---------------- 登出 ----------------
router.post('/logout', async (ctx) => {
  const cookie = ctx.cookies.get('csrfToken')
  const field = (ctx.request.body && ctx.request.body._csrf) || ctx.get('X-CSRF-Token')
  if (!cookie || !field || cookie !== field) {
    ctx.status = 403
    await ctx.render('backend/pages/message', { title: '操作被拒绝', message: 'CSRF 校验失败，请刷新页面后重试', status: 403 })
    return
  }
  ctx.session = null
  ctx.redirect('/admin/login')
})

// ---------------- 审计日志（只读）----------------
router.get('/audit', async (ctx) => {
  if (!can(ctx, 'audit:list')) return renderMessage(ctx, '无权限', '你没有查看审计日志的权限', 403)
  await ctx.render('backend/pages/audit', {})
})

// ---------------- 统计报表 ----------------
router.get('/stats', async (ctx) => {
  if (!can(ctx, 'stats:view')) return renderMessage(ctx, '无权限', '你没有查看统计报表的权限', 403)
  await ctx.render('backend/pages/stats', {})
})

// ---------------- 资源列表 / 单行表编辑 ----------------
router.get('/:resource', async (ctx) => {
  const cfg = RESOURCES[ctx.params.resource]
  if (!cfg) return renderMessage(ctx, '页面不存在', `未知资源：${ctx.params.resource}`)

  // 单行表（站点设置）：直接渲染编辑表单
  if (cfg.singleRow) {
    if (!can(ctx, `${cfg.perm}:update`)) return renderMessage(ctx, '无权限', '你没有编辑该资源的权限', 403)
    const item = await serviceMap[cfg.service].getById()
    const selectOptions = await getSelectOptions()
    return ctx.render('backend/pages/resource-form', {
      resource: ctx.params.resource, cfg, item: item || {}, isEdit: true,
      formTitle: '编辑' + cfg.label, selectOptions
    })
  }

  if (!can(ctx, `${cfg.perm}:list`)) return renderMessage(ctx, '无权限', '你没有查看该资源的权限', 403)
  const page = Number(ctx.query.page) || 1
  const keyword = ctx.query.keyword || ''
  const data = await listRenderData(ctx, cfg, serviceMap[cfg.service], page, keyword)
  data.canAdd = can(ctx, `${cfg.perm}:create`)
  await ctx.render('backend/pages/resource-list', data)
})

// ---------------- 列表片段（AJAX 局部刷新）----------------
router.get('/:resource/rows', async (ctx) => {
  const cfg = RESOURCES[ctx.params.resource]
  if (!cfg || cfg.singleRow) return renderMessage(ctx, '页面不存在', '该资源不支持列表', 404)
  if (!can(ctx, `${cfg.perm}:list`)) return renderMessage(ctx, '无权限', '权限不足', 403)
  const page = Number(ctx.query.page) || 1
  const keyword = ctx.query.keyword || ''
  const data = await listRenderData(ctx, cfg, serviceMap[cfg.service], page, keyword)
  data.canAdd = can(ctx, `${cfg.perm}:create`)
  await ctx.render('backend/snippets/resource-list-body', data)
})

// ---------------- 新增表单 ----------------
router.get('/:resource/create', async (ctx) => {
  const cfg = RESOURCES[ctx.params.resource]
  if (!cfg || cfg.singleRow) return renderMessage(ctx, '页面不存在', '该资源不支持新增', 404)
  if (!can(ctx, `${cfg.perm}:create`)) return renderMessage(ctx, '无权限', '你没有新增该资源的权限', 403)
  const selectOptions = await getSelectOptions()
  await ctx.render('backend/pages/resource-form', {
    resource: ctx.params.resource, cfg, item: {}, isEdit: false,
    formTitle: '新增' + cfg.label, selectOptions
  })
})

// ---------------- 编辑表单 ----------------
router.get('/:resource/edit/:id', async (ctx) => {
  const cfg = RESOURCES[ctx.params.resource]
  if (!cfg || cfg.singleRow) return renderMessage(ctx, '页面不存在', '该资源不支持编辑', 404)
  if (!can(ctx, `${cfg.perm}:update`)) return renderMessage(ctx, '无权限', '你没有编辑该资源的权限', 403)
  let item
  try {
    item = await serviceMap[cfg.service].getById(ctx.params.id)
  } catch (err) {
    return renderMessage(ctx, '页面不存在', '记录不存在或已被删除')
  }
  const selectOptions = await getSelectOptions()
  await ctx.render('backend/pages/resource-form', {
    resource: ctx.params.resource, cfg, item: item || {}, isEdit: true,
    formTitle: '编辑' + cfg.label, selectOptions
  })
})

module.exports = router.routes()
