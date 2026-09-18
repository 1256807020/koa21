'use strict'
// routes/api/stats.js
// ============================================================
// 统计报表接口：/api/v1/admin/stats/*
//   GET /overview                 总量与状态分布（COUNT ... FILTER）
//   GET /categories               分类统计排行（GROUP BY + 窗口函数）
//   GET /top-articles?limit=2     每个分类最新 N 篇（PARTITION BY + ROW_NUMBER）
//   GET /monthly?months=12        按月发文趋势（date_trunc + GROUP BY）
//   GET /explain/queries          可 EXPLAIN 的查询清单（白名单）
//   GET /explain?query=<key>      执行计划（EXPLAIN ANALYZE，白名单键）
//
// 权限：统一需要 `stats:view`（默认只给超级管理员；这属于系统级视角）。
// 教学点：数据"能看"和"能改"要分开授权 —— 统计接口是只读的，但涉及全站经营数据，
//        所以既不是人人可看的公开接口，也不该复用某个写权限。
// ============================================================
const Router = require('@koa/router')
const router = new Router()

const { ok } = require('../../utils/response')
const { handle } = require('../../utils/handle')
const { parse } = require('../../utils/validate')
const {
  statsTopQuerySchema,
  statsMonthlyQuerySchema,
  statsExplainQuerySchema
} = require('../../utils/schemas')
const { requireLogin } = require('../../middleware/guard')
const { requirePermission } = require('../../middleware/rbac')
const statsService = require('../../services/statsService')

router.use(requireLogin)

// 本组接口统一权限点
const canViewStats = requirePermission('stats:view')

router.get('/overview', canViewStats, handle(async (ctx) => {
  ok(ctx, await statsService.overview())
}))

router.get('/categories', canViewStats, handle(async (ctx) => {
  ok(ctx, await statsService.categoryStats())
}))

router.get('/top-articles', canViewStats, handle(async (ctx) => {
  const { limit } = parse(statsTopQuerySchema, ctx.query)
  ok(ctx, await statsService.topArticlesPerCategory(limit))
}))

router.get('/monthly', canViewStats, handle(async (ctx) => {
  const { months } = parse(statsMonthlyQuerySchema, ctx.query)
  ok(ctx, await statsService.monthlyTrend(months))
}))

router.get('/explain/queries', canViewStats, handle(async (ctx) => {
  ok(ctx, statsService.listExplainQueries())
}))

router.get('/explain', canViewStats, handle(async (ctx) => {
  const { query, analyze } = parse(statsExplainQuerySchema, ctx.query)
  // 默认开启 ANALYZE（会真实执行查询，只读查询没有副作用）
  const useAnalyze = analyze === undefined ? true : (analyze === '1' || analyze === 'true')
  ok(ctx, await statsService.explain(query, { analyze: useAnalyze }))
}))

module.exports = router.routes()
