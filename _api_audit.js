'use strict'
// 临时：接口全矩阵审计（找逻辑错误/隐患/硬编码）。跑完删除。
const BASE = 'http://localhost:3000'

function createClient () {
  const cookies = {}
  const setCookies = (res) => {
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    for (const c of raw) {
      const pair = c.split(';')[0]
      const i = pair.indexOf('=')
      cookies[pair.slice(0, i)] = pair.slice(i + 1)
    }
  }
  const decodeSession = () => {
    let raw = String(cookies['koa:sess'] || '').replace(/^"|"$/g, '')
    try { raw = decodeURIComponent(raw) } catch (e) { /* noop */ }
    try { return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) } catch (e) { return null }
  }
  async function req (path, opts = {}) {
    const headers = Object.assign({
      Cookie: Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }, opts.headers || {})
    const res = await fetch(BASE + path, { ...opts, headers, redirect: 'manual' })
    setCookies(res)
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch (e) { /* not json */ }
    return { status: res.status, text, json, location: res.headers.get('location') }
  }
  return {
    req, cookies, decodeSession,
    async login (username, password) {
      const page = await req('/admin/login')
      const csrf = (page.text.match(/name="_csrf"\s+value="([^"]+)"/) || [])[1]
      await req('/admin/login/code')
      const code = (decodeSession() || {}).code
      return req('/admin/login/doLogin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ username, password, code, _csrf: csrf }).toString()
      })
    },
    async write (method, path, payload) {
      await req('/api/v1/csrf-token')
      return req(path, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': cookies.csrfToken || '' },
        body: JSON.stringify(payload || {})
      })
    }
  }
}

const findings = []
const ok = []
function expect (name, cond, detail) {
  if (cond) ok.push(name)
  else findings.push({ name, detail })
  console.log(`  ${cond ? '[OK]  ' : '[问题]'} ${name}${cond ? '' : ' => ' + detail}`)
}

