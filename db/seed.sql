-- ============================================================
-- Koa CMS · 初始化数据（可重复执行）
--
-- 重要：routes/index.js 里硬编码了三个分类 ID，种子数据必须沿用它们，
--       否则 /news、/service、/case 三个前台页面会查不到数据：
--         5bdaf166e67d082570b10a21  成功案例
--         5bdaf17fe67d082570b10a22  服务
--         5bdaf18de67d082570b10a23  新闻
-- ============================================================

-- ---------------- 分类 ----------------
INSERT INTO articlecate (_id, title, pid, sort, status) VALUES
  ('5bdaf166e67d082570b10a21', '成功案例', '0', 3, 1),
  ('5bdaf17fe67d082570b10a22', '服务', '0', 2, 1),
  ('5bdaf18de67d082570b10a23', '新闻', '0', 1, 1),
  ('5bdaf166e67d082570b10a31', '家居案例', '5bdaf166e67d082570b10a21', 1, 1),
  ('5bdaf166e67d082570b10a32', '商业空间', '5bdaf166e67d082570b10a21', 2, 1),
  ('5bdaf18de67d082570b10a41', '行业新闻', '5bdaf18de67d082570b10a23', 1, 1),
  ('5bdaf18de67d082570b10a42', '公司动态', '5bdaf18de67d082570b10a23', 2, 1)
ON CONFLICT (_id) DO NOTHING;

-- ---------------- 导航（title 需与一级分类 title 一致，详情页据此高亮） ----------------
INSERT INTO nav (_id, title, url, sort, status) VALUES
  ('5bdaf166e67d082570b10b01', '首页', '/', 1, 1),
  ('5bdaf166e67d082570b10b02', '新闻', '/news', 2, 1),
  ('5bdaf166e67d082570b10b03', '服务', '/service', 3, 1),
  ('5bdaf166e67d082570b10b04', '成功案例', '/case', 4, 1),
  ('5bdaf166e67d082570b10b05', '关于我们', '/about', 5, 1)
ON CONFLICT (_id) DO NOTHING;

-- ---------------- 轮播图 ----------------
INSERT INTO focus (_id, title, pic, url, sort, status) VALUES
  ('5bdaf166e67d082570b10c01', '全屋定制设计', 'upload/1541070437319.jpg', '/case', 1, 1),
  ('5bdaf166e67d082570b10c02', '国际品质工艺', 'upload/1541070470339.jpg', '/case', 2, 1),
  ('5bdaf166e67d082570b10c03', '一站式服务体系', 'upload/1541075782848.png', '/service', 3, 1)
ON CONFLICT (_id) DO NOTHING;

-- ---------------- 友情链接 ----------------
INSERT INTO link (_id, title, pic, url, sort, status) VALUES
  ('5bdaf166e67d082570b10d01', 'Koa 官方文档', 'upload/1541062277900.png', 'https://koajs.com', 1, 1),
  ('5bdaf166e67d082570b10d02', 'PostgreSQL 18', 'upload/1541066171967.png', 'https://www.postgresql.org', 2, 1),
  ('5bdaf166e67d082570b10d03', 'Node.js', 'upload/1541066449025.png', 'https://nodejs.org', 3, 1)
ON CONFLICT (_id) DO NOTHING;

