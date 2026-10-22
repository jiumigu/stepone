// ============================================================
// goals.js — 目标 + 里程碑 + 进度口径
//
// 铁律 3：进度 = 已完成里程碑 / 总里程碑，只算不填。
// 状态机：planning -> in_progress（首个里程碑完成）-> completed（全部完成，发 +30）
// ============================================================

import { getState, commit } from './store.js';
import { addDays, addMonths, diffDays, uid, nowIso, todayStr } from './util.js';
import { pushTxn, hasAwarded, REASON, RULE } from './points.js';

export const DIMENSIONS = [
  { key: 'health', label: '身体健康', color: '#E9793F' },
  { key: 'learn', label: '学习成长', color: '#4A8FE7' },
  { key: 'career', label: '事业发展', color: '#7C6BD8' },
  { key: 'wealth', label: '财富', color: '#3E9B6D' },
  { key: 'life', label: '生活', color: '#D96A9B' },
  { key: 'create', label: '创作', color: '#C79A2E' },
];

export const RHYTHMS = [
  { key: 'daily', label: '每天' },
  { key: 'weekly', label: '每周' },
  { key: 'monthly', label: '每月' },
  { key: 'once', label: '一次性' },
];

export const GOAL_STATUS_LABEL = {
  planning: '未开始',
  in_progress: '进行中',
  completed: '已完成',
  abandoned: '已放弃',
};

export function dimensionOf(key) {
  return DIMENSIONS.find((d) => d.key === key) || DIMENSIONS[0];
}

export function rhythmOf(key) {
  return RHYTHMS.find((r) => r.key === key) || RHYTHMS[0];
}

/** 里程碑数量保护上限：防止「每天」× 一年 生成 365 条 */
export const MAX_MILESTONES = 60;

/**
 * 按节奏模板生成里程碑日期。
 * 「均匀铺在起止区间内」—— 若基础步长会超过上限，则等比例放大步长，
 * 保证首尾都落在区间内，而不是简单截断。
 */
export function planMilestoneDates({ start, due, rhythm }) {
  if (!start || !due || due < start) return [];

  if (rhythm === 'once') return [due];

  if (rhythm === 'monthly') {
    const out = [];
    let cur = start;
    while (cur <= due && out.length < MAX_MILESTONES) {
      out.push(cur);
      cur = addMonths(cur, 1);
    }
    return out.length ? out : [due];
  }

  const baseStep = rhythm === 'daily' ? 1 : 7;
  const span = Math.max(0, diffDays(start, due));
  const rawCount = Math.floor(span / baseStep) + 1;
  const step = rawCount > MAX_MILESTONES
    ? baseStep * Math.ceil(rawCount / MAX_MILESTONES)
    : baseStep;

  const out = [];
  let cur = start;
  while (cur <= due && out.length < MAX_MILESTONES) {
    out.push(cur);
    cur = addDays(cur, step);
  }
  return out.length ? out : [due];
}

/** 里程碑自动命名的单位；一次性没有「第 N 次」的说法 */
const RHYTHM_UNIT = { daily: '天', weekly: '周', monthly: '个月' };

/** 前缀最多取目标名的前 10 个字（按字符，不劈开 emoji） */
export const TITLE_PREFIX_MAX = 10;

export function goalTitlePrefix(title) {
  const chars = Array.from(String(title || '').trim());
  if (chars.length <= TITLE_PREFIX_MAX) return chars.join('');
  return `${chars.slice(0, TITLE_PREFIX_MAX).join('')}…`;
}

/**
 * 自动生成的里程碑名字：「目标前 10 字 · 第 N 个月」。
 *
 * 为什么不只叫「第 1 个月」：里程碑会单独出现在日历抽屉、今天页、流水里，
 * 那时候上下文只有它自己，「第 3 天」三个字认不出是哪件事（真实反馈）。
 * 带上目标前缀，它走到哪儿都自解释。
 */
export function milestoneTitle(rhythm, index, goalTitle) {
  const unit = RHYTHM_UNIT[rhythm];
  if (!unit) return String(goalTitle || '').trim();
  const prefix = goalTitlePrefix(goalTitle);
  const step = `第 ${index + 1} ${unit}`;
  return prefix ? `${prefix} · ${step}` : step;
}

