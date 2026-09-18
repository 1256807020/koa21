'use strict'
// ============================================================
// 前台路由 —— 主题系统 + 变量契约
// 配套文档：docs/theme-system.md
//
// 本文件做三件事：
//   1) 主题解析：决定用 themes/ 下哪一套模板（支持 ?theme=xxx 临时预览）
//   2) 变量契约：每个页面统一注入 site / nav / cats / theme / pathname，
//      列表页统一 list + page 对象，详情页统一 article + prev/next
//      —— 写模板的人只需看契约表，不必读本文件
//   3) 渲染：主题缺某个页面时自动回退 default，避免"复制一半的主题"把站点搞挂
// ============================================================
const Router = require('@koa/router')
const router = new Router()
const path = require('path')
const fs = require('fs')
const url = require('url')
const DB = require('../model/db.js')
const config = require('../model/config.js')
const tools = require('../model/tools.js')

// ---------------- 主题解析 ----------------
const VIEWS_DIR = path.join(config.root, 'views')
const THEMES_DIR = path.join(VIEWS_DIR, 'themes')
const DEFAULT_THEME = 'default'
const THEME_NAME_RE = /^[a-z0-9-]{1,32}$/

/**
 * 主题名安全校验（**防目录穿越**）：
 *   ① 先做字符集白名单 [a-z0-9-]{1,32} —— 任何 ../ 、绝对路径、中文都会被拒
 *   ② 再校验 themes/ 下真实存在且带 theme.json
 * 任一不满足返回 null（调用方回退 default）。
 * 教学点：凡是"用请求参数拼文件路径"的地方，都必须先做字符集白名单 + 存在性校验。
 */
function pickTheme (name) {
  const s = String(name || '')
  if (!THEME_NAME_RE.test(s)) return null
  if (!fs.existsSync(path.join(THEMES_DIR, s, 'theme.json'))) return null
  return s
}

/**
 * 「已启用」的查询条件。
 * 注意：种子数据里 status 是数字 1，后台表单提交后可能被存成字符串 '1'，
 * 因此用 $or 同时兼容两种形态（历史遗留，不清洗数据的前提下这是最稳的写法）。
 */
function enabled () {
  return { $or: [{ status: 1 }, { status: '1' }] }
}

/** 站点设置 → 契约里的 site（去掉 site_ 前缀，模板写 {{site.title}} 而不是 {{site.site_title}}） */
function toSite (row = {}) {
  return {
    title: row.site_title || '',
    logo: row.site_logo || '',
    url: row.site_url || '',
    keywords: row.site_keywords || '',
    description: row.site_description || '',
    icp: row.site_icp || '',
    qq: row.site_qq || '',
    tel: row.site_tel || '',
    address: row.site_address || ''
  }
}

/** 分页对象（契约 page）：所有列表页形状完全一致 */
function toPage (current, pageSize, total) {
  const totalPages = Math.ceil(total / pageSize) || 0
  return {
    current,
    pageSize,
    total,
    totalPages,
    hasPrev: current > 1,
    hasNext: current < totalPages
  }
}

/**
 * 分类树：tools.cateToList 把子分类挂在 parent.list 上，
 * 契约里统一叫 children（语义更清楚），这里做一次字段名映射。
 */
function buildCatTree (rows) {
  return tools.cateToList(rows).map((item) => ({
    _id: item._id,
    title: item.title,
    pid: item.pid,
    sort: item.sort,
    children: (item.list || []).map((c) => ({ _id: c._id, title: c.title, pid: c.pid, sort: c.sort }))
  }))
}

// ---------------- 全局中间件：注入契约里的全局变量 ----------------
router.use(async (ctx, next) => {
  const pathname = url.parse(ctx.request.url).pathname

  const [navResult, settingResult, cateResult] = await Promise.all([
    DB.find('nav', enabled(), {}, { sortJson: { sort: 1 } }),
    DB.find('setting', {}),
    DB.find('articlecate', {})
  ])

  // 主题选择优先级：?theme=xxx 预览参数 > 站点设置里保存的 > default
  // 预览参数**只影响本次请求**（不落库、不写 Cookie），方便开发新主题时对照
  const savedTheme = pickTheme((settingResult[0] || {}).theme)
  const theme = pickTheme(ctx.query.theme) || savedTheme || DEFAULT_THEME

  ctx.state.__HOST__ = config.getOrigin(ctx)
  ctx.state.site = toSite(settingResult[0] || {})   // 契约：site（原 setting）
  ctx.state.nav = navResult                          // 契约：nav
  ctx.state.cats = buildCatTree(cateResult)          // 契约：cats（分类树）
  ctx.state.theme = `/themes/${theme}`               // 契约：theme（静态资源根，模板里写 {{theme}}/assets/style.css）
  ctx.state.themeName = theme
  ctx.state.pathname = pathname
  await next()
})

/**
 * 渲染页面模板。
 * 关键保护：当前主题若缺这个页面 → 自动回退 default 的同名页面。
 * 否则"复制了一半的新主题"会让前台直接 500，这是换主题功能最常见的翻车点。
 */
async function renderPage (ctx, page, data) {
  const name = ctx.state.themeName
  const file = path.join(THEMES_DIR, name, 'pages', `${page}.html`)
  const view = fs.existsSync(file)
    ? `themes/${name}/pages/${page}`
    : `themes/${DEFAULT_THEME}/pages/${page}`
  await ctx.render(view, data)
}

