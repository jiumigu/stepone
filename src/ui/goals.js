// ============================================================
// goals.js — 「目标」页（列表）+ 目标详情（二级页，必须有显式返回）
// 进度只读：不接受任何手填或拖拽
// ============================================================

import { getState } from '../core/store.js';
import {
  DIMENSIONS, RHYTHMS, dimensionOf, rhythmOf, goalStats, milestonesOf,
  nextPendingMilestone, isStalled, sortGoals, GOAL_STATUS_LABEL,
  completeMilestone, revertMilestone, abandonGoal, updateGoal,
  prefixMilestoneTitles,
} from '../core/goals.js';
import {
  fmtDay, fmtDaySmart, todayStr, diffDays, esc, relDay, toTimeStr, isoToDay,
} from '../core/util.js';
import {
  toast, actionSheet, confirmSheet, progressRing, emptyBlock, sectionTitle, badge, openSheet,
} from './components.js';
import {
  openGoalForm, openAddStepSheet, openMilestoneActions, openMilestoneSheet,
} from './pickers.js';

let els = {};
let detailEl = null;
let detailGoalId = null;
const expanded = { completed: false, abandoned: false };

const skeleton = `
  <header class="page-head">
    <div>
      <h1>目标</h1>
      <p class="sub" data-sub></p>
    </div>
    <button class="chip-btn" data-new>新建目标</button>
  </header>
  <main class="scroll" data-list></main>
`;

// ---------------- 列表 ----------------
function goalCard(g, s) {
  const dim = dimensionOf(g.dimension);
  const stats = goalStats(g.id, s);
  const next = nextPendingMilestone(g.id, s);
  const stalled = isStalled(g, s);

  let nextLine = '';
  if (stats.total === 0) {
    nextLine = `<span>还没有里程碑 · 进度无定义</span>`;
  } else if (!next) {
    nextLine = `<span>全部里程碑完成</span>`;
  } else {
    const rel = relDay(next.plan_date);
    const late = next.plan_date < todayStr();
    nextLine = `<span>${esc(next.title)}</span><span class="dot-sep"></span>
      <span class="${late ? 'is-late' : ''}">${esc(rel)}</span>`;
  }

  return `<button class="goal-card" data-goal="${g.id}">
    <span class="dim-bar" style="background:${dim.color}"></span>
    <div class="goal-card-main">
      <div class="goal-card-title">${esc(g.title)}</div>
      <div class="goal-card-sub">
        <span>${esc(dim.label)}</span><span class="dot-sep"></span>
        <span>${stats.done}/${stats.total || '—'}</span><span class="dot-sep"></span>
        ${nextLine}
      </div>
      ${stalled ? '<div class="stall-tip">这个目标 14 天没动了</div>' : ''}
    </div>
    ${progressRing(stats.ratio, { size: 42, stroke: 4.5 })}
  </button>`;
}

function groupBlock(title, list, s, key) {
  if (!list.length) return '';
  const open = key === 'active' || expanded[key];
  const head = `<div class="sec-head">
    <h3>${esc(title)} · ${list.length}</h3>
    ${key === 'active' ? '' : `<button class="btn-sm btn-ghost" data-toggle="${key}">${open ? '收起' : '展开'}</button>`}
  </div>`;
  if (!open) return head;
  return head + list.map((g) => goalCard(g, s)).join('');
}

export function mount(root) {
  root.innerHTML = skeleton;
  els = {
    root,
    sub: root.querySelector('[data-sub]'),
    list: root.querySelector('[data-list]'),
  };

  root.querySelector('[data-new]').addEventListener('click', () => {
    openGoalForm({ onCreated: (id) => openDetail(id) });
  });

  els.list.addEventListener('click', (e) => {
    const card = e.target.closest('[data-goal]');
    if (card) {
      openDetail(card.dataset.goal);
      return;
    }
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const key = toggle.dataset.toggle;
      expanded[key] = !expanded[key];
      renderList();
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && act.dataset.act === 'new-goal') {
      openGoalForm({ onCreated: (id) => openDetail(id) });
    }
  });

  update();
}

function renderList() {
  const s = getState();
  const active = sortGoals(s.goal.filter((g) => g.status === 'planning' || g.status === 'in_progress'), s);
  const completed = s.goal.filter((g) => g.status === 'completed')
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''));
  const abandoned = s.goal.filter((g) => g.status === 'abandoned')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  els.sub.textContent = active.length
    ? `${active.length} 个进行中`
    : '还没有进行中的目标';

  let html = '';
  html += groupBlock('进行中', active, s, 'active');
  html += groupBlock('已完成', completed, s, 'completed');
  html += groupBlock('已放弃', abandoned, s, 'abandoned');

  if (!s.goal.length) {
    html = emptyBlock({
      title: '还没有目标',
      text: '目标 = 一件想做成的事 + 一个节奏',
      action: { key: 'new-goal', label: '建第一个目标' },
    });
  } else if (!active.length && !completed.length && !abandoned.length) {
    html = emptyBlock({
      title: '还没有目标',
      action: { key: 'new-goal', label: '建第一个目标' },
    });
  }

  els.list.innerHTML = html;
}

