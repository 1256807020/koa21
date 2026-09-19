// src/backend/editor.js
// ============================================================
// wangEditor v5 富文本编辑器（自托管，esbuild 打包）
//   产物：public/backend/editor.js（IIFE）+ public/backend/editor.css（样式，需在 layout 里 link）
//
// 工作方式：扫描页面上的 [data-richtext] 容器，在其中的 [data-toolbar] / [data-editor]
//          上分别挂载工具栏与编辑区，内容同步到同容器内的隐藏域 name=<字段名>。
//
// 为什么换掉 TipTap：TipTap 本体是"无头(headless)编辑器"，工具栏/样式要自己写，
// 观感与官方 demo 差距大；wangEditor 自带完整中文工具栏与样式，开箱即用、与后台契合。
// ============================================================
import '@wangeditor/editor/dist/css/style.css'
import { createEditor, createToolbar } from '@wangeditor/editor'

function getCsrf () {
  const c = document.cookie.split('; ').find((x) => x.startsWith('csrfToken='))
  return c ? decodeURIComponent(c.split('=')[1]) : ''
}

function showToast (msg, type = 'info') {
  const wrap = document.getElementById('kt-toast-wrap')
  if (!wrap) { window.alert(msg); return }
  const el = document.createElement('div')
  el.className = `kt-toast kt-toast-${type}`
  el.textContent = msg
  wrap.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

/**
 * 图片上传：复用项目统一的 /api/v1/admin/upload
 * （与其它上传同一套白名单 + CSRF + 鉴权，不另开后门）
 */
async function uploadImage (file, insertFn) {
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch('/api/v1/admin/upload', {
      method: 'POST',
      headers: { 'X-CSRF-Token': getCsrf() },
      body: fd
    })
    const j = await res.json()
    if (j.code !== 0) throw new Error(j.message || '上传失败')
    insertFn(j.data.url, file.name, j.data.url)
  } catch (e) {
    showToast(e.message || '图片上传失败', 'error')
  }
}

function initOne (wrap) {
  const toolbarEl = wrap.querySelector('[data-toolbar]')
  const editorEl = wrap.querySelector('[data-editor]')
  const hidden = wrap.querySelector('input[type=hidden]')
  if (!toolbarEl || !editorEl || !hidden) return

  // 初始正文：模板已把内容原样渲染进 [data-editor]
  // （middleware/render.js 未开 outputEscape，Liquid 不转义 → innerHTML 即真实 HTML）
  const html = editorEl.innerHTML.trim() || '<p><br></p>'
  editorEl.innerHTML = ''

  const editor = createEditor({
    selector: editorEl,
    html,
    mode: 'default',
    config: {
      placeholder: '请输入正文…',
      onChange: (ed) => { hidden.value = ed.getHtml() },
      MENU_CONF: {
        uploadImage: { customUpload: uploadImage }
      }
    }
  })
  createToolbar({ editor, selector: toolbarEl, mode: 'default' })

  // 关键：初始化后立刻同步一次，保证"打开编辑页不修改直接提交"也不会丢正文
  hidden.value = editor.getHtml()
}

function initBackendEditors () {
  document.querySelectorAll('[data-richtext]').forEach((wrap) => {
    if (wrap.dataset.wang === '1') return
    try {
      initOne(wrap)
      wrap.dataset.wang = '1'
    } catch (e) {
      // 单个编辑器失败不影响其它字段
      console.error('[editor] wangEditor 初始化失败：', e)
    }
  })
  if (window.lucide) window.lucide.createIcons()
}

window.initBackendEditors = initBackendEditors

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBackendEditors)
} else {
  initBackendEditors()
}