-- ---------------- 文章（新闻 3 条 / 案例 3 条 / 服务 2 条） ----------------
INSERT INTO article (_id, pid, catename, title, author, img_url, keywords, description, content, status, is_best, is_hot, is_new, sort, add_time) VALUES
  ('5bdaf166e67d082570b10e01', '5bdaf18de67d082570b10a41', '行业新闻', 'Koa 3 + PostgreSQL 18 的 CMS 实践', 'admin',
   'upload/1541062277900.png', 'koa,postgresql,cms', '老项目迁移到 PostgreSQL 18 的完整过程记录',
   '<p>从 MongoDB 迁移到 PostgreSQL 18，最大的收益是数据一致性有了保障：</p><ul><li>主键、外键与唯一约束由数据库强制</li><li>事务与连接池开箱即用</li><li>Navicat / psql 直接可视化管理</li></ul><p>数据层封装保持原有 API，业务路由几乎零改动。</p>',
   1, 1, 1, 1, 3, now() - interval '2 day'),

  ('5bdaf166e67d082570b10e02', '5bdaf18de67d082570b10a41', '行业新闻', '为什么老项目也值得做依赖升级', 'admin',
   'upload/1541066171967.png', '依赖升级,安全', '升级到最新稳定版本可以规避已知漏洞',
   '<p>几年前的依赖里，multer 1.x、koa-cors、koa-jsonp 等包都已经停止维护，存在已知安全问题。</p><p>本次升级把上传、跨域、会话、模板、日志全部换到当前维护的版本，并锁定精确版本号。</p>',
   1, 0, 1, 1, 2, now() - interval '5 day'),

  ('5bdaf166e67d082570b10e03', '5bdaf18de67d082570b10a42', '公司动态', '后台管理系统完成数据库改造', 'admin',
   'upload/1541066449025.png', 'cms,后台', '内容管理、分类管理、轮播图与站点设置全部恢复可用',
   '<p>数据库丢失后，本次直接重建了 PostgreSQL 18 的表结构与种子数据。</p><p>后台可以正常登录、发布文章、维护分类、轮播图、导航与站点设置。</p>',
   1, 1, 0, 1, 1, now() - interval '1 day'),

  ('5bdaf166e67d082570b10e04', '5bdaf166e67d082570b10a31', '家居案例', '三居室现代简约方案', '设计部',
   'upload/1541066454842.png', '家居,案例', '130㎡ 三居室现代简约风格设计',
   '<p>项目面积 130㎡，以浅色木质与大面积留白营造通透空间。</p>',
   1, 1, 1, 0, 3, now() - interval '8 day'),

  ('5bdaf166e67d082570b10e05', '5bdaf166e67d082570b10a32', '商业空间', '连锁餐饮门店形象升级', '设计部',
   'upload/1541070437319.jpg', '商业空间,案例', '统一门店形象，提升品牌识别度',
   '<p>通过统一的材质、灯光与标识系统，快速复制到全国门店。</p>',
   1, 0, 1, 0, 2, now() - interval '12 day'),

  ('5bdaf166e67d082570b10e06', '5bdaf166e67d082570b10a31', '家居案例', '小户型收纳改造', '设计部',
   'upload/1541070470339.jpg', '小户型,收纳', '68㎡ 小户型收纳改造实录',
   '<p>利用通顶柜体与隐藏式收纳，把可用空间提升约 30%。</p>',
   1, 1, 0, 1, 1, now() - interval '15 day'),

  ('5bdaf166e67d082570b10e07', '5bdaf17fe67d082570b10a22', '服务', '全案设计服务', 'admin',
   'upload/1541075782848.png', '全案设计,服务', '从现场测量到落地交付的完整服务',
   '<p>服务内容包含：现场测量、方案设计、主材选购、施工跟踪、竣工验收。</p>',
   1, 1, 1, 1, 2, now() - interval '20 day'),

  ('5bdaf166e67d082570b10e08', '5bdaf17fe67d082570b10a22', '服务', '软装陈设服务', 'admin',
   'upload/1541075839440.png', '软装,服务', '家具、灯具、布艺、饰品的整体搭配',
   '<p>依据空间气质与使用习惯，完成家具、灯具、布艺与饰品的整体搭配。</p>',
   1, 0, 0, 1, 1, now() - interval '25 day')
ON CONFLICT (_id) DO NOTHING;

-- ---------------- 站点设置（单行） ----------------
INSERT INTO setting (_id, site_title, site_url, site_logo, site_keywords, site_description,
                     site_icp, site_qq, site_tel, site_address, site_status)
VALUES ('setting', 'Koa CMS 内容管理系统', 'http://localhost:3000', 'upload/1541062277900.png',
        'koa,cms,postgresql,内容管理', '基于 Koa 3 与 PostgreSQL 18 的轻量内容管理系统',
        '沪ICP备00000000号', '89898981', '15918779820', '上海市沙河广园东路1858号', 1)
ON CONFLICT (_id) DO NOTHING;

-- ---------------- 管理员 ----------------
-- 默认账号：admin / 123456   （密码为 bcrypt 哈希，登录后请立即修改）
INSERT INTO admin (_id, username, password, status, lasttime)
VALUES ('5bdaf166e67d082570b10f01', 'admin', '$2b$10$4TRXi.k0ZvP8/IyWfRXf3.5uRhNmtmZLSmdQSe1ntCK/5sXygArGq', 1, NULL)
ON CONFLICT (username) DO NOTHING;
