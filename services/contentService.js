'use strict'
// services/contentService.js
// ============================================================
// 前台内容读取（公开、只读）
//   - 供 /api/v1/public/* 使用；将来前端分离（Next/Astro）后，这就是唯一的公开数据源。
//   - 只返回 status=1 的内容，且一律**字段白名单**，不 SELECT *。
// ============================================================
// SQL 教学点（本文件集中演示两个进阶用法）：
//   1) WITH RECURSIVE 递归 CTE：分类是"任意层级"的树（pid 指向父级），
//      用递归 CTE 一次查出整棵树 / 某个分类的全部子孙，替代"应用层循环查询"。
//   2) 窗口函数 LAG/LEAD：取同分类下的上一篇/下一篇，一次查询搞定，
//      替代"查两次（各带 ORDER BY + LIMIT 1）"的老写法。
// ============================================================
const DB = require('../model/db')

// 站点设置对外可见的字段（单行表，_id 固定 'setting'）
const SETTING_FIELDS = {
  _id: 1, site_title: 1, site_url: 1, site_logo: 1, site_keywords: 1,
  site_description: 1, site_icp: 1, site_qq: 1, site_tel: 1, site_address: 1, site_status: 1
}

// 列表用字段：**刻意不含 content** —— 正文可能几十 KB，列表带上会让响应体膨胀几十倍
const ARTICLE_LIST_FIELDS = `
  a._id, a.title, a.author, a.img_url, a.keywords, a.description,
  a.pid, a.is_best, a.is_hot, a.is_new, a.sort, a.add_time,
  c.title AS cate_name`

/** 站点设置 */
async function getSettings () {
  const rows = await DB.find('setting', {}, SETTING_FIELDS)
  return rows[0] || null
}

/** 导航（仅启用，按 sort 升序） */
async function getNav () {
  return DB.find('nav', { status: 1 }, { _id: 1, title: 1, url: 1, sort: 1 }, { sortJson: { sort: 1 } })
}

/** 首页轮播 */
async function getFocus () {
  return DB.find('focus', { status: 1 },
    { _id: 1, title: 1, pic: 1, url: 1, sort: 1 },
    { sortJson: { sort: 1 } })
}

/** 友情链接 */
async function getLinks () {
  return DB.find('link', { status: 1 },
    { _id: 1, title: 1, pic: 1, url: 1, sort: 1 },
    { sortJson: { sort: 1 } })
}

/**
 * 分类树（递归 CTE 一次查出所有层级）
 * 返回嵌套结构：[{ _id, title, level, children: [...] }]
 */
async function getCategoryTree () {
  const { rows } = await DB.query(
    `WITH RECURSIVE tree AS (
       SELECT _id, title, pid, sort, status, 1 AS level
         FROM articlecate
        WHERE pid = '0'
       UNION ALL
       SELECT c._id, c.title, c.pid, c.sort, c.status, t.level + 1
         FROM articlecate c
         JOIN tree t ON c.pid = t._id
     )
     SELECT _id, title, pid, sort, level
       FROM tree
      WHERE status = 1
      ORDER BY level, sort, title`
  )

  // 一次性查出来的扁平结果，在应用层组装成树（O(n)，比"每层查一次库"快得多）
  const map = new Map()
  const roots = []
  for (const row of rows) {
    map.set(row._id, { ...row, children: [] })
  }
  for (const row of rows) {
    const node = map.get(row._id)
    if (row.level === 1 || !map.has(row.pid)) roots.push(node)
    else map.get(row.pid).children.push(node)
  }
  return roots
}

/**
 * 文章列表（分页 + 分类筛选 + 关键词）
 * @param {object} params
 * @param {string} [params.cateId] 分类 id（**含其所有子孙分类**的文章）
 */
async function listArticles ({ cateId = '', keyword = '', page = 1, pageSize = 10 } = {}) {
  const params = []
  const where = ['a.status = 1']

  if (cateId) {
    // 递归 CTE 求出该分类及其所有子孙，再筛文章所属分类 —— 一次 SQL 完成"含子分类"的筛选
    params.push(cateId)
    where.push(`a.pid IN (
      WITH RECURSIVE subtree AS (
        SELECT _id FROM articlecate WHERE _id = $${params.length}
        UNION ALL
        SELECT c._id FROM articlecate c JOIN subtree s ON c.pid = s._id
      )
      SELECT _id FROM subtree
    )`)
  }
  if (keyword) {
    params.push(`%${keyword}%`)
    where.push(`(a.title ILIKE $${params.length} OR a.description ILIKE $${params.length})`)
  }
  const whereSql = `WHERE ${where.join(' AND ')}`

  const dataSql = `
    SELECT ${ARTICLE_LIST_FIELDS}
      FROM article a
      LEFT JOIN articlecate c ON c._id = a.pid
      ${whereSql}
     ORDER BY a.sort DESC, a.add_time DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`

  const dataParams = [...params, Number(pageSize), (Number(page) - 1) * Number(pageSize)]
  const countSql = `SELECT COUNT(*)::int AS count FROM article a ${whereSql}`

  const { rows } = await DB.query(dataSql, dataParams)
  const { rows: totalRows } = await DB.query(countSql, params)
  return { list: rows, total: totalRows[0].count, page: Number(page), pageSize: Number(pageSize) }
}

/**
 * 文章详情 + 同分类下的上一篇/下一篇
 * 上下篇用窗口函数 LAG/LEAD 一次算出（老写法要分别为 prev、next 各查一次）
 */
async function getArticle (id) {
  const { rows } = await DB.query(
    `SELECT a._id, a.title, a.author, a.img_url, a.keywords, a.description, a.content,
            a.pid, a.is_best, a.is_hot, a.is_new, a.sort, a.add_time,
            c.title AS cate_name
       FROM article a
       LEFT JOIN articlecate c ON c._id = a.pid
      WHERE a._id = $1 AND a.status = 1`,
    [DB.getObjectId(id)]
  )
  const article = rows[0]
  if (!article) return null

  const { rows: navRows } = await DB.query(
    `WITH ordered AS (
       SELECT _id, title,
              LAG(_id)   OVER (ORDER BY sort DESC, add_time DESC) AS prev_id,
              LAG(title) OVER (ORDER BY sort DESC, add_time DESC) AS prev_title,
              LEAD(_id)  OVER (ORDER BY sort DESC, add_time DESC) AS next_id,
              LEAD(title) OVER (ORDER BY sort DESC, add_time DESC) AS next_title
         FROM article
        WHERE status = 1 AND pid = $2
     )
     SELECT prev_id, prev_title, next_id, next_title FROM ordered WHERE _id = $1`,
    [article._id, article.pid || '']
  )

  const nav = navRows[0] || {}
  return {
    article,
    prev: nav.prev_id ? { _id: nav.prev_id, title: nav.prev_title } : null,
    next: nav.next_id ? { _id: nav.next_id, title: nav.next_title } : null
  }
}

/** 直接子分类（status=1，按 sort 升序）—— 列表页的二级分类标签页用 */
async function getChildren (parentId) {
  return DB.find('articlecate', { pid: parentId, status: 1 },
    { _id: 1, title: 1, sort: 1 }, { sortJson: { sort: 1 } })
}

module.exports = { getSettings, getNav, getFocus, getLinks, getCategoryTree, listArticles, getArticle, getChildren }
