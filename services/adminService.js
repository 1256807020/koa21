// services/adminService.js
// ============================================================
// 管理员（后台用户）业务逻辑层
// 教学点：
//   1) 路由只调这里，所有 SQL 都集中在 service，方便复用与测试。
//   2) 所有 DB 调用都走 mongo-sql 参数化（底层 pg 占位符），从根上杜绝 SQL 注入。
//   3) service 抛出的错误都带 .code（见 utils/code.js），由路由层统一转成 fail()。
// ============================================================
const DB = require('../model/db')
const tools = require('../model/tools')
const code = require('../utils/code')

const TABLE = 'admin'

/** 列表（分页 + 按用户名模糊搜索） */
async function list ({ page = 1, pageSize = 10, username = '' } = {}) {
  const where = {}
  // $ilike 由 mongo-sql 翻译成 ILIKE 参数化条件，大小写不敏感
  if (username) where.username = { $ilike: `%${username}%` }

  const rows = await DB.find(TABLE, where, null, { page, pageSize, sortJson: { add_time: -1 } })
  const total = await DB.count(TABLE, where)
  return { list: rows, total, page, pageSize }
}

/** 按 id 取单条 */
async function getById (id) {
  const rows = await DB.find(TABLE, { _id: DB.getObjectId(id) })
  return rows[0] || null
}

/** 新增（密码用 bcrypt 哈希；用户名查重） */
async function create ({ username, password, status = 1 }) {
  const exist = await DB.find(TABLE, { username })
  if (exist.length) {
    const e = new Error('管理员已存在')
    e.code = code.PARAM_ERROR
    throw e
  }
  const { rows } = await DB.insert(TABLE, {
    username,
    password: await tools.hashPassword(password), // 绝不存明文
    status,
    lasttime: ''
  })
  return rows[0]
}

/** 编辑（密码为空则不改；其余字段按需更新） */
async function update (id, { username, password, status }) {
  const data = {}
  if (username !== undefined) data.username = username
  if (status !== undefined) data.status = status
  if (password) data.password = await tools.hashPassword(password)

  const { rowCount, rows } = await DB.update(TABLE, { _id: DB.getObjectId(id) }, data)
  if (!rowCount) {
    const e = new Error('管理员不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  return rows[0]
}

/** 删除（真正落地；原先 /admin/remove 是占位 ctx.body='删除用户'） */
async function remove (id) {
  const { rowCount } = await DB.remove(TABLE, { _id: DB.getObjectId(id) })
  if (!rowCount) {
    const e = new Error('管理员不存在')
    e.code = code.NOT_FOUND
    throw e
  }
  return true
}

module.exports = { list, getById, create, update, remove }
