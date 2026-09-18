// utils/response.js
// ============================================================
// 统一 API 响应体：{ code, message, data }
// 约定：
//   code = 0     成功
//   code > 0     业务错误（见 utils/code.js 错误码表）
//   code < 0     系统/保留
// 教学点：所有 JSON API 都通过这里出参，前端只判 code，无需关心
//         HTTP 200/500 的细节差异（但 fail 仍允许覆盖 HTTP status，
//         例如未登录返回 401，符合 REST 语义）。
// ============================================================

/**
 * 成功响应
 * @param {Koa.Context} ctx
 * @param {*} [data] 业务数据
 * @param {string} [message] 提示语
 */
function ok(ctx, data = null, message = 'success') {
  ctx.body = { code: 0, message, data };
}

/**
 * 失败响应
 * @param {Koa.Context} ctx
 * @param {number} code 业务错误码（见 utils/code.js）
 * @param {string} message 错误信息
 * @param {*} [data] 附加数据（如字段级错误）
 * @param {number} [status] HTTP 状态码，默认 200（业务错误也走 200，由 code 区分）
 */
function fail(ctx, code, message, data = null, status = 200) {
  ctx.status = status;
  ctx.body = { code, message, data };
}

module.exports = { ok, fail };
