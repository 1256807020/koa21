// services/articleService.js
// ============================================================
// 内容（文章）业务逻辑层 —— SQL 教学主战场
// 教学点：
//   列表用 LEFT JOIN articlecate 取分类名，替代"查主表 + 应用层循环补 catename"的 N+1 写法。
//   （N+1：先查 article 列表，再对每条 article 查一次 articlecate，O(N) 次查询，慢且浪费连接）
// ============================================================
const DB = require('../model/db')
const code = require('../utils/code')
const { sanitizeArticle } = require('../utils/sanitize')
const { cleanupFiles } = require('../utils/fileCleanup')

const TABLE = 'article'

/**
 * 允许 create/update 写入的字段白名单。
 * ⚠️ 必须与 utils/schemas.js 的 article add schema 保持**同集合**：
 *    schema 放行但这里不收 → 字段被静默丢弃（历史上就因此丢了 描述/关键词/封面图/推荐位/排序）。
 *    tests/article-fields.test.js 会守住这条契约。
 */
const MUTABLE_FIELDS = [
  'title', 'author', 'pid', 'keywords', 'description', 'img_url',
  'content', 'is_best', 'is_hot', 'is_new', 'sort', 'status'
]

/**
 * 列表：单条 SQL 用 JOIN 把分类名带出来；支持分页 + 标题模糊 + 分类筛选
 * @returns {Promise<{list:Array,total:number,page:number,pageSize:number}>}
 */
async function list ({ page = 1, pageSize = 10, title = '', keyword = '', cateId = '' } = {}) {
  // keyword 是新后台（/console）与其它通用资源统一的搜索参数名；
  // title 是老接口沿用的参数名。二者等价，keyword 优先。
  const kw = keyword || title
  // —— 参数化：where 条件值全部走占位符，表名/列名用白名单常量，杜绝注入 ——
  const whereParams = []
  const where = []
  if (kw) {
    // 标题/作者模糊搜索：参数化 ILIKE（注意 % 要拼在值里，不要拼进 SQL 字符串）
    whereParams.push(`%${kw}%`)
    where.push(`(a.title ILIKE $${whereParams.length} OR a.author ILIKE $${whereParams.length})`)
  }
  if (cateId) {
    whereParams.push(cateId)
    where.push(`a.pid = $${whereParams.length}`)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  // —— SQL 进阶：LEFT JOIN ——
  // 原写法（N+1）：SELECT * FROM article; 然后 for 每条 { SELECT title FROM articlecate WHERE _id = a.pid }
  // 现在一条 SQL 解决：分类名 c.title 随行返回，别名为 cate_name
  const dataSql = `
    SELECT a._id, a.title, a.author, a.status, a.add_time, a.pid,
           c._id  AS cate_id,
           c.title AS cate_name
    FROM article a
    LEFT JOIN articlecate c ON c._id = a.pid
    ${whereSql}
    ORDER BY a.add_time DESC
    LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`
  const dataParams = [...whereParams, Number(pageSize), (page - 1) * Number(pageSize)]

  // 总数统计（与列表共用 where 条件，但不需要分页参数）
  const totalSql = `SELECT COUNT(*)::int AS count FROM article a ${whereSql}`

  const { rows } = await DB.query(dataSql, dataParams)
  const { rows: totalRows } = await DB.query(totalSql, whereParams)
  return { list: rows, total: totalRows[0].count, page, pageSize }
}

/** 取单条 */
async function getById (id) {
  const rows = await DB.find(TABLE, { _id: DB.getObjectId(id) })
  return rows[0] || null
}

/**
 * 新增
 * ⚠️ 字段必须与 utils/schemas.js 的 article add schema 对齐：
 *    schema 放行、但这里不收的字段会被**静默丢弃**（曾经只收 title/author/pid/content/status，
 *    导致后台填的 描述/关键词/封面图/推荐位/排序 全部没存上，编辑时自然是空的）。
 */
async function create (data = {}) {
  // 表单来的都是字符串（'' / '1'），统一转数字，非法值回退默认
  const num = (v, def = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : def
  }
  const { rows } = await DB.insert(TABLE, {
    title: data.title,
    author: data.author || '',
    pid: data.pid || '',
    keywords: data.keywords || '',
    description: data.description || '',
    img_url: data.img_url || '',
    content: sanitizeArticle(data.content || ''), // P0 安全：入库前净化富文本，防存储型 XSS
    is_best: num(data.is_best, 0),
    is_hot: num(data.is_hot, 0),
    is_new: num(data.is_new, 0),
    sort: num(data.sort, 0),
    status: data.status === undefined || data.status === '' ? 1 : num(data.status, 1),
    add_time: new Date()
  })
  return rows[0]
}

/** 编辑 */
async function update (id, data) {
  // 仅当本次提交了 content 才净化（部分更新不应把已有正文清空/污染）
  if (data && typeof data.content === 'string') {
    data.content = sanitizeArticle(data.content)
  }
  const { rowCount, rows } = await DB.update(TABLE, { _id: DB.getObjectId(id) }, data)
  if (!rowCount) {
    const e = new Error('文章不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  return rows[0]
}

/** 删除（删完顺带清理封面图，避免留下孤儿文件） */
async function remove (id) {
  // 先取出这一行：① 拿到封面图路径 ② 便于"记录不存在"时给出准确提示
  const before = (await DB.find(TABLE, { _id: DB.getObjectId(id) }))[0]
  const { rowCount } = await DB.remove(TABLE, { _id: DB.getObjectId(id) })
  if (!rowCount) {
    const e = new Error('文章不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  // 删除文件失败不影响删除结果（cleanupFiles 内部会吞掉异常并记日志）
  cleanupFiles('article', before)
  return true
}

module.exports = { list, getById, create, update, remove, MUTABLE_FIELDS }
