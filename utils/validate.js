// utils/validate.js
// ============================================================
// 输入校验层：基于 zod 的 schema 驱动校验
// 教学点：
//   1) 声明式 schema 同时完成"类型转换 + 校验 + 友好报错"，
//      取代散落在各路由里的手写正则（易漏、难维护）。
//   2) parse 失败会抛 ZodError，由全局错误处理中间件捕获并
//      转成 { code: PARAM_ERROR, message, data: 字段错误 }。
// 注意：本文件 require('zod')，需先 `pnpm add zod`。
// ============================================================
const { z } = require('zod');
const code = require('./code');

// 通用片段：id 既可能是路由参数字符串，也可能是 body 数字，
// 用 coerce 自动转 number，避免 "1" !== 1 的坑。
const idSchema = z.coerce.number().int().positive('id 必须是正整数');

// 分页参数（列表接口复用）
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

/**
 * 校验入口：成功返回解析后的数据（类型已转换），失败抛"带 .code 的干净错误"
 * @param {z.ZodType} schema
 * @param {*} data
 *
 * 教学点：zod 校验失败默认抛 ZodError，其 message 是多行 JSON（含 issues 数组），
 * 直接返回给前端既丑又不统一。这里统一转成：
 *   - e.code = code.PARAM_ERROR（1001），让路由 handle 映射到 HTTP 400 + {code:1001}
 *   - e.message = 各字段中文报错用 "；" 拼接（如 "密码至少 6 位；用户名至少 2 位"）
 *   - e.details = 原始 issues（可选，供前端按字段高亮）
 * 这样上层 handle 无需感知 zod，统一 fail 出参。
 */
function parse(schema, data) {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const e = new Error(err.issues.map(i => i.message).join('；'));
      e.code = code.PARAM_ERROR;
      e.details = err.issues;
      throw e;
    }
    throw err;
  }
}

/**
 * SSR 表单校验中间件（把 zod 从"只用于 JSON API"扩展到后台老表单）
 *
 * 设计取舍：后台 SSR 路由的 handler 里到处是 `ctx.req.body.title` 这类读取，
 * 若改成 `const { title } = parse(...)` 要动每个 handler 的正文（13 处，改动面大、易出错）。
 * 这里换个思路：**做成中间件**——校验通过就把"已转换的值"合并回 body，
 * handler 一行都不用改；校验失败则渲染错误页并中断（不会继续写库）。
 *
 * 顺带解决一个老问题：后台表单提交的都是字符串（如 status='1'），
 * 经 zod 的 z.coerce.number() 转换后再入库，类型才正确。
 *
 * @param {import('zod').ZodType} schema
 * @param {string|((ctx)=>string)} backPath 校验失败时"返回重填"的页面路径（可传函数，便于带 id）
 */
function validatePageBody (schema, backPath) {
  return async (ctx, next) => {
    try {
      const parsed = schema.parse(ctx.request.body || {})
      // 合并回两个位置：@koa/multer 会把 body 放在 ctx.request.body，
      // 而老代码读的是 ctx.req.body（tools.multer 里做了桥接），两边都要更新。
      // 注意顺序：原 body 在前、parsed 在后 → 未知字段（id/prevPage 等）不会被丢掉。
      ctx.request.body = { ...ctx.request.body, ...parsed }
      if (ctx.req && ctx.req.body) ctx.req.body = { ...ctx.req.body, ...parsed }
      return next()
    } catch (err) {
      if (err instanceof z.ZodError) {
        const back = typeof backPath === 'function' ? backPath(ctx) : backPath
        ctx.status = 400
        await ctx.render('admin/error', {
          message: err.issues.map((i) => i.message).join('；'),
          redirect: (ctx.state.__HOST__ || '') + (back || '/admin')
        })
        return
      }
      throw err
    }
  }
}

module.exports = { z, idSchema, pageSchema, parse, validatePageBody };
