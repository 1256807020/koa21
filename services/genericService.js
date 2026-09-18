'use strict'
// services/genericService.js
// ============================================================
// 通用 CRUD 服务工厂
//
// 为什么需要它：
//   nav / focus / link / articlecate 这几个资源结构都很像（标题 + 排序 + 状态），
//   如果每个都写一份 service，就是 4 份几乎一样的代码 —— 改一个 bug 要改 4 遍。
//   这里用"工厂函数 + 配置"生成，行为差异通过 hooks 注入。
//
// 教学点：
//   1) 工厂模式 vs 复制粘贴：**差异点显式化**。复制粘贴时"差异"藏在大段相同代码里，
//      最容易漏改；工厂把它作为参数暴露出来，一眼能看到每个资源哪里不一样。
//   2) 删除前的业务守卫放 hooks.beforeRemove：数据库没有物理外键，
//      "有子记录就不能删"这类约束只能自己查（这就是无外键的代价）。
//   3) 列表搜索用参数化 ILIKE，绝不拼接用户输入（防注入）。
// ============================================================
const DB = require('../model/db')
const code = require('../utils/code')
const createLogger = require('../model/logger')

const log = createLogger('generic-service')

function notFound (msg) {
  const e = new Error(msg)
  e.code = code.NOT_FOUND
  return e
}

function badRequest (msg) {
  const e = new Error(msg)
  e.code = code.PARAM_ERROR
  return e
}

/**
 * 创建一个通用 CRUD 服务
 * @param {object} cfg
 * @param {string} cfg.table        表名
 * @param {object} cfg.listFields   列表/详情返回的字段白名单（绝不 SELECT *）
 * @param {string[]} [cfg.searchFields]  支持 keyword 模糊搜索的字段
 * @param {object} [cfg.defaultSort]     默认排序，如 { sort: 1, add_time: -1 }
 * @param {string[]} [cfg.mutableFields] 允许 create/update 写入的字段白名单（**关键**：防止越权改别的列）
 * @param {object} [cfg.hooks]
 * @param {(row:object)=>Promise<void>} [cfg.hooks.beforeRemove] 删除前守卫（不满足就 throw）
 * @param {(data:object)=>Promise<object>} [cfg.hooks.beforeCreate] 新增前处理（可改数据）
 * @param {(data:object, row:object)=>Promise<object>} [cfg.hooks.beforeUpdate] 更新前处理
 */
function createCrudService (cfg) {
  const {
    table,
    listFields,
    searchFields = [],
    defaultSort = { sort: 1 },
    mutableFields = null,
    hooks = {}
  } = cfg

  /** 只保留白名单字段（没配白名单则原样返回，由上层 zod 控制） */
  function pick (data = {}) {
    if (!mutableFields) return { ...data }
    const out = {}
    for (const f of mutableFields) {
      if (data[f] !== undefined) out[f] = data[f]
    }
    return out
  }

  /**
   * 列表：分页 + 精确筛选 + 关键词模糊
   * @param {object} q  query（page/pageSize/keyword + 任意等值字段）
   */
  async function list (q = {}) {
    const { page = 1, pageSize = 10, keyword = '', ...rest } = q
    const where = {}

    // 等值筛选：只接受非空值（空字符串表示"不筛选"）
    for (const [k, v] of Object.entries(rest)) {
      if (v !== '' && v !== undefined && v !== null) where[k] = v
    }
    // 关键词：多字段 OR 模糊（参数化，不拼字符串）
    if (keyword && searchFields.length) {
      where.$or = searchFields.map((f) => ({ [f]: { $ilike: `%${keyword}%` } }))
    }

    const rows = await DB.find(table, where, listFields, { page, pageSize, sortJson: defaultSort })
    const total = await DB.count(table, where)
    return { list: rows, total, page, pageSize }
  }

  async function getById (id) {
    const rows = await DB.find(table, { _id: DB.getObjectId(id) }, listFields)
    if (!rows[0]) throw notFound('记录不存在')
    return rows[0]
  }

  async function create (data = {}) {
    let payload = pick(data)
    if (hooks.beforeCreate) payload = await hooks.beforeCreate(payload)
    const { rows } = await DB.insert(table, { ...payload, add_time: new Date() })
    log.info(`新增 ${table}：${rows[0] && rows[0]._id}`)
    return rows[0]
  }

  async function update (id, data = {}) {
    const payload = pick(data)
    if (!Object.keys(payload).length) throw badRequest('没有要更新的字段')
    const oid = DB.getObjectId(id)
    const existRows = await DB.find(table, { _id: oid }, listFields)
    if (!existRows[0]) throw notFound('记录不存在')

    let finalPayload = payload
    if (hooks.beforeUpdate) finalPayload = await hooks.beforeUpdate(payload, existRows[0])

    const { rowCount, rows } = await DB.update(table, { _id: oid }, finalPayload)
    if (!rowCount) throw notFound('记录不存在')
    log.info(`更新 ${table}：${id}`)
    return rows[0]
  }

  async function remove (id) {
    const oid = DB.getObjectId(id)
    const rows = await DB.find(table, { _id: oid }, listFields)
    if (!rows[0]) throw notFound('记录不存在')

    // 业务守卫（无物理外键，只能自己查）
    if (hooks.beforeRemove) await hooks.beforeRemove(rows[0])

    const { rowCount } = await DB.remove(table, { _id: oid })
    if (!rowCount) throw notFound('记录不存在')
    log.info(`删除 ${table}：${id}`)
    return true
  }

  return { list, getById, create, update, remove }
}

module.exports = { createCrudService, notFound, badRequest }
