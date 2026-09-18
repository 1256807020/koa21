-- ============================================================
-- Koa CMS · PostgreSQL 18 表结构
-- 说明：主键沿用 _id（text，24 位十六进制），
--       让原模板里的 {{$value._id}} 与 DB.getObjectId() 继续可用
-- 本脚本可重复执行（幂等）
-- ============================================================

-- 生成 24 位十六进制主键，形态与 MongoDB ObjectId 一致
CREATE OR REPLACE FUNCTION gen_oid() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 24);
$$;

-- ---------------- 管理员 ----------------
CREATE TABLE IF NOT EXISTS admin (
  _id        text PRIMARY KEY DEFAULT gen_oid(),
  username   varchar(50)  NOT NULL UNIQUE,
  password   varchar(100) NOT NULL DEFAULT '',    -- bcrypt 哈希（60 字符），兼容历史 md5(32)
  status     smallint     NOT NULL DEFAULT 1,
  lasttime   timestamptz,
  add_time   timestamptz  NOT NULL DEFAULT now()
);

-- ---------------- 文章分类（两级，pid='0' 为一级） ----------------
CREATE TABLE IF NOT EXISTS articlecate (
  _id         text PRIMARY KEY DEFAULT gen_oid(),
  title       varchar(100) NOT NULL,
  pid         text         NOT NULL DEFAULT '0',
  keywords    varchar(255),
  description text,
  status      smallint     NOT NULL DEFAULT 1,
  sort        integer      NOT NULL DEFAULT 0,
  add_time    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_articlecate_pid ON articlecate (pid);

-- ---------------- 文章 ----------------
CREATE TABLE IF NOT EXISTS article (
  _id         text PRIMARY KEY DEFAULT gen_oid(),
  pid         text,                                -- 所属分类 _id
  catename    varchar(100),                        -- 冗余的分类名，列表直接显示
  title       varchar(255) NOT NULL,
  author      varchar(50),
  img_url     varchar(255),                        -- 相对 public 目录，如 upload/xxx.png
  content     text,
  keywords    varchar(255),
  description text,
  status      smallint     NOT NULL DEFAULT 1,
  is_best     smallint     NOT NULL DEFAULT 0,
  is_hot      smallint     NOT NULL DEFAULT 0,
  is_new      smallint     NOT NULL DEFAULT 0,
  sort        integer      NOT NULL DEFAULT 0,
  add_time    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_article_pid      ON article (pid);
CREATE INDEX IF NOT EXISTS idx_article_status   ON article (status);
CREATE INDEX IF NOT EXISTS idx_article_add_time ON article (add_time DESC);

-- ---------------- 导航 ----------------
CREATE TABLE IF NOT EXISTS nav (
  _id       text PRIMARY KEY DEFAULT gen_oid(),
  title     varchar(100) NOT NULL,
  url       varchar(255) NOT NULL DEFAULT '/',
  sort      integer      NOT NULL DEFAULT 0,
  status    smallint     NOT NULL DEFAULT 1,
  add_time  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nav_status_sort ON nav (status, sort);

-- ---------------- 轮播图 ----------------
CREATE TABLE IF NOT EXISTS focus (
  _id       text PRIMARY KEY DEFAULT gen_oid(),
  title     varchar(100),
  pic       varchar(255),
  url       varchar(255),
  sort      integer      NOT NULL DEFAULT 0,
  status    smallint     NOT NULL DEFAULT 1,
  add_time  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_focus_status_sort ON focus (status, sort);

-- ---------------- 友情链接 ----------------
CREATE TABLE IF NOT EXISTS link (
  _id       text PRIMARY KEY DEFAULT gen_oid(),
  title     varchar(100),
  pic       varchar(255),
  url       varchar(255),
  sort      integer      NOT NULL DEFAULT 0,
  status    smallint     NOT NULL DEFAULT 1,
  add_time  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_link_status_sort ON link (status, sort);

-- ---------------- 站点设置（单行表，_id 固定为 'setting'） ----------------
CREATE TABLE IF NOT EXISTS setting (
  _id             text PRIMARY KEY DEFAULT 'setting',
  site_title      varchar(255),
  site_url        varchar(255),
  site_logo       varchar(255),
  site_keywords   varchar(255),
  site_description text,
  site_icp        varchar(100),
  site_qq         varchar(50),
  site_tel        varchar(50),
  site_address    varchar(255),
  site_status     smallint     NOT NULL DEFAULT 1,
  add_time        timestamptz  NOT NULL DEFAULT now()
);

-- ---------------- RBAC：角色（P1） ----------------
-- 设计取舍：一个管理员一个角色（admin.role_id），够 CMS 用且实现清晰；
-- 若将来要"一人多角色"，只需把 admin.role_id 换成 admin_role 中间表（多对多），其余代码不变。
CREATE TABLE IF NOT EXISTS role (
  _id         text PRIMARY KEY DEFAULT gen_oid(),
  code        varchar(50)  NOT NULL UNIQUE,   -- 角色标识，代码里用它判断，如 super_admin
  name        varchar(50)  NOT NULL,          -- 角色名，界面上显示，如 超级管理员
  description varchar(255),
  status      smallint     NOT NULL DEFAULT 1,
  add_time    timestamptz  NOT NULL DEFAULT now()
);

-- ---------------- RBAC：权限点（P1） ----------------
-- 权限点命名统一为 "资源:动作"（如 article:delete），便于中间件直接拼串校验。
-- 注意列名用 grp 而不是 group —— group 是 SQL 保留字，直接写会报语法错误。
CREATE TABLE IF NOT EXISTS permission (
  _id      text PRIMARY KEY DEFAULT gen_oid(),
  code     varchar(80) NOT NULL UNIQUE,          -- 权限点，如 article:create
  name     varchar(80) NOT NULL,                 -- 中文名，如 新增文章
  grp      varchar(50) NOT NULL DEFAULT 'default', -- 分组（前端按组渲染权限树）
  sort     integer     NOT NULL DEFAULT 0,
  add_time timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_permission_grp ON permission (grp, sort);

-- ---------------- RBAC：角色-权限（多对多） ----------------
-- ⚠️ 教学点：这里**故意不加物理外键**，与项目其他表保持一致（Mongo 迁移遗留的"逻辑关联"风格）。
-- 代价是删除角色时数据库不会帮你清理关联行，必须自己在事务里先删 role_permission 再删 role ——
-- 这正是"有外键 vs 无外键"最直观的对比场景（见 docs/database-sql.md 与 services/rbacService.removeRole）。
CREATE TABLE IF NOT EXISTS role_permission (
  _id           text PRIMARY KEY DEFAULT gen_oid(),
  role_id       text NOT NULL,
  permission_id text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permission ON role_permission (role_id, permission_id);
CREATE INDEX IF NOT EXISTS idx_role_permission_role ON role_permission (role_id);

-- ---------------- 操作审计日志（P1） ----------------
CREATE TABLE IF NOT EXISTS audit_log (
  _id         text PRIMARY KEY DEFAULT gen_oid(),
  admin_id    text,
  admin_name  varchar(50),
  action      varchar(20)  NOT NULL,        -- create / update / delete / other
  resource    varchar(50),                  -- 资源名，如 article
  resource_id text,                         -- 目标记录 _id
  method      varchar(10),                  -- HTTP 方法
  path        varchar(255),                 -- 请求路径（查问题时最好用）
  status      smallint     NOT NULL DEFAULT 200,
  ip          varchar(64),
  detail      jsonb,                        -- 变更内容快照（已脱敏，password 类字段不入库）
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created  ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin    ON audit_log (admin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_log (resource, resource_id);

-- ---------------- 审计归档冷表 ----------------
-- 热表审计日志只增不减，长期跑会把表撑到几十上百万行（查询变慢、备份变重）。
-- 归档策略：近期（默认 90 天）留 audit_log，过期行搬到这里（见 scripts/audit-archive.js）。
-- 结构上刻意"不带索引地照抄字段"，只额外加 archived_at 标记归档时间：
--   - 冷表查询频率极低，索引只会拖慢写入；
--   - 冷表不再要求 _id 唯一（原来不同批次归档可能产生重复 _id，这里改用代理主键）。
CREATE TABLE IF NOT EXISTS audit_log_archive (
  id          bigserial PRIMARY KEY,
  admin_id    text,
  admin_name  varchar(50),
  action      varchar(20),
  resource    varchar(50),
  resource_id text,
  method      varchar(10),
  path        varchar(255),
  status      smallint,
  ip          varchar(64),
  detail      jsonb,
  created_at  timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_archive_created ON audit_log_archive (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_archive_archived ON audit_log_archive (archived_at DESC);

-- ---------------- 管理员表补充 role_id（RBAC） ----------------
-- 已有库不会因为 CREATE TABLE IF NOT EXISTS 而新增列，所以这里显式 ALTER（幂等）
ALTER TABLE admin ADD COLUMN IF NOT EXISTS role_id text;
CREATE INDEX IF NOT EXISTS idx_admin_role ON admin (role_id);
