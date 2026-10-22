// ============================================================
// util.js — 纯函数工具层（无副作用、无依赖）
// 铁律 9：所有「今天」的判断只走 todayStr()，用本地日期字符串比较
// ============================================================

const pad2 = (n) => String(n).padStart(2, '0');

/** Date -> 'YYYY-MM-DD'（本地时区，绝不使用 toISOString） */
export function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 唯一的「今天」入口 */
export function todayStr() {
  return toDateStr(new Date());
}

/** 'YYYY-MM-DD' -> 本地 0 点的 Date */
export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

export function addMonths(s, n) {
  const d = parseDate(s);
  d.setMonth(d.getMonth() + n);
  return toDateStr(d);
}

/** to - from，单位天 */
export function diffDays(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

/** ISO 时间戳 -> 本地日期字符串 */
export function isoToDay(iso) {
  if (!iso) return null;
  return toDateStr(new Date(iso));
}

export function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function fmtDay(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 跨年时补上年份，避免「9月12日 — 8月18日」这类歧义 */
export function fmtDaySmart(s) {
  const d = parseDate(s);
  if (d.getFullYear() !== new Date().getFullYear()) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  return fmtDay(s);
}

export function fmtWeekday(s) {
  return WEEKDAYS[parseDate(s).getDay()];
}

export function fmtShort(s) {
  const d = parseDate(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** ISO 时间戳 -> 'HH:MM' */
export function toTimeStr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 相对今天的口语化表达 */
export function relDay(s) {
  const n = diffDays(todayStr(), s);
  if (n === 0) return '今天';
  if (n === 1) return '明天';
  if (n === -1) return '昨天';
  if (n > 0) return `还有 ${n} 天`;
  return `已逾期 ${-n} 天`;
}

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** 数字三态：有值给值 / 0 给 0 / 无数据给 '—' */
export function numOrDash(v, dash = '—') {
  return v === null || v === undefined || Number.isNaN(v) ? dash : String(v);
}
