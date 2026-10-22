// ============================================================
// routines.js (ui) — 「重复的事」抽屉
// 只依赖 core + components，不 import today.js（避免成环）；
// 变更后通过 onChange 回调通知调用方刷新。
// ============================================================

import { openSheet, actionSheet, confirmSheet, toast } from './components.js';
import { getState } from '../core/store.js';
import { esc } from '../core/util.js';
import {
  RULES, ruleLabel, createRoutine, removeRoutine,
  setRoutineActive, skipToday,
} from '../core/routines.js';

const WEEK_LABELS = [
  { d: 1, t: '一' }, { d: 2, t: '二' }, { d: 3, t: '三' },
  { d: 4, t: '四' }, { d: 5, t: '五' }, { d: 6, t: '六' }, { d: 0, t: '日' },
];

function listHtml() {
  const s = getState();
  if (!s.routine.length) {
    return `<p class="hint">还没有重复的事。加上「每天拉伸 10 分钟」这种，到点它自己出现在今天。</p>`;
  }
  return `<div class="rt-list">
    ${s.routine.map((r) => `
      <button class="rt-row ${r.active ? '' : 'is-off'}" data-rt="${r.id}">
        <span class="rt-mark">↻</span>
        <span class="rt-main">
          <span class="rt-title">${esc(r.title)}</span>
          <span class="rt-sub">${esc(ruleLabel(r))}${r.active ? '' : ' · 已暂停'}</span>
        </span>
      </button>`).join('')}
  </div>`;
}

function formHtml() {
  return `
    <div class="field">
      <label>要重复做什么</label>
      <input type="text" data-title maxlength="40" placeholder="例如：拉伸 10 分钟">
    </div>
    <div class="field">
      <label>多久一次</label>
      <div class="chips chips--grid3" data-rule>
        ${Object.entries(RULES).map(([k, label]) =>
          `<button type="button" data-v="${k}" class="${k === 'daily' ? 'is-active' : ''}">${esc(label)}</button>`).join('')}
      </div>
    </div>
    <div class="field" data-week-wrap hidden>
      <label>哪几天</label>
      <div class="chips chips--grid4" data-week>
        ${WEEK_LABELS.map((w) => `<button type="button" data-d="${w.d}">${w.t}</button>`).join('')}
      </div>
    </div>
    <p class="hint">只在你会打开它的日子里出现。错过几天不补，也不会变成一堆逾期。</p>
  `;
}

export function openRoutineSheet({ onChange } = {}) {
  const notify = () => { if (onChange) onChange(); };

  const sheet = openSheet({
    title: '重复的事',
    html: `${listHtml()}<button class="btn btn-ghost btn-block" data-new style="margin-top:14px">＋ 加一件重复的事</button>`,
  });

  const body = sheet.body;

  const showList = () => {
    body.innerHTML = `${listHtml()}<button class="btn btn-ghost btn-block" data-new style="margin-top:14px">＋ 加一件重复的事</button>`;
  };

  const showForm = () => {
    body.innerHTML = formHtml();
    const titleEl = body.querySelector('[data-title]');
    const ruleGroup = body.querySelector('[data-rule]');
    const weekWrap = body.querySelector('[data-week-wrap]');
    const weekGroup = body.querySelector('[data-week]');
    const picked = new Set();
    let rule = 'daily';

    ruleGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-v]');
      if (!btn) return;
      rule = btn.dataset.v;
      ruleGroup.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b === btn));
      weekWrap.hidden = rule !== 'weekly';
    });

    weekGroup.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-d]');
      if (!btn) return;
      const d = Number(btn.dataset.d);
      if (picked.has(d)) picked.delete(d); else picked.add(d);
      btn.classList.toggle('is-active', picked.has(d));
    });

    titleEl.focus();

    const save = () => {
      const text = titleEl.value.trim();
      if (!text) { toast('先写要做什么', 'warn'); return; }
      if (rule === 'weekly' && !picked.size) { toast('选一天，不然它不会出现', 'warn'); return; }
      createRoutine({ title: text, rule, weekdays: [...picked] });
      toast('加好了，今天就会出现');
      notify();
      showList();
    };

    // 表单底部按钮（插在 body 末尾，避免与底部固定 footer 打架）
    const bar = document.createElement('div');
    bar.className = 'rt-form-bar';
    bar.innerHTML = `
      <button class="btn btn-quiet" data-back>返回</button>
      <button class="btn btn-primary" style="flex:1" data-save>加进去</button>`;
    body.appendChild(bar);
    bar.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) showList();
      if (e.target.closest('[data-save]')) save();
    });
  };

  sheet.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-new]')) { showForm(); return; }

    const row = e.target.closest('[data-rt]');
    if (!row) return;
    const id = row.dataset.rt;
    const r = getState().routine.find((x) => x.id === id);
    if (!r) return;

    actionSheet({
      title: r.title,
      actions: [
        {
          label: '今天不做（明天照常）',
          onSelect: () => {
            skipToday(r.id);
            notify();
            showList();
            toast('今天跳过，明天照常');
          },
        },
        {
          label: r.active ? '暂停这个重复' : '恢复这个重复',
          onSelect: () => {
            setRoutineActive(r.id, !r.active);
            notify();
            showList();
            toast(r.active ? '已暂停' : '已恢复');
          },
        },
        {
          label: '删除',
          danger: true,
          onSelect: async () => {
            const ok = await confirmSheet({
              title: '删掉「' + r.title + '」？',
              message: '已经生成的待办会保留，之后不再自动出现。',
              okText: '删除',
              danger: true,
            });
            if (!ok) return;
            removeRoutine(r.id);
            notify();
            showList();
            toast('已删除');
          },
        },
      ],
    });
  });
}
