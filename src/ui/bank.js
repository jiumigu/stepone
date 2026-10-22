// ============================================================
// bank.js — 快乐银行：余额 + 流水 + 礼物
// 余额是账本求和；礼物状态是派生的，UI 不提供状态切换控件
// ============================================================

import { getState } from '../core/store.js';
import {
  todayEarned, weekEarned, totalEarned, totalSpent, currentBalance,
  incomeBreakdown, filteredTxns, TXN_FILTERS, txnTitle, joyOfTxn,
} from '../core/selectors.js';
import { giftsWithStatus, redeemGift, GIFT_STATUS_LABEL } from '../core/gifts.js';
import { RULE, REASON, joyBand } from '../core/points.js';
import { esc, fmtDay, isoToDay, toTimeStr } from '../core/util.js';
import {
  toast, confirmSheet, emptyBlock, sectionTitle, badge, stat,
} from './components.js';
import { openJoyForm, openGiftForm } from './pickers.js';
import { openDataSheet, lastExportLabel } from './data.js';

let els = {};
let filter = 'all';

const skeleton = `
  <header class="page-head">
    <div>
      <h1>快乐银行</h1>
      <p class="sub">分是挣来的，不是刷出来的</p>
    </div>
    <button class="chip-btn" data-joy>记快乐</button>
  </header>
  <main class="scroll" data-body></main>
`;

function txnRow(t, s) {
  const tone = t.delta > 0 ? 'is-in' : t.delta < 0 ? 'is-out' : 'is-zero';
  const sign = t.delta > 0 ? '+' : '';
  const time = `${isoToDay(t.created_at) === isoToDay(new Date().toISOString()) ? '今天' : fmtDay(isoToDay(t.created_at))} ${toTimeStr(t.created_at)}`;

  // 快乐记录：标题是「你写的那件事」，副行才是档位（见 selectors.txnTitle）
  const joy = joyOfTxn(t, s);
  const title = txnTitle(t, s);
  const sub = joy ? `${joyBand(joy.score).label} · ${time}` : time;

  return `<div class="txn">
    <div class="txn-main">
      <div class="txn-title">${esc(title)}</div>
      <div class="txn-time">${esc(sub)}</div>
    </div>
    <div class="txn-delta ${tone}">${sign}${t.delta}</div>
  </div>`;
}

function giftCard(g) {
  const pct = Math.max(0, Math.min(1, g.price > 0 ? currentBalance(getState()) / g.price : 0));
  const isRedeemed = g.derived === 'redeemed';
  const tone = isRedeemed ? 'muted' : g.derived === 'waiting' ? 'waiting' : 'neutral';

  let foot = '';
  if (isRedeemed) {
    foot = `<span>${esc(fmtDay(isoToDay(g.redeemed_at)))} 换的</span><span class="badge badge--done">已兑换</span>`;
  } else if (g.derived === 'waiting') {
    foot = `<span>攒够了，随时能换</span><button class="btn btn-sm btn-primary" data-redeem="${g.id}">现在可以换</button>`;
  } else {
    foot = `<span>还差 ${g.short} 分</span><span class="badge badge--muted">已攒 ${Math.round(pct * 100)}%</span>`;
  }

  return `<div class="gift ${isRedeemed ? 'is-redeemed' : g.derived === 'waiting' ? 'is-waiting' : ''}">
    <div class="gift-top">
      <span class="gift-title">${esc(g.title)}</span>
      <span class="gift-price">${g.price} 分</span>
    </div>
    <div class="gift-bar"><span style="width:${(isRedeemed ? 1 : pct) * 100}%"></span></div>
    <div class="gift-foot">${foot}</div>
  </div>`;
}

