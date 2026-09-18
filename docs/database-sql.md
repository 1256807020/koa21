# koa21 CMS · 数据库表关联与 SQL 实战

> 面向"会用 TypeORM / Prisma 但 SQL 内功偏弱"的前端转全栈同学。
> 本文所有示例基于本项目**真实表结构**（`db/schema.sql`）与种子数据（`db/seed.sql`），
> 可在 `psql -p 5433 -d koa_cms`（账号 `postgres` / `postgres`）中直接运行。
>
> 核心认知：ORM（TypeORM / Prisma / Sequelize）本质是"把 JS 对象翻译成 SQL"，
> 你之前"感觉没学到 SQL"是因为 SQL 被藏在 ORM 背后了。本文帮你把 SQL 翻出来。

---

## 1. 表之间到底怎么关联（无外键，逻辑关联）

一句话结论：**本项目没有任何物理外键（`FOREIGN KEY`），全是"逻辑关联"**——
也就是"两个表靠某个字段的值相等来对应"。看 `db/schema.sql`，每张表只有
`_id PRIMARY KEY DEFAULT gen_oid()`，没有任何 `REFERENCES`。这是从 MongoDB 迁过来的痕迹
（Mongo 本来就用 `_id` 引用，没有 FK 概念）。

实际关联只有两类：

| 关系 | 怎么连的 | 类型 |
|---|---|---|
| `articlecate` 自己连自己 | `articlecate.pid = articlecate._id` | **自引用**（两级分类） |
| `article` → `articlecate` | `article.pid = articlecate._id` | **一对多**（一个分类多篇文章） |
| `nav` / `focus` / `link` / `admin` / `setting` | —— | 各自独立，互不关联 |

关系图：

```
articlecate (父, pid='0')
   ├─ articlecate (子, pid=父_id)  ──┐
   │                                 │ 一对多
   └─ articlecate (子)  ─────────────┤
                                     ↓
                              article (pid=子分类_id)
```

`article.pid` 指向的是**子分类**的 `_id`（见 `seed.sql`：`文章 e04` 的
`pid='5bdaf166e67d082570b10a31'` 是"家居案例"，而"家居案例"的 `pid` 又指向"成功案例"）。
这是典型的**两层分类树**。

---

## 2. 关系模型三件套（用本项目对号入座）

### 2.1 一对多（最常见）
`articlecate → article`。一个分类下有多篇文章，每篇文章只属于一个分类。
SQL 里用"多"的那张表（`article`）存一个关联字段（`pid`）指向"一"的那张表（`articlecate`）的主键。

### 2.2 自引用
`articlecate` 自己连自己，表达"层级/树"。父和子在同一张表里，靠 `pid` 区分（`pid='0'` 表示一级）。

### 2.3 多对多（本项目没有，但必须知道）
例：**文章 ↔ 标签**——一篇文章多个标签、一个标签多篇文章。
这种关系**无法直接用一张表的一个字段表达**，SQL 里必须建一张**中间表（junction table）**拆开：

```sql
-- 标签表
CREATE TABLE tag (
  _id  text PRIMARY KEY DEFAULT gen_oid(),
  name varchar(50) NOT NULL UNIQUE
);

-- 中间表：两个外键（本项目为逻辑关联，无 FK 约束）
CREATE TABLE article_tag (
  article_id text NOT NULL,
  tag_id     text NOT NULL,
  PRIMARY KEY (article_id, tag_id)   -- 联合主键，防止重复关联
);
```

插入示例数据：

```sql
INSERT INTO tag (_id, name) VALUES
  ('tag01','koa'), ('tag02','postgresql'), ('tag03','cms');

INSERT INTO article_tag (article_id, tag_id) VALUES
  ('5bdaf166e67d082570b10e01','tag01'),
  ('5bdaf166e67d082570b10e01','tag02'),
  ('5bdaf166e67d082570b10e02','tag01');
```

**多对多查询**（本质是把"两个一对多"拼起来）：

```sql
-- 查某篇文章的所有标签
SELECT t.name
FROM tag t
JOIN article_tag at ON at.tag_id = t._id
WHERE at.article_id = '5bdaf166e67d082570b10e01';

-- 查带某标签（如 'koa'）的所有文章
SELECT a.title
FROM article a
JOIN article_tag at ON at.article_id = a._id
JOIN tag t         ON t._id = at.tag_id
WHERE t.name = 'koa';

-- 统计每个标签下有多少篇文章（三表 JOIN + 聚合）
SELECT t.name, COUNT(at.article_id) AS 文章数
FROM tag t
LEFT JOIN article_tag at ON at.tag_id = t._id
GROUP BY t._id, t.name
ORDER BY 文章数 DESC;
```

