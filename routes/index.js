'use strict'
// 前台路由 —— Liquid 新模板（views/frontend/*.liquid）
// 数据全部走 services/contentService（与 /api/v1/public/* 同源），
// 保证"页面渲染的数据"和"接口返回的数据"完全一致。
// 旧 art-template 主题系统（themes/）已删除，本文件不再依赖任何 .html 模板。
const Router = require('@koa/router')
const router = new Router()
const config = require('../model/config')
const { toSite } = require('../utils/site.js')
const content = require('../services/contentService.js')

// 全局中间件：注入站点设置 + 导航 + 友情链接（每个前台页都要）
router.use(async (ctx, next) => {
  const [setting, nav, links] = await Promise.all([
    content.getSettings(),
    content.getNav(),
    content.getLinks()
  ])
  ctx.state.site = toSite(setting || {})
  ctx.state.nav = nav || []
  ctx.state.links = links || []
  ctx.state.year = new Date().getFullYear()
  ctx.state.pathname = ctx.path
  await next()
})

// 首页：轮播 + 友情链接 + 最新文章
router.get('/', async (ctx) => {
  const pageSize = config.frontend.pageSize
  const [focus, articles] = await Promise.all([
    content.getFocus(),
    content.listArticles({ page: 1, pageSize })
  ])
  await ctx.render('frontend/index', { focus, articles: articles.list })
})

// 列表页通用（新闻 / 案例 / 服务）
async function listPage (ctx, parentCateId) {
  const page = Number(ctx.query.page) || 1
  const pageSize = config.frontend.pageSize
  const cateId = ctx.query.pid || parentCateId
  const keyword = ctx.query.keyword || ''
  const [res, subCates] = await Promise.all([
    content.listArticles({ cateId, keyword, page, pageSize }),
    content.getChildren(parentCateId)
  ])
  const totalPages = Math.max(1, Math.ceil(res.total / res.pageSize))
  return {
    articles: res.list,
    pageInfo: {
      page: res.page,
      pageSize: res.pageSize,
      total: res.total,
      totalPages,
      hasPrev: res.page > 1,
      hasNext: res.page < totalPages
    },
    subCates,
    cateId: ctx.query.pid || '',
    keyword
  }
}

router.get('/news', async (ctx) => {
  await ctx.render('frontend/news', await listPage(ctx, config.frontend.cateIds.news))
})
router.get('/case', async (ctx) => {
  await ctx.render('frontend/case', await listPage(ctx, config.frontend.cateIds.case))
})
router.get('/service', async (ctx) => {
  await ctx.render('frontend/service', await listPage(ctx, config.frontend.cateIds.service))
})

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
  await ctx.render('frontend/content', data)
})

// 关于我们
router.get('/about', async (ctx) => {
  await ctx.render('frontend/about', { info: ctx.state.site })
})

module.exports = router.routes()
