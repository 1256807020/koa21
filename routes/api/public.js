'use strict'
// routes/api/public.js
// ============================================================
// 公开内容 API（无需登录）：/api/v1/public/*
//   GET /public/settings            站点设置
//   GET /public/nav                 导航
//   GET /public/focus               首页轮播
//   GET /public/links               友情链接
//   GET /public/categories          分类树（递归 CTE）
//   GET /public/articles            文章列表（分页/分类含子孙/关键词）
//   GET /public/articles/:id        文章详情 + 上下篇（窗口函数）
//
// 教学点：
//   1) 这是"前端分离"后唯一的公开数据源：只读、只暴露 status=1、字段白名单。
//   2) 响应带 Cache-Control：这类内容"读多写少"，让 CDN/浏览器缓存能显著降低回源；
//      将来接 ISR/SSG 时，这套缓存头就是天然配合。
//   3) 参数一律过 zod（page/pageSize/keyword 长度），不信任任何客户端输入。
// ============================================================
const Router = require('@koa/router')
const router = new Router()

const { ok } = require('../../utils/response')
const { handle } = require('../../utils/handle')
const { parse } = require('../../utils/validate')
// 查询 schema 来自单一来源（与 OpenAPI 文档共用同一份定义）
const { publicArticleQuerySchema: articleQuerySchema } = require('../../utils/schemas')
const contentService = require('../../services/contentService')

// 公开内容的缓存策略：60 秒内可由浏览器/CDN 直接命中，同时允许回源校验
const CACHE_HEADER = 'public, max-age=60, stale-while-revalidate=300'

router.get('/settings', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  ok(ctx, await contentService.getSettings())
}))

router.get('/nav', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  ok(ctx, await contentService.getNav())
}))

router.get('/focus', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  ok(ctx, await contentService.getFocus())
}))

router.get('/links', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  ok(ctx, await contentService.getLinks())
}))

router.get('/categories', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  ok(ctx, await contentService.getCategoryTree())
}))

router.get('/articles', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  const { page, pageSize, cateId, keyword } = parse(articleQuerySchema, ctx.query)
  ok(ctx, await contentService.listArticles({ page, pageSize, cateId, keyword }))
}))

router.get('/articles/:id', handle(async (ctx) => {
  ctx.set('Cache-Control', CACHE_HEADER)
  const data = await contentService.getArticle(ctx.params.id)
  if (!data) {
    const e = new Error('内容不存在或已下架')
    e.code = require('../../utils/code').NOT_FOUND
    throw e
  }
  ok(ctx, data)
}))

module.exports = router.routes()
