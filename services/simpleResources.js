'use strict'
// services/simpleResources.js
// ============================================================
// 结构简单的后台资源：分类 / 导航 / 轮播 / 友链 / 站点设置
//
// 背景：这些资源以前**只有 SSR 端点**（/admin/nav/doAdd 这类表单接口），
// 没有 JSON API —— 导致任何"不走 Koa 模板"的新后台（SPA / 分离前端）都调不动它们。
// 这里用 genericService 工厂补齐 JSON API，让后台接口彻底完整。
//
// 命名与 rbacService.RESOURCE_TABLE 保持一致（nav/focus/link/articlecate/setting），
// 这样权限点（nav:list / focus:create ...）就能直接对上。
// ============================================================
const DB = require('../model/db')
const { createCrudService, notFound, badRequest } = require('./genericService')

// ---------------- 分类 articlecate ----------------
const articlecateService = createCrudService({
  table: 'articlecate',
  listFields: { _id: 1, title: 1, pid: 1, keywords: 1, description: 1, status: 1, sort: 1, add_time: 1 },
  searchFields: ['title'],
  defaultSort: { sort: 1 },
  mutableFields: ['title', 'pid', 'keywords', 'description', 'status', 'sort'],
  hooks: {
    // ⚠️ 无物理外键的代价：删父分类会留下"孤儿子分类 / 孤儿文章"，只能自己查
    beforeRemove: async (row) => {
      const id = String(row._id)
      const children = await DB.count('articlecate', { pid: id })
      if (children > 0) throw badRequest(`该分类下还有 ${children} 个子分类，请先处理子分类`)
      const articles = await DB.count('article', { pid: id })
      if (articles > 0) throw badRequest(`该分类下还有 ${articles} 篇文章，请先移走或删除这些文章`)
    }
  }
})

// ---------------- 导航 nav ----------------
const navService = createCrudService({
  table: 'nav',
  listFields: { _id: 1, title: 1, url: 1, sort: 1, status: 1, add_time: 1 },
  searchFields: ['title', 'url'],
  defaultSort: { sort: 1 },
  mutableFields: ['title', 'url', 'sort', 'status']
})

// ---------------- 轮播 focus / 友链 link ----------------
// 两者字段完全一致（title/pic/url/sort/status），只是表不同
const focusService = createCrudService({
  table: 'focus',
  listFields: { _id: 1, title: 1, pic: 1, url: 1, sort: 1, status: 1, add_time: 1 },
  searchFields: ['title'],
  defaultSort: { sort: 1 },
  mutableFields: ['title', 'pic', 'url', 'sort', 'status']
})

const linkService = createCrudService({
  table: 'link',
  listFields: { _id: 1, title: 1, pic: 1, url: 1, sort: 1, status: 1, add_time: 1 },
  searchFields: ['title', 'url'],
  defaultSort: { sort: 1 },
  mutableFields: ['title', 'pic', 'url', 'sort', 'status']
})

// ---------------- 站点设置 setting（单行表，特殊处理）----------------
const SETTING_FIELDS = {
  _id: 1, site_title: 1, site_url: 1, site_logo: 1, site_keywords: 1,
  site_description: 1, site_icp: 1, site_qq: 1, site_tel: 1, site_address: 1,
  site_status: 1, add_time: 1
}
const SETTING_BASE = createCrudService({
  table: 'setting',
  listFields: SETTING_FIELDS,
  defaultSort: { _id: 1 },
  mutableFields: [
    'site_title', 'site_url', 'site_logo', 'site_keywords', 'site_description',
    'site_icp', 'site_qq', 'site_tel', 'site_address', 'site_status'
  ]
})

/**
 * 站点设置是**单行表**，语义与标准 CRUD 不同：
 *   没有"新增/删除"，只有"读取这一行"和"更新这一行"。
 * 这里显式覆盖掉不适用方法，避免调用方误用（而不是让它悄悄失败）。
 */
const settingService = {
  async list (q = {}) {
    return SETTING_BASE.list({ ...q, page: 1, pageSize: 1 })
  },
  async getById () {
    const { list } = await SETTING_BASE.list({ page: 1, pageSize: 1 })
    return list[0] || null
  },
  async update (id, data) {
    // 忽略传入的 id：单行表永远更新那唯一的一行
    const { list } = await SETTING_BASE.list({ page: 1, pageSize: 1 })
    const row = list[0]
    if (!row) throw notFound('站点设置不存在，请先执行 pnpm db:init')
    return SETTING_BASE.update(row._id, data)
  },
  async create () {
    throw badRequest('站点设置不支持新增（单行配置）')
  },
  async remove () {
    throw badRequest('站点设置不支持删除（单行配置）')
  }
}

module.exports = {
  articlecateService,
  navService,
  focusService,
  linkService,
  settingService
}
