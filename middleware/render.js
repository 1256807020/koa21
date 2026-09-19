'use strict'
// middleware/render.js
// ============================================================
// 双模板引擎：art-template（老模板 .html）+ LiquidJS（新模板 .liquid）
//
// 为什么要两套（过渡期）：
//   新后台要用 Liquid（语法贴近 DedeCMS / WordPress / Shopify，且活跃维护），
//   但老后台 29 个 Ace Admin 模板 + 前台主题仍是 art-template。
//   一次性全转风险太高 —— 于是让两套**按扩展名共存**，逐个模块迁移，随时可停。
//
// 判定规则（简单、可预测）：
//   render('console/pages/dashboard') → 若存在 views/console/pages/dashboard.liquid 用 LiquidJS
//                                       否则回退 art-template（找 .html）
//
// 教学点：**引擎选择不应该让调用方操心**。
//   路由里一律写 ctx.render('xxx', data)，不写扩展名、不关心用哪个引擎，
//   将来把最后一个 .html 转成 .liquid 后，把 art-template 分支删掉即可，调用方零改动。
// ============================================================
const fs = require('fs')
const path = require('path')
const { Liquid } = require('liquidjs')
const config = require('../model/config')
const createLogger = require('../model/logger')

const log = createLogger('render')
const VIEWS_DIR = path.join(config.root, 'views')

let liquid = null

function getLiquid () {
  if (!liquid) {
    liquid = new Liquid({
      root: VIEWS_DIR,
      extname: '.liquid',
      // 开发环境关缓存：改模板立即生效（生产开启，避免每个请求都读盘编译）
      cache: !config.isDev
    })
    // 模板里常用的格式化过滤器（与 art-template 的 dateFormat 等对应，但 Liquid 侧独立注册）
    const pad = (n) => String(n).padStart(2, '0')
    liquid.registerFilter('dt', (v) => {
      if (!v) return ''
      const d = (v instanceof Date) ? v : new Date(v)
      if (isNaN(d.getTime())) return String(v)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    })
  }
  return liquid
}

/**
 * 在 koa-art-template 之上叠加 LiquidJS 支持
 * @param {import('koa')} app 必须已注册 koa-art-template
 */
function setupLiquidRender (app) {
  const originalRender = app.context.render
  if (typeof originalRender !== 'function') {
    throw new Error('setupLiquidRender 必须在 koa-art-template 之后调用')
  }

  app.context.render = async function render (view, data = {}) {
    const liquidFile = path.join(VIEWS_DIR, `${view}.liquid`)
    if (fs.existsSync(liquidFile)) {
      // 与 koa-art-template 保持一致的合并语义：ctx.state 打底，调用方 data 覆盖
      const scope = Object.assign({}, this.state, data)
      this.type = 'html'
      this.body = await getLiquid().renderFile(`${view}.liquid`, scope)
      return
    }
    return originalRender.call(this, view, data)
  }

  log.info('双模板引擎已就绪：.liquid → LiquidJS，.html → art-template')
}

module.exports = { setupLiquidRender, getLiquid, VIEWS_DIR }