> 记法：**多对多 = 拆成两个一对多 + 一张中间表**。你现在的 `link`、`focus` 是独立表，
> 所以没用到中间表；一旦出现"互相关联"的需求（标签、角色-权限、用户-用户组），就要上中间表。

---

## 3. 核心 SQL（基础，每条都能在库里跑）

连库：`psql -p 5433 -d koa_cms`

**3.1 最基础的查询**（对应路由里 `DB.find('article', {status:1})`）
```sql
SELECT _id, title, pid, status
FROM article
WHERE status = 1
ORDER BY add_time DESC
LIMIT 5;
```

**3.2 JOIN：文章 + 分类名**（ORM 里 `relations:['category']` 干的事）
```sql
SELECT a.title AS 文章, c.title AS 分类
FROM article a
LEFT JOIN articlecate c ON a.pid = c._id   -- 连接条件
ORDER BY a.add_time DESC
LIMIT 10;
```
- `LEFT JOIN`：即使文章没对应分类（孤儿），文章行也保留（分类名 NULL）。
- `INNER JOIN`：只保留两边都能对上的行，孤儿文章直接不出现。

**3.3 自连接：两级分类树**
```sql
SELECT p.title AS 一级, s.title AS 二级
FROM articlecate p
JOIN articlecate s ON s.pid = p._id
WHERE p.pid = '0'
ORDER BY p.sort, s.sort;
```

**3.4 聚合 GROUP BY：每类文章数**
```sql
SELECT c.title AS 分类, COUNT(a._id) AS 文章数
FROM articlecate c
LEFT JOIN article a ON a.pid = c._id
GROUP BY c._id, c.title
ORDER BY 文章数 DESC;
```

**3.5 子查询 IN**（对应代码 `{ pid: { $in: ids } }`）
```sql
SELECT a.title
FROM article a
WHERE a.pid IN (
  SELECT _id FROM articlecate WHERE title IN ('行业新闻','公司动态')
);
```

**3.6 索引与 EXPLAIN**
```sql
-- schema.sql 已建：CREATE INDEX idx_article_pid ON article (pid);
-- 没有索引 PG 会全表扫描；加索引走 B-Tree 直接定位
EXPLAIN ANALYZE SELECT * FROM article WHERE pid = '5bdaf166e67d082570b10a31';
```

---

## 4. 本项目常用的实战 SQL（重点）

### 4.1 分页查询
```sql
SELECT _id, title FROM article
WHERE status = 1
ORDER BY add_time DESC
LIMIT 10 OFFSET 0;     -- 第 2 页：OFFSET 10；第 N 页：OFFSET (N-1)*10
```

### 4.2 模糊搜索（`ILIKE` 不区分大小写）
```sql
SELECT title FROM article
WHERE title ILIKE '%koa%' OR keywords ILIKE '%koa%';
```

### 4.3 软删除 / 状态过滤（本项目用 `status` 而非真删除）
```sql
SELECT * FROM article WHERE status = 0;            -- 查已下架
UPDATE article SET status = 0 WHERE _id = '...';   -- 下架（软删）
```

### 4.4 开关切换（后台 `onclick toggle` 启停，如 focus/link）
```sql
UPDATE focus SET status = 1 - status WHERE _id = '...';   -- 0/1 互转
```

### 4.5 树形分类（递归 CTE，`WITH RECURSIVE`）
```sql
WITH RECURSIVE tree AS (
  SELECT _id, title, pid, 0 AS depth FROM articlecate WHERE pid = '0'
  UNION ALL
  SELECT c._id, c.title, c.pid, t.depth + 1
  FROM articlecate c JOIN tree t ON c.pid = t._id
)
SELECT * FROM tree ORDER BY depth, sort;
```

### 4.6 统计报表
```sql
-- 状态分布
SELECT status, COUNT(*) FROM article GROUP BY status;
-- 近 7 天每天新增文章数
SELECT date_trunc('day', add_time) AS 天, COUNT(*) AS 新增
FROM article WHERE add_time >= now() - interval '7 day'
GROUP BY 1 ORDER BY 1;
```

### 4.7 联表更新（分类改名，同步冗余字段 `catename`）
```sql
UPDATE article SET catename = '新分类名'
WHERE pid IN (SELECT _id FROM articlecate WHERE title = '旧分类名');
```
> 体现"冗余字段"的代价：分类改名时要同步，否则文章显示的还是旧名。

