'use strict'
/**
 * PostgreSQL 18 数据访问层（单例）
 *
 * 改造要点：把原来的 MongoDB 版 DB 封装整体替换为 pg 版，
 * 对外方法签名与返回结构保持兼容，业务路由可以完全不改：
 *   DB.find(table, where, projection, { page, pageSize, sortJson })
 *   DB.insert(table, doc)
 *   DB.update(table, where, data)
 *   DB.remove(table, where)
 *   DB.count(table, where)
 *   DB.getObjectId(id)
 *
 * 说明：主键沿用 _id（text，24 位十六进制），
 * 目的是让模板里 {{$value._id}}、DB.getObjectId(...) 这些写法继续可用。
 */
const { Pool } = require('pg')
const config = require('./config')
const createLogger = require('./logger')
const CODE = require('../utils/code')
const { assertIdent, quoteIdent, buildWhere, buildSelect, buildOrder } = require('./sql-builder')

const log = createLogger('db')

// 文本类列：空字符串按原样保存；其余类型（时间/数值）空字符串一律转 null
const TEXT_TYPE_RE = /char|text|json|bytea|interval|citext/

class Db {
  static getInstance () {
    if (!Db.instance) {
      Db.instance = new Db()
    }
    return Db.instance
  }

  constructor () {
    this.pool = new Pool({
      host: config.pg.host,
      port: config.pg.port,
      user: config.pg.user,
      password: config.pg.password,
      database: config.pg.database,
      ssl: config.pg.ssl,
      max: config.pg.max,
      idleTimeoutMillis: config.pg.idleTimeoutMillis,
      connectionTimeoutMillis: config.pg.connectionTimeoutMillis,
      application_name: 'koa21-cms'
    })

    // 空闲连接被数据库断开会触发，兜底记录，避免进程崩溃
    this.pool.on('error', (err) => {
      log.error('数据库连接池异常:', err.message)
    })

    // 表结构缓存：表名 -> Map(列名 -> 数据类型)
    this._columns = new Map()

    log.info(`PostgreSQL 连接配置: ${config.pg.user}@${config.pg.host}:${config.pg.port}/${config.pg.database}`)
  }

  /** 执行原生 SQL（参数化） */
  query (sql, params = []) {
    return this.pool.query(sql, params)
  }

  /** 数据库可用性探测 */
  async ping () {
    const { rows } = await this.query('SELECT version() AS version')
    return rows[0].version
  }

  async getPool () {
    return this.pool
  }

  async close () {
    await this.pool.end()
  }

