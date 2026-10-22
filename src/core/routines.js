// ============================================================
// routines.js — 重复任务（「每天要做的」）
//
// 设计判断（与产品立场一致）：
//  1) 只补今天，不补历史。App 关了三天再打开，只出现今天这一条，
//     不会一次性冒出三条逾期红字 —— 那是最典型的「惩罚」。
//     代价：那三天的日历格子是空的。这是刻意的，不是 bug。
//  2) 生成是幂等的：同一 routine 同一天最多一条 todo（按 routine_id + plan_date 判重），
//     反复启动、跨过午夜、多标签页同时跑，都只会有一条。
//  3) 不新增计分通道：实例就是普通 todo，完成仍然只走 completeTodo()（+2）。
//  4) 删掉今天的实例 = 今天不做。记进 skip_dates，当天不再重建。
// ============================================================

import { getState, commit } from './store.js';
import { uid, nowIso, todayStr, parseDate } from './util.js';

/** 重复规则（存字符串而不是函数，保证能 JSON 序列化） */
export const RULES = {
  daily: '每天',
  weekdays: '工作日',
  weekly: '每周',
};

/** 规则 + 选中的星期几 -> 人话标签 */
export function ruleLabel(routine) {
  if (routine.rule === 'weekly') {
    const names = ['日', '一', '二', '三', '四', '五', '六'];
    const days = [...(routine.weekdays || [])].sort();
    if (!days.length) return '每周';
    return `每周${days.map((d) => names[d]).join('·')}`;
  }
  return RULES[routine.rule] || '每天';
}

/** 今天这条要不要出现 */
export function matchesDate(routine, date) {
  if (!routine.active) return false;
  const dow = parseDate(date).getDay();
  if (routine.rule === 'daily') return true;
  if (routine.rule === 'weekdays') return dow >= 1 && dow <= 5;
  if (routine.rule === 'weekly') return (routine.weekdays || []).includes(dow);
  return false;
}

export function activeRoutines(s = getState()) {
  return s.routine.filter((r) => r.active);
}

/**
 * 把「今天该出现的」重复任务落成待办。
 * 在启动时、跨过午夜时、页面重新可见时调用，可以重复调用。
 * @returns {number} 本次新建了几条
 */
export function rollRoutines(today = todayStr()) {
  const s = getState();
  const due = s.routine.filter(
    (r) => matchesDate(r, today) && !(r.skip_dates || []).includes(today),
  );

  const existing = new Set(
    s.todo.filter((t) => t.routine_id && t.plan_date === today).map((t) => t.routine_id),
  );
  const todo = due.filter((r) => !existing.has(r.id));

  if (!todo.length) {
    if (s.setting.roll_date !== today) {
      commit((st) => { st.setting.roll_date = today; });
    }
    return 0;
  }

  commit((st) => {
    for (const r of todo) {
      st.todo.push({
        id: uid('todo'),
        title: r.title,
        plan_date: today,
        goal_id: r.goal_id || null,
        milestone_id: null,
        status: 'pending',
        done_at: null,
        source: 'routine',
        routine_id: r.id,
        created_at: nowIso(),
      });
    }
    st.setting.roll_date = today;
  });
  return todo.length;
}

// ---- 增删改 ------------------------------------------------
export function createRoutine({ title, rule = 'daily', weekdays = [] }) {
  const text = String(title).trim();
  if (!text) return null;
  const routine = {
    id: uid('rt'),
    title: text,
    rule: RULES[rule] ? rule : 'daily',
    weekdays: rule === 'weekly' ? [...weekdays].sort() : [],
    goal_id: null,
    active: true,
    skip_dates: [],
    created_at: nowIso(),
  };
  commit((s) => {
    s.routine.push(routine);
  });
  // 建完立刻让今天出现（不然用户会以为没生效）
  rollRoutines();
  return routine;
}

export function setRoutineActive(id, active) {
  commit((s) => {
    const r = s.routine.find((x) => x.id === id);
    if (r) r.active = Boolean(active);
  });
}

export function updateRoutine(id, patch) {
  commit((s) => {
    const r = s.routine.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  });
}

/**
 * 删除重复任务：模板消失，但已经生成的待办保留（历史不能被抹掉）。
 * 未完成且落在今天的实例一并清掉，否则它会变成一个删不干净的孤儿。
 */
export function removeRoutine(id) {
  commit((s) => {
    const today = todayStr();
    s.todo = s.todo.filter(
      (t) => !(t.routine_id === id && t.plan_date === today && !t.done_at),
    );
    s.routine = s.routine.filter((r) => r.id !== id);
  });
}

/** 今天不想做：删掉实例，并让当天不再重建 */
export function skipToday(routineId, date = todayStr()) {
  commit((s) => {
    const r = s.routine.find((x) => x.id === routineId);
    if (r) {
      r.skip_dates = r.skip_dates || [];
      if (!r.skip_dates.includes(date)) r.skip_dates.push(date);
    }
    const target = s.todo.find(
      (t) => t.routine_id === routineId && t.plan_date === date && !t.done_at,
    );
    if (target) s.todo = s.todo.filter((t) => t.id !== target.id);
  });
}
