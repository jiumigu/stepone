// ============================================================
// app.js — 启动 + tab 路由 + 跨页事件
//
// 路由策略：4 个 tab 常驻 DOM，切换只做显隐；
// 目标详情是自建二级页（有显式返回，不依赖浏览器后退）。
// 数据变更后：当前页由各模块自己 update()，其它 tab 标记 dirty，
// 切过去时再刷新 —— 避免写操作把正在播的动画打断。
// ============================================================

import { getState, subscribe, commit } from './core/store.js';
import { registerGiftSync } from './core/gifts.js';
import { rollRoutines } from './core/routines.js';
import { esc, todayStr } from './core/util.js';
import { openSheet, toast } from './ui/components.js';
import * as today from './ui/today.js';
import * as goals from './ui/goals.js';
import * as calendar from './ui/calendar.js';
import * as bank from './ui/bank.js';
import { openDataSheet } from './ui/data.js';

const PAGES = { today, goals, calendar, bank };
const mounted = { today: false, goals: false, calendar: false, bank: false };
const dirty = new Set();
let current = 'today';

registerGiftSync();

function pageEl(tab) {
  return document.querySelector(`[data-page="${tab}"]`);
}

function updateTabbar() {
  document.querySelectorAll('#tabbar button').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.tab === current);
  });
}

function go(tab, { goalId } = {}) {
  if (!PAGES[tab]) return;
  // 桌面端侧栏在详情页之上可点，切 tab 时必须把详情页收掉，
  // 否则它会一直盖在新页面上（手机端被挡住，看不出来）
  if (goals.isDetailOpen()) goals.closeDetail();

  for (const key of Object.keys(PAGES)) {
    const el = pageEl(key);
    if (el) el.hidden = key !== tab;
  }
  current = tab;

  if (!mounted[tab]) {
    PAGES[tab].mount(pageEl(tab));
    mounted[tab] = true;
  } else if (dirty.has(tab)) {
    PAGES[tab].update();
  }

  dirty.delete(tab);
  updateTabbar();

  if (goalId && tab === 'goals') goals.openDetail(goalId);
}

// 当前页自己控制刷新时机，其它页标脏
subscribe(() => {
  for (const key of Object.keys(PAGES)) {
    if (key !== current) dirty.add(key);
  }
});

// ---- 首次引导 ---------------------------------------------
const ONBOARD_STEPS = [
  {
    title: '目标太远，先做一步',
    text: '把「今年想做成的一件事」拆成今天能做完的两三个动作。不管理目标，只看今天这一步。',
  },
  {
    title: '做完就有分',
    text: '完成一件待办 +2，完成一个里程碑 +10，整件事做完 +30。分数只由事件产生，不能自己加。',
  },
  {
    title: '攒够了就换',
    text: '把「舍不得买」的东西写进想要清单，标个价。攒够了就换 —— 那句「这是你攒出来的」，比任何进度条都有用。',
  },
];

function showOnboarding() {
  let step = 0;

  const render = () => {
    const item = ONBOARD_STEPS[step];
    const isLast = step === ONBOARD_STEPS.length - 1;
    return `
      <div class="onboard-step">
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.text)}</p>
      </div>
      <div class="onboard-dots">
        ${ONBOARD_STEPS.map((_, i) => `<i class="${i === step ? 'is-on' : ''}"></i>`).join('')}
      </div>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button class="btn btn-quiet" data-skip="1">跳过</button>
        <button class="btn btn-primary" style="flex:1" data-next="1">${isLast ? '开始' : '下一步'}</button>
      </div>
    `;
  };

  const sheet = openSheet({ title: '一步', html: render() });

  const finish = () => {
    commit((s) => { s.setting.onboarded = true; });
    sheet.close();
  };

  sheet.el.addEventListener('click', (e) => {
    if (e.target.closest('[data-skip]')) return finish();
    if (e.target.closest('[data-next]')) {
      if (step === ONBOARD_STEPS.length - 1) return finish();
      step += 1;
      sheet.body.innerHTML = render();
    }
  });
}

// ---- 协议提示（直接双击打开 html 时 module 无法加载）----------
function protocolTip() {
  if (location.protocol !== 'file:') return;
  const tip = document.createElement('div');
  tip.className = 'proto-tip';
  tip.innerHTML = '当前用 file:// 打开，ES module 会被浏览器拦截。请在项目目录跑 <code>python3 -m http.server 8080</code>，再访问 <code>http://localhost:8080</code>';
  document.body.appendChild(tip);
}

// ---- 跨天：重复任务换新的一天 ------------------------------
// 页面可能整夜开着（桌面常驻标签页），靠定时器 + 可见性变化兜住午夜。
let currentDay = todayStr();

function checkDayChange() {
  const now = todayStr();
  if (now === currentDay) return;
  currentDay = now;
  rollRoutines(now);
  if (mounted.today) today.update();
}

// ---- PWA ---------------------------------------------------
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (!/^https?:$/.test(location.protocol)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('[stepone] Service Worker 注册失败', err);
    });
  });
}

// ---- 启动 -------------------------------------------------
function boot() {
  protocolTip();
  registerSW();

  document.getElementById('tabbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) { go(btn.dataset.tab); return; }
    if (e.target.closest('[data-data]')) openDataSheet();
  });

  document.addEventListener('stepone:navigate', (e) => {
    const { tab, goalId } = e.detail || {};
    go(tab, { goalId });
  });

  // 导入备份 = 整份数据被替换，所有页面（含当前页）都要重画
  document.addEventListener('stepone:data-replaced', () => {
    if (goals.isDetailOpen()) goals.closeDetail();
    dirty.clear();
    for (const key of Object.keys(PAGES)) {
      if (mounted[key]) PAGES[key].update();
    }
  });

  document.addEventListener('stepone:storage-error', () => {
    toast('这次没存进去 —— 检查浏览器存储空间或隐私模式', 'warn');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && goals.isDetailOpen()) goals.closeDetail();
  });

  // 今天该出现的重复任务先落成待办，再渲染首屏
  rollRoutines();
  currentDay = todayStr();
  setInterval(checkDayChange, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkDayChange();
  });

  go('today');

  const s = getState();
  if (!s.setting.onboarded) setTimeout(showOnboarding, 420);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
