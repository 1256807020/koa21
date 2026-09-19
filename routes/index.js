'use strict'
// 前台路由 —— LiquidJS 主题系统（views/themes/<name>/，详见 docs/theme-system.md）
// 数据全部走 services/contentService（与 /api/v1/public/* 同源），保证页面与接口数据一致。
//
// 变量契约（写模板只需看这张表，不用读本文件）：
//   全局：site / nav / links / cats / theme / pathname / year / canonical / ogType / ogImage / jsonLd
//   /         → focus, newsTop（最新文章）
//   /news /case /service → list, page{...}, subCates, cateId, keyword
//   /content/:id → article, prev, next, breadcrumb
//   /about    → info
const fs = require('fs')
const path = require('path')
const Router = require('@koa/router')
const router = new Router()
const config = require('../model/config')
const { toSite } = require('../utils/site.js')
const { VIEWS_DIR } = require('../middleware/render')
const content = require('../services/contentService.js')
const theme = require('../utils/theme.js')

// 渲染前台页面：当前主题缺页 → 自动回退 default 同名页（避免"复制一半的主题"搞挂前台）
async function renderPage (ctx, page, data = {}) {
  const name = ctx.state.themeName
  const candidates = name === theme.DEFAULT
    ? [`themes/${theme.DEFAULT}/pages/${page}`]
    : [`themes/${name}/pages/${page}`, `themes/${theme.DEFAULT}/pages/${page}`]
  for (const view of candidates) {
    if (fs.existsSync(path.join(VIEWS_DIR, `${view}.liquid`))) {
      return ctx.render(view, data)
    }
  }
  ctx.status = 404
  ctx.body = '<h3>页面不存在</h3>'
}

// 全局中间件：解析主题 + 注入站点级契约变量（每个前台页都有）
router.use(async (ctx, next) => {
  const name = theme.pickTheme(ctx)
  ctx.state.themeName = name
  ctx.state.theme = `/themes/${name}` // 静态资源根（public/themes/<name>）
  ctx.state.pathname = ctx.path
  ctx.state.year = new Date().getFullYear()
  ctx.state.canonical = (ctx.state.__HOST__ || '') + ctx.path
  ctx.state.ogType = 'website'
  ctx.state.ogImage = ''

  const [setting, nav, links, cats] = await Promise.all([
    content.getSettings(),
    content.getNav(),
    content.getLinks(),
    content.getCategoryTree()
  ])
  ctx.state.site = toSite(setting || {})
  ctx.state.nav = nav || []
  ctx.state.links = links || []
  ctx.state.cats = cats || []
  ctx.state.ogImage = ctx.state.site.logo || '' // 默认 OG 图 = 站点 logo
  await next()
})

// 首页
router.get('/', async (ctx) => {
  const pageSize = config.frontend.pageSize
  const [focus, articles] = await Promise.all([
    content.getFocus(),
    content.listArticles({ page: 1, pageSize })
  ])
  if (focus.length) ctx.state.ogImage = focus[0].pic || ctx.state.ogImage
  ctx.state.jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: ctx.state.site.title,
    url: ctx.state.__HOST__ || '',
    logo: ctx.state.site.logo || undefined,
    description: ctx.state.site.description || undefined
  }
  await renderPage(ctx, 'index', { focus, newsTop: articles.list })
})

// 列表页通用（新闻 / 案例 / 服务）
async function listPage (ctx, parentCateId, pageName) {
  const page = Number(ctx.query.page) || 1
  const pageSize = config.frontend.pageSize
  const cateId = ctx.query.pid || parentCateId
  const keyword = ctx.query.keyword || ''
  const [res, subCates] = await Promise.all([
    content.listArticles({ cateId, keyword, page, pageSize }),
    content.getChildren(parentCateId)
  ])
  const totalPages = Math.max(1, Math.ceil(res.total / res.pageSize))
  await renderPage(ctx, pageName, {
    list: res.list,
    page: {
      current: res.page,
      pageSize: res.pageSize,
      total: res.total,
      totalPages,
      hasPrev: res.page > 1,
      hasNext: res.page < totalPages
    },
    subCates,
    cateId: ctx.query.pid || '',
    keyword
  })
}

router.get('/news', async (ctx) => listPage(ctx, config.frontend.cateIds.news, 'news'))
router.get('/case', async (ctx) => listPage(ctx, config.frontend.cateIds.case, 'case'))
router.get('/service', async (ctx) => listPage(ctx, config.frontend.cateIds.service, 'service'))

// 文章详情
router.get('/content/:id', async (ctx) => {
  const id = ctx.params.id
  // id 合法性先过一道，非法 id 直接 404（避免打到库里触发异常）
  if (!/^[0-9a-zA-Z_-]{1,64}$/.test(String(id || ''))) {
    ctx.status = 404
    ctx.body = '<h3>内容不存在或已删除</h3>'
    return
  }
  const data = await content.getArticle(id)
  if (!data) {
    ctx.status = 404
    ctx.body = '<h3>内容不存在或已删除</h3>'
    return
  }
  const { article, prev, next } = data
  const breadcrumb = [
    { title: '首页', url: '/' },
    { title: article.cate_name || '内容', url: `/news?pid=${article.pid || ''}` },
    { title: article.title, url: '' }
  ]
  ctx.state.ogType = 'article'
  ctx.state.ogImage = article.img_url || ctx.state.ogImage
  ctx.state.canonical = (ctx.state.__HOST__ || '') + `/content/${article._id}`
  ctx.state.jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    image: article.img_url ? [article.img_url] : undefined,
    datePublished: article.add_time,
    description: article.description || undefined,
    author: article.author ? { '@type': 'Person', name: article.author } : undefined,
    mainEntityOfPage: ctx.state.canonical
  }
  await renderPage(ctx, 'content', { article, prev, next, breadcrumb })
})

// 关于我们
router.get('/about', async (ctx) => {
  await renderPage(ctx, 'about', { info: ctx.state.site })
})

// SEO：robots.txt
router.get('/robots.txt', async (ctx) => {
  ctx.type = 'text/plain'
  ctx.body = `User-agent: *\nAllow: /\n\nSitemap: ${(ctx.state.__HOST__ || '')}/sitemap.xml\n`
})

// SEO：sitemap.xml（首页/列表/分类/全部已发布文章）
router.get('/sitemap.xml', async (ctx) => {
  const base = ctx.state.__HOST__ || ''
  const urls = []
  const push = (loc) => urls.push(`  <url><loc>${base}${loc}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>`)
  push('/'); push('/news'); push('/case'); push('/service'); push('/about')

  const cats = await content.getCategoryTree()
  for (const c of cats) push(`/news?pid=${c._id}`)

  let page = 1
  const pageSize = 500
  // 安全上限 50 页（25000 篇），避免超大站点拖垮请求
  while (page <= 50) {
    const res = await content.listArticles({ page, pageSize })
    for (const a of res.list) push(`/content/${a._id}`)
    if (res.page >= res.totalPages) break
    page++
  }

  ctx.type = 'application/xml'
  ctx.body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
})

module.exports = router.routes()