async function main () {
  const anon = createClient()
  const su = createClient()

  console.log('\n=== A. 公开内容 API 边界 ===')
  let r = await anon.req('/api/v1/public/articles?pageSize=999')
  expect('pageSize 超限(999) 应被拒', r.status === 400, `${r.status} ${r.text.slice(0, 80)}`)
  r = await anon.req('/api/v1/public/articles?pageSize=abc')
  expect('pageSize=abc 应被拒', r.status === 400, `${r.status}`)
  r = await anon.req('/api/v1/public/articles?page=-1')
  expect('page=-1 应被拒', r.status === 400, `${r.status}`)
  r = await anon.req('/api/v1/public/articles?keyword=' + 'x'.repeat(200))
  expect('keyword 超长(200) 应被拒', r.status === 400, `${r.status}`)
  r = await anon.req('/api/v1/public/articles?cateId=not-exist')
  expect('cateId 不存在 → 空列表(200)', r.status === 200 && r.json.data.list.length === 0, `${r.status}`)
  r = await anon.req('/api/v1/public/articles/%40%40%40')
  expect('非法 id → 400（不应 500）', r.status === 400, `${r.status} ${r.text.slice(0, 120)}`)
  r = await anon.req('/api/v1/public/articles/000000000000000000000000')
  expect('不存在的 id → 404', r.status === 404, `${r.status}`)
  r = await anon.req('/api/v1/public/articles/' + 'x'.repeat(80))
  expect('超长 id → 400（不应 500）', r.status === 400, `${r.status}`)
  r = await anon.req('/api/v1/public/no-such')
  expect('未定义公开路径 → 404 JSON', r.status === 404 && r.json && r.json.code === 1004, `${r.status}`)
  r = await anon.req('/api/v1/public/articles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  expect('公开接口 POST → 405/404（不应 200）', [404, 405].includes(r.status), `${r.status}`)

  console.log('\n=== B. 鉴权 / CSRF ===')
  for (const p of ['/api/v1/admin/manage/list', '/api/v1/admin/rbac/me', '/api/v1/admin/audit/list']) {
    r = await anon.req(p)
    expect(`未登录 ${p} → 401`, r.status === 401, `${r.status}`)
  }
  r = await su.login('admin', '123456')
  expect('超管登录成功', r.status === 302, `${r.status}`)
  await su.req('/api/v1/csrf-token')
  r = await su.req('/api/v1/admin/manage/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'noCsrf', password: 'abc123' })
  })
  expect('缺 CSRF 头写请求 → 403', r.status === 403 && r.json.code === 1007, `${r.status}`)
  r = await su.req('/api/v1/admin/manage/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': 'wrong' },
    body: JSON.stringify({ username: 'badCsrf', password: 'abc123' })
  })
  expect('错 CSRF 头 → 403', r.status === 403, `${r.status}`)

  console.log('\n=== C. RBAC / 资源边界 ===')
  r = await su.req('/api/v1/admin/foo/list')
  expect('未知 resource 列表 → 404', r.status === 404 && r.json.code === 1004, `${r.status}`)
  r = await su.write('POST', '/api/v1/admin/foo/add', { title: 'x' })
  expect('未知 resource 新增 → 404', r.status === 404, `${r.status}`)
  r = await su.req('/api/v1/admin/rbac/roles/not-exist-role/permissions')
  expect('不存在角色查权限 → 404', r.status === 404, `${r.status} ${r.text.slice(0, 100)}`)
  r = await su.write('POST', '/api/v1/admin/rbac/roles/not-exist-role/permissions', { codes: [] })
  expect('不存在角色授权 → 404', r.status === 404, `${r.status} ${r.text.slice(0, 100)}`)
  r = await su.req('/api/v1/admin/manage/%40%40%40')
  expect('资源详情非法 id → 400（不应 500）', r.status === 400, `${r.status} ${r.text.slice(0, 120)}`)
  r = await su.req('/api/v1/admin/manage/000000000000000000000000')
  expect('资源详情不存在 id → 404', r.status === 404, `${r.status}`)
  r = await su.write('POST', '/api/v1/admin/manage/%40%40%40/delete', {})
  expect('删除非法 id → 400（不应 500）', r.status === 400, `${r.status} ${r.text.slice(0, 120)}`)
  r = await su.write('POST', '/api/v1/admin/manage/000000000000000000000000/edit', { username: 'zzz111' })
  expect('编辑不存在 id → 404', r.status === 404, `${r.status}`)

  console.log('\n=== D. 唯一性 / 角色校验 ===')
  r = await su.write('POST', '/api/v1/admin/manage/add', { username: 'admin', password: 'abc123' })
  expect('用户名重复 → 1001 参数错误', r.json && r.json.code === 1001, `${r.status} ${r.text.slice(0, 100)}`)
  r = await su.write('POST', '/api/v1/admin/manage/add', { username: 'dupcheck1', password: 'abc123', role_id: 'not-exist-role' })
  const dupOk = r.json && r.json.code === 0
  expect('绑定不存在的角色 → 应被拒（当前行为：' + (dupOk ? '放行' : '已拒') + '）', !dupOk, `${r.status} ${r.text.slice(0, 100)}`)
  if (dupOk && r.json.data && r.json.data._id) {
    await su.write('POST', `/api/v1/admin/manage/${r.json.data._id}/delete`, {})
  }

  console.log('\n=== E. 权限撤销是否立即生效（会话残留） ===')
  // 造一个 editor 角色账号
  r = await su.req('/api/v1/admin/rbac/roles')
  const editorRole = (r.json.data || []).find((x) => x.code === 'editor')
  r = await su.write('POST', '/api/v1/admin/manage/add', { username: 'revoketest', password: 'abc123', role_id: editorRole._id })
  const tempId = r.json && r.json.data && r.json.data._id
  const victim = createClient()
  await victim.login('revoketest', 'abc123')
  r = await victim.req('/api/v1/admin/article/list?pageSize=1')
  expect('editor 账号登录后可读列表', r.status === 200, `${r.status}`)
  // 超管把它删掉
  r = await su.write('POST', `/api/v1/admin/manage/${tempId}/delete`, {})
  expect('超管删除该账号', r.json && r.json.code === 0, `${r.status}`)
  // 被删账号的会话还能用吗？
  r = await victim.req('/api/v1/admin/article/list?pageSize=1')
  expect('账号已删除后，其旧会话应失效', r.status === 401, `实际 ${r.status} —— 说明删除账号后旧会话仍有效（权限撤销不即时）`)

  console.log('\n=== F. 审计查询边界 ===')
  r = await su.req('/api/v1/admin/audit/list?pageSize=999')
  expect('审计 pageSize 超限 → 400', r.status === 400, `${r.status}`)
  r = await su.req('/api/v1/admin/audit/list?action=create&resource=manage')
  expect('审计按 action+resource 过滤可用', r.status === 200 && r.json.data.list.every((x) => x.action === 'create' && x.resource === 'manage'), `${r.status}`)
  r = await su.req('/api/v1/admin/audit/list?pageSize=100')
  const anyLeak = (r.json.data.list || []).some((x) => JSON.stringify(x.detail || {}).match(/"password":"(?!\[REDACTED\])/))
  expect('审计日志不含明文密码', !anyLeak, '发现非脱敏密码字段')

  console.log('\n=== G. 后台 SSR 开放重定向（Referer 可控） ===')
  await su.req('/admin/nav')
  r = await su.req('/admin/remove', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: 'https://evil.example.com/steal'
    },
    body: `collectionName=nav&id=000000000000000000000000&_csrf=${su.cookies.csrfToken}`
  })
  const redirectedToEvil = (r.location || '').includes('evil.example.com')
  expect('删除后不应按 Referer 跳到外部站点（开放重定向）', !redirectedToEvil, `Location=${r.location}`)

  console.log(`\n===== 汇总：通过 ${ok.length} 项，发现问题 ${findings.length} 项 =====`)
  if (findings.length) {
    console.log('\n问题清单：')
    findings.forEach((f, i) => console.log(`  ${i + 1}. ${f.name}\n     ${f.detail}`))
  }
  process.exit(0)
}

main().catch((e) => { console.error('脚本异常：', e); process.exit(1) })