// ---------------- 详情（二级页）----------------
function ensureDetail() {
  if (detailEl) return detailEl;
  detailEl = document.createElement('div');
  detailEl.className = 'detail';
  document.body.appendChild(detailEl);
  return detailEl;
}

export function openDetail(goalId) {
  detailGoalId = goalId;
  const el = ensureDetail();
  renderDetail();
  requestAnimationFrame(() => el.classList.add('is-on'));
}

export function closeDetail() {
  if (!detailEl) return;
  detailEl.classList.remove('is-on');
  detailGoalId = null;
  setTimeout(() => {
    if (detailEl && !detailEl.classList.contains('is-on')) {
      detailEl.remove();
      detailEl = null;
    }
  }, 240);
}

export function isDetailOpen() {
  return Boolean(detailGoalId);
}

/**
 * 完成时间的可读写法。
 * 和计划日同一天只写时间（「13:53 完成」）；跨天必须写哪天，
 * 否则「11月19日 13:53 完成」会被读成计划日完成的（真实误读）。
 */
function doneLabel(m) {
  const doneDay = isoToDay(m.done_at);
  if (!doneDay) return '';
  return doneDay === m.plan_date ? toTimeStr(m.done_at) : `→ ${fmtDaySmart(doneDay)}`;
}

/**
 * 新增的那一条要看得见：滚到它、闪一下。
 * 列表长了以后「加了但没显示」很可能是加成了别的东西，或者加在了屏幕外 ——
 * 后者不该让用户自己找。
 */
function revealMilestone(id) {
  const node = id && detailEl ? detailEl.querySelector(`[data-ms="${id}"]`) : null;
  if (!node) return;
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.classList.add('is-new');
  setTimeout(() => node.classList.remove('is-new'), 1400);
}

