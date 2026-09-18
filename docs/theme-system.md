# 前台主题系统设计（Theme System）

> 配套文档：[`docs/frontend-architecture.md`](frontend-architecture.md)（选型对比与演进路线）
>
> 本文是**实施细则**：把"前台页面能 SEO、能换模板、模板能被开发"这三件事，落成可照着做的规范。
>
> 制定时间：2026-09-19

---

## 0. 目标与硬约束

| 诉求 | 必须满足 |
|---|---|
| **SEO** | 前台首屏**必须是服务端渲染的完整 HTML**（绝不能是 CSR 空壳） |
| **换模板** | 换主题 = 换一个目录，**刷新即生效，零构建** |
| **模板可开发** | 有明确的**目录规范 + 变量契约**，照着契约就能写模板，不用读后端代码 |
| **接 AI** | AI 只生产内容（数据），主题只管展示，两者解耦 |
| **default 主题** | 既是线上默认皮肤，**同时是"如何开发一套主题"的官方样例** |

---

## 1. 架构总览

```
┌───────────────────────────────────────────────────┐
│  内容层（已有）                                    │
│  Koa 3 + PostgreSQL 18 + /api/v1/*                │
│  ├─ /api/v1/public/*    公开内容 API（SEO 数据源） │
│  ├─ /api/v1/admin/*     后台管理（RBAC/CSRF/审计） │
│  └─ [未来] AI 服务：生成 / 润色 / 翻译 / 摘要      │
└───────────────────────────────────────────────────┘
         ↓ 数据                    ↓ JSON
┌─────────────────────────┐   ┌──────────────────────┐
│ 前台：主题系统（SSR）★   │   │ 后台：（另行接入）    │
│ themes/<name>/pages/    │   │ 不需要 SEO            │
│ 每次请求：数据 + 模板    │   │ 吃 /api/v1/admin/*   │
│        → HTML           │   │                      │
│ SEO ✅   换模板 ✅       │   │                      │
└─────────────────────────┘   └──────────────────────┘
```

**前台与后台的唯一耦合点是 JSON API，前端可以完全不同栈。**

---

## 2. 现状问题（为什么要立这套规范）

`routes/index.js` 现在的变量注入**命名混乱**，这是"模板没法被人开发"的直接原因：

| 路由 | 现状注入 | 问题 |
|---|---|---|
| 全局 | `nav` / `setting` / `pathname` / `__HOST__` | 站点信息叫 `setting`，不直观 |
| `/` | `focus` `links` | — |
| `/news` | `newslist`（**其实是子分类**）、`articlelist` | 名不副实 |
| `/content/:id` | `list`（**其实是单篇文章**） | 叫 `list` 却是单条，最容易误导 |
| `/case` | `catelist`、`articlelist` | 与 `/news` 命名不一致 |
| `/about` | 无 | 页面拿不到任何数据 |
| 分页 | `page` `totalPages` | 缺 `total` / `pageSize` / `hasPrev` / `hasNext` |
| 分类 ID | 硬编码在 `config.frontend.cateIds` | 换数据就要改代码 |

> **结论：不是模板引擎不行，是缺一套"变量契约"。**
> 契约立好之后，写模板的人只需要看契约表，不需要读 `routes/index.js`。

---

## 3. 目录规范

主题由**两处目录**组成（模板与静态资源分开，这是被现有架构约束后的取舍，见下方说明）：

```
views/themes/                     # ← 模板（art-template 的 root 仍是 views/）
└── <theme-name>/                 #   主题目录名 = 主题标识（只允许 [a-z0-9-]{1,32}）
    ├── theme.json                #   元信息（必需，缺失则不被识别为主题）
    ├── pages/                    #   页面模板（对应 6 个前台路由）
    │   ├── index.html            #   /
    │   ├── news.html             #   /news
    │   ├── content.html          #   /content/:id
    │   ├── case.html             #   /case
    │   ├── about.html            #   /about
    │   └── service.html          #   /service
    ├── partials/                 #   被 include 的公共片段
    │   └── header.html
    ├── snippets/                 #   ★ htmx 局部片段（只输出一小块 HTML，不输出整页）
    │   ├── article-list.html     #     列表项（分页/筛选时局部替换）
    │   └── search-result.html
    └── assets/                   #   主题自带资源（可选）

public/themes/                    # ← 静态资源（由 koa-static 提供）
└── <theme-name>/
    ├── css/  js/  images/
    └── assets/
        ├── style.css             #   主题样式（用 CSS 变量做皮肤）
        └── main.js               #   主题脚本（轮播等）
```