// ---------------- 首页 ----------------
router.get('/', async (ctx) => {
  const [focus, links, newsTop] = await Promise.all([
    DB.find('focus', enabled(), {}, { sortJson: { sort: 1 } }),
    DB.find('link', enabled(), {}, { sortJson: { sort: 1 } }),
    // 首页最新文章（契约 newsTop）：只取已发布
    DB.find('article', enabled(), {}, { page: 1, pageSize: config.frontend.pageSize, sortJson: { add_time: -1 } })
  ])

  await renderPage(ctx, 'index', { focus, links, newsTop })
})

// ---------------- 新闻列表 / 案例列表（共用逻辑） ----------------
/**
 * 分页列表的通用取数：支持按子分类筛选
 * @param {string} parentCateId 父分类 _id（news / case）
 */
async function loadListPage (ctx, parentCateId) {
  const cateId = ctx.query.pid
  const current = Number(ctx.query.page) || 1
  const pageSize = config.frontend.pageSize

  // 父分类下的二级分类（契约 subCates）
  const subCates = await DB.find('articlecate', { pid: parentCateId })

  const where = Object.assign({}, enabled())
  if (cateId) {
    where.pid = cateId
  } else {
    where.pid = { $in: subCates.map((item) => item._id.toString()) }
  }

  const [list, total] = await Promise.all([
    DB.find('article', where, {}, { page: current, pageSize, sortJson: { add_time: -1 } }),
    DB.count('article', where)
  ])

  return {
    list,                                  // 契约：list
    page: toPage(current, pageSize, total), // 契约：page 对象
    subCates,                               // 契约：subCates（原 newslist / catelist）
    cateId: cateId || ''                    // 契约：cateId
  }
}

router.get('/news', async (ctx) => {
  const data = await loadListPage(ctx, config.frontend.cateIds.news)
  await renderPage(ctx, 'news', data)
})

// ---------------- 成功案例 ----------------
router.get('/case', async (ctx) => {
  const data = await loadListPage(ctx, config.frontend.cateIds.case)
  await renderPage(ctx, 'case', data)
})

// ---------------- 服务 ----------------
router.get('/service', async (ctx) => {
  const list = await DB.find('article', Object.assign({ pid: config.frontend.cateIds.service }, enabled()))
  await renderPage(ctx, 'service', { list })
})

// ---------------- 文章详情 ----------------
router.get('/content/:id', async (ctx) => {
  const id = ctx.params.id

  // id 合法性先过一道，避免非法 ObjectId 打到数据库触发异常（非法 id 应 404 而不是 500）
  if (!/^[0-9a-zA-Z_-]{1,64}$/.test(String(id || ''))) {
    ctx.status = 404
    ctx.body = '<h3>内容不存在或已删除</h3>'
    return
  }

  // ⚠️ 必须过滤 status：否则"已下架"的文章详情页仍可被访问（这是本轮顺手修掉的真实问题）
  const rows = await DB.find('article', Object.assign({ _id: DB.getObjectId(id) }, enabled()))
  const article = rows[0]
  if (!article) {
    ctx.status = 404
    ctx.body = '<h3>内容不存在或已删除</h3>'
    return
  }

  // 面包屑：由文章分类反查（子分类则带上父分类）
  const breadcrumb = await buildBreadcrumb(article.pid)

  // 上一篇 / 下一篇（同一分类内，按时间排序）
  const { prev, next } = await loadNeighbors(article)

  await renderPage(ctx, 'content', { article, prev, next, breadcrumb })
})

/** 面包屑：当前分类（及其父分类） */
async function buildBreadcrumb (pid) {
  const out = []
  if (!pid) return out

  const cate = (await DB.find('articlecate', { _id: DB.getObjectId(pid) }))[0]
  if (!cate) return out

  if (String(cate.pid) !== '0') {
    const parent = (await DB.find('articlecate', { _id: DB.getObjectId(cate.pid) }))[0]
    if (parent) out.push({ _id: parent._id, title: parent.title })
  }
  out.push({ _id: cate._id, title: cate.title })
  return out
}

/**
 * 上一篇 / 下一篇：同一分类内按 add_time 排序取相邻两条。
 * 这里用两次参数化查询（而不是构造复杂 SQL），可读性优先；数据量不大时开销可忽略。
 */
async function loadNeighbors (article) {
  const base = Object.assign({ pid: article.pid }, enabled())

  const prevRows = await DB.find('article', Object.assign({}, base, {
    add_time: { $lt: article.add_time }
  }), { _id: 1, title: 1 }, { page: 1, pageSize: 1, sortJson: { add_time: -1 } })

  const nextRows = await DB.find('article', Object.assign({}, base, {
    add_time: { $gt: article.add_time }
  }), { _id: 1, title: 1 }, { page: 1, pageSize: 1, sortJson: { add_time: 1 } })

  return { prev: prevRows[0] || null, next: nextRows[0] || null }
}

// ---------------- 关于我们 ----------------
router.get('/about', async (ctx) => {
  // 契约规定每个页面都有 info 变量（即使为空），避免模板里出现未定义变量
  await renderPage(ctx, 'about', { info: ctx.state.site })
})

module.exports = router.routes()
