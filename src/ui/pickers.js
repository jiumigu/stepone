// ============================================================
// pickers.js — 跨页面共享的弹层与表单
// 放在独立模块，避免 today <-> bank <-> goals 相互 import 成环
// ============================================================

import { openSheet, toast, confirmSheet, actionSheet } from './components.js';
import { getState } from '../core/store.js';
import { todayStr, addDays, esc, fmtDay, fmtDaySmart, diffDays } from '../core/util.js';
import {
  JOY_BANDS, joyPoints, joyBand,
} from '../core/points.js';
import {
  DIMENSIONS, RHYTHMS, dimensionOf, rhythmOf,
  planMilestoneDates, createGoal, addMilestone, updateMilestone,
  removeMilestone, completeMilestone, revertMilestone, milestoneTitle,
} from '../core/goals.js';
import { addJoy } from '../core/joy.js';
import { addTodo } from '../core/todos.js';
import { addGift, PRICE_TIERS } from '../core/gifts.js';

// ------------------------------------------------------------
// 记一条快乐
// ------------------------------------------------------------
export function openJoyForm({ onSaved } = {}) {
  const html = `
    <div class="field">
      <label>今天什么让你开心</label>
      <textarea data-joy-text placeholder="一句话就够，不用正经" maxlength="120"></textarea>
    </div>
    <div class="field" style="margin-bottom:4px">
      <label>快乐程度</label>
      <div class="joy-score-row">
        <span class="joy-score-num" data-joy-num>3</span>
        <span class="joy-score-label" data-joy-label>开心</span>
        <span class="badge" data-joy-pts>+3 分</span>
      </div>
      <input type="range" min="1" max="5" step="1" value="3" data-joy-range aria-label="快乐程度，1 到 5 档">
      <div class="joy-scale">
        ${JOY_BANDS.map((b) => `<span>${esc(b.label)}</span>`).join('')}
      </div>
    </div>
    <p class="hint">没完成任务的日子也能存点分 —— 这一栏奖励「过得好」。</p>
  `;

  const sheet = openSheet({
    title: '记一条快乐',
    html,
    footer: '<button class="btn btn-primary btn-block" data-save="1">存进快乐银行</button>',
  });

  const body = sheet.body;
  const range = body.querySelector('[data-joy-range]');
  const numEl = body.querySelector('[data-joy-num]');
  const labelEl = body.querySelector('[data-joy-label]');
  const ptsEl = body.querySelector('[data-joy-pts]');

  const sync = () => {
    const band = joyBand(Number(range.value));
    numEl.textContent = String(band.score);
    labelEl.textContent = band.label;
    ptsEl.textContent = `+${band.points} 分`;
    range.style.setProperty('--fill', `${((band.score - 1) / 4) * 100}%`);
  };
  range.addEventListener('input', sync);
  sync();

  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-save]')) return;
    const text = body.querySelector('[data-joy-text]').value.trim();
    if (!text) {
      toast('写一句吧，哪怕三个字', 'warn');
      return;
    }
    const { points } = addJoy({ content: text, score: Number(range.value) });
    sheet.close();
    toast(`存下了 · +${points} 分`);
    if (onSaved) onSaved(points);
  });

  setTimeout(() => body.querySelector('[data-joy-text]')?.focus(), 260);
  return sheet;
}

