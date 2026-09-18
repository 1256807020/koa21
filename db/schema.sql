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
