// ============================================================
// selectors.js — 派生读取层（只读，绝不写 state）
// UI 只从这里取数据，保证「同一口径只有一处实现」
// ============================================================

import { todayStr, isoToDay, addDays, parseDate, toDateStr } from './util.js';
import { balance, JOY_BANDS, RULE, REASON } from './points.js';

/** 今天页三分组：逾期未完成 / 今日待办 / 今日已完成 */
export function todayBoard(s) {
  const today = todayStr();
  const overdue = [];
  const todayItems = [];
  const doneToday = [];

  for (const t of s.todo) {
    if (t.done_at) {
      if (isoToDay(t.done_at) === today) doneToday.push(t);
      continue;
    }
    if (t.plan_date < today) overdue.push(t);
    else if (t.plan_date === today) todayItems.push(t);
  }

  const byCreated = (a, b) => a.created_at.localeCompare(b.created_at);
  overdue.sort((a, b) => a.plan_date.localeCompare(b.plan_date) || byCreated(a, b));
  todayItems.sort(byCreated);
  doneToday.sort((a, b) => b.done_at.localeCompare(a.done_at));

  return { overdue, todayItems, doneToday, today };
}

/** 目标 ID -> 标题（卡片上显示归属） */
export function goalIndex(s) {
  const map = new Map();
  for (const g of s.goal) map.set(g.id, g);
  return map;
}

/** 重复任务 ID -> 模板（列表上显示「每天 / 工作日 / 每周一·三·五」） */
export function routineIndex(s) {
  const map = new Map();
  for (const r of s.routine) map.set(r.id, r);
  return map;
}

/**
 * 日历用：日期 -> 当天发生的事件（待办 / 里程碑 / 快乐），三类同口径。
 *
 * 归属规则（这是「日历能不能查到那天发生了什么」的唯一口径）：
 *  - 计划事件（role='plan'）：记在 plan_date —— 那天本来安排了这件事
 *  - 完成事件（role='done'）：记在 actually done 的那天
 *  - 计划日与完成日是同一天时只留一条（role='done'），不重复计数
 *
 * 为什么两件都要留：里程碑「第 1 个月」计划在 11/1、实际 10/22 做成，
 * 用户既想在 11/1 看到「这天该交这一步」，也想在 10/22 看到「这天做成了」。
 * 只留一边都会让人以为记录丢了。
 */
export function dayEventMap(s) {
  const map = new Map();
  const push = (day, item) => {
    if (!day) return;
    const list = map.get(day) || [];
    list.push(item);
    map.set(day, list);
  };

  const add = (base, planDay, doneAt) => {
    const doneDay = doneAt ? isoToDay(doneAt) : null;
    const isDone = Boolean(doneDay);

    if (!isDone || doneDay !== planDay) {
      push(planDay, {
        ...base,
        role: 'plan',
        done: false,
        at: planDay,
        overdue: !isDone && planDay < todayStr(),
        done_on: doneDay,
      });
    }
    if (isDone) {
      push(doneDay, { ...base, role: 'done', done: true, at: doneDay, overdue: false });
    }
  };

  for (const t of s.todo) {
    add(
      { kind: 'todo', id: t.id, title: t.title, goal_id: t.goal_id || null, routine_id: t.routine_id || null },
      t.plan_date,
      t.done_at,
    );
  }

  for (const m of s.milestone) {
    add(
      {
        kind: 'milestone', id: m.id, title: m.title, goal_id: m.goal_id,
        note: m.note || '', status: m.status,
      },
      m.plan_date,
      m.done_at,
    );
  }

  for (const j of s.joy_log) {
    push(isoToDay(j.created_at), {
      kind: 'joy', role: 'done', id: j.id,
      title: j.content || '记了一条快乐',
      done: true, at: isoToDay(j.created_at), at_iso: j.created_at, overdue: false,
      score: j.score, points: j.points_awarded,
    });
  }

  // 计划在前（还没发生的事先摆出来）；同类按业务顺序：待办 > 里程碑 > 快乐
  const KIND_RANK = { todo: 0, milestone: 1, joy: 2 };
  for (const [day, list] of map) {
    list.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'plan' ? -1 : 1;
      if (a.kind !== b.kind) return KIND_RANK[a.kind] - KIND_RANK[b.kind];
      return String(a.at).localeCompare(String(b.at));
    });
    map.set(day, list);
  }
  return map;
}

/** 某天的事件列表（selectors 不碰 store，state 由调用方传入） */
export function eventsOfDay(day, s) {
  return dayEventMap(s).get(day) || [];
}

