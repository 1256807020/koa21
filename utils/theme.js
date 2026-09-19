'use strict'
// utils/theme.js
// ============================================================
// 前台主题系统（LiquidJS 版，详见 docs/theme-system.md）
//
// 设计要点：
//   1) 主题目录 = views/themes/<name>/，主题名白名单 [a-z0-9-]{1,32}，
//      且目录内必须存在 theme.json 才被识别为"合法主题"。
//   2) 解析优先级：?theme= 预览（仅本次请求）> config.frontend.theme > 'default'。
//   3) 防穿越：非法名 / 不存在的目录一律回退 'default'，绝不允许 ../ 或绝对路径。
//   4) 缺页回退：当前主题缺某 pages/*.liquid → 自动回退 default 同名页
//      （避免"复制了一半的主题"把前台搞挂）。
//   5) 静态资源根 = /themes/<name>（由 koa-static 从 public/themes/<name> 提供），
//      换主题时 CSS/JS 自动跟着换。
// ============================================================
const fs = require('fs')
const path = require('path')
const config = require('../model/config')

const THEMES_DIR = path.join(config.root, 'views', 'themes')
const NAME_RE = /^[a-z0-9-]{1,32}$/
const DEFAULT = 'default'

function isValidName (name) {
  return typeof name === 'string' && NAME_RE.test(name)
}

// 目录存在且含合法 theme.json 才认
function exists (name) {
  if (!isValidName(name)) return false
  try {
    return fs.existsSync(path.join(THEMES_DIR, name, 'theme.json'))
  } catch {
    return false
  }
}

// 解析最终生效主题名（含回退 default）
function resolveTheme (name) {
  if (name && exists(name)) return name
  return DEFAULT
}

// 当前请求的主题名：?theme 预览优先，其次 config，最后 default
function pickTheme (ctx) {
  const fromQuery = ctx.query && ctx.query.theme
  return resolveTheme(fromQuery || (config.frontend && config.frontend.theme) || DEFAULT)
}

// 列出所有合法主题（供后台"主题管理"下拉用）
function listThemes () {
  let dirs
  try { dirs = fs.readdirSync(THEMES_DIR) } catch { dirs = [] }
  return dirs
    .filter((d) => isValidName(d) && exists(d))
    .map((d) => {
      try {
        return { name: d, meta: JSON.parse(fs.readFileSync(path.join(THEMES_DIR, d, 'theme.json'), 'utf8')) }
      } catch {
        return { name: d, meta: {} }
      }
    })
}

module.exports = { THEMES_DIR, DEFAULT, NAME_RE, isValidName, exists, resolveTheme, pickTheme, listThemes }
