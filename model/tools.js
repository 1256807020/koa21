'use strict'
/**
 * 公共工具：上传、时间、加密封装
 * 升级说明：
 *   koa-multer（已废弃，依赖 multer 1.x）→ @koa/multer + multer 2.x
 *   md5（老包）                     → Node 内置 crypto
 *   silly-datetime（已停更）         → dayjs
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('@koa/multer')
const bcrypt = require('bcryptjs')
const dayjs = require('dayjs')
const config = require('./config')

// 允许上传的图片后缀白名单
const ALLOWED_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']

function ensureUploadDir () {
  fs.mkdirSync(config.upload.dirAbs, { recursive: true })
}

const tools = {
  /**
   * 文件上传中间件（用法保持原样：tools.multer().single('img_url')）
   *
   * 兼容说明：@koa/multer 4 会把解析结果从 ctx.req.body/file 搬到 ctx.request.body / ctx.file，
   * 并把原属性删除；而本项目路由读的是 ctx.req.body / ctx.req.file。
   * 这里加一层桥接，把数据补回老位置，让所有路由代码不用改。
   */
  multer () {
    ensureUploadDir()

    const storage = multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, config.upload.dirAbs)
      },
      filename: function (req, file, cb) {
        const ext = path.extname(file.originalname || '').toLowerCase()
        if (!ALLOWED_EXT.includes(ext)) {
          cb(new Error(`不支持的文件类型：${ext || '未知'}`))
          return
        }
        // 时间戳 + 随机串，避免高并发同名覆盖
        cb(null, `${Date.now()}-${crypto.randomBytes(3).toString('hex')}${ext}`)
      }
    })

    const instance = multer({ storage, limits: { fileSize: config.upload.maxSize } })

    const bridge = (ctx) => {
      if (!ctx || !ctx.req) return ctx
      if (ctx.req.body === undefined && ctx.request.body !== undefined) ctx.req.body = ctx.request.body
      if (ctx.req.file === undefined && ctx.file !== undefined) ctx.req.file = ctx.file
      if (ctx.req.files === undefined && ctx.files !== undefined) ctx.req.files = ctx.files
      return ctx
    }

    // @koa/multer 的中间件是"解析完成后 return next()"，
    // 所以桥接要放在 next 之前执行，下游路由才能拿到 ctx.req.body / ctx.req.file
    const wrap = (middleware) => async (ctx, next) => {
      await middleware(ctx, async () => {
        bridge(ctx)
        return next()
      })
    }

    return {
      single: (name) => wrap(instance.single(name)),
      array: (name, maxCount) => wrap(instance.array(name, maxCount)),
      fields: (fields) => wrap(instance.fields(fields)),
      none: () => wrap(instance.none()),
      any: () => wrap(instance.any())
    }
  },

  /**
   * 取出上传文件对外的可访问路径（相对 public 目录，统一用 / 分隔）
   * 用于替换原来的 ctx.req.file.path.substr(7)（那个写法在 Windows 下会得到 upload\xx.png，模板里会挂）
   */
  imgUrl (file) {
    if (!file || !file.path) return ''
    const relative = path.relative(config.root, path.resolve(file.path))
    const posix = relative.split(path.sep).join('/')
    return posix.replace(/^public\//, '')
  },

  getTime () {
    return new Date()
  },

  /** md5（仅保留用于兼容历史数据识别，新密码一律用 bcrypt） */
  md5 (str) {
    return crypto.createHash('md5').update(String(str)).digest('hex')
  },

  /** 生成密码哈希（bcrypt，推荐用于存储） */
  async hashPassword (plain) {
    return bcrypt.hash(String(plain), 10)
  },

  /** 校验密码：bcrypt 哈希直接比对；遗留 md5 哈希按 md5 比（返回 true 表示可触发自动升级） */
  async comparePassword (plain, stored) {
    if (typeof stored === 'string' && stored.startsWith('$2')) {
      return bcrypt.compare(String(plain), stored)
    }
    return crypto.createHash('md5').update(String(plain)).digest('hex') === stored
  },

  /** 判断存储值是否已是 bcrypt 哈希 */
  isBcryptHash (stored) {
    return typeof stored === 'string' && stored.startsWith('$2')
  },

  /** 模板里使用的日期格式化 */
  formatDate (value, format = 'YYYY-MM-DD HH:mm') {
    if (!value) return ''
    const d = dayjs(value)
    return d.isValid() ? d.format(format) : ''
  },

  /** 一维分类数组 → 两级分类（pid = '0' 为一级） */
  cateToList (data) {
    const list = Array.isArray(data) ? data : []
    const isTop = (pid) => pid === '0' || pid === 0 || pid === '' || pid === undefined || pid === null

    const firstArr = list.filter((item) => isTop(item.pid))
    for (const parent of firstArr) {
      parent.list = list.filter((item) => String(item.pid) === String(parent._id))
    }
    return firstArr
  }
}

module.exports = tools
