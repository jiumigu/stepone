// ============================================================
// calendar.js — 月视图 + 当日抽屉
//
// 一格里的点 = 那天真实发生的事，按来源上色：
//   橙 待办 / 蓝 里程碑 / 绿 快乐记录
// 实心 = 那天做成了；空心 = 那天安排了但还没做。
// 归属规则见 selectors.dayEventMap（计划日与完成日各记一条，同日不重复）。
// ============================================================

import { getState } from '../core/store.js';
import { dayEventMap, eventsOfDay } from '../core/selectors.js';
import { completeTodo, revertTodo } from '../core/todos.js';
import { completeMilestone, revertMilestone } from '../core/goals.js';
import { joyBand } from '../core/points.js';
import {
  toDateStr, todayStr, fmtDay, fmtDaySmart, fmtWeekday, esc, toTimeStr, isoToDay,
} from '../core/util.js';
import { toast, openSheet, actionSheet } from './components.js';
import { openAddStepSheet } from './pickers.js';

let els = {};
const view = { y: new Date().getFullYear(), m: new Date().getMonth() };

const KIND_LABEL = { todo: '待办', milestone: '里程碑', joy: '快乐' };

const skeleton = `
  <header class="page-head">
    <div>
      <h1>日历</h1>
      <p class="sub">往后看一眼，别把事堆到今天</p>
    </div>
  </header>
  <main class="scroll" data-body></main>
`;

function monthCells(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // 周一为第一列
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    cells.push(new Date(year, month, 1 - offset + i));
  }
  return cells;
}

function renderCalendar() {
  const s = getState();
  const events = dayEventMap(s);
  const today = todayStr();
  const cells = monthCells(view.y, view.m);

  const grid = cells.map((d) => {
    const key = toDateStr(d);
    const out = d.getMonth() !== view.m;
    const list = events.get(key) || [];
    const isToday = key === today;
    const hasOverdue = list.some((e) => e.overdue);

    // 最多 3 个点，超出用 +N —— 点的颜色告诉你是哪一类，数量告诉你有几件
    const shown = list.slice(0, 3);
    const rest = list.length - shown.length;
    const dotsHtml = shown.length
      ? `<span class="cal-dots">${shown.map((e) => `<i class="cal-dot cal-dot--${e.kind} ${e.role === 'plan' ? 'is-plan' : ''}"></i>`).join('')}${rest > 0 ? `<i class="more-count">+${rest}</i>` : ''}</span>`
      : '';

    return `<button class="cal-cell ${out ? 'is-out' : ''} ${isToday ? 'is-today' : ''}" data-day="${key}">
      ${hasOverdue ? '<span class="cal-late"></span>' : ''}
      <span>${d.getDate()}</span>
      ${dotsHtml}
    </button>`;
  }).join('');

  els.body.innerHTML = `
    <div class="cal-head">
      <h2>${view.y} 年 ${view.m + 1} 月</h2>
      <div class="cal-nav">
        <button data-prev aria-label="上个月">‹</button>
        <button data-next aria-label="下个月">›</button>
        <button class="cal-today-btn" data-today>今天</button>
      </div>
    </div>
    <div class="cal-week">
      <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
    </div>
    <div class="cal-grid">${grid}</div>
    <div class="cal-legend">
      <span><i class="cal-dot cal-dot--todo"></i>待办</span>
      <span><i class="cal-dot cal-dot--milestone"></i>里程碑</span>
      <span><i class="cal-dot cal-dot--joy"></i>快乐</span>
      <span class="cal-legend-note">实心＝做成了，空心＝那天安排着</span>
    </div>
  `;
}

// ---------------- 当日抽屉 ----------------
function eventRow(e) {
  const late = e.overdue ? `<span class="is-late">逾期</span>` : '';

  if (e.kind === 'joy') {
    const band = joyBand(e.score);
    return `<div class="day-ev" data-joyrow="${e.id}">
      <span class="ev-dot ev-dot--joy"></span>
      <div class="ev-main">
        <div class="ev-title">${esc(e.title)}</div>
        <div class="ev-sub">
          <span>${esc(band.label)}</span>
          <span class="dot-sep"></span>
          <span>${esc(toTimeStr(e.at_iso))}</span>
        </div>
      </div>
      <span class="ev-pts">+${e.points || band.points}</span>
    </div>`;
  }

  const isDone = e.role === 'done';
  // 计划日那一行，事情后来被做掉了：标题也要划掉。
  // 勾选框保持空心（不是这天做的），圈里那个淡勾表示「已经做过」。
  const doneElse = !isDone && Boolean(e.done_on);
  const meta = [];
  if (isDone) {
    meta.push(`<span>${e.at === todayStr() ? '今天' : esc(fmtDay(e.at))} 做的</span>`);
  } else if (doneElse) {
    // 计划日那一行：说明它后来被做掉了，避免和「没完成」混淆
    meta.push(`<span>${esc(fmtDay(e.done_on))} 已经做了</span>`);
  } else if (e.overdue) {
    meta.push(late);
  }
  // 完成感受只属于「做完那天」，计划日不该出现
  if (e.kind === 'milestone' && isDone && e.note) {
    meta.push(`<span>· ${esc(e.note)}</span>`);
  }
  if (e.kind === 'todo' && e.routine_id) {
    meta.push('<span>· 重复</span>');
  }

  return `<div class="todo ${isDone ? 'is-done' : ''} ${doneElse ? 'is-done-else' : ''} ${e.overdue ? 'is-overdue' : ''}"
      data-ev="${e.kind}" data-id="${e.id}" data-role="${e.role}">
    <button class="todo-check" data-check="1" aria-label="${isDone ? '已完成' : doneElse ? '已经做过' : '标记完成'}"></button>
    <div class="todo-main">
      <div class="todo-title">${esc(e.title)}</div>
      ${meta.length ? `<div class="todo-meta">${meta.join('<span class="dot-sep"></span>')}</div>` : ''}
    </div>
    <span class="ev-kind ev-kind--${e.kind}">${KIND_LABEL[e.kind]}</span>
  </div>`;
}