// ------------------------------------------------------------
// 新建目标（两段式一屏：是什么 / 多久怎么算完成）
// ------------------------------------------------------------
export function openGoalForm({ onCreated, prefillTitle = '' } = {}) {
  const today = todayStr();
  const form = {
    title: prefillTitle,
    dimension: 'health',
    start_date: today,
    due_date: addDays(today, 56),
    rhythm: 'weekly',
  };

  const html = `
    <div class="field">
      <label>目标是什么</label>
      <input type="text" data-f="title" placeholder="例如：跑完半马" maxlength="40" value="${esc(prefillTitle)}">
    </div>
    <div class="field">
      <label>属于哪个维度</label>
      <div class="chips chips--grid3" data-chips="dimension">
        ${DIMENSIONS.map((d) => `<button type="button" data-v="${d.key}" class="${d.key === form.dimension ? 'is-active' : ''}">${esc(d.label)}</button>`).join('')}
      </div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>开始</label>
        <input type="date" data-f="start_date" value="${form.start_date}">
      </div>
      <div class="field">
        <label>截止</label>
        <input type="date" data-f="due_date" value="${form.due_date}">
      </div>
    </div>
    <div class="field">
      <label>多久做一次</label>
      <div class="chips chips--grid4" data-chips="rhythm">
        ${RHYTHMS.map((r) => `<button type="button" data-v="${r.key}" class="${r.key === form.rhythm ? 'is-active' : ''}">${esc(r.label)}</button>`).join('')}
      </div>
    </div>
    <p class="hint" data-preview></p>
  `;

  const sheet = openSheet({
    title: '新建目标',
    html,
    footer: '<button class="btn btn-primary btn-block" data-save="1">创建目标</button>',
  });

  const body = sheet.body;

  const refreshPreview = () => {
    const dates = planMilestoneDates({
      start: form.start_date,
      due: form.due_date,
      rhythm: form.rhythm,
    });
    const hint = body.querySelector('[data-preview]');
    if (!dates.length) {
      hint.innerHTML = '截止日期不能早于开始日期';
      return;
    }
    const unit = rhythmOf(form.rhythm).label;
    // 名字先给个样例：里程碑会单独出现在日历和今天页，得自带上下文
    const sample = milestoneTitle(form.rhythm, 0, form.title.trim() || '目标名');
    hint.innerHTML = `按「${esc(unit)}」自动生成 <strong>${dates.length}</strong> 个里程碑，第一个在 ${esc(fmtDay(dates[0]))}，最后一个在 ${esc(fmtDay(dates[dates.length - 1]))}。
      <br>它们默认叫「${esc(sample)}」这样，建好后可以逐个改名。`;
  };

  body.querySelector('[data-f="title"]').addEventListener('input', (e) => {
    form.title = e.target.value;
    refreshPreview();
  });
  ['start_date', 'due_date'].forEach((key) => {
    body.querySelector(`[data-f="${key}"]`).addEventListener('change', (e) => {
      form[key] = e.target.value;
      refreshPreview();
    });
  });

  body.querySelectorAll('[data-chips]').forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      const field = group.dataset.chips;
      form[field] = btn.dataset.v;
      group.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
      refreshPreview();
    });
  });

  refreshPreview();

  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-save]')) return;
    if (!form.title.trim()) {
      toast('先给它起个名字', 'warn');
      body.querySelector('[data-f="title"]').focus();
      return;
    }
    if (form.due_date < form.start_date) {
      toast('截止日期不能早于开始日期', 'warn');
      return;
    }
    const id = createGoal(form);
    sheet.close();
    toast('目标建好了，先去完成第一步');
    if (onCreated) onCreated(id);
  });

  setTimeout(() => body.querySelector('[data-f="title"]')?.focus(), 260);
  return sheet;
}

// ------------------------------------------------------------
// 加一步（可指定目标 / 日期）
//
// 两种语义必须分开，否则「加了一步但目标里没有它」：
//   asMilestone = true  → 写里程碑：进目标时间轴、进日历、完成 +10、算进度
//   asMilestone = false → 写待办：进今天页 / 日历、完成 +2、不动进度
// 目标详情页的「加一步」是前者（用户原话：「在目标中加一步，意味着新增一个里程碑」）。
// ------------------------------------------------------------
export function openAddStepSheet({
  goalId = null,
  asMilestone = false,
  plan_date = todayStr(),
  due = null,
  onCreated,
} = {}) {
  const isMs = Boolean(goalId && asMilestone);

  // 少开一次原生日历弹层：常用日期直接给按钮，web 上比点开日历快得多
  const quick = [
    { label: '今天', value: todayStr() },
    { label: '明天', value: addDays(todayStr(), 1) },
  ];
  if (due && due !== plan_date && !quick.some((q) => q.value === due)) {
    quick.push({ label: '目标截止日', value: due });
  }

  const html = `
    <div class="field">
      <label>这一步做什么</label>
      <input type="text" data-title placeholder="越小越好，小到今天就能做完" maxlength="60">
    </div>
    <div class="field">
      <label>放在哪天</label>
      <input type="date" data-date value="${plan_date}">
      <div class="chips chips--quick" data-quick>
        ${quick.map((q) => `<button type="button" data-day="${q.value}">${esc(q.label)}</button>`).join('')}
      </div>
    </div>
    <p class="hint">${isMs
      ? '加的是里程碑：完成后 +10 分，算进目标进度。'
      : goalId
        ? '这一件会挂在目标下面，完成 +2 分，不改变目标进度。'
        : '不挂目标也可以，它只是一件今天要做的事。'}</p>
  `;

  const sheet = openSheet({
    title: isMs ? '为这个目标加一步' : goalId ? '挑一件今天要做的事' : '加一件',
    html,
    footer: '<button class="btn btn-primary btn-block" data-save="1">加进去</button>',
  });

  const body = sheet.body;
  const dateInput = body.querySelector('[data-date]');

  const syncQuick = () => {
    body.querySelectorAll('[data-day]').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.day === dateInput.value);
    });
  };
  body.querySelectorAll('[data-day]').forEach((b) => {
    b.addEventListener('click', () => {
      dateInput.value = b.dataset.day;
      syncQuick();
    });
  });
  dateInput.addEventListener('change', syncQuick);
  syncQuick();

  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-save]')) return;
    const title = body.querySelector('[data-title]').value.trim();
    const date = dateInput.value || todayStr();
    if (!title) {
      toast('写一句要做什么', 'warn');
      return;
    }

    if (isMs) {
      const id = addMilestone(goalId, { title, plan_date: date });
      sheet.close();
      toast(date === todayStr() ? '加了一步 · 就在今天' : `加了一步 · ${fmtDay(date)}`);
      if (onCreated) onCreated(id);
      return;
    }

    addTodo({ title, plan_date: date, goal_id: goalId });
    sheet.close();
    toast(date === todayStr() ? '加到今天了' : `加到 ${fmtDay(date)} 了`);
    if (onCreated) onCreated();
  });

  setTimeout(() => body.querySelector('[data-title]')?.focus(), 260);
  return sheet;
}

