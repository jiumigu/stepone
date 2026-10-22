// ============================================================
// components.js — 通用 UI 原子件
// 只做视图，不碰业务；所有业务动作由调用方通过 data-act 委托
// ============================================================

import { esc, numOrDash } from '../core/util.js';

// ---- Toast -------------------------------------------------
let toastTimer = null;

export function toast(message, tone = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 1900);
}

// ---- 底部抽屉 / 弹层 ---------------------------------------
function layerRoot() {
  let root = document.getElementById('layer');
  if (!root) {
    root = document.createElement('div');
    root.id = 'layer';
    document.body.appendChild(root);
  }
  return root;
}

/**
 * 打开一个抽屉。
 * @returns {{el:HTMLElement, body:HTMLElement, close:Function}}
 */
export function openSheet({ title = '', html = '', footer = '', size = 'auto' }) {
  const root = layerRoot();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-scrim" data-close="1"></div>
    <section class="sheet sheet--${size}" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      ${title ? `<header class="sheet-head"><h2>${esc(title)}</h2><button class="sheet-x" data-close="1" aria-label="关闭">✕</button></header>` : ''}
      <div class="sheet-body"></div>
      ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ''}
    </section>
  `;
  const body = wrap.querySelector('.sheet-body');
  body.innerHTML = html;
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('is-on'));

  const close = () => {
    wrap.classList.remove('is-on');
    setTimeout(() => wrap.remove(), 220);
    document.body.classList.remove('no-scroll');
  };

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  document.body.classList.add('no-scroll');

  return { el: wrap, body, close };
}

/** 二次确认，返回 Promise<boolean> */
export function confirmSheet({ title, message, okText = '确定', cancelText = '再想想', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      sheet.close();
      resolve(value);
    };

    const sheet = openSheet({
      title,
      html: `<p class="confirm-msg">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-quiet" data-cancel="1">${esc(cancelText)}</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok="1">${esc(okText)}</button>
      `,
    });

    sheet.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ok]')) finish(true);
      if (e.target.closest('[data-cancel]')) finish(false);
      if (e.target.closest('.sheet-scrim, .sheet-x')) finish(false);
    });
  });
}

/** 底部动作菜单 */
export function actionSheet({ title, actions }) {
  const html = `<div class="act-list">
    ${actions.map((a, i) => `<button class="act-item ${a.danger ? 'is-danger' : ''}" data-idx="${i}">${esc(a.label)}</button>`).join('')}
  </div>`;
  const sheet = openSheet({ title, html });
  sheet.el.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-idx]');
    if (!btn) return;
    const action = actions[Number(btn.dataset.idx)];
    sheet.close();
    if (action && action.onSelect) setTimeout(() => action.onSelect(), 180);
  });
  return sheet;
}

// ---- 进度环 ------------------------------------------------
/** ratio 为 null 时显示空心虚线圈（进度无定义） */
export function progressRing(ratio, { size = 44, stroke = 5, label = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const defined = ratio !== null && ratio !== undefined;
  const value = defined ? Math.max(0, Math.min(1, ratio)) : 0;
  const dash = defined ? c * value : 0;
  const pct = defined ? Math.round(value * 100) : null;

  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-label="进度 ${numOrDash(pct)}%">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="var(--line-strong)" stroke-width="${stroke}"
      ${defined ? '' : 'stroke-dasharray="4 5"'} />
    ${defined && value > 0 ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none"
      stroke="var(--brand)" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})" />` : ''}
    <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
      class="ring-text">${label || (defined ? `${pct}%` : '—')}</text>
  </svg>`;
}

// ---- 空状态（必须给出口）-----------------------------------
export function emptyBlock({ title, text = '', action = null }) {
  return `<div class="empty">
    <div class="empty-dot"></div>
    <p class="empty-title">${esc(title)}</p>
    ${text ? `<p class="empty-text">${esc(text)}</p>` : ''}
    ${action ? `<button class="btn btn-soft" data-act="${esc(action.key)}">${esc(action.label)}</button>` : ''}
  </div>`;
}

// ---- 小件 --------------------------------------------------
export function sectionTitle(text, right = '') {
  return `<div class="sec-head"><h3>${esc(text)}</h3>${right}</div>`;
}

export function badge(text, tone = 'neutral') {
  return `<span class="badge badge--${tone}">${esc(text)}</span>`;
}

export function stat(label, value) {
  return `<div class="stat"><span class="stat-label">${esc(label)}</span><span class="stat-value">${esc(value)}</span></div>`;
}

/** 数字三态渲染：null/undefined -> '—'，0 -> '0' */
export { numOrDash };
