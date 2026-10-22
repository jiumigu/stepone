// ============================================================
// points.js — 唯一账本 + 唯一汇率表
//
// 铁律 2：所有积分变动只能由事件产生，页面没有「手动加分」入口。
// 铁律 4：撤销走冲正流水，永不删除历史。
// 约束 2：余额 = SUM(delta)，不设 balance 字段。
// ============================================================

import { nowIso, uid } from './util.js';

/** 原因码：全站唯一枚举 */
export const REASON = {
  TODO_DONE: 'todo_done',
  MILESTONE_DONE: 'milestone_done',
  GOAL_DONE: 'goal_done',
  JOY_LOG: 'joy_log',
  GIFT_REDEEM: 'gift_redeem',
  REVERT: 'revert',
};

/** 汇率表：整份作品只有这一处定价 */
export const RULE = {
  [REASON.TODO_DONE]: { delta: 2, label: '完成待办', group: 'todo' },
  [REASON.MILESTONE_DONE]: { delta: 10, label: '完成里程碑', group: 'milestone' },
  [REASON.GOAL_DONE]: { delta: 30, label: '完成目标', group: 'milestone' },
  [REASON.JOY_LOG]: { delta: 0, label: '记一条快乐', group: 'joy' },
  [REASON.GIFT_REDEEM]: { delta: 0, label: '兑换礼物', group: 'spend' },
  [REASON.REVERT]: { delta: 0, label: '撤销冲正', group: 'todo' },
};

/** 快乐 5 档：常量只写一处（防止「弹窗说很开心、流水说还行」） */
export const JOY_BANDS = [
  { score: 1, label: '还行', points: 1 },
  { score: 2, label: '有点开心', points: 2 },
  { score: 3, label: '开心', points: 3 },
  { score: 4, label: '很开心', points: 4 },
  { score: 5, label: '今天值了', points: 5 },
];

export function joyBand(score) {
  return JOY_BANDS.find((b) => b.score === Number(score)) || JOY_BANDS[0];
}

export function joyPoints(score) {
  return joyBand(score).points;
}

/** 余额：账本求和（唯一真源） */
export function balance(s) {
  return s.point_txn.reduce((sum, t) => sum + Number(t.delta || 0), 0);
}

/**
 * 写一条流水。唯一计分口 —— 不导出任何「直接改余额」的函数。
 * 必须在 commit(mutator) 内部调用，保证与业务改动同一事务。
 */
export function pushTxn(s, { delta, reason_code, ref_id = null, note = '', at = nowIso() }) {
  const before = balance(s);
  const txn = {
    id: uid('txn'),
    delta: Number(delta),
    reason_code,
    ref_id,
    note,
    balance_before: before,
    balance_after: before + Number(delta),
    created_at: at,
  };
  s.point_txn.push(txn);
  return txn;
}

/** 某 ref 是否已经发过分（用于「每目标只发一次」这类幂等判定） */
export function hasAwarded(s, reason_code, ref_id) {
  return s.point_txn.some((t) => t.reason_code === reason_code && t.ref_id === ref_id && t.delta > 0);
}

/** 流水展示文案 */
export function txnText(t) {
  const sign = t.delta > 0 ? '+' : '';
  return `${sign}${t.delta} ${t.note || RULE[t.reason_code]?.label || t.reason_code}`;
}

export function txnTone(t) {
  return t.delta > 0 ? 'in' : t.delta < 0 ? 'out' : 'zero';
}
