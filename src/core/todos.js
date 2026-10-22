// ============================================================
// todos.js — 待办 + 唯一完成入口
//
// 铁律 1：勾选完成只发生在「今天」和「日历抽屉」，且调用同一个 completeTodo()
// 铁律 3（幂等）：done_at 非空直接返回，绝不重复加分
// ============================================================

import { getState, commit } from './store.js';
import { uid, nowIso, todayStr } from './util.js';
import { pushTxn, REASON, RULE } from './points.js';
import { recalcGoal } from './goals.js';

export const TODO_STATUS_LABEL = { pending: '待完成', done: '已完成' };

/** 单条创建（不 commit，供批量复用） */
function makeTodo({ title, plan_date, goal_id = null, milestone_id = null, source = 'manual', routine_id = null }) {
  return {
    id: uid('todo'),
    title: String(title).trim(),
    plan_date: plan_date || todayStr(),
    goal_id: goal_id || null,
    milestone_id: milestone_id || null,
    status: 'pending',
    done_at: null,
    source,
    routine_id,
    created_at: nowIso(),
  };
}

/** 步骤 1：一句话捕获 —— 回车即建，不弹窗、不选分类、允许不挂目标 */
export function capture(title, plan_date = todayStr()) {
  const text = String(title).trim();
  if (!text) return null;
  const todo = makeTodo({ title: text, plan_date, source: 'capture' });
  commit((s) => { s.todo.push(todo); });
  return todo;
}

/** 批量捕获：粘贴多行，一行一条（备考 / 搬家场景） */
export function captureMany(raw, plan_date = todayStr()) {
  const lines = String(raw)
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const created = lines.map((title) => makeTodo({ title, plan_date, source: 'capture' }));
  commit((s) => { s.todo.push(...created); });
  return created;
}

/** 挂到目标上（步骤 3） */
export function addTodo({ title, plan_date, goal_id = null }) {
  const text = String(title).trim();
  if (!text) return null;
  const todo = makeTodo({
    title: text,
    plan_date: plan_date || todayStr(),
    goal_id,
    source: goal_id ? 'goal' : 'manual',
  });
  commit((s) => { s.todo.push(todo); });
  return todo;
}

/**
 * 全站唯一的完成实现。
 * 一次事务内：todo 置 done -> 写 +2 流水 -> 重算目标进度
 * @returns {boolean} 是否真的发生了状态变更（false = 幂等拦截）
 */
export function completeTodo(id) {
  const s = getState();
  const target = s.todo.find((t) => t.id === id);
  if (!target) return false;
  if (target.done_at) return false; // 幂等闸门

  commit((st) => {
    const todo = st.todo.find((t) => t.id === id);
    if (!todo || todo.done_at) return;
    todo.status = 'done';
    todo.done_at = nowIso();
    pushTxn(st, {
      delta: RULE[REASON.TODO_DONE].delta,
      reason_code: REASON.TODO_DONE,
      ref_id: todo.id,
      note: `完成「${todo.title}」`,
    });
    if (todo.goal_id) recalcGoal(todo.goal_id, st);
  });
  return true;
}

/** 撤销完成：写 -2 冲正流水，原流水保留（铁律 4） */
export function revertTodo(id) {
  const s = getState();
  const target = s.todo.find((t) => t.id === id);
  if (!target || !target.done_at) return false;

  commit((st) => {
    const todo = st.todo.find((t) => t.id === id);
    if (!todo || !todo.done_at) return;
    pushTxn(st, {
      delta: -RULE[REASON.TODO_DONE].delta,
      reason_code: REASON.REVERT,
      ref_id: todo.id,
      note: `撤销「${todo.title}」`,
    });
    todo.status = 'pending';
    todo.done_at = null;
    if (todo.goal_id) recalcGoal(todo.goal_id, st);
  });
  return true;
}

/** 删除待办：已完成的必须先撤销（避免余额与任务脱钩） */
export function removeTodo(id) {
  const s = getState();
  const target = s.todo.find((t) => t.id === id);
  if (!target) return { ok: false, reason: 'notfound' };
  if (target.done_at) return { ok: false, reason: 'done_first' };

  commit((st) => {
    st.todo = st.todo.filter((t) => t.id !== id);
    // 重复任务的实例被删掉 = 今天不做，记下日期，当天不再重建
    if (target.routine_id) {
      const r = st.routine.find((x) => x.id === target.routine_id);
      if (r) {
        r.skip_dates = r.skip_dates || [];
        if (!r.skip_dates.includes(target.plan_date)) r.skip_dates.push(target.plan_date);
      }
    }
  });
  return { ok: true };
}

export function updateTodo(id, patch) {
  commit((s) => {
    const t = s.todo.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
  });
}
