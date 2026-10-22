// ============================================================
// today.js — 「今天」页：默认落地页，80% 的操作在这里完成
//
// 结构：骨架只建一次，update() 只重绘列表与统计，
// 保证底部输入框焦点不丢（避免每次写操作都重排整页）。
// ============================================================

import { getState } from '../core/store.js';
import {
  todayBoard, todayEarned, currentBalance, goalIndex, routineIndex,
} from '../core/selectors.js';
import { captureMany, completeTodo, revertTodo, removeTodo } from '../core/todos.js';
import { rollRoutines, ruleLabel, skipToday } from '../core/routines.js';
import {
  fmtDay, fmtWeekday, todayStr, diffDays, esc, toTimeStr,
} from '../core/util.js';
import { toast, actionSheet, emptyBlock } from './components.js';
import {
  openJoyForm, openGoalPicker, openGoalForm,
} from './pickers.js';
import { openRoutineSheet } from './routines.js';

let els = {};
let pressTimer = null;

const skeleton = `
  <header class="page-head">
    <div>
      <h1 data-date></h1>
      <p class="sub" data-sub></p>
    </div>
    <div class="head-acts">
      <button class="chip-btn" data-routine>重复</button>
      <button class="chip-btn" data-joy>记快乐</button>
    </div>
  </header>
  <main class="scroll" data-list></main>
  <div class="dock">
    <div class="dock-stat" data-stat></div>
    <form class="capture" data-form autocomplete="off">
      <input data-input placeholder="想到什么，先丢进去" maxlength="80" enterkeyhint="done">
      <button type="submit" aria-label="添加">＋</button>
    </form>
  </div>
`;

function todoRow(t, { overdue = false, gidx, ridx }) {
  const isDone = Boolean(t.done_at);
  const goal = t.goal_id ? gidx.get(t.goal_id) : null;
  const routine = t.routine_id && ridx ? ridx.get(t.routine_id) : null;
  const late = overdue ? diffDays(t.plan_date, todayStr()) : 0;
  const metas = [];
  if (routine) metas.push(`<span class="rt-meta">↻ ${esc(ruleLabel(routine))}</span>`);
  if (overdue) metas.push(`<span class="is-late">逾期 ${late} 天</span>`);
  if (goal) metas.push(`<span>${esc(goal.title)}</span>`);
  if (isDone) metas.push(`<span>${toTimeStr(t.done_at)} 完成</span>`);

  return `<div class="todo ${isDone ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''} ${routine ? 'is-routine' : ''}" data-id="${t.id}">
    <button class="todo-check" data-check="1"
      aria-label="${isDone ? '已完成' : '标记完成'}"></button>
    <div class="todo-main">
      <div class="todo-title">${esc(t.title)}</div>
      ${metas.length ? `<div class="todo-meta">${metas.join('<span class="dot-sep"></span>')}</div>` : ''}
    </div>
    <button class="todo-more" data-more="1" aria-label="更多操作">···</button>
  </div>`;
}

export function mount(root) {
  root.innerHTML = skeleton;
  els = {
    root,
    date: root.querySelector('[data-date]'),
    sub: root.querySelector('[data-sub]'),
    list: root.querySelector('[data-list]'),
    stat: root.querySelector('[data-stat]'),
    form: root.querySelector('[data-form]'),
    input: root.querySelector('[data-input]'),
  };

  root.querySelector('[data-joy]').addEventListener('click', () => {
    openJoyForm({ onSaved: () => update() });
  });

  root.querySelector('[data-routine]').addEventListener('click', () => {
    openRoutineSheet({ onChange: () => update() });
  });

  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = els.input.value;
    if (!raw.trim()) return;
    const created = captureMany(raw);
    els.input.value = '';
    if (created.length > 1) toast(`一次收了 ${created.length} 件`);
    update();
  });

  els.list.addEventListener('click', onListClick);
  els.list.addEventListener('pointerdown', onPointerDown);
  ['pointerup', 'pointercancel', 'pointermove'].forEach((ev) => {
    els.list.addEventListener(ev, clearPress);
  });

  // 今天该出现的重复任务落成待办（幂等，多调无害）
  rollRoutines();
  update();
}