### 4.8 关联删除（删分类时如何处理其文章）
```sql
-- 方案 A（本项目做法，无 FK）：先把文章置为孤儿，再删分类
UPDATE article SET pid = NULL WHERE pid = '待删分类id';
DELETE FROM articlecate WHERE _id = '待删分类id';

-- 方案 B（有 FK + ON DELETE CASCADE）：直接删分类，文章自动跟着删
--   ALTER TABLE article ADD FOREIGN KEY (pid) REFERENCES articlecate(_id) ON DELETE CASCADE;
--   DELETE FROM articlecate WHERE _id = '待删分类id';
```

### 4.9 时间范围
```sql
SELECT title FROM article WHERE add_time >= current_date;            -- 今天
SELECT title FROM article WHERE add_time >= now() - interval '7 day'; -- 近 7 天
```

### 4.10 事务（多步操作原子化）
```sql
BEGIN;
UPDATE article    SET status = 0 WHERE _id = '...';
UPDATE articlecate SET status = 0 WHERE _id = '...';
COMMIT;   -- 任一步失败则 ROLLBACK; 保证要么都成功要么都回滚
```

### 4.11 性能分析
```sql
EXPLAIN ANALYZE
SELECT a.title, c.title
FROM article a LEFT JOIN articlecate c ON a.pid = c._id
WHERE a.status = 1 ORDER BY a.add_time DESC LIMIT 10;
```
看输出里有没有 `Seq Scan`（全表扫描，慢）→ 给 `WHERE`/`JOIN` 字段加索引。

---

## 5. ORM 写法 ↔ 真实 SQL 对照

你项目里的 `DB.find` 就是个"迷你 ORM"，它背后生成的 SQL：

| 你写的（Mongo 风格） | 真实 SQL |
|---|---|
| `DB.find('article', {pid:'xxx'})` | `SELECT * FROM article WHERE pid = 'xxx'` |
| `DB.find('article', {pid:{$in:ids}})` | `WHERE pid IN ('a','b')` |
| `DB.find('article', {status:1, title:{$like:'%koa%'}})` | `WHERE status = 1 AND title ILIKE '%koa%'` |
| `DB.find('article', {}, null, {page:1,pageSize:10,sortJson:{add_time:-1}})` | `... ORDER BY add_time DESC LIMIT 10 OFFSET 0` |

TypeORM / Prisma 同理：
- TypeORM：`articleRepo.find({ relations: ['cate'] })` → 生成 `SELECT ... FROM article a LEFT JOIN articlecate c ON a.pid=c._id`
- Prisma：`prisma.article.findMany({ include: { cate: true } })` → 同样生成一条 `LEFT JOIN`
- 多对多：`relations:['tags']` / `include:{ tags:true }` → 自动 `JOIN article_tag JOIN tag`

**把 ORM 生成的 SQL 打出来看**（这是学 SQL 的最佳捷径）：
```js
// TypeORM
createConnection({ logging: true })
// Prisma
new PrismaClient({ log: [{ emit: 'stdout', level: 'query' }] })
```
然后把打印出的 SQL 复制到 `psql` 里加 `EXPLAIN` 跑一遍，就知道它干了什么、慢在哪。
本项目 `model/mongo-sql.js` 就是个**手搓 ORM 翻译器**——`buildWhere()` 把
`{status:1, pid:{$in:ids}}` 翻译成 `status = $1 AND pid IN ($2,$3)`，`addParam()` 生成
`$1 $2` 占位符（参数化防注入）。读这个文件比看教程直观。

---

## 6. 架构师解惑：外键 vs 无外键 / ORM vs 手写 SQL

### 6.1 到底要不要外键？
**两种都正确，只是场景不同，没有"谁对谁错"。**

- **用外键**：数据完整性由数据库强制（删分类时若还有文章，DB 直接拒绝或级联删）。
  适合传统企业系统、小项目、强一致场景。
  - 代价：每次写操作 DB 要校验约束（性能开销）；分库分表 / 数据迁移时会锁表、很难搞；
    级联删除容易"误删一片"。
- **不用外键（你这个项目）**：互联网 / 高并发系统常用。灵活、写性能好、关联由应用层控制。
  - 代价：可能出现**孤儿数据**（文章 `pid` 指向已删分类），需应用层兜底。
- **为什么你学的 TypeORM/Prisma 几乎都生成外键？** 因为它们面向"规范关系建模"，
  默认帮你把 `@ManyToOne` 翻译成 `FOREIGN KEY`。你项目没外键，是因为它从 MongoDB 迁来，
  Mongo 根本没有 FK 概念，迁移时保持了"逻辑关联"风格。
- **建议**：学习阶段用外键把"关系约束"的概念吃透；真实生产按团队规范与性能取舍决定。