/**
 * 给「第 N 个月」这种裸名字补上目标前缀（老数据升级用）。
 * 只认完全匹配自动命名格式的，手改过的名字一律不动 —— 不做静默覆盖。
 * @returns {number} 实际改了几条
 */
export function prefixMilestoneTitles(goalId) {
  const goal = getState().goal.find((g) => g.id === goalId);
  const unit = goal ? RHYTHM_UNIT[goal.rhythm] : null;
  const prefix = goal ? goalTitlePrefix(goal.title) : '';
  if (!goal || !unit || !prefix) return 0;

  const bare = new RegExp(`^第\\s*\\d+\\s*${unit}$`);
  let changed = 0;

  commit((s) => {
    for (const m of s.milestone) {
      if (m.goal_id !== goalId) continue;
      if (!bare.test(m.title)) continue;
      m.title = `${prefix} · ${m.title}`;
      changed += 1;
    }
  });

  return changed;
}

export function createGoal({ title, dimension, start_date, due_date, rhythm }) {
  const goalId = uid('goal');
  const dates = planMilestoneDates({ start: start_date, due: due_date, rhythm });

  commit((s) => {
    s.goal.push({
      id: goalId,
      title: String(title).trim(),
      dimension,
      start_date,
      due_date,
      rhythm,
      status: 'planning',
      progress: dates.length ? 0 : null,
      created_at: nowIso(),
    });
    dates.forEach((planDate, i) => {
      s.milestone.push({
        id: uid('ms'),
        goal_id: goalId,
        title: milestoneTitle(rhythm, i, String(title).trim()),
        plan_date: planDate,
        order_num: i + 1,
        status: 'pending',
        done_at: null,
        note: '',
      });
    });
  });

  return goalId;
}

export function milestonesOf(goalId, s = getState()) {
  return s.milestone
    .filter((m) => m.goal_id === goalId)
    .sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.order_num - b.order_num);
}

/** 进度口径：总数为 0 时 ratio 返回 null（UI 显示「—」） */
export function goalStats(goalId, s = getState()) {
  const list = milestonesOf(goalId, s);
  const total = list.length;
  const done = list.filter((m) => m.status === 'done').length;
  return { total, done, ratio: total === 0 ? null : done / total };
}

/** 重算派生值：进度 + 状态机 + 完成奖励。只由写操作调用。 */
export function recalcGoal(goalId, s) {
  const goal = s.goal.find((g) => g.id === goalId);
  if (!goal || goal.status === 'abandoned') return;

  const { total, done, ratio } = goalStats(goalId, s);
  goal.progress = ratio;

  if (total === 0) return;

  if (done === total) {
    if (goal.status !== 'completed') {
      goal.status = 'completed';
      goal.completed_at = nowIso();
      if (!hasAwarded(s, REASON.GOAL_DONE, goalId)) {
        pushTxn(s, {
          delta: RULE[REASON.GOAL_DONE].delta,
          reason_code: REASON.GOAL_DONE,
          ref_id: goalId,
          note: `完成「${goal.title}」`,
        });
      }
    }
  } else if (done > 0) {
    if (goal.status !== 'in_progress') {
      goal.status = 'in_progress';
      goal.completed_at = null;
    }
  } else if (goal.status === 'completed' || goal.status === 'in_progress') {
    // 撤销到 0 完成：状态回落到未开始（+30 已发不回收，见 audit 已知边界）
    goal.status = 'planning';
    goal.completed_at = null;
  }
}

/**
 * 完成一个里程碑（+10）。幂等闸门在 done_at。
 * note 传进来时和完成写在同一事务里 —— 「写下当时的感受」属于完成这个动作，
 * 不该是另一张编辑表单（否则会出现「写了感受但没完成」的中间态）。
 */
export function completeMilestone(id, { note = null } = {}) {
  const s = getState();
  const target = s.milestone.find((m) => m.id === id);
  if (!target || target.done_at) return false;

  commit((st) => {
    const m = st.milestone.find((x) => x.id === id);
    if (!m || m.done_at) return;
    m.status = 'done';
    m.done_at = nowIso();
    if (note !== null) m.note = String(note).trim();
    pushTxn(st, {
      delta: RULE[REASON.MILESTONE_DONE].delta,
      reason_code: REASON.MILESTONE_DONE,
      ref_id: m.id,
      note: `完成里程碑「${m.title}」`,
    });
    recalcGoal(m.goal_id, st);
  });
  return true;
}

