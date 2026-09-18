'use strict'
// utils/sanitize.js
// ============================================================
// 富文本 XSS 净化（P0 安全 · 存储型 XSS 防御）
// 教学点：
//   1) 前台文章详情页用 art-template 的 `{{@list.content}}`（即「不转义」）输出富文本，
//      若把带 <script> 的恶意 HTML 直接入库，任何访问者打开文章即被执行 → 存储型 XSS。
//   2) 正确做法是「入库前净化」，而非信任前端/信任富文本编辑器。净化用**白名单**（只放行允许的
//      标签/属性），绝不能用黑名单（黑名单永远列不全 on* 事件、javascript: 变体等）。
//   3) 这里选 sanitize-html：配置 allowedTags / allowedAttributes / allowedSchemes，
//      默认就禁掉 <script>、onclick=、javascript: 等，外链强制 rel=noopener。
//   4) 输出侧仍保留 `{{@content}}`（富文本必须原样渲染才有意义）——安全靠「入库时已净化」保证，
//      而不是在输出时转义（那样富文本就废了）。这是「输入净化 vs 输出转义」的经典取舍。
// ============================================================
const sanitizeHtml = require('sanitize-html')

// 文章正文允许的标签/属性（够用且安全）
const ARTICLE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'pre', 'code',
    'ul', 'ol', 'li',
    'strong', 'em', 'b', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'caption',
    'figure', 'figcaption',
    'span', 'div', 'section', 'article'
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    // 谨慎：只放开 class/id，不开 style（style 里 expression()/url() 曾是 XSS 载体）
    '*': ['class', 'id']
  },
  // 禁止 javascript:/vbscript: 等危险协议；外链只允许 http/https/mailto/tel
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'] // 图片允许 data: URI（base64 内嵌图）
  },
  // 外链一律 rel=noopener noreferrer + target=_blank，防 tabnabbing
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
  },
  // 不在白名单里的标签直接丢弃其内容（不是 escape，避免残留脏标签）
  disallowedTagsMode: 'discard'
}

/** 净化文章正文；非字符串或空直接返回空串 */
function sanitizeArticle (content) {
  if (typeof content !== 'string' || !content) return ''
  return sanitizeHtml(content, ARTICLE_OPTIONS)
}

module.exports = { sanitizeArticle, ARTICLE_OPTIONS }
