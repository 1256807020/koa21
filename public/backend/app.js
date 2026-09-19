// public/console/app.js
// ============================================================
// 新后台（Console）前端交互 —— 约 200 行原生 JS，不引入框架。
// 核心思路：页面 SSR 渲染初始 HTML，交互全部走既有的 /api/v1/admin/* JSON API；
// 列表用「服务端返回 HTML 片段」局部替换（事件委托，避免重渲染丢监听）。
// 同时导出 api / toast / buildPager 供统计、审计等内联脚本复用。
// ============================================================

// —— 统一请求封装（仅 JSON API）——
export function getCsrf () {
  const c = document.cookie.split('; ').find((x) => x.startsWith('csrfToken='))
  return c ? decodeURIComponent(c.split('=')[1]) : ''
}

export async function api (path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'X-CSRF-Token': getCsrf() },
    ...opts
  })
  let json = {}
  try { json = await res.json() } catch (_) { /* 非 JSON 忽略 */ }
  if (json.code !== 0) {
    throw new Error(json.message || `请求失败（${res.status}）`)
  }
  return json.data
}

async function getText (path) {
  const res = await fetch(path, { headers: { 'X-CSRF-Token': getCsrf() } })
  return res.text()
}

export function toast (msg, type = 'info') {
  const wrap = document.getElementById('kt-toast-wrap')
  if (!wrap) return
  const el = document.createElement('div')
  el.className = `kt-toast kt-toast-${type}`
  el.textContent = msg
  wrap.appendChild(el)
  setTimeout(() => el.remove(), 3500)
}

// —— 自定义确认模态框（替代 window.confirm，避免自动化/移动端被自动 dismiss）——
export function confirmDialog (message) {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = 'kt-modal-mask'
    mask.innerHTML = `<div class="kt-modal" role="dialog" aria-modal="true">
      <div class="kt-modal-body">${message}</div>
      <div class="kt-modal-footer">
        <button type="button" class="kt-btn kt-btn-outline" data-act="cancel">取消</button>
        <button type="button" class="kt-btn kt-btn-danger" data-act="ok">删除</button>
      </div></div>`
    document.body.appendChild(mask)
    const close = (v) => { mask.remove(); resolve(v) }
    mask.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false))
    mask.querySelector('[data-act="ok"]').addEventListener('click', () => close(true))
    mask.addEventListener('click', (e) => { if (e.target === mask) close(false) })
  })
}

// —— 分页条 ——
export function buildPager (container, onPage) {
  const page = Number(container.dataset.page) || 1
  const pages = Number(container.dataset.pages) || 1
  if (pages <= 1) { container.innerHTML = ''; return }
  const link = (p, label, disabled = false, active = false) =>
    `<a class="kt-page-link ${disabled ? 'kt-page-link-disabled' : ''} ${active ? 'kt-page-link-active' : ''}" data-page="${p}">${label}</a>`
  let html = link(Math.max(1, page - 1), '上一页', page <= 1)
  const start = Math.max(1, page - 2)
  const end = Math.min(pages, page + 2)
  if (start > 1) { html += link(1, '1'); if (start > 2) html += '<span class="px-2 text-default-500">…</span>' }
  for (let p = start; p <= end; p++) html += link(p, String(p), false, p === page)
  if (end < pages) { if (end < pages - 1) html += '<span class="px-2 text-default-500">…</span>'; html += link(pages, String(pages)) }
  html += link(Math.min(pages, page + 1), '下一页', page >= pages)
  container.innerHTML = html
  container.onclick = (e) => {
    const a = e.target.closest('a[data-page]')
    if (a && !a.classList.contains('kt-page-link-disabled')) {
      e.preventDefault()
      onPage(Number(a.dataset.page))
    }
  }
}

function resourceOf () { return location.pathname.split('/')[2] || '' }

function reloadRows (resource, page, keyword) {
  const url = `/console/${resource}/rows?page=${page}&keyword=${encodeURIComponent(keyword || '')}`
  getText(url).then((html) => {
    const list = document.getElementById('list')
    if (list) {
      list.innerHTML = html
      const pager = document.getElementById('list-pager')
      if (pager) buildPager(pager, (p) => reloadRows(resource, p, keyword))
    }
  }).catch((e) => toast(e.message || '加载失败', 'error'))
}