// ------------------------------------------------------------
// 选一个目标（今天页空状态的出口）
// ------------------------------------------------------------
export function openGoalPicker({ onPick } = {}) {
  const s = getState();
  const active = s.goal.filter((g) => g.status !== 'abandoned' && g.status !== 'completed');

  if (!active.length) {
    toast('还没有进行中的目标，先建一个', 'warn');
    openGoalForm();
    return null;
  }

  const html = `<div class="act-list">
    ${active.map((g) => {
      const dim = dimensionOf(g.dimension);
      return `<button class="act-item" data-pick="${g.id}" style="display:flex;align-items:center;gap:9px">
        <span class="dim-bar" style="background:${dim.color}"></span>
        <span style="flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(g.title)}</span>
      </button>`;
    }).join('')}
  </div>`;

  const sheet = openSheet({ title: '从目标里挑一步', html });
  sheet.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    sheet.close();
    setTimeout(() => openAddStepSheet({ goalId: btn.dataset.pick, onCreated: onPick }), 180);
  });
  return sheet;
}

// ------------------------------------------------------------
// 里程碑：完成 / 编辑 / 删除
// ------------------------------------------------------------
export function openMilestoneSheet(ms, { onChanged } = {}) {
  const isDone = ms.status === 'done';
  const html = `
    <div class="field">
      <label>名称</label>
      <input type="text" data-title value="${esc(ms.title)}" maxlength="40">
    </div>
    <div class="field">
      <label>计划日期</label>
      <input type="date" data-date value="${ms.plan_date}">
    </div>
    ${isDone ? `
    <div class="field">
      <label>当时的感受</label>
      <textarea data-note placeholder="那时候在想什么">${esc(ms.note || '')}</textarea>
    </div>` : `
    <p class="hint">「写下当时的感受」在完成这一步的时候填 —— 编辑这里只改名称和日期。</p>`}
  `;

  const sheet = openSheet({
    title: '里程碑',
    html,
    footer: `
      <button class="btn btn-quiet" data-del="1">删除</button>
      <button class="btn btn-primary" data-save="1">保存</button>
    `,
  });

  const body = sheet.body;
  sheet.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-save]')) {
      const patch = {
        title: body.querySelector('[data-title]').value.trim() || ms.title,
        plan_date: body.querySelector('[data-date]').value || ms.plan_date,
      };
      const noteEl = body.querySelector('[data-note]');
      if (noteEl) patch.note = noteEl.value.trim();
      updateMilestone(ms.id, patch);
      sheet.close();
      toast('改好了');
      if (onChanged) onChanged();
      return;
    }

    if (e.target.closest('[data-del]')) {
      const s = getState();
      const count = s.milestone.filter((m) => m.goal_id === ms.goal_id).length;
      if (count <= 1) {
        toast('至少留一个里程碑，否则进度没有定义', 'warn');
        return;
      }
      const ok = await confirmSheet({
        title: '删掉这个里程碑？',
        message: '它会从时间轴上消失，进度会重新算。',
        okText: '删掉',
        danger: true,
      });
      if (!ok) return;
      sheet.close();
      removeMilestone(ms.id);
      toast('已删除');
      if (onChanged) onChanged();
    }
  });

  return sheet;
}