function clearPress() {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function onPointerDown(e) {
  const item = e.target.closest('.todo');
  if (!item || e.target.closest('.todo-more')) return;
  clearPress();
  pressTimer = setTimeout(() => {
    pressTimer = null;
    openTodoActions(item.dataset.id);
  }, 480);
}

function onListClick(e) {
  const item = e.target.closest('.todo');

  if (item && e.target.closest('[data-check]')) {
    const s = getState();
    const todo = s.todo.find((t) => t.id === item.dataset.id);
    if (!todo) return;
    if (todo.done_at) {
      toast('长按可以撤销这次完成');
      return;
    }
    if (completeTodo(todo.id)) flashThenRelayout(item);
    return;
  }

  if (item && e.target.closest('[data-more]')) {
    openTodoActions(item.dataset.id);
    return;
  }

  const actBtn = e.target.closest('[data-act]');
  if (actBtn) {
    handleEmptyAction(actBtn.dataset.act);
  }
}

function handleEmptyAction(act) {
  if (act === 'pick-goal') {
    openGoalPicker({ onPick: update });
    return;
  }
  if (act === 'new-goal') {
    openGoalForm({
      onCreated: (id) => {
        document.dispatchEvent(new CustomEvent('stepone:navigate', {
          detail: { tab: 'goals', goalId: id },
        }));
      },
    });
  }
}

function openTodoActions(id) {
  const s = getState();
  const todo = s.todo.find((t) => t.id === id);
  if (!todo) return;

  const actions = [];

  if (todo.done_at) {
    actions.push({
      label: '撤销完成（-2 冲正）',
      onSelect: () => {
        revertTodo(todo.id);
        toast('已撤销，写了一条冲正流水', 'warn');
        update();
      },
    });
  } else {
    actions.push({
      label: '标记完成（+2）',
      onSelect: () => {
        const node = els.list.querySelector(`.todo[data-id="${todo.id}"]`);
        if (completeTodo(todo.id)) flashThenRelayout(node);
      },
    });
    actions.push({
      label: '设为目标',
      onSelect: () => openGoalForm({ prefillTitle: todo.title }),
    });
    // 重复任务的实例：可以直接「今天不做」，不用绕去「重复」抽屉里找
    if (todo.routine_id) {
      actions.push({
        label: '今天不做（明天照常）',
        onSelect: () => {
          skipToday(todo.routine_id);
          toast('今天跳过，明天照常');
          update();
        },
      });
    }
  }

  actions.push({
    label: '删除',
    danger: true,
    onSelect: () => {
      const res = removeTodo(todo.id);
      if (!res.ok) {
        toast('已完成的先撤销，再删除', 'warn');
        return;
      }
      toast('已删除');
      update();
    },
  });

  actionSheet({ title: todo.title, actions });
}

export function update() {
  const s = getState();
  const board = todayBoard(s);
  const gidx = goalIndex(s);
  const ridx = routineIndex(s);
  const pendingCount = board.overdue.length + board.todayItems.length;

  els.date.innerHTML = `${fmtDay(board.today)} <span class="wd">${fmtWeekday(board.today)}</span>`;
  els.sub.innerHTML = pendingCount === 0 && board.doneToday.length === 0
    ? '今天还没安排'
    : `今天 <strong>${pendingCount}</strong> 件事 · 已完成 ${board.doneToday.length}`;

  const bal = currentBalance(s);
  els.stat.innerHTML = `今天已赚 <strong>+${todayEarned(s)}</strong> · 快乐银行 ${bal} 分`;

  let html = '';

  if (board.overdue.length) {
    html += `<div class="group-label">逾期 · ${board.overdue.length}</div>`;
    html += board.overdue.map((t) => todoRow(t, { overdue: true, gidx, ridx })).join('');
  }

  if (board.todayItems.length) {
    if (board.overdue.length) html += `<div class="group-label">今天 · ${board.todayItems.length}</div>`;
    html += board.todayItems.map((t) => todoRow(t, { gidx, ridx })).join('');
  }

  if (pendingCount === 0) {
    const hasActiveGoal = s.goal.some((g) => g.status !== 'abandoned' && g.status !== 'completed');
    html += emptyBlock({
      title: board.doneToday.length ? '今天的事都做完了' : '今天还没安排',
      text: board.doneToday.length
        ? '做完了就是做完了，别再补'
        : (s.routine.some((r) => r.active)
          ? '重复的事明天还会来，今天先歇着'
          : '要不要从目标里挑一步？'),
      action: hasActiveGoal
        ? { key: 'pick-goal', label: '从目标里挑一步' }
        : { key: 'new-goal', label: '建第一个目标' },
    });
  }

  if (board.doneToday.length) {
    html += `<div class="group-label">已完成 · ${board.doneToday.length}</div>`;
    html += board.doneToday.map((t) => todoRow(t, { gidx, ridx })).join('');
  }

  els.list.innerHTML = html;
}

/**
 * 完成瞬间只改视觉，不立刻重排 —— 让用户先看见「我做了这件事」，
 * 380ms 后再沉底到已完成区。连续勾选时列表不会跳。
 */
function markDoneVisual(node) {
  if (!node) return;
  node.classList.add('is-done');
  node.querySelector('.todo-check')?.classList.add('is-pop');
}

function flashThenRelayout(node) {
  markDoneVisual(node);
  toast(`+2 · 今天已赚 +${todayEarned(getState())}`);
  setTimeout(update, 380);
}

export function focusInput() {
  if (els.input) els.input.focus();
}