/** 撤销里程碑完成：写冲正流水 -10，不删原流水 */
export function revertMilestone(id) {
  const s = getState();
  const target = s.milestone.find((m) => m.id === id);
  if (!target || !target.done_at) return false;

  commit((st) => {
    const m = st.milestone.find((x) => x.id === id);
    if (!m || !m.done_at) return;
    pushTxn(st, {
      delta: -RULE[REASON.MILESTONE_DONE].delta,
      reason_code: REASON.REVERT,
      ref_id: m.id,
      note: `撤销里程碑「${m.title}」`,
    });
    m.status = 'pending';
    m.done_at = null;
    recalcGoal(m.goal_id, st);
  });
  return true;
}

/** 完成下一个待办里程碑（目标详情页的主按钮） */
export function nextPendingMilestone(goalId, s = getState()) {
  return milestonesOf(goalId, s).find((m) => m.status !== 'done') || null;
}

export function updateMilestone(id, patch) {
  commit((s) => {
    const m = s.milestone.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    recalcGoal(m.goal_id, s);
  });
}

/** 给目标追加一个里程碑 */
export function addMilestone(goalId, { title, plan_date }) {
  commit((s) => {
    const goal = s.goal.find((g) => g.id === goalId);
    const list = milestonesOf(goalId, s);
    const order = list.length ? Math.max(...list.map((m) => m.order_num)) + 1 : 1;
    // 兜底名字和自动生成保持同一口径，不另写一套「第 N 步」
    const fallback = goal
      ? milestoneTitle(goal.rhythm, order - 1, goal.title) || `第 ${order} 步`
      : `第 ${order} 步`;
    s.milestone.push({
      id: uid('ms'),
      goal_id: goalId,
      title: String(title || '').trim() || fallback,
      plan_date: plan_date || todayStr(),
      order_num: order,
      status: 'pending',
      done_at: null,
      note: '',
    });
    recalcGoal(goalId, s);
  });
}

/** 删除里程碑（进度无定义时回到 null；至少保留 1 个由 UI 拦截） */
export function removeMilestone(id) {
  commit((s) => {
    const m = s.milestone.find((x) => x.id === id);
    if (!m) return;
    const goalId = m.goal_id;
    s.milestone = s.milestone.filter((x) => x.id !== id);
    recalcGoal(goalId, s);
  });
}

export function abandonGoal(goalId) {
  commit((s) => {
    const g = s.goal.find((x) => x.id === goalId);
    if (!g) return;
    g.status = 'abandoned';
  });
}

/** 目标基础字段编辑（里程碑不重排，只影响之后新增的） */
export function updateGoal(goalId, patch) {
  commit((s) => {
    const g = s.goal.find((x) => x.id === goalId);
    if (!g) return;
    Object.assign(g, patch);
  });
}

/** 14 天无任何完成事件（停滞提示，只提示，不改状态） */
export function isStalled(goal, s = getState(), days = 14) {
  if (!goal || goal.status === 'completed' || goal.status === 'abandoned') return false;
  const list = milestonesOf(goal.id, s);
  const doneTimes = list.map((m) => m.done_at).filter(Boolean).sort();
  const last = doneTimes.length ? doneTimes[doneTimes.length - 1] : goal.created_at;
  const base = new Date(last).getTime();
  return (Date.now() - base) / 86400000 >= days;
}

/** 目标列表排序：逾期优先（逾期最久的在前）-> 下一个里程碑日期 -> 创建时间倒序 */
export function sortGoals(goals, s = getState()) {
  const nextOf = (g) => nextPendingMilestone(g.id, s);
  const rank = (g) => {
    const next = nextOf(g);
    if (!next) return 2;
    return next.plan_date < todayStr() ? 0 : 1;
  };

  return [...goals].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    const na = nextOf(a);
    const nb = nextOf(b);
    if (na && nb && na.plan_date !== nb.plan_date) {
      return na.plan_date.localeCompare(nb.plan_date);
    }
    return b.created_at.localeCompare(a.created_at);
  });
}