/**
 * 完成这一步：感受和完成写在一次提交里。
 * 分开做会留下「感受写了、状态没变」的中间态（真实用户踩过）。
 */
export function openMilestoneDoneSheet(ms, { onChanged } = {}) {
  const sheet = openSheet({
    title: `完成「${ms.title}」`,
    html: `
      <div class="done-hint">
        <span class="done-pts">+10</span>
        <span>完成后记在今天的日历上</span>
      </div>
      <div class="field">
        <label>说一句（选填）</label>
        <textarea data-note placeholder="不用写得漂亮，写给你自己">${esc(ms.note || '')}</textarea>
      </div>
      <p class="hint">计划日期是 ${esc(ms.plan_date)}。晚一点做也没关系，不扣分。</p>
    `,
    footer: `
      <button class="btn btn-quiet" data-cancel="1">再等等</button>
      <button class="btn btn-primary" style="flex:1" data-done="1">完成这一步</button>
    `,
  });

  sheet.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) { sheet.close(); return; }
    if (!e.target.closest('[data-done]')) return;
    const note = sheet.body.querySelector('[data-note]').value;
    const ok = completeMilestone(ms.id, { note });
    sheet.close();
    setTimeout(() => {
      if (ok) toast('+10 分');
      if (onChanged) onChanged();
    }, 180);
  });

  return sheet;
}

/** 里程碑动作菜单（点时间轴某一项时弹出） */
export function openMilestoneActions(ms, { onChanged } = {}) {
  const done = ms.status === 'done';
  actionSheet({
    title: ms.title,
    actions: [
      done
        ? {
            label: '撤销完成（-10 冲正）',
            onSelect: () => {
              revertMilestone(ms.id);
              toast('已撤销，写了一条冲正流水', 'warn');
              if (onChanged) onChanged();
            },
          }
        : {
            label: '完成这一步（+10）',
            onSelect: () => openMilestoneDoneSheet(ms, { onChanged }),
          },
      { label: '修改名称 / 日期 / 感受', onSelect: () => openMilestoneSheet(ms, { onChanged }) },
      {
        label: '删除',
        danger: true,
        onSelect: () => {
          const s = getState();
          const count = s.milestone.filter((m) => m.goal_id === ms.goal_id).length;
          if (count <= 1) {
            toast('至少留一个里程碑', 'warn');
            return;
          }
          removeMilestone(ms.id);
          toast('已删除');
          if (onChanged) onChanged();
        },
      },
    ],
  });
}

// ------------------------------------------------------------
// 加一个礼物
// ------------------------------------------------------------
export function openGiftForm({ onCreated } = {}) {
  const html = `
    <div class="field">
      <label>想要什么</label>
      <input type="text" data-title placeholder="一杯奶茶 / 一本想要的书" maxlength="30">
    </div>
    <div class="field">
      <label>多少分能换</label>
      <input type="number" data-price placeholder="60" min="1" step="1" inputmode="numeric">
    </div>
    <p class="hint">
      参考价：${PRICE_TIERS.map((t) => `${esc(t.label)} ${esc(t.range)}（${esc(t.hint)}）`).join(' · ')}
    </p>
  `;

  const sheet = openSheet({
    title: '想再要一个',
    html,
    footer: '<button class="btn btn-primary btn-block" data-save="1">加进清单</button>',
  });

  const body = sheet.body;
  sheet.el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-save]')) return;
    const title = body.querySelector('[data-title]').value.trim();
    const price = Number(body.querySelector('[data-price]').value);
    if (!title) return toast('写个名字', 'warn');
    if (!Number.isFinite(price) || price <= 0) return toast('定个价，比如 60', 'warn');
    addGift({ title, price });
    sheet.close();
    toast('加进清单了，慢慢攒');
    if (onCreated) onCreated();
  });

  setTimeout(() => body.querySelector('[data-title]')?.focus(), 260);
  return sheet;
}
