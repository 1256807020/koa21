'use strict'
// utils/site.js
// ============================================================
// 站点设置的「契约形状」—— 前台与新后台共用
//
// 为什么要抽出来：
//   数据库里字段叫 site_title / site_logo ...，直接把原始行丢给模板有两个问题：
//   ① 模板里要写 {{ site.site_title }}，重复且难看（site 已经是命名空间了）；
//   ② 一旦把整行丢进去，将来表加列就会**顺带泄露**不该给模板的字段。
//   统一转成 { title, logo, url, ... } 后，模板只认契约、不认表结构。
// ============================================================

/**
 * 站点设置行 → 契约对象
 * @param {object} row setting 表的一行（可能为空）
 */
function toSite (row = {}) {
  return {
    title: row.site_title || '',
    logo: row.site_logo || '',
    url: row.site_url || '',
    keywords: row.site_keywords || '',
    description: row.site_description || '',
    icp: row.site_icp || '',
    qq: row.site_qq || '',
    tel: row.site_tel || '',
    address: row.site_address || '',
    status: row.site_status === undefined ? 1 : row.site_status
  }
}

module.exports = { toSite }
