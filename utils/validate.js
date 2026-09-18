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

// 通用片段：id 既可能是路由参数字符串，也可能是 body 数字，
// 用 coerce 自动转 number，避免 "1" !== 1 的坑。
const idSchema = z.coerce.number().int().positive('id 必须是正整数');

// 分页参数（列表接口复用）
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

/**
 * 校验入口：成功返回解析后的数据（类型已转换），失败抛 ZodError
 * @param {z.ZodType} schema
 * @param {*} data
 */
function parse(schema, data) {
  return schema.parse(data);
}

module.exports = { z, idSchema, pageSchema, parse };
