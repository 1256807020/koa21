// src/console/editor.js
// TipTap 富文本编辑器（自托管，esbuild 打包到 public/console/editor.js）。
// 扫描页面上的 [data-richtext]，在 [data-editor] 上挂载编辑器，并把内容同步到隐藏域。
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'

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

function uploadImage (editor) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.addEventListener('change', () => {
    const file = input.files[0]
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    fetch('/api/v1/admin/upload', {
      method: 'POST',
      headers: { 'X-CSRF-Token': getCsrf() },
      body: fd
    }).then((r) => r.json()).then((j) => {
      if (j.code !== 0) throw new Error(j.message)
      editor.chain().focus().setImage({ src: j.data.url }).run()
    }).catch((e) => showToast(e.message || '上传失败', 'error'))
  })
  input.click()
}

function buildToolbar (editor) {
  const bar = document.createElement('div')
  bar.className = 'mb-2 flex flex-wrap items-center gap-1 rounded-md border border-default-200 bg-default-50 p-1'

  const defs = [
    { icon: 'bold', title: '加粗', run: () => editor.chain().focus().toggleBold().run(), active: () => editor.isActive('bold') },
    { icon: 'italic', title: '斜体', run: () => editor.chain().focus().toggleItalic().run(), active: () => editor.isActive('italic') },
    { icon: 'strikethrough', title: '删除线', run: () => editor.chain().focus().toggleStrike().run(), active: () => editor.isActive('strike') },
    { icon: 'heading-2', title: '标题 2', run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(), active: () => editor.isActive('heading', { level: 2 }) },
    { icon: 'list', title: '无序列表', run: () => editor.chain().focus().toggleBulletList().run(), active: () => editor.isActive('bulletList') },
    { icon: 'list-ordered', title: '有序列表', run: () => editor.chain().focus().toggleOrderedList().run(), active: () => editor.isActive('orderedList') },
    { icon: 'link', title: '链接', run: () => { const url = window.prompt('链接地址（取消则移除链接）'); if (url === null) return; if (url) editor.chain().focus().setLink({ href: url }).run(); else editor.chain().focus().unsetLink().run() } },
    { icon: 'image', title: '插入图片', run: () => uploadImage(editor) }
  ]

  defs.forEach((d, i) => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.title = d.title
    btn.className = 'kt-btn kt-btn-ghost kt-btn-sm'
    // 注意：Lucide 的 createIcons() 只会替换 <i data-lucide> 元素，
    // 所以必须把 data-lucide 放在按钮**内部的 <i>** 上，不能放在 <button> 上。
    const ic = document.createElement('i')
    ic.className = 'size-4'
    ic.setAttribute('data-lucide', d.icon)
    btn.appendChild(ic)
    btn.addEventListener('click', (e) => { e.preventDefault(); d.run() })
    bar.appendChild(btn)
    if (i === 3 || i === 5) {
      const sep = document.createElement('span')
      sep.className = 'mx-1 h-5 w-px bg-default-200'
      bar.appendChild(sep)
    }
  })

  // ⚠️ 这里**不能**调 lucide.createIcons()：此时 bar 还是游离节点（尚未插入 DOM），
  //    createIcons 内部是 document.querySelectorAll('[data-lucide]')，找不到游离节点。
  //    图标渲染由调用方在 insertBefore 之后统一处理。

  const refresh = () => {
    // 分隔符是 <span>，故 querySelectorAll('button') 的顺序与 defs 一一对应
    bar.querySelectorAll('button').forEach((b, i) => {
      const d = defs[i]
      if (d && d.active) b.classList.toggle('is-active', d.active())
    })
  }
  editor.on('selectionUpdate', refresh)
  editor.on('transaction', refresh)
  return bar
}

function initConsoleEditors () {
  document.querySelectorAll('[data-richtext]').forEach((wrap) => {
    if (wrap.dataset.tiptap === '1') return
    const mount = wrap.querySelector('[data-editor]')
    const hidden = wrap.querySelector('input[type=hidden]')
    if (!mount || !hidden) return
    const content = mount.innerHTML
    const editor = new Editor({
      element: mount,
      extensions: [
        StarterKit,
        Image.configure({ inline: false, allowBase64: false }),
        Link.configure({ openOnClick: false, autolink: true })
      ],
      content,
      onUpdate: () => { hidden.value = editor.getHTML() }
    })
    wrap.insertBefore(buildToolbar(editor), mount)
    wrap.dataset.tiptap = '1'
  })
  // 工具栏已插入 DOM，此时才渲染 Lucide 图标
  if (window.lucide) window.lucide.createIcons()
}

window.initConsoleEditors = initConsoleEditors

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initConsoleEditors)
} else {
  initConsoleEditors()
}
