// ============================================================
// store.js — 持久化 + 事务 + 订阅
//
// 设计要点（对应设计稿第 5 节 / 第 9 节）：
//  1) 唯一的写入口是 commit(mutator)。mutator 里对 state 的修改在同一个
//     「事务」内完成，落后统一 persist + emit，对应「写后即算」。
//  2) 存储后端通过 adapter 注入 —— 现在用 localStorage，将来换 IndexedDB
//     或云端只改 useAdapter() 一处，业务层完全不动（可移植性的锚点）。
//  3) afterCommit 钩子用于「派生态回写」（当前只有礼物状态），
//     钩子内部只允许裸改 state，不允许再 commit（防重入）。
// ============================================================

import { todayStr, nowIso } from './util.js';

export const STORAGE_KEY = 'stepone.v1';
export const SCHEMA_VERSION = 2;

// ---- 存储适配器（默认 localStorage；可替换）----------------
const localAdapter = {
  name: 'localStorage',
  read() {
    try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
  },
  write(value) {
    window.localStorage.setItem(STORAGE_KEY, value);
  },
};

let adapter = localAdapter;

/** 替换存储后端。next 需实现 { name, read(): string|null, write(string) } */
export function useAdapter(next) {
  adapter = next || localAdapter;
  state = null; // 换后端后重新加载
  emit();
}

export function getAdapterName() {
  return adapter.name;
}

// ---- 初始状态 ---------------------------------------------
function blankState() {
  return {
    schema_version: SCHEMA_VERSION,
    setting: {
      id: 1, nickname: '', start_date: todayStr(), last_export_at: null,
      roll_date: null,
    },
    goal: [],
    milestone: [],
    todo: [],
    routine: [],
    joy_log: [],
    point_txn: [],
    gift: [],
    updated_at: nowIso(),
  };
}

const ARRAY_TABLES = ['goal', 'milestone', 'todo', 'routine', 'joy_log', 'point_txn', 'gift'];

/** 容错解析：缺表补齐、类型纠正（存档损坏时不至于白屏） */
export function safeParse(raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const base = blankState();
  for (const table of ARRAY_TABLES) {
    if (!Array.isArray(data[table])) data[table] = base[table];
  }
  data.setting = { ...base.setting, ...(data.setting || {}) };
  data.schema_version = data.schema_version || SCHEMA_VERSION;
  return data;
}

/**
 * 版本迁移：只做「缺什么补什么」，绝不删除用户已有字段。
 * 在 getState 首次加载时跑一次，迁移结果立即落盘（避免每次启动重复迁移）。
 */
export function migrate(data) {
  const before = data.schema_version || 1;

  // v1 -> v2：新增 routine 表 + setting.roll_date
  if (before < 2) {
    if (!Array.isArray(data.routine)) data.routine = [];
    for (const r of data.routine) {
      if (!Array.isArray(r.skip_dates)) r.skip_dates = [];
      if (typeof r.active !== 'boolean') r.active = true;
      if (!Array.isArray(r.weekdays)) r.weekdays = [];
    }
    if (!('roll_date' in data.setting)) data.setting.roll_date = null;
  }

  data.schema_version = SCHEMA_VERSION;
  return { data, changed: before !== SCHEMA_VERSION };
}

// ---- 运行时状态 -------------------------------------------
let state = null;

export function getState() {
  if (!state) {
    const raw = adapter.read();
    const parsed = (raw && safeParse(raw)) || blankState();
    const { data, changed } = migrate(parsed);
    state = data;
    if (changed && raw) {
      // 迁移后立刻落盘：老存档第一次被读到时升到新版本
      try { adapter.write(JSON.stringify(state)); } catch { /* 写失败不影响本次会话 */ }
    }
  }
  return state;
}

function persist() {
  try {
    adapter.write(JSON.stringify(state));
  } catch (err) {
    // 配额满 / 隐私模式：不抛（避免中断 UI 流程），但要明确告知
    console.error('[stepone] 持久化失败', err);
    if (typeof document !== 'undefined') {
      document.dispatchEvent(new CustomEvent('stepone:storage-error', { detail: { error: err } }));
    }
  }
}

// ---- 事务与订阅 -------------------------------------------
const listeners = new Set();
const afterCommitHooks = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 派生状态回写钩子（写完再算，不构成第二个真源） */
export function onAfterCommit(fn) {
  afterCommitHooks.add(fn);
  return () => afterCommitHooks.delete(fn);
}

function emit() {
  const snapshot = getState();
  listeners.forEach((fn) => {
    try { fn(snapshot); } catch (err) { console.error('[stepone] 订阅回调异常', err); }
  });
}

/**
 * 唯一写入口。
 * @param {(state) => any} mutator 直接修改传入的 state
 * @returns mutator 的返回值
 */
export function commit(mutator) {
  const current = getState();
  const result = mutator(current);
  current.updated_at = nowIso();
  for (const hook of afterCommitHooks) {
    try { hook(current); } catch (err) { console.error('[stepone] afterCommit 钩子异常', err); }
  }
  persist();
  emit();
  return result;
}

// ---- 导出 / 导入 / 重置（架构预留，UI 未暴露）----------------
export function exportJSON() {
  return JSON.stringify(getState(), null, 2);
}

/**
 * 导入：先验形状再覆盖。
 * safeParse 会「缺什么补什么」，所以任意 JSON 都能被它补成一份空存档 ——
 * 那等于点错文件就把用户数据洗白。这里必须先把「不像备份」的挡在门外。
 */
export function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('数据格式不合法');
  }
  const hasShape = parsed
    && typeof parsed === 'object'
    && !Array.isArray(parsed)
    && (parsed.setting || Array.isArray(parsed.goal)
      || Array.isArray(parsed.todo) || Array.isArray(parsed.point_txn));
  const next = hasShape ? safeParse(text) : null;
  if (!next) throw new Error('数据格式不合法');
  state = migrate(next).data;
  persist();
  emit();
  return state;
}

/** 清空全部数据（危险操作：UI 不提供入口，仅开发调试用） */
export function resetAll() {
  state = blankState();
  persist();
  emit();
}

/** 开发调试：整体替换 state 引用（测试用） */
export function __setState(next) {
  state = next;
  emit();
}