**URL 映射**：`public/themes/<name>/...` ←→ `/themes/<name>/...`（koa-static 直接服务 `public/`）。
模板里统一写 **`{{theme}}/css/reset.css`**，后端注入的 `theme` 值为 `/themes/<name>`，
于是**换主题时 CSS/JS 自动跟着换**——这一步不做的话，"换主题"只是换 HTML 不换皮肤，等于没换。

### 为什么模板在 `views/themes/` 而不是根目录 `themes/`

art-template 的渲染 root 目前是 `views/`（`app.js` 里 `render(app, { root: path.join(config.root,'views') })`），
而**后台的 31 个模板仍在 `views/admin/`**，它们的 `{{include 'admin/public/header.html'}}` 是相对 root 写的。

- 若把 root 改成项目根 → 后台 31 个模板的 include 路径**全部要改**（风险大、收益低，且后台马上要被 Vue3 替代）
- 保持 root = `views/` → 后台**零改动**，前台只需按 `themes/<name>/pages/xxx` 渲染

> **等后台 Vue3 接入、`views/admin/` 删除之后**，`views/` 里只剩 `themes/`，
> 那时把 `views/themes/` 上移为根目录 `themes/` + 修改 root 即可，**一步到位**。
> 这是"分两步走、每步都低风险"的取舍。

### include 必须写**主题内相对路径**

```
views/themes/default/pages/index.html
  →  {{include '../partials/header.html'}}     ✅ 相对路径
  →  {{include 'themes/default/partials/header.html'}}   ❌ 写死了主题名
```

用相对路径，复制整套主题去改名时 **include 一个字都不用改**。这是主题系统能不能成立的关键细节。

**`snippets/` 的作用**：分页、筛选、搜索这类交互，服务端**只渲染这一小块 HTML** 返回给 htmx 替换，
既不整页刷新，又保持"模板还是 HTML"。（本轮尚未创建，待接入 htmx 时再加）

---

## 4. 变量契约（**核心**）

> 契约原则：**所有页面都保证能拿到下面这些变量**。写模板的人只需看这张表。

### 4.1 全局（每个页面都有）

| 变量 | 类型 | 说明 |
|---|---|---|
| `site` | object | 站点设置：`site.name` `site.logo` `site.description` `site.keywords` `site.url` |
| `nav` | array | 导航：`[{ title, url, sort }]`（已按 sort 排序，仅 status=1） |
| `cats` | array | 分类树：`[{ _id, title, pid, children? }]` |
| `theme` | string | 当前主题的静态资源根路径，如 `/themes/default` |
| `__HOST__` | string | 站点完整地址（已由 `config.getOrigin` 推导） |
| `pathname` | string | 当前路径（用于导航高亮） |

### 4.2 页面级

| 页面 | 额外提供 |
|---|---|
| `/`（index） | `focus`（轮播）、`links`（友链）、`newsTop`（最新 N 篇） |
| `/news` | `list`（文章数组）、`page`（分页对象）、`cateId`（当前分类）、`subCates`（子分类） |
| `/case` | 同 `/news` |
| `/content/:id` | `article`（单篇详情）、`prev`（上一篇）、`next`（下一篇）、`breadcrumb` |
| `/service` | `list` |
| `/about` | `info`（可留空，但变量要存在） |

### 4.3 统一数据形状（**统一了才有通用模板**）

```js
// 列表项 / 详情，字段命名完全一致
article = {
  _id, title, description, content,     // content 仅详情有
  img_url, add_time, author,
  cate_id, cate_name,
  url                                   // ★ 语义化链接，如 /news/xxx-slug
}

// 分页对象（所有列表页统一）
page = {
  current,      // 当前页
  pageSize,     // 每页条数
  total,        // 总条数
  totalPages,   // 总页数
  hasPrev, hasNext
}
```

### 4.4 现状 → 目标 重命名对照

| 现状 | 目标 | 影响页面 |
|---|---|---|
| `newslist`（子分类） | `subCates` | `/news` |
| `articlelist` | `list` | `/news` `/case` |
| `list`（单篇文章） | `article` | `/content/:id` |
| `catelist` | `subCates` | `/case` |
| `setting` | `site` | 全局 |
| `page` + `totalPages` | `page` 对象 | 所有列表页 |

