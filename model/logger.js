'use strict'
const fs = require('fs')
const path = require('path')
const log4js = require('log4js')
const config = require('./config')

const logDir = path.isAbsolute(config.log.dir) ? config.log.dir : path.join(config.root, config.log.dir)
fs.mkdirSync(logDir, { recursive: true })

log4js.configure({
  appenders: {
    out: {
      type: 'stdout',
      layout: { type: 'pattern', pattern: '%[[%d{yyyy-MM-dd hh:mm:ss.SSS}] [%p] %c%] %m' }
    },
    file: {
      type: 'dateFile',
      filename: path.join(logDir, 'app.log'),
      pattern: 'yyyy-MM-dd',
      keepFileExt: true,
      numBackups: 30,
      compress: true
    }
  },
  categories: {
    default: { appenders: ['out', 'file'], level: config.log.level }
  }
})

/**
 * 统一的日志出口，带 scope 便于区分模块
 * @param {string} scope 模块名
 */
module.exports = function createLogger (scope) {
  return log4js.getLogger(scope)
}
module.exports.log4js = log4js
