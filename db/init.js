'use strict'
/**
 * 数据库初始化脚本
 *
 *   pnpm db:init    建库（不存在时）+ 建表 + 灌入种子数据，可重复执行
 *   pnpm db:reset   先删库再重建（危险：数据会全部丢失）
 *
 * 连接信息全部来自当前 NODE_ENV 对应的 .env 文件
 */
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')
const config = require('../model/config')

const DB_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const TABLES = [
  'admin', 'articlecate', 'article', 'nav', 'focus', 'link', 'setting',
  'role', 'permission', 'role_permission', 'audit_log'
]

async function main () {
  const reset = process.argv.includes('--reset')
  const dbName = config.pg.database

  if (!DB_NAME_RE.test(dbName)) {
    throw new Error(`非法的数据库名: ${dbName}`)
  }

  const base = {
    host: config.pg.host,
    port: config.pg.port,
    user: config.pg.user,
    password: config.pg.password,
    ssl: config.pg.ssl
  }

  console.log('----------------------------------------')
  console.log(`环境      : ${config.env}`)
  console.log(`目标数据库: ${config.pg.user}@${config.pg.host}:${config.pg.port}/${dbName}`)
  console.log('----------------------------------------')

  // 1. 连 maintenance 库，创建目标数据库
  const maintainClient = new Client({
    ...base,
    database: process.env.PG_ADMIN_DATABASE || 'postgres'
  })
  await maintainClient.connect()

  if (reset) {
    await maintainClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
    console.log(`已删除旧数据库 ${dbName}`)
  }

  const { rowCount } = await maintainClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
  if (rowCount === 0) {
    await maintainClient.query(`CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0`)
    console.log(`已创建数据库 ${dbName}`)
  } else {
    console.log(`数据库 ${dbName} 已存在，跳过创建`)
  }
  await maintainClient.end()

  // 2. 连目标库，执行建表与种子数据
  const client = new Client({ ...base, database: dbName })
  await client.connect()

  const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  const seedSql = fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8')

  await client.query(schemaSql)
  console.log('表结构初始化完成')

  await client.query(seedSql)
  console.log('种子数据初始化完成')

  console.log('----------------------------------------')
  for (const table of TABLES) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM "${table}"`)
    console.log(`  ${table.padEnd(12)} ${rows[0].count} 条`)
  }
  console.log('----------------------------------------')

  await client.end()

  console.log('完成。启动服务：pnpm dev')
  console.log(`后台入口：http://localhost:${config.port}/admin/login`)
  console.log('默认账号：admin / 123456（登录后请立即修改）')
}

main().catch((err) => {
  console.error('\n初始化失败：', err.message)
  if (err.code === 'ECONNREFUSED') {
    console.error(`请确认 PostgreSQL 已启动，且 ${config.pg.host}:${config.pg.port} 可访问（当前 PG_PORT=${config.pg.port}）`)
  }
  if (err.code === '28P01') {
    console.error('数据库密码不正确，请检查 .env 中的 PG_PASSWORD')
  }
  process.exit(1)
})