> ⚠️ 重命名会**改现有模板**，所以这是"一次性代价"——做完之后契约就稳定了。

---

## 5. `theme.json`

```json
{
  "name": "default",
  "title": "默认主题",
  "author": "your-name",
  "version": "1.0.0",
  "description": "官方样板主题，同时作为开发新主题的参考样例",
  "preview": "assets/preview.png",
  "pages": ["index", "news", "content", "case", "about", "service"],
  "engine": ">=1.0.0"
}
```

**约定**：`theme.json` 缺失或字段非法 → 该目录不被识别为主题（后台列表里不出现），
并在 `/healthz` 或启动日志中给出告警，避免"复制了一半的主题"把前台搞挂。

---

## 6. 文章动态渲染（**方案 A 的最强项**）

SSR 的"动态"是**每次请求实时合成**，内容改了下一个请求就是新的——这正是它相对静态生成（SSG）的优势。

### 三种动态形态

| 形态 | 例子 | 做法 | SEO |
|---|---|---|---|
| **① 首屏动态** | `/content/123` 文章详情 | 请求 → 查库 → 模板合成 HTML | ✅ 爬虫拿到完整内容 |
| **② 局部动态** | 列表分页、分类筛选、搜索 | htmx 请求 → 服务端渲染 `snippets/*.html` → 只替换列表区 | ⭕ 用户触发的交互，与 SEO 无关 |
| **③ 内容内动态区块** | 相关文章、面包屑、上一篇/下一篇、**AI 生成摘要** | 模板里直接 `{{ related }}` / `{% include %}` | ✅ 随首屏一起渲染 |

### 片段缓存（可选的性能优化）

文章详情的正文很少变，但导航、相关文章是实时的。可以分层缓存：

```
文章内容（长期缓存，发布/编辑时失效）
  + 导航/站点设置（短期缓存 或 每次查）
  + 相关文章（短期缓存）
  → 合成 HTML
```

这就是 WordPress 缓存插件的思路：**内容缓存 + 外壳实时**。
第一版**先不做**（当前量级用不上），等有需要再加 `model/store.js` 的缓存接口即可（Redis 已就绪）。

---

## 7. htmx 局部片段（`snippets/`）

### 用法

```html
<!-- pages/news.html -->
<div id="article-list">
  {{include './snippets/article-list.html'}}     ← 首屏由服务端渲染（SEO ✅）
</div>

<button hx-get="/news?page=2&pid={{cateId}}"
        hx-target="#article-list"
        hx-swap="innerHTML">下一页</button>
```

```html
<!-- snippets/article-list.html：只输出列表项，不输出整页 -->
{{each list item}}
  <a href="{{item.url}}" class="news-item">
    <h3>{{item.title}}</h3>
    <p>{{item.description}}</p>
  </a>
{{/each}}
```

### ⚠️ 关键：必须用「服务端返回 HTML」模式，不要用 client-side-templates

| 模式 | 服务端返回 | SEO |
|---|---|---|
| **htmx 原生（推荐）** | **HTML 片段**（服务端用 `snippets/` 渲染好） | ✅ |
| `client-side-templates` 扩展 | JSON（前端用 Mustache 渲染） | ❌ CSR，首屏空 |

**前台首屏绝不能用第二种。** 后台（不需要 SEO）两种都行。

---

## 8. 主题切换与预览

| 能力 | 做法 |
|---|---|
| **线上切换** | `setting` 表加 `theme` 字段；后台"主题管理"下拉列出 `themes/` 下的合法主题 |
| **临时预览** | 支持 `?theme=<name>` 查询参数临时切换（**只影响当前会话**），便于开发新主题时对照 |
| **安全约束** | 主题名只允许 `[a-z0-9-]{1,32}`，且必须是 `themes/` 下**真实存在**的目录名 |
| **防穿越** | 拼路径前必须校验，禁止 `../`、绝对路径、空值；不合法一律回退 `default` |
| **模板不存在** | 若当前主题缺某个 `pages/*.html` → **自动回退到 `default` 的同名页面**，而不是 500 |

> 最后一条很重要：**换主题不该让站点挂掉**。缺页回退 default 能避免"复制一半的主题"导致前台崩溃。

---

## 9. 模板语法

- **当前**：art-template `{{ }}` + `{{if}}` `{{each}}`（前后端一致，浏览器版 6KB）
- **可选升级**：LiquidJS（`{{ }}` + `{% if %}` `{% for %}`）——活跃维护，且与 DedeCMS / WordPress / Shopify 的标签心智最接近
  （见 §12 待确认）

