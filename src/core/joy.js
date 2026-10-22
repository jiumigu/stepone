// ============================================================
// joy.js — 记一条快乐（贯穿入口）
//
// 意义：没完成任务的日子也能存点分 —— 奖励「过得好」，不只奖励「做得多」。
// ============================================================

import { getState, commit } from './store.js';
import { uid, nowIso, isoToDay, todayStr } from './util.js';
import { pushTxn, joyPoints, joyBand, REASON } from './points.js';

export function addJoy({ content, score = 3 }) {
  const text = String(content || '').trim();
  const band = joyBand(score);
  const points = joyPoints(band.score);

  const record = {
    id: uid('joy'),
    content: text,
    score: band.score,
    tags: [],
    created_at: nowIso(),
    points_awarded: points,
  };

  commit((s) => {
    s.joy_log.push(record);
    pushTxn(s, {
      delta: points,
      reason_code: REASON.JOY_LOG,
      ref_id: record.id,
      note: text ? `记一条快乐：${text}` : `记一条快乐「${band.label}」`,
    });
  });

  return { record, points };
}

export function joyOfDay(day = todayStr(), s = getState()) {
  return s.joy_log
    .filter((j) => isoToDay(j.created_at) === day)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
