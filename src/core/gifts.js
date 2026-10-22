// ============================================================
// gifts.js — 礼物：状态由余额派生，不允许手动切换
//
// 铁律 6：pending <-> waiting 是派生值，每次写流水后重算。
// 余额不足禁止兑换（不做负数余额）。
// ============================================================

import { getState, commit, onAfterCommit } from './store.js';
import { uid, nowIso } from './util.js';
import { pushTxn, balance, REASON } from './points.js';

export const GIFT_STATUS_LABEL = {
  pending: '还差一点',
  waiting: '现在可以换',
  redeemed: '已兑换',
  cancelled: '已取消',
};

/** 价格档位参考（让定价有手感，不通胀） */
export const PRICE_TIERS = [
  { label: '小确幸', range: '30 ~ 60', hint: '一杯奶茶' },
  { label: '想要很久', range: '150 ~ 300', hint: '一本想要的书' },
  { label: '大件', range: '800 以上', hint: '一次短途旅行' },
];

/** 终态直接返回自身；其余由余额派生 */
export function deriveGiftStatus(gift, bal) {
  if (gift.status === 'redeemed' || gift.status === 'cancelled') return gift.status;
  return bal >= gift.price ? 'waiting' : 'pending';
}

export function giftsWithStatus(s = getState()) {
  const bal = balance(s);
  return [...s.gift]
    .map((g) => ({ ...g, derived: deriveGiftStatus(g, bal), short: Math.max(0, g.price - bal) }))
    .sort((a, b) => {
      const rank = (x) => (x.derived === 'waiting' ? 0 : x.derived === 'pending' ? 1 : 2);
      return rank(a) - rank(b) || b.created_at.localeCompare(a.created_at);
    });
}

export function addGift({ title, price }) {
  const name = String(title || '').trim();
  const amount = Math.round(Number(price));
  if (!name || !Number.isFinite(amount) || amount <= 0) return null;

  const gift = {
    id: uid('gift'),
    title: name,
    price: amount,
    status: 'pending',
    created_at: nowIso(),
    redeemed_at: null,
  };
  commit((s) => { s.gift.push(gift); });
  return gift;
}

export function removeGift(id) {
  commit((s) => {
    const g = s.gift.find((x) => x.id === id);
    if (!g || g.status === 'redeemed') return;
    s.gift = s.gift.filter((x) => x.id !== id);
  });
}

/**
 * 兑换。校验顺序：存在 -> 未兑换 -> 余额足够。
 * @returns {{ok:boolean, reason?:string, short?:number, gift?:object}}
 */
export function redeemGift(id) {
  const s = getState();
  const gift = s.gift.find((g) => g.id === id);
  if (!gift) return { ok: false, reason: 'notfound' };
  if (gift.status === 'redeemed') return { ok: false, reason: 'redeemed' };

  const bal = balance(s);
  if (bal < gift.price) {
    return { ok: false, reason: 'balance', short: gift.price - bal };
  }

  commit((st) => {
    const g = st.gift.find((x) => x.id === id);
    if (!g || g.status === 'redeemed') return;
    pushTxn(st, {
      delta: -g.price,
      reason_code: REASON.GIFT_REDEEM,
      ref_id: g.id,
      note: `兑换「${g.title}」`,
    });
    g.status = 'redeemed';
    g.redeemed_at = nowIso();
  });

  return { ok: true, gift };
}

/** 派生态回写缓存（不构成第二个真源，UI 仍以 derive 为准） */
export function syncGiftStatuses(s) {
  const bal = balance(s);
  for (const g of s.gift) {
    if (g.status === 'redeemed' || g.status === 'cancelled') continue;
    g.status = bal >= g.price ? 'waiting' : 'pending';
  }
}

/** 注册到 store 的 afterCommit（app 启动时调用一次） */
export function registerGiftSync() {
  return onAfterCommit(syncGiftStatuses);
}