// —— 初始化（DOM 就绪后，模块脚本默认 defer）——
function init () {
  // 侧栏（移动端抽屉）
  const sb = document.getElementById('sidenavDrawer')
  const bd = document.getElementById('sidenavBackdrop')
  document.querySelectorAll('[data-sidenav-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => { sb.classList.toggle('kt-open'); bd.classList.toggle('kt-open') })
  })
  bd?.addEventListener('click', () => { sb.classList.remove('kt-open'); bd.classList.remove('kt-open') })

  // 下拉菜单（点击切换 + 点击外部关闭）
  document.querySelectorAll('[data-dropdown]').forEach((d) => {
    const t = d.querySelector('[data-dropdown-toggle]')
    const m = d.querySelector('[data-dropdown-menu]')
    t?.addEventListener('click', (e) => { e.stopPropagation(); m.classList.toggle('kt-open') })
  })
  document.addEventListener('click', () => {
    document.querySelectorAll('[data-dropdown-menu].kt-open').forEach((m) => m.classList.remove('kt-open'))
  })

  // 搜索（事件委托，覆盖动态加载后的表单）
  document.addEventListener('submit', (e) => {
    const searchForm = e.target.closest('[data-search]')
    if (searchForm) {
      e.preventDefault()
      const resource = resourceOf()
      const kw = searchForm.keyword.value
      reloadRows(resource, 1, kw)
      history.replaceState(null, '', kw ? `?keyword=${encodeURIComponent(kw)}` : location.pathname)
    }
  })

  // 初始分页条
  const initPager = document.getElementById('list-pager')
  if (initPager) {
    buildPager(initPager, (p) => {
      const u = new URL(location.href)
      reloadRows(resourceOf(), p, u.searchParams.get('keyword') || '')
    })
  }

  // 删除（事件委托 + 自定义确认模态框，避免浏览器自动 dismiss window.confirm）
  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-action="delete"]')
    if (!del) return
    e.preventDefault()
    const ok = await confirmDialog('确定要删除吗？此操作不可恢复。')
    if (!ok) return
    const resource = resourceOf()
    const id = del.dataset.id
    fetch(`/api/v1/admin/${resource}/${id}/delete`, {
      method: 'POST',
      headers: { 'X-CSRF-Token': getCsrf() }
    }).then((r) => r.json()).then((j) => {
      if (j.code !== 0) throw new Error(j.message)
      toast('删除成功', 'success')
      const u = new URL(location.href)
      reloadRows(resource, Number(u.searchParams.get('page') || 1), u.searchParams.get('keyword') || '')
    }).catch((err) => toast(err.message || '删除失败', 'error'))
  })

  // 表单提交（新增/编辑，JSON 提交到 /api/v1/admin/*）
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('#resource-form')
    if (!form) return
    e.preventDefault()
    const resource = form.dataset.resource
    const id = form.dataset.id
    const isEdit = form.dataset.edit === 'true'
    const fd = new FormData(form)
    const payload = {}
    for (const [k, v] of fd.entries()) {
      if (k === '_csrf') continue
      if (k === 'password' && isEdit && v === '') continue // 编辑时留空 = 不修改密码
      payload[k] = v
    }
    const url = isEdit ? `/api/v1/admin/${resource}/${id}/edit` : `/api/v1/admin/${resource}/add`
    api(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
      body: JSON.stringify(payload)
    }).then(() => {
      toast('保存成功', 'success')
      setTimeout(() => { location.href = `/console/${resource}` }, 400)
    }).catch((err) => toast(err.message || '保存失败', 'error'))
  })

  // 图片上传（点击按钮 → 选文件 → 上传 → 回填隐藏域 + 预览）
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-upload-btn]')
    if (btn) btn.parentElement.querySelector('[data-upload]').click()
  })
  document.addEventListener('change', (e) => {
    const inp = e.target.closest('[data-upload]')
    if (!inp) return
    const file = inp.files[0]
    if (!file) return
    const field = inp.parentElement
    const fd = new FormData()
    fd.append('file', file)
    fetch('/api/v1/admin/upload', {
      method: 'POST',
      headers: { 'X-CSRF-Token': getCsrf() },
      body: fd
    }).then((r) => r.json()).then((j) => {
      if (j.code !== 0) throw new Error(j.message)
      const url = j.data.url.replace(/^\//, '')
      field.querySelector('input[type=hidden]').value = url
      const prev = field.querySelector('.image-preview')
      prev.src = j.data.url
      prev.classList.remove('hidden')
      toast('上传成功', 'success')
    }).catch((err) => toast(err.message || '上传失败', 'error'))
  })

  // 富文本由 public/console/editor.js（TipTap）接管：扫描 [data-richtext] 挂载编辑器。
  // 这里只负责把页面上所有 <i data-lucide> 渲染成内联 SVG（Lucide，离线 vendor）。
  if (window.lucide) window.lucide.createIcons()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
