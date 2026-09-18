'use strict'
/**
 * UEditor 后端上传处理器
 *
 * 为什么不用 koa2-ueditor：
 *   它依赖已废弃的 koa-multer@1.0.2 → multer@1.3.0（存在已知安全漏洞，且不支持 Koa 3）。
 *   这里用 @koa/multer 4 + multer 2 自研同协议实现，行为与 UEditor 官方后端一致。
 *
 * 前端约定（public/ueditor/ueditor.config.js）：
 *   serverUrl = "/admin/editorUpload"
 *   取配置：GET  /admin/editorUpload?action=config
 *   传图片：POST /admin/editorUpload?action=uploadimage   （multipart，字段名 upfile）
 *   返回：  { state: 'SUCCESS', url, title, original, type, size }
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('@koa/multer')
const config = require('./config')
const tools = require('./tools')

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']
const FILE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.zip', '.rar', '.doc', '.docx', '.pdf', '.txt']
const UPLOAD_ACTIONS = ['uploadimage', 'uploadfile', 'uploadvideo', 'uploadscrawl']

const storage = multer.diskStorage({
  destination (req, file, cb) {
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const dir = path.join(config.upload.dirAbs, `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename (req, file, cb) {
    const ext = path.extname(file.originalname || '').toLowerCase()
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`)
  }
})

const uploadSingle = multer({
  storage,
  limits: { fileSize: config.upload.maxSize }
}).single('upfile')

/** 返回给 UEditor 的后端配置 */
function backendConfig () {
  return {
    imageActionName: 'uploadimage',
    imageFieldName: 'upfile',
    imageMaxSize: config.upload.maxSize,
    imageAllowFiles: IMAGE_EXT,
    imageCompressEnable: true,
    imageCompressBorder: 1600,
    imageInsertAlign: 'none',
    imageUrlPrefix: '',
    imagePathFormat: '/upload/{yyyy}{mm}{dd}/{filename}',

    fileActionName: 'uploadfile',
    fileFieldName: 'upfile',
    fileMaxSize: config.upload.maxSize,
    fileAllowFiles: FILE_EXT,
    fileUrlPrefix: '',
    filePathFormat: '/upload/{yyyy}{mm}{dd}/{filename}',

    catcherActionName: 'catchimage',
    catcherFieldName: 'source[]',
    catcherMaxSize: config.upload.maxSize,
    catcherAllowFiles: IMAGE_EXT,
    catcherLocalDomain: '',
    catcherPathFormat: '/upload/{yyyy}{mm}{dd}/{filename}',

    videoActionName: 'uploadvideo',
    videoFieldName: 'upfile',
    videoMaxSize: config.upload.maxSize,
    videoAllowFiles: ['.mp4', '.webm'],
    videoUrlPrefix: '',
    videoPathFormat: '/upload/{yyyy}{mm}{dd}/{filename}',

    scrawlActionName: 'uploadscrawl',
    scrawlFieldName: 'upfile',
    scrawlPathFormat: '/upload/{yyyy}{mm}{dd}/{filename}',
    scrawlMaxSize: config.upload.maxSize,
    scrawlUrlPrefix: '',
    scrawlInsertAlign: 'none',

    listsImageUrlPrefix: '',
    listsFileUrlPrefix: '',
    listsPathFormat: '/upload/{yyyy}{mm}{dd}/{filename}',

    imageManagerActionName: 'listimage',
    fileManagerActionName: 'listfile',

    lang: 'zh-cn'
  }
}

/** 涂鸦（base64）保存 */
function saveScrawl (base64) {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const dir = path.join(config.upload.dirAbs, `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`)
  fs.mkdirSync(dir, { recursive: true })

  const data = String(base64).replace(/^data:image\/\w+;base64,/, '')
  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`
  const fullPath = path.join(dir, filename)
  fs.writeFileSync(fullPath, Buffer.from(data, 'base64'))
  return { path: fullPath, filename }
}

module.exports = function ueditorHandler () {
  return async function (ctx) {
    const action = String(ctx.query.action || '').toLowerCase()

    // 1. 前端拉取后端配置
    if (action === 'config') {
      ctx.type = 'application/json'
      ctx.body = backendConfig()
      return
    }

    if (!UPLOAD_ACTIONS.includes(action)) {
      ctx.body = { state: '不支持的请求操作' }
      return
    }

    // 2. 涂鸦走 base64，其余走 multipart 文件
    if (action === 'uploadscrawl') {
      const base64 = ctx.query.upfile || (ctx.request.body && ctx.request.body.upfile)
      if (!base64) {
        ctx.body = { state: '涂鸦内容为空' }
        return
      }
      try {
        const saved = saveScrawl(base64)
        ctx.body = {
          state: 'SUCCESS',
          url: `/${tools.imgUrl(saved)}`,
          title: saved.filename,
          original: saved.filename,
          type: '.png',
          size: fs.statSync(saved.path).size
        }
      } catch (err) {
        ctx.body = { state: `涂鸦保存失败：${err.message}` }
      }
      return
    }

    try {
      await uploadSingle(ctx, async () => {})
    } catch (err) {
      ctx.body = {
        state: err.code === 'LIMIT_FILE_SIZE'
          ? `文件超出大小限制（最大 ${Math.round(config.upload.maxSize / 1024 / 1024)}MB）`
          : `上传失败：${err.message}`
      }
      return
    }

    const file = ctx.file
    if (!file) {
      ctx.body = { state: '未接收到上传文件' }
      return
    }

    const ext = path.extname(file.filename || '').toLowerCase()
    const allowed = action === 'uploadfile' ? FILE_EXT : IMAGE_EXT
    if (!allowed.includes(ext)) {
      fs.unlink(file.path, () => {})
      ctx.body = { state: `不允许的文件类型：${ext || '未知'}` }
      return
    }

    ctx.body = {
      state: 'SUCCESS',
      url: `/${tools.imgUrl(file)}`,
      title: file.filename,
      original: file.originalname,
      type: ext,
      size: file.size
    }
  }
}