/**
 * 兼容视图：只数「待办」的按天计数（日历格子里原来的圆点数量语义）。
 * 内部走 dayEventMap，不另立口径。
 */
export function dayCountMap(s) {
  const map = new Map();
  for (const [day, list] of dayEventMap(s)) {
    const todos = list.filter((e) => e.kind === 'todo');
    if (!todos.length) continue;
    map.set(day, {
      count: todos.length,
      doneCount: todos.filter((e) => e.done).length,
      hasOverdue: todos.some((e) => !e.done && e.overdue),
    });
  }
  return map;
}

/** 兼容：某天的待办（按「计划日」取，日历抽屉改走 eventsOfDay） */
export function todosOfDay(day, s) {
  return [...s.todo]
    .filter((t) => t.plan_date === day)
    .sort((a, b) => {
      const ad = a.done_at ? 1 : 0;
      const bd = b.done_at ? 1 : 0;
      return ad - bd || a.created_at.localeCompare(b.created_at);
    });
}

/** 某个时间点之后的收入合计 */
function earnedSince(s, fromDay) {
  return s.point_txn
    .filter((t) => t.delta > 0 && isoToDay(t.created_at) >= fromDay)
    .reduce((sum, t) => sum + t.delta, 0);
}

export function todayEarned(s) {
  return earnedSince(s, todayStr());
}

/** 本周（周一起算）收入 */
export function weekEarned(s) {
  const d = parseDate(todayStr());
  const offset = (d.getDay() + 6) % 7; // 周一 = 0
  const monday = toDateStr(new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset));
  return earnedSince(s, monday);
}

export function totalEarned(s) {
  return s.point_txn.filter((t) => t.delta > 0).reduce((sum, t) => sum + t.delta, 0);
}

export function totalSpent(s) {
  return Math.abs(s.point_txn.filter((t) => t.delta < 0).reduce((sum, t) => sum + t.delta, 0));
}

export function currentBalance(s) {
  return balance(s);
}

/** 收入来源分布（三色横条）：待办 / 里程碑（含目标）/ 快乐记录 */
export function incomeBreakdown(s) {
  const bucket = { todo: 0, milestone: 0, joy: 0 };
  for (const t of s.point_txn) {
    if (t.delta <= 0) continue;
    if (t.reason_code === 'todo_done') bucket.todo += t.delta;
    else if (t.reason_code === 'milestone_done' || t.reason_code === 'goal_done') bucket.milestone += t.delta;
    else if (t.reason_code === 'joy_log') bucket.joy += t.delta;
  }
  const total = bucket.todo + bucket.milestone + bucket.joy;
  return [
    { key: 'todo', label: '待办', value: bucket.todo, pct: total ? bucket.todo / total : 0, color: 'var(--brand)' },
    { key: 'milestone', label: '里程碑', value: bucket.milestone, pct: total ? bucket.milestone / total : 0, color: '#4A8FE7' },
    { key: 'joy', label: '快乐记录', value: bucket.joy, pct: total ? bucket.joy / total : 0, color: '#3E9B6D' },
  ];
}

export const TXN_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'in', label: '收入' },
  { key: 'out', label: '支出' },
];

export function filteredTxns(s, filter = 'all', limit = 60) {
  let list = [...s.point_txn].sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (filter === 'in') list = list.filter((t) => t.delta > 0);
  if (filter === 'out') list = list.filter((t) => t.delta < 0);
  return list.slice(0, limit);
}

/**
 * 流水标题：唯一口径。
 * 快乐记录显示「你写的那件事」，不是「开心」这个档位名 ——
 * 老数据 note 里存的是档位，所以按 ref_id 回查 joy_log 取正文。
 */
export function txnTitle(t, s) {
  if (t.reason_code === REASON.JOY_LOG) {
    const joy = s.joy_log.find((j) => j.id === t.ref_id);
    if (joy && joy.content) return joy.content;
  }
  return t.note || RULE[t.reason_code]?.label || t.reason_code;
}

/** 快乐流水关联到的原始记录（银行页显示档位用） */
export function joyOfTxn(t, s) {
  if (t.reason_code !== REASON.JOY_LOG) return null;
  return s.joy_log.find((j) => j.id === t.ref_id) || null;
}

/** 快乐档位常量透出给 UI，避免 UI 里再写一遍文案 */
export { JOY_BANDS };

/** 未来 7 天是否有安排（今天页空状态用） */
export function hasUpcoming(s, days = 7) {
  const today = todayStr();
  const end = addDays(today, days);
  return s.todo.some((t) => !t.done_at && t.plan_date > today && t.plan_date <= end);
}