  /** 读取并缓存表结构（用于字段过滤与类型归一化） */
  async getColumns (table) {
    const name = assertIdent(table)
    if (this._columns.has(name)) return this._columns.get(name)

    const { rows } = await this.query(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = ANY (current_schemas(false))
          AND table_name = $1`,
      [name]
    )

    const map = new Map(rows.map((row) => [row.column_name, row.data_type]))
    this._columns.set(name, map)
    return map
  }

  /** 表结构变更后调用（例如执行完建表脚本） */
  clearColumnCache () {
    this._columns.clear()
  }

  _normalizeValue (value, dataType) {
    if (value === undefined) return null
    if (value === '') {
      // timestamptz / integer 这类列不接受空字符串，统一转 null
      if (dataType && !TEXT_TYPE_RE.test(dataType)) return null
      return value
    }
    return value
  }

  async _prepareData (table, doc) {
    const columns = await this.getColumns(table)
    const keys = Object.keys(doc || {})
      .filter((key) => !key.startsWith('$'))
      // undefined 表示"本次没有提交这个字段"，直接跳过保持原值
      // （与 Mongo 的行为一致；否则表单里没勾选的 checkbox 会把 NOT NULL 列写成 NULL）
      .filter((key) => doc[key] !== undefined)
      // 过滤掉表里不存在的字段，避免外部表单塞入未知列导致 500
      .filter((key) => columns.size === 0 || columns.has(key))
    return {
      keys,
      values: keys.map((key) => this._normalizeValue(doc[key], columns.get(key)))
    }
  }

  /**
   * 查询
   * @param {string} table 表名
   * @param {object} where Mongo 风格条件
   * @param {object} projection 投影，如 { _id: 1, title: 1 }
   * @param {object} options { page, pageSize, sortJson } 不传则不分页
   */
  async find (table, where = {}, projection = null, options = null) {
    const name = assertIdent(table)
    const params = []
    let sql = `SELECT ${buildSelect(projection)} FROM ${quoteIdent(name)}`

    const whereSql = buildWhere(where, params)
    if (whereSql) sql += ` WHERE ${whereSql}`

    if (options && typeof options === 'object') {
      const orderSql = buildOrder(options.sortJson)
      if (orderSql) sql += ` ${orderSql}`

      const page = Math.max(1, Number(options.page) || 1)
      const pageSize = Number(options.pageSize) || 0
      if (pageSize > 0) {
        params.push(pageSize)
        sql += ` LIMIT $${params.length}`
        params.push((page - 1) * pageSize)
        sql += ` OFFSET $${params.length}`
      }
    }

    const { rows } = await this.query(sql, params)
    return rows
  }

  /** 统计条数 */
  async count (table, where = {}) {
    const name = assertIdent(table)
    const params = []
    const whereSql = buildWhere(where, params)
    const sql = `SELECT COUNT(*)::int AS count FROM ${quoteIdent(name)}${whereSql ? ` WHERE ${whereSql}` : ''}`
    const { rows } = await this.query(sql, params)
    return rows[0].count
  }

  /** 新增，返回 { rowCount, insertedId, rows } */
  async insert (table, doc = {}) {
    const name = assertIdent(table)
    const { keys, values } = await this._prepareData(name, doc)
    if (!keys.length) return { rowCount: 0, insertedId: null, rows: [] }

    const columns = keys.map(quoteIdent).join(', ')
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ')
    const sql = `INSERT INTO ${quoteIdent(name)} (${columns}) VALUES (${placeholders}) RETURNING *`

    const { rows, rowCount } = await this.query(sql, values)
    return { rowCount, insertedId: rows[0] ? rows[0]._id : null, rows }
  }

  /** 更新，返回 { rowCount, rows } */
  async update (table, where = {}, data = {}) {
    const name = assertIdent(table)
    const params = []
    const { keys, values } = await this._prepareData(name, data)
    if (!keys.length) return { rowCount: 0, rows: [] }

    const sets = keys.map((key, index) => {
      params.push(values[index])
      return `${quoteIdent(key)} = $${params.length}`
    }).join(', ')

    const whereSql = buildWhere(where, params)
    const sql = `UPDATE ${quoteIdent(name)} SET ${sets}${whereSql ? ` WHERE ${whereSql}` : ''} RETURNING *`

    const { rows, rowCount } = await this.query(sql, params)
    return { rowCount, rows }
  }

  /** 删除，返回 { rowCount, rows } */
  async remove (table, where = {}) {
    const name = assertIdent(table)
    const params = []
    const whereSql = buildWhere(where, params)
    const sql = `DELETE FROM ${quoteIdent(name)}${whereSql ? ` WHERE ${whereSql}` : ''} RETURNING *`

    const { rows, rowCount } = await this.query(sql, params)
    return { rowCount, rows }
  }

  /** 事务：await DB.transaction(async (client) => { ... }) */
  async transaction (handler) {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await handler(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * 兼容原 Mongoose/Mongo 的 ObjectID 用法
   * 现在只是把 id 规范成字符串并校验合法性（防注入、防脏参数）
   *
   * ⚠️ 关键：这里必须抛**带 .code 的业务错误**。
   * 之前只抛普通 Error，上层统一错误处理认不出它是"参数错误"，
   * 于是 `GET /api/v1/public/articles/@@@` 这种脏参数会返回 **500**（把客户端错误报成服务端故障，
   * 既误导调用方，又会污染错误日志、触发无意义的告警）。现在统一为 PARAM_ERROR → HTTP 400。
   */
  getObjectId (id) {
    const value = String(id === undefined || id === null ? '' : id).trim()
    if (!/^[0-9A-Za-z_-]{1,64}$/.test(value)) {
      const err = new Error(`非法的 id 参数: ${value || '(空)'}`)
      err.code = CODE.PARAM_ERROR
      throw err
    }
    return value
  }
}

module.exports = Db.getInstance()
