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
 *
 * ------------------------------------------------------------
 * P0 安全加固记录（本轮）：
 *   这里原先**自成一套更弱的上传逻辑**，绕过了 tools.multer 的图片白名单：
 *     ① 只按"扩展名"判断，且原 FILE_EXT 放开 `.zip/.rar/.doc/.docx/.pdf/.txt`
 *        → 站点变成"任意文件托管"（钓鱼页、木马分发的绝佳温床）；
 *     ② 从不校验 MIME → `.png` 里塞 HTML 也能过（虽有 nosniff 兜底，仍不该放行）；
 *     ③ `uploadvideo` 用 IMAGE_EXT 校验视频 → **逻辑 bug，视频永远传不上去**；
 *     ④ `saveScrawl` 把任意 base64 直接写成 `.png`，不校验是不是真图片。
 *   加固后：图片 + 视频两类白名单，扩展名**与** MIME 双重校验，涂鸦校验 PNG 魔数，
 *          并**取消**"任意文件上传"能力（uploadfile）。
 * ------------------------------------------------------------
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const multer = require('@koa/multer')
const config = require('./config')
const tools = require('./tools')

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']
const VIDEO_EXT = ['.mp4', '.webm']

// 扩展名 → 允许的 MIME（双重校验：改名绕过只能骗过扩展名，骗不过 MIME）
const MIME_BY_EXT = {
  '.png': ['image/png'],
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.gif': ['image/gif'],
  '.bmp': ['image/bmp'],
  '.webp': ['image/webp'],
  '.mp4': ['video/mp4'],
  '.webm': ['video/webm']
}

// 每个 action 允许的扩展名。
// ⚠️ uploadfile 刻意留空（禁用）：内容站只需要"正文插图 / 视频"，
//    放开压缩包与文档等于把站点变成文件托管服务，风险远大于收益。
//    若将来确实需要传 PDF，应改用**独立域名的对象存储**，与主站域名隔离。
const ACTION_EXT = {
  uploadimage: IMAGE_EXT,
  uploadscrawl: ['.png'],
  uploadvideo: VIDEO_EXT,
  uploadfile: []
}

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

/** 校验扩展名 + MIME 是否属于该 action 的白名单 */
function checkFileType (action, originalname, mimetype) {
  const ext = path.extname(originalname || '').toLowerCase()
  const allowedExt = ACTION_EXT[action] || []
  if (!allowedExt.length) return { ok: false, message: '该类型上传已禁用（仅支持图片与视频）' }
  if (!allowedExt.includes(ext)) return { ok: false, message: `不允许的文件类型：${ext || '未知'}` }
  const allowedMimes = MIME_BY_EXT[ext] || []
  if (!allowedMimes.includes(String(mimetype || '').toLowerCase())) {
    return { ok: false, message: `文件类型与内容不符（${ext} / ${mimetype || '无 MIME'}）` }
  }
  return { ok: true, ext }
}

/** 返回给 UEditor 的后端配置（fileAllowFiles 留空 = 前端也不会提供"上传附件"入口） */
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
    fileAllowFiles: [], // 已禁用（安全考量见文件头注释）
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
    videoAllowFiles: VIDEO_EXT,
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/** 涂鸦（base64）保存：必须先确认它是真的 PNG，否则拒绝 */
function saveScrawl (base64) {
  const raw = String(base64 || '').replace(/^data:image\/\w+;base64,/, '')
  let buf
  try {
    buf = Buffer.from(raw, 'base64')
  } catch (err) {
    return { error: '涂鸦内容不是合法的 base64' }
  }
  if (buf.length < 8 || !buf.subarray(0, 4).equals(PNG_SIGNATURE)) {
    return { error: '涂鸦内容不是合法的 PNG 图片' }
  }

  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const dir = path.join(config.upload.dirAbs, `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`)
  fs.mkdirSync(dir, { recursive: true })

  const filename = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`
  const fullPath = path.join(dir, filename)
  fs.writeFileSync(fullPath, buf)
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
      const saved = saveScrawl(base64)
      if (saved.error) {
        ctx.body = { state: saved.error }
        return
      }
      ctx.body = {
        state: 'SUCCESS',
        url: `/${tools.imgUrl(saved)}`,
        title: saved.filename,
        original: saved.filename,
        type: '.png',
        size: fs.statSync(saved.path).size
      }
      return
    }

    // 3. uploadfile 已被刻意禁用（任意外链文件托管是钓鱼/木马分发温床）
    if (action === 'uploadfile') {
      ctx.body = { state: '该类型上传已禁用（仅支持图片与视频）' }
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

    // 4. 类型校验（扩展名 + MIME，按 action 取白名单）。不通过则**立即删除已落盘文件**。
    const check = checkFileType(action, file.originalname, file.mimetype)
    if (!check.ok) {
      fs.unlink(file.path, () => {})
      ctx.body = { state: check.message }
      return
    }

    ctx.body = {
      state: 'SUCCESS',
      url: `/${tools.imgUrl(file)}`,
      title: file.filename,
      original: file.originalname,
      type: check.ext,
      size: file.size
    }
  }
}

// 导出内部函数供单测（避免必须起服务/发 multipart 才能验证白名单）
module.exports.checkFileType = checkFileType
module.exports.ACTION_EXT = ACTION_EXT