### 6.2 ORM 和手写 SQL，谁对谁好？
**都不是错，是分工。**

- **ORM 的价值**：开发效率高、跨数据库、防 SQL 注入、建模直观（用类表达表）。
  代价：复杂查询生成的 SQL 不一定最优；有"抽象泄漏"——典型的 **N+1 问题**
  （循环文章、每篇再查一次分类 = 1 + N 条 SQL，应该用一次 `JOIN` 解决）。
- **手写 SQL 的价值**：精确控制、复杂报表 / 批量 / 性能优化时的唯一解。
  代价：重复劳动、易错、绑定具体数据库方言。
- **"真实后端都手写 SQL"是误解**：很多后端也用 ORM / Query Builder
  （Laravel Eloquent、Django ORM、Sequelize、SQLAlchemy）。他们遇到报表、批量、性能瓶颈时，
  才切回原生 SQL 或 Query Builder。大佬们"直接看库写 SQL"，是因为他们**先懂 SQL 才用 ORM**；
  你路径相反（先 ORM 后补 SQL），起点不同，终点一样。

### 6.3 前端转全栈的你，现在在哪、往哪走？
- **你已经会的**（别低估）：用 ORM 设计 RBAC、定义关联、把业务跑通——这是**数据建模能力**，
  非常核心。你能用 Prisma 写出"用户-角色-权限"的关联 schema，说明建模思维已经到位。
- **差距在"SQL 内功"**：JOIN / 子查询 / 索引 / EXPLAIN / 事务 / 并发。这些 OM 帮你藏起来了。
- **学习路径（两条腿走路）**：
  1. ORM 跑通业务（你已会）
  2. 打开 ORM `logging: true`，把生成的 SQL 当教材（本项目 `mongo-sql.js` 也是现成教材）
  3. 学基础 SQL：`SELECT / WHERE / ORDER BY / LIMIT / JOIN / GROUP BY / 子查询 / 索引`
  4. 学 `EXPLAIN` 与优化（消灭全表扫描、N+1）
  5. 学事务与并发（`BEGIN/COMMIT`、乐观锁 `UPDATE ... WHERE version=?`）
  6. 复杂报表 / 批量操作用手写 SQL
- **结论**：用 ORM 没错，**但"只会 ORM 不懂 SQL"会在优化和排错时卡住**。目标不是抛弃 ORM，
  而是"能用 ORM 高效开发，也能在需要时手写精准 SQL"。你现在的困惑，正是从"会用工具"
  走向"懂原理"的临界点——跨过去就是全栈。

---

## 7. 练习（全部可在 `psql -p 5433 -d koa_cms` 直接跑）

```sql
-- 1. 查"成功案例"下的所有文章
SELECT title FROM article WHERE pid = '5bdaf166e67d082570b10a21';

-- 2. 每个分类各有多少篇文章（含 0）
SELECT c.title, COUNT(a._id) AS n
FROM articlecate c LEFT JOIN article a ON a.pid=c._id
GROUP BY c._id, c.title ORDER BY n DESC;

-- 3. 两级分类树
SELECT p.title 一级, s.title 二级
FROM articlecate p JOIN articlecate s ON s.pid=p._id
WHERE p.pid='0' ORDER BY p.sort, s.sort;

-- 4. 标题含 "Koa" 的文章
SELECT title FROM article WHERE title ILIKE '%koa%';

-- 5. 最新 5 篇文章 + 分类名（JOIN 实战）
SELECT a.title, c.title AS 分类
FROM article a LEFT JOIN articlecate c ON a.pid=c._id
ORDER BY a.add_time DESC LIMIT 5;

-- 6. 文章状态分布
SELECT status, COUNT(*) FROM article GROUP BY status;

-- 7. 近 7 天新增文章
SELECT title FROM article WHERE add_time >= now() - interval '7 day';

-- 8. 分页取第 2 页（每页 10）
SELECT title FROM article ORDER BY add_time DESC LIMIT 10 OFFSET 10;

-- 9. 把某篇文章下架（软删）
UPDATE article SET status = 0 WHERE _id = '5bdaf166e67d082570b10e01';

-- 10. 用 EXPLAIN 看 pid 查询是否走索引
EXPLAIN ANALYZE SELECT * FROM article WHERE pid = '5bdaf166e67d082570b10a31';
```

跑完这 10 条，`SELECT / WHERE / ORDER BY / LIMIT / JOIN / GROUP BY / 子查询 / 索引 / 事务`
就都摸过了。后面再补 `窗口函数`（如 `ROW_NUMBER()` 排名）、`CTE`、多对多，就是水到渠成。
