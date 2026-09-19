'use strict'
// middleware/render.js
// ============================================================
// 模板渲染：仅 LiquidJS（.liquid）。
// 老 art-template（.html）模板已随旧前台 / 旧后台一起删除，渲染层不再依赖它。
// 调用方只写 ctx.render('xxx', data)，引擎对调用方透明。
// ============================================================
const fs = require('fs')
const path = require('path')
const { Liquid } = require('liquidjs')
const config = require('../model/config')
const createLogger = require('../model/logger')
const CODE = require('../utils/code')

const log = createLogger('render')
const VIEWS_DIR = path.join(config.root, 'views')

let liquid = null

function getLiquid () {
  if (!liquid) {
    liquid = new Liquid({
      root: VIEWS_DIR,
      extname: '.liquid',
      // 开发环境关缓存：改模板立即生效（生产开启，避免每请求读盘编译）
      cache: !config.isDev
    })
    const pad = (n) => String(n).padStart(2, '0')
    // 日期格式化过滤器（替代 art-template 的 dateFormat 系列）
    liquid.registerFilter('dt', (v) => {
      if (!v) return ''
      const d = (v instanceof Date) ? v : new Date(v)
      if (isNaN(d.getTime())) return String(v)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    })
    liquid.registerFilter('date', (v) => {
      if (!v) return ''
      const d = (v instanceof Date) ? v : new Date(v)
      if (isNaN(d.getTime())) return String(v)
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    })
  }
  return liquid
}

/**
 * 注册统一的 ctx.render：仅 LiquidJS。
 * @param {import('koa')} app
 */
function setupLiquidRender (app) {
  app.context.render = async function render (view, data = {}) {
    // 与 koa-art-template 一致的合并语义：ctx.state 打底，调用方 data 覆盖
    const scope = Object.assign({}, this.state, data)

    const liquidFile = path.join(VIEWS_DIR, `${view}.liquid`)
    if (!fs.existsSync(liquidFile)) {
      const e = new Error(`模板不存在：${view}`)
      e.code = CODE.NOT_FOUND
      throw e
    }

    this.type = 'html'
    this.body = await getLiquid().renderFile(`${view}.liquid`, scope)
  }

  log.info('模板引擎已就绪：LiquidJS（.liquid）')
}

module.exports = { setupLiquidRender, getLiquid, VIEWS_DIR }