**无论选哪个，`{{ }}` 语法不变，后续切换成本可控。**

---

## 10. 开发一套新主题的流程（5 步）

1. **复制样板**：`cp -r themes/default themes/<my-theme>`
2. **改元信息**：编辑 `theme.json`（`name` 必须与目录名一致）
3. **换皮肤**：改 `assets/style.css` 里的 **CSS 变量**（配色/字体/圆角/间距）→ 立刻看到变化
4. **改结构**：编辑 `pages/*.html`，**只使用 §4 契约里的变量**
5. **发布**：后台"主题管理"切换；或用 `?theme=<my-theme>` 先预览

**`default` 主题里要留注释**，标明每块对应哪个契约变量 —— 它就是"教程主题"。

---

## 11. 实施顺序建议：**先后台，再前台**

| | 后台（另行接入） | 前台主题系统 |
|---|---|---|
| 后端改动 | **零**（`/api/v1/admin/*` 已就绪：RBAC/CSRF/审计/校验/脱敏） | 需要改 `routes/index.js`（变量契约） |
| SEO 风险 | **零**（后台不需要被爬虫抓） | 有（要小心，但可并行灰度） |
| 前置依赖 | 无 | 依赖"变量契约"设计 |
| 见效速度 | 快（素材在手，接上就跑） | 慢（要新建架构 + 写规范） |

**四条先后台的理由：**

1. **零后端改动 + 你素材在手** → 最快见效，且立刻解决"后台体验差"这个你每天在烦的问题
2. **后台接入 = 对 `/api/v1/admin/*` 的一次全面实战检验** ——
   缺字段、分页不对、权限点不全这类问题**现在就暴露**；等做前台时，API 已经是被验证过的
3. **零 SEO 风险** —— 后台怎么折腾都不影响线上前台
4. **前台现状已经能 SEO**（SSR 直出），缺的只是"主题化"；而主题化需要先定契约（§4），
   属于设计工作，放在后台稳定后做，思路更清楚

> 例外：如果后台框架迟迟定不下来，可以**先做 §4 变量契约**（纯后端、风险低、前台后台都受益）。

---

## 12. 后台接入清单（API 契约现状）

后台只需消费以下接口，**后端无需改动**：

| 接口 | 说明 |
|---|---|
| `GET /api/v1/csrf-token` | 拿 CSRF token（双提交 Cookie，token 种在可读 Cookie `csrfToken`） |
| `POST /api/v1/admin/login` | 登录（另有 SSR 版 `/admin/login/doLogin` 走验证码） |
| `GET /api/v1/admin/rbac/me` | 当前用户 + 权限点 |
| `GET /api/v1/admin/:resource/list` | 列表（分页 `page` `pageSize`） |
| `POST /api/v1/admin/:resource/add` | 新增 |
| `POST /api/v1/admin/:resource/:id/edit` | 编辑 |
| `POST /api/v1/admin/:resource/:id/delete` | 删除 |
| `GET /api/v1/admin/audit/list` | 审计日志（需 `audit:list` 权限） |
| `GET /api/v1/admin/stats/*` | 统计报表 |

**写请求必须带** `X-CSRF-Token` 头（值 = `csrfToken` Cookie 的值）。
响应统一 `{ code, message, data }`，`code=0` 为成功。错误码见 `utils/code.js`。

**资源白名单**：目前 `services = { manage, article }`（`routes/api/admin.js`）。
其他资源（nav / focus / link / articlecate / setting）走 SSR 端点，需要时再加进 services 映射。

---

## 13. 待确认

| # | 待定项 | 影响 |
|---|---|---|
| 1 | 模板引擎：继续 art-template，还是升级 **LiquidJS** | 长期主题生态的友好度（见 §9） |
| 2 | 是否引入 **htmx**（约 14KB）做局部刷新；还是先用现有 jQuery `$.post` | 后台/前台交互实现方式 |
| 3 | `config.frontend.cateIds` 硬编码是否改为后台可配置 | 主题通用性 |
| 4 | 文章 URL 是否改语义化 slug（`/content/:id` → `/news/:slug`） | SEO 排名（**需 301 跳转**） |
| 5 | 后台框架选型（待提供） | 后台实施 |

---

## 14. 实施记录（2026-09-19 第一轮落地）

### 14.1 已完成