function render() {
  const s = getState();
  const bal = currentBalance(s);
  const bd = incomeBreakdown(s);
  const gifts = giftsWithStatus(s);
  const txns = filteredTxns(s, filter);

  const bdBar = bd.some((x) => x.pct > 0)
    ? bd.map((x) => `<span style="width:${(x.pct * 100).toFixed(1)}%;background:${x.color}"></span>`).join('')
    : '<span style="width:100%;background:var(--line)"></span>';

  els.body.innerHTML = `
    <div class="balance-card">
      <div class="balance-label">当前余额</div>
      <div class="balance-num">${bal}<small>分</small></div>
      <div class="balance-row">
        ${stat('本周收入', `+${weekEarned(s)}`)}
        ${stat('今天', `+${todayEarned(s)}`)}
        ${stat('已兑换', `${totalSpent(s)}`)}
      </div>
    </div>

    <div class="breakdown">
      <div class="bd-bar">${bdBar}</div>
      <div class="bd-legend">
        ${bd.map((x) => `<div><span class="bd-swatch" style="background:${x.color}"></span>${esc(x.label)} ${x.value}</div>`).join('')}
      </div>
    </div>

    ${sectionTitle(`想要的东西 · ${gifts.filter((g) => g.derived !== 'redeemed').length}`, '')}
    ${gifts.length ? gifts.map(giftCard).join('') : emptyBlock({
      title: '还没有想要的东西',
      text: '把「舍不得买」的写进来，让它变成攒出来的',
      action: { key: 'new-gift', label: '想再要一个' },
    })}
    <button class="btn btn-ghost btn-block" data-new-gift style="margin-bottom:6px">＋ 想再要一个</button>

    ${sectionTitle('流水', `<span class="hint" style="margin:0">累计赚 ${totalEarned(s)}</span>`)}
    <div class="filter-row">
      ${TXN_FILTERS.map((f) => `<button data-filter="${f.key}" class="${filter === f.key ? 'is-active' : ''}">${esc(f.label)}</button>`).join('')}
    </div>
    <div class="txn-list">
      ${txns.length ? txns.map((t) => txnRow(t, s)).join('') : '<p class="hint" style="padding:12px 2px">还没有流水。完成一件待办就会有一条。</p>'}
    </div>

    ${sectionTitle('数据', '')}
    <button class="row-entry" data-data="1">
      <div class="row-entry-main">
        <div class="row-entry-title">备份与恢复</div>
        <div class="row-entry-sub">只存在这台设备 · 上次导出 ${esc(lastExportLabel(s))}</div>
      </div>
      <span class="row-entry-chev" aria-hidden="true">›</span>
    </button>
    <div style="height:10px"></div>
  `;
}

export function mount(root) {
  root.innerHTML = skeleton;
  els = { root, body: root.querySelector('[data-body]') };

  root.querySelector('[data-joy]').addEventListener('click', () => {
    openJoyForm({ onSaved: () => update() });
  });

  els.body.addEventListener('click', async (e) => {
    const filterBtn = e.target.closest('[data-filter]');
    if (filterBtn) {
      filter = filterBtn.dataset.filter;
      render();
      return;
    }

    if (e.target.closest('[data-data]')) {
      openDataSheet();
      return;
    }

    if (e.target.closest('[data-new-gift]') ||
        (e.target.closest('[data-act]') && e.target.closest('[data-act]').dataset.act === 'new-gift')) {
      openGiftForm({ onCreated: () => update() });
      return;
    }

    const redeemBtn = e.target.closest('[data-redeem]');
    if (redeemBtn) {
      const id = redeemBtn.dataset.redeem;
      const gift = getState().gift.find((g) => g.id === id);
      if (!gift) return;
      const ok = await confirmSheet({
        title: `用 ${gift.price} 分换${gift.title}？`,
        message: '换完余额会变少，这是正常的 —— 本来就是你攒的。',
        okText: '换',
      });
      if (!ok) return;
      const res = redeemGift(id);
      if (!res.ok) {
        toast(res.reason === 'balance' ? `还差 ${res.short} 分` : '现在换不了', 'warn');
        update();
        return;
      }
      toast('这是你攒出来的');
      update();
    }
  });

  update();
}

export function update() {
  if (els.body) render();
}