function dayDrawerBody(day) {
  const s = getState();
  const list = eventsOfDay(day, s);
  if (!list.length) {
    return `<p class="hint" style="text-align:center;padding:22px 0">这一天什么都没有 —— 空着也是允许的</p>`;
  }

  const groupOrder = ['todo', 'milestone', 'joy'];
  return groupOrder.map((kind) => {
    const items = list.filter((e) => e.kind === kind);
    if (!items.length) return '';
    return `<div class="day-group">
      <div class="day-group-label"><i class="cal-dot cal-dot--${kind}"></i>${KIND_LABEL[kind]} · ${items.length}</div>
      ${items.map(eventRow).join('')}
    </div>`;
  }).join('');
}

function openDayDrawer(day) {
  const sheet = openSheet({
    title: `${fmtDaySmart(day)} ${fmtWeekday(day)}`,
    html: dayDrawerBody(day),
    footer: '<button class="btn btn-soft btn-block" data-add="1">在这一天加一件</button>',
  });

  const refresh = () => {
    sheet.body.innerHTML = dayDrawerBody(day);
    update();
  };

  const findEvent = (node) => {
    const id = node.dataset.id;
    const kind = node.dataset.ev;
    const s = getState();
    if (kind === 'todo') return s.todo.find((t) => t.id === id);
    if (kind === 'milestone') return s.milestone.find((m) => m.id === id);
    return null;
  };

  sheet.el.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-ev]');

    if (item && e.target.closest('[data-check]')) {
      const role = item.dataset.role;
      const rec = findEvent(item);
      if (!rec) return;

      if (item.dataset.ev === 'todo') {
        if (rec.done_at) {
          // 抽屉里没有「···」按钮，撤销入口是点整行（原有文案会让人找不存在的按钮）
          toast(role === 'done'
            ? '点这一行可以撤销完成'
            : `${fmtDay(isoToDay(rec.done_at))} 已经做过了`, 'warn');
          return;
        }
        if (completeTodo(rec.id)) {
          toast('+2 分');
          refresh();
        }
        return;
      }

      // 里程碑：计划日那一行，但事情已经做掉了 —— 别再让它「点了没反应」
      if (role === 'plan' && rec.done_at) {
        toast(`${fmtDay(isoToDay(rec.done_at))} 已经做过了`, 'warn');
        return;
      }

      // 里程碑：在日历里也能直接完成 / 撤销，和详情页同一个入口
      if (role === 'done') {
        if (revertMilestone(rec.id)) {
          toast('已撤销，记了一条 -10 冲正', 'warn');
          refresh();
        }
        return;
      }
      if (completeMilestone(rec.id)) {
        toast('+10 分');
        refresh();
      }
      return;
    }

    // 整行可点：手机上不用瞄准右边那个小标签
    if (item && !e.target.closest('[data-check]')) {
      const rec = findEvent(item);
      if (!rec) return;
      if (item.dataset.ev === 'todo') {
        actionSheet({
          title: rec.title,
          actions: [
            rec.done_at
              ? { label: '撤销完成（-2 冲正）', onSelect: () => { revertTodo(rec.id); toast('已撤销', 'warn'); refresh(); } }
              : { label: '标记完成（+2）', onSelect: () => { if (completeTodo(rec.id)) { toast('+2 分'); refresh(); } } },
          ],
        });
        return;
      }
      const { openMilestoneActions } = await import('./pickers.js');
      openMilestoneActions(rec, { onChanged: refresh });
      return;
    }

    if (e.target.closest('[data-add]')) {
      sheet.close();
      setTimeout(() => {
        openAddStepSheet({ plan_date: day, onCreated: update });
      }, 180);
    }
  });
}

export function mount(root) {
  root.innerHTML = skeleton;
  els = { root, body: root.querySelector('[data-body]') };

  els.body.addEventListener('click', (e) => {
    if (e.target.closest('[data-prev]')) {
      view.m -= 1;
      if (view.m < 0) { view.m = 11; view.y -= 1; }
      renderCalendar();
      return;
    }
    if (e.target.closest('[data-next]')) {
      view.m += 1;
      if (view.m > 11) { view.m = 0; view.y += 1; }
      renderCalendar();
      return;
    }
    if (e.target.closest('[data-today]')) {
      const now = new Date();
      view.y = now.getFullYear();
      view.m = now.getMonth();
      renderCalendar();
      return;
    }
    const cell = e.target.closest('[data-day]');
    if (cell) openDayDrawer(cell.dataset.day);
  });

  renderCalendar();
}

export function update() {
  if (els.body) renderCalendar();
}
