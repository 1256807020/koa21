'use strict'
// utils/backendConfig.js
// ============================================================
// 新后台（Console）资源 UI 配置 —— 配置驱动通用 CRUD 页面。
// 一份配置同时描述：列表列、表单字段、权限资源名、可选来源（级联下拉）。
// 新增一个资源通常只需在此加一项 + 后端 service + RBAC 权限点（见 routes/api/admin.js）。
//
// 字段类型（type）对应模板渲染与前端提交逻辑：
//   text / number / textarea / password → 普通输入
//   select → 下拉（options 静态 或 source 动态取：categories / roles）
//   checkbox → 开关（提交 '1' / '0'）
//   image → 图片上传控件（隐藏域存 URL）
//   richtext → TipTap 富文本（隐藏域存 HTML）
// ============================================================

const STATUS_OPTIONS = [
  { value: 1, label: '显示' },
  { value: 0, label: '隐藏' }
]

const RESOURCES = {
  article: {
    label: '文章', perm: 'article', service: 'article', searchFields: ['title'],
    columns: [
      { key: 'title', label: '标题' },
      { key: 'cate_name', label: '分类' },
      { key: 'author', label: '作者' },
      { key: 'status', label: '状态', type: 'status' },
      { key: 'add_time', label: '发布时间', type: 'datetime' }
    ],
    form: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'pid', label: '分类', type: 'select', source: 'categories', pidNone: '' },
      { key: 'author', label: '作者', type: 'text' },
      { key: 'img_url', label: '封面图', type: 'image' },
      { key: 'keywords', label: '关键词', type: 'text' },
      { key: 'description', label: '描述', type: 'textarea' },
      { key: 'content', label: '正文', type: 'richtext' },
      { key: 'is_best', label: '推荐', type: 'checkbox' },
      { key: 'is_hot', label: '热门', type: 'checkbox' },
      { key: 'is_new', label: '最新', type: 'checkbox' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS }
    ]
  },

  articlecate: {
    label: '分类', perm: 'articlecate', service: 'articlecate', searchFields: ['title'],
    columns: [
      { key: 'title', label: '名称' },
      { key: 'pid', label: '上级', type: 'pid' },
      { key: 'sort', label: '排序' },
      { key: 'status', label: '状态', type: 'status' }
    ],
    form: [
      { key: 'title', label: '名称', type: 'text', required: true },
      { key: 'pid', label: '上级分类', type: 'select', source: 'categories', pidNone: '0' },
      { key: 'keywords', label: '关键词', type: 'text' },
      { key: 'description', label: '描述', type: 'textarea' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS }
    ]
  },

  nav: {
    label: '导航', perm: 'nav', service: 'nav', searchFields: ['title', 'url'],
    columns: [
      { key: 'title', label: '标题' },
      { key: 'url', label: '链接' },
      { key: 'sort', label: '排序' },
      { key: 'status', label: '状态', type: 'status' }
    ],
    form: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'url', label: '链接', type: 'text', required: true },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS }
    ]
  },

  focus: {
    label: '轮播', perm: 'focus', service: 'focus', searchFields: ['title'],
    columns: [
      { key: 'title', label: '标题' },
      { key: 'pic', label: '图片', type: 'image' },
      { key: 'url', label: '链接' },
      { key: 'sort', label: '排序' },
      { key: 'status', label: '状态', type: 'status' }
    ],
    form: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'pic', label: '图片', type: 'image' },
      { key: 'url', label: '链接', type: 'text' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS }
    ]
  },

  link: {
    label: '友链', perm: 'link', service: 'link', searchFields: ['title'],
    columns: [
      { key: 'title', label: '名称' },
      { key: 'pic', label: '图标', type: 'image' },
      { key: 'url', label: '链接' },
      { key: 'sort', label: '排序' },
      { key: 'status', label: '状态', type: 'status' }
    ],
    form: [
      { key: 'title', label: '名称', type: 'text', required: true },
      { key: 'pic', label: '图标', type: 'image' },
      { key: 'url', label: '链接', type: 'text' },
      { key: 'sort', label: '排序', type: 'number' },
      { key: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS }
    ]
  },

  manage: {
    label: '管理员', perm: 'manage', service: 'manage', searchFields: ['username'],
    columns: [
      { key: 'username', label: '账号' },
      { key: 'status', label: '状态', type: 'status' },
      { key: 'lasttime', label: '最近登录', type: 'datetime' },
      { key: 'add_time', label: '创建时间', type: 'datetime' }
    ],
    form: [
      { key: 'username', label: '账号', type: 'text', required: true },
      { key: 'password', label: '密码', type: 'password', requiredOnCreate: true, hint: '新增必填，至少 6 位；编辑时留空表示不修改' },
      { key: 'role_id', label: '角色', type: 'select', source: 'roles' },
      { key: 'status', label: '状态', type: 'select', options: STATUS_OPTIONS }
    ]
  },

  setting: {
    label: '站点设置', perm: 'setting', service: 'setting', singleRow: true,
    form: [
      { key: 'site_title', label: '站点名称', type: 'text', required: true },
      { key: 'site_url', label: '站点地址', type: 'text' },
      { key: 'site_logo', label: '站点 Logo', type: 'image' },
      { key: 'site_keywords', label: '关键词', type: 'text' },
      { key: 'site_description', label: '描述', type: 'textarea' },
      { key: 'site_icp', label: '备案号', type: 'text' },
      { key: 'site_qq', label: 'QQ', type: 'text' },
      { key: 'site_tel', label: '电话', type: 'text' },
      { key: 'site_address', label: '地址', type: 'text' },
      { key: 'site_status', label: '状态', type: 'select', options: [{ value: 1, label: '开启' }, { value: 0, label: '关闭' }] }
    ]
  }
}

module.exports = { RESOURCES, STATUS_OPTIONS }