| # | 内容 | 说明 |
|---|---|---|
| 1 | **模板目录迁移** | `views/default/*.html` → `views/themes/default/pages/`<br>`views/default/public/header.html` → `views/themes/default/partials/`<br>顺手删除已确认无引用的死文件 `views/default/index.htm` |
| 2 | **`theme.json`** | 新建，含 name/title/author/version/pages 等元信息 |
| 3 | **include 改相对路径** | 6 个页面的 `{{include 'default/public/header.html'}}` → `{{include '../partials/header.html'}}`，复制主题零改动 |
| 4 | **变量契约落地** | `routes/index.js` 重写（详见下） |
| 5 | **静态资源迁移** | `public/default/` → `public/themes/default/`（54 个文件），模板改用 `{{theme}}/...` 引用 |

### 14.2 变量契约的实施要点（`routes/index.js`）

| 能力 | 实现 |
|---|---|
| 主题解析 | `pickTheme()` 双重校验：字符集白名单 `[a-z0-9-]{1,32}` + `themes/` 下真实存在 `theme.json` |
| 主题优先级 | `?theme=xxx`（仅本次请求，不落库不写 Cookie）> `setting.theme` > `default` |
| **缺页回退** | 当前主题缺某个 `pages/*.html` → 自动回退 `default` 同名页。**没有这条，"复制一半的新主题"会让前台直接 500** |
| 全局注入 | `site`（去掉 `site_` 前缀）、`nav`、`cats`（分类树，`children`）、`theme`、`pathname`、`__HOST__` |
| 列表页 | `list` + `page` 对象（`current/pageSize/total/totalPages/hasPrev/hasNext`）+ `subCates` + `cateId` |
| 详情页 | `article` + `prev` + `next` + `breadcrumb` |
| 并发优化 | 全局中间件的三次查询改为 `Promise.all` |

**模板侧重命名**（一次性代价，做完契约就稳定）：
`setting.site_*` → `site.*`；`articlelist` → `list`；`newslist`/`catelist` → `subCates`；
详情页 `list`（单篇文章）→ `article`；`{{page}}`/`{{totalPages}}` → `{{page.current}}`/`{{page.totalPages}}`；
`{{pid}}` → `{{cateId}}`；`serviceList` → `list`。

### 14.3 ⚠️ 本轮**顺手发现并修掉的两个真实 bug**

**① 已下架的文章仍可被前台访问（数据泄露）**
`/news`、`/case`、`/service`、`/content/:id` 原先**都没有过滤 `status`**，
导致后台点了"下架"的文章，前台列表和详情页**照样能看**。
修法：统一加 `enabled()` 条件（`status` 兼容数字 1 与字符串 '1'），
详情页查不到（或已下架）直接 404。

**② 新闻列表翻页会跳到案例页**
`news.html` 的分页 JS 里写的是 `location.href = "/case?pid=..."` 和 `"/case?page="`——
复制粘贴遗留，在新闻页点下一页会跳到 `/case`。已修正为 `/news`。

> 这两个都是"改造时顺手看出来的"，说明**做契约/重构的过程本身就是最好的 code review**。

### 14.4 验证（19/19 通过）

6 个前台页面 200、全部主题资源 200、契约变量真实渲染非空、
已发布文章 200 / 已下架文章 404 / 非法 id 404 而非 500、
下架内容不出现在前台列表、不存在的主题与目录穿越尝试均安全回退 default、后台 `/admin/login` 未受影响。

### 14.5 下一步

| 优先级 | 事项 |
|---|---|
| 高 | 后台 Vue3（`Vu3Admin01`）接入 `/api/v1/admin/*` —— 完成后可删 `views/admin/` 31 个模板 |
| 中 | 建第二套主题，验证"换主题"真的能用（顺带成为 `theme.json` + 开发流程的第一份实战验收） |
| 中 | `snippets/` + htmx 局部渲染（分页/筛选先做） |
| 中 | SEO 三件套：`sitemap.xml` / `robots.txt` / OG+JSON-LD |
| 低 | 后台主题管理界面（列出 `themes/` + 切换） |
| 低 | `config.frontend.cateIds` 硬编码改为后台可配置 |

---

## 附：一句话

> **前台 = 服务端模板 + 变量契约 + 主题目录**（SEO 与"可换模板"的唯一交集）；
> **交互 = 服务端渲染 HTML 片段 + htmx 局部替换**（不是前端渲染 JSON）；
> **内容 = `/api/v1/*`**（AI 从这里进，主题完全不用关心）。