function renderDetail() {
  if (!detailGoalId || !detailEl) return;
  const s = getState();
  const g = s.goal.find((x) => x.id === detailGoalId);
  if (!g) {
    closeDetail();
    return;
  }

  const dim = dimensionOf(g.dimension);
  const rhythm = rhythmOf(g.rhythm);
  const stats = goalStats(g.id, s);
  const list = milestonesOf(g.id, s);
  const next = nextPendingMilestone(g.id, s);
  const stalled = isStalled(g, s);

  const statusTone = g.status === 'completed' ? 'done' : g.status === 'abandoned' ? 'muted' : 'neutral';

  // 只给「下一个该做的那一步」标逾期。整条时间轴都标红会成为道德指责，
  // 与「断一天不惩罚」的产品立场冲突（见 audit.md §2.3-A）。
  const nextId = next ? next.id : null;

  const msHtml = list.length
    ? list.map((m) => {
        const isDone = m.status === 'done';
        const isPast = m.plan_date < todayStr() && !isDone;
        const isNextOverdue = isPast && m.id === nextId;
        return `<div class="ms-item ${isDone ? 'is-done' : ''} ${isPast && !isNextOverdue ? 'is-stale' : ''}" data-ms="${m.id}">
          <div class="ms-dot"></div>
          <div class="ms-main">
            <div class="ms-title">${esc(m.title)}</div>
            <div class="ms-sub">
              <span>${esc(fmtDaySmart(m.plan_date))}</span>
              ${isDone
                ? `<span>${esc(doneLabel(m))} 完成</span>`
                : isNextOverdue ? `<span class="is-late">拖了 ${diffDays(m.plan_date, todayStr())} 天</span>` : ''}
              ${m.note ? `<span>· ${esc(m.note)}</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('')
    : `<p class="hint">还没有里程碑。进度需要里程碑才有定义，先给它加一个。</p>`;

  detailEl.innerHTML = `
    <div class="detail-head">
      <button class="back-btn" data-back>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
          stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        返回
      </button>
      <div style="flex:1"></div>
      <button class="todo-more" data-more aria-label="更多">···</button>
    </div>
    <div class="scroll">
      <div class="detail-hero">
        ${progressRing(stats.ratio, { size: 62, stroke: 6 })}
        <div style="min-width:0">
          <h2>${esc(g.title)}</h2>
          <div class="meta">
            <span class="dim-bar" style="background:${dim.color};display:inline-block;vertical-align:-2px;margin-right:5px"></span>
            ${esc(dim.label)} · ${esc(rhythm.label)} ·
            <span style="white-space:nowrap">${stats.total} 个里程碑里完成 ${stats.done} 个</span>
          </div>
          <div class="meta">${esc(fmtDaySmart(g.start_date))} — ${esc(fmtDaySmart(g.due_date))}
            · ${esc(GOAL_STATUS_LABEL[g.status] || g.status)}</div>
          ${stalled ? '<div class="stall-tip">这个目标 14 天没动了</div>' : ''}
        </div>
      </div>
      <div class="timeline">${msHtml}</div>
      <div style="height:8px"></div>
    </div>
    <div class="detail-foot">
      <button class="btn btn-quiet" data-add-step>加一步</button>
      ${next
        ? `<button class="btn btn-primary" style="flex:1" data-complete-next>完成「${esc(next.title)}」+10</button>`
        : `<button class="btn btn-primary" style="flex:1" data-add-ms>加一个里程碑</button>`}
    </div>
  `;

  detailEl.querySelector('[data-back]').addEventListener('click', closeDetail);

  detailEl.querySelector('[data-more]').addEventListener('click', () => {
    actionSheet({
      title: g.title,
      actions: [
        { label: '编辑名称 / 日期', onSelect: () => openMilestoneSheetForGoal(g) },
        {
          // 老数据的里程碑只叫「第 1 个月」，在日历/今天页认不出是哪件事。
          // 这里给一条显式入口，不静默改用户已经手改过的名字。
          label: '里程碑名字补上目标名',
          onSelect: () => {
            const n = prefixMilestoneTitles(g.id);
            renderDetail();
            update();
            if (n) toast(`补了 ${n} 个里程碑的名字`);
            else toast('没有能补的：只补「第 N 个月」这种，改过的不动', 'warn');
          },
        },
        {
          label: '放弃这个目标',
          danger: true,
          onSelect: async () => {
            const ok = await confirmSheet({
              title: '放弃这个目标？',
              message: '放弃后不能恢复，进度会停在原地，已发的积分不回收。',
              okText: '放弃',
              danger: true,
            });
            if (!ok) return;
            abandonGoal(g.id);
            closeDetail();
            update();
            toast('已放弃', 'warn');
          },
        },
      ],
    });
  });

  // 「加一步」= 新增一个里程碑（不是待办）。写成待办时它会出现在今天页和日历，
  // 但目标时间轴和进度都不动 —— 用户会看到「加了但列表里没有」。
  const openAddStep = () => openAddStepSheet({
    goalId: g.id,
    asMilestone: true,
    due: g.due_date,
    onCreated: (id) => {
      renderDetail();
      update();
      revealMilestone(id);
    },
  });

  detailEl.querySelector('[data-add-step]').addEventListener('click', openAddStep);

  const addMs = detailEl.querySelector('[data-add-ms]');
  if (addMs) addMs.addEventListener('click', openAddStep);

  const doneBtn = detailEl.querySelector('[data-complete-next]');
  if (doneBtn) {
    doneBtn.addEventListener('click', () => {
      const before = g.status;
      const ok = completeMilestone(next.id);
      if (!ok) return;
      const after = getState().goal.find((x) => x.id === g.id);
      renderDetail();
      update();
      if (after && after.status === 'completed' && before !== 'completed') {
        toast('目标完成 · +30 分');
      } else {
        toast('+10 分');
      }
    });
  }

  detailEl.querySelectorAll('[data-ms]').forEach((node) => {
    node.addEventListener('click', () => {
      const ms = getState().milestone.find((m) => m.id === node.dataset.ms);
      if (!ms) return;
      openMilestoneActions(ms, {
        onChanged: () => { renderDetail(); update(); },
      });
    });
  });
}

/** 目标级编辑 */
function openMilestoneSheetForGoal(g) {
  const sheet = openSheet({
    title: '编辑目标',
    html: `
      <div class="field">
        <label>目标名称</label>
        <input type="text" data-title value="${esc(g.title)}" maxlength="40">
      </div>
      <div class="field-row">
        <div class="field"><label>开始</label><input type="date" data-start value="${g.start_date}"></div>
        <div class="field"><label>截止</label><input type="date" data-due value="${g.due_date}"></div>
      </div>
      <p class="hint">改日期不会重排已有里程碑，只影响之后新增的。</p>
    `,
    footer: '<button class="btn btn-primary btn-block" data-save="1">保存</button>',
  });

  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-save]')) return;
    const title = sheet.body.querySelector('[data-title]').value.trim();
    const start = sheet.body.querySelector('[data-start]').value;
    const due = sheet.body.querySelector('[data-due]').value;
    if (!title || !start || !due || due < start) {
      toast('检查一下名称和日期', 'warn');
      return;
    }
    updateGoal(g.id, { title, start_date: start, due_date: due });
    sheet.close();
    renderDetail();
    update();
    toast('改好了');
  });
}

export function update() {
  if (!els.list) return;
  renderList();
  if (detailGoalId) renderDetail();
}
