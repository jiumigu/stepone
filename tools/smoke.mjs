// ============================================================
// smoke.mjs — 无浏览器验收：跑通设计稿第 11 节里的逻辑项
// 做法：mock 一个 localStorage，把 core 层当成纯逻辑跑
// 运行：node tools/smoke.mjs
// ============================================================

import assert from 'node:assert/strict';

// --- 先注入浏览器环境（store 的 adapter 只在调用时访问 window）---
const memory = Object.create(null);
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in memory ? memory[k] : null),
    setItem: (k, v) => { memory[k] = String(v); },
    removeItem: (k) => { delete memory[k]; },
  },
};

const {
  getState, useAdapter, exportJSON, importJSON, subscribe, commit,
  safeParse, migrate, SCHEMA_VERSION,
} = await import('../src/core/store.js');
const { registerGiftSync, addGift, giftsWithStatus, redeemGift, deriveGiftStatus } = await import('../src/core/gifts.js');
const { createGoal, goalStats, milestonesOf, completeMilestone, nextPendingMilestone, prefixMilestoneTitles } = await import('../src/core/goals.js');
const { capture, captureMany, addTodo, completeTodo, revertTodo, removeTodo } = await import('../src/core/todos.js');
const { addJoy } = await import('../src/core/joy.js');
const { balance } = await import('../src/core/points.js');
const {
  todayBoard, todayEarned, currentBalance, dayCountMap, incomeBreakdown,
  dayEventMap, eventsOfDay, txnTitle, joyOfTxn,
} = await import('../src/core/selectors.js');
const { todayStr, addDays, parseDate, isoToDay } = await import('../src/core/util.js');
const {
  createRoutine, rollRoutines, matchesDate, skipToday,
  setRoutineActive, removeRoutine, ruleLabel,
} = await import('../src/core/routines.js');

registerGiftSync();

const rows = [];
let seq = 0;
function check(name, fn) {
  seq += 1;
  try {
    fn();
    rows.push({ no: String(seq).padStart(2, '0'), name, ok: true, note: '' });
  } catch (err) {
    rows.push({ no: String(seq).padStart(2, '0'), name, ok: false, note: err.message });
  }
}

const today = todayStr();

// ------------------------------------------------------------
// 1. 一句话捕获
// ------------------------------------------------------------
let firstTodoId = null;

check('01 一句话捕获，立刻进今天', () => {
  const t = capture('写 500 字');
  assert.ok(t && t.id);
  firstTodoId = t.id;
  const board = todayBoard(getState());
  assert.equal(board.todayItems.length, 1);
  assert.equal(board.todayItems[0].plan_date, today);
  assert.equal(board.todayItems[0].goal_id, null);
});

check('02 批量捕获（一行一条）', () => {
  const list = captureMany('买跑鞋\n预约体检\n\n清空收件箱');
  assert.equal(list.length, 3);
  assert.equal(todayBoard(getState()).todayItems.length, 4);
});

// ------------------------------------------------------------
// 2. 升格成目标 + 模板生成
// ------------------------------------------------------------
let goalId = null;

check('03 每周节奏 8 周 -> 自动生成 8 个里程碑', () => {
  goalId = createGoal({
    title: '跑完半马',
    dimension: 'health',
    start_date: today,
    due_date: addDays(today, 55),
    rhythm: 'weekly',
  });
  const ms = milestonesOf(goalId, getState());
  assert.equal(ms.length, 8);
  assert.equal(ms[0].plan_date, today);
  assert.ok(ms.every((m) => m.status === 'pending'));
});

check('04 进度口径 = 已完成 / 总数（初始 0/8 = 0）', () => {
  const stats = goalStats(goalId, getState());
  assert.equal(stats.total, 8);
  assert.equal(stats.done, 0);
  assert.equal(stats.ratio, 0);
});

check('05 一次性节奏只生成 1 个里程碑；无里程碑进度为 null', () => {
  const g2 = createGoal({
    title: '换工作',
    dimension: 'career',
    start_date: today,
    due_date: addDays(today, 30),
    rhythm: 'once',
  });
  assert.equal(milestonesOf(g2, getState()).length, 1);
});

check('06 每天节奏长区间不会爆量（<= 60 且首尾落在区间内）', () => {
  const g3 = createGoal({
    title: '读一年书',
    dimension: 'learn',
    start_date: today,
    due_date: addDays(today, 364),
    rhythm: 'daily',
  });
  const ms = milestonesOf(g3, getState());
  assert.ok(ms.length <= 60, `实际 ${ms.length}`);
  assert.ok(ms[0].plan_date >= today);
  assert.ok(ms[ms.length - 1].plan_date <= addDays(today, 364));
});

// ------------------------------------------------------------
// 3~4. 落到今天 / 完成 / 幂等 / 撤销
// ------------------------------------------------------------
check('07 为目标的加一步出现在今天页', () => {
  const t = addTodo({ title: '跑 3km', plan_date: today, goal_id: goalId });
  assert.ok(t.goal_id === goalId);
  const board = todayBoard(getState());
  assert.ok(board.todayItems.some((x) => x.id === t.id));
});

check('08 完成待办 +2，余额由账本求和', () => {
  const before = currentBalance(getState());
  assert.equal(before, 0);
  assert.equal(completeTodo(firstTodoId), true);
  assert.equal(currentBalance(getState()), 2);
  assert.equal(todayEarned(getState()), 2);
});

check('09 双击幂等：第二次不加分、不写流水', () => {
  const len = getState().point_txn.length;
  assert.equal(completeTodo(firstTodoId), false);
  assert.equal(getState().point_txn.length, len);
  assert.equal(currentBalance(getState()), 2);
});

check('10 撤销完成：余额 -2，原流水保留并新增冲正', () => {
  const len = getState().point_txn.length;
  assert.equal(revertTodo(firstTodoId), true);
  assert.equal(currentBalance(getState()), 0);
  assert.equal(getState().point_txn.length, len + 1);
  const last = getState().point_txn[getState().point_txn.length - 1];
  assert.equal(last.delta, -2);
  assert.equal(last.reason_code, 'revert');
});

check('11 已完成的待办不能直接删（避免余额脱钩）', () => {
  completeTodo(firstTodoId);
  const res = removeTodo(firstTodoId);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'done_first');
  revertTodo(firstTodoId);
  assert.equal(removeTodo(firstTodoId).ok, true);
  assert.equal(currentBalance(getState()), 0);
});

// ------------------------------------------------------------
// 8~9. 里程碑与目标完成
// ------------------------------------------------------------
check('12 完成里程碑 +10，目标变 in_progress，进度上升', () => {
  const next = nextPendingMilestone(goalId, getState());
  assert.ok(next);
  assert.equal(completeMilestone(next.id), true);
  assert.equal(currentBalance(getState()), 10);
  const stats = goalStats(goalId, getState());
  assert.equal(stats.done, 1);
  assert.equal(stats.ratio, 1 / 8);
  const goal = getState().goal.find((g) => g.id === goalId);
  assert.equal(goal.status, 'in_progress');
});

check('13 完成最后一个里程碑 -> completed 且只发一次 +30', () => {
  const ms = milestonesOf(goalId, getState()).filter((m) => m.status !== 'done');
  ms.forEach((m) => completeMilestone(m.id));
  const goal = getState().goal.find((g) => g.id === goalId);
  assert.equal(goal.status, 'completed');
  assert.equal(goal.progress, 1);

  const goalDoneTxns = getState().point_txn.filter((t) => t.reason_code === 'goal_done' && t.ref_id === goalId);
  assert.equal(goalDoneTxns.length, 1);
  assert.equal(goalDoneTxns[0].delta, 30);
});

check('14 里程碑完成也幂等', () => {
  const done = getState().milestone.find((m) => m.goal_id === goalId && m.status === 'done');
  const before = currentBalance(getState());
  assert.equal(completeMilestone(done.id), false);
  assert.equal(currentBalance(getState()), before);
});

// ------------------------------------------------------------
// 10. 记一条快乐
// ------------------------------------------------------------
check('15 快乐 5 档：每档得分与流水一致', () => {
  const base = currentBalance(getState());
  const first = addJoy({ content: '今天值了', score: 5 });
  assert.equal(first.points, 5);
  assert.equal(currentBalance(getState()), base + 5);

  const total = addJoy({ content: '还行', score: 1 });
  assert.equal(total.points, 1);
  assert.equal(currentBalance(getState()), base + 6);
});

// ------------------------------------------------------------
// 11~12. 礼物与兑换
// ------------------------------------------------------------
let giftId = null;
let giftPrice = 0;

check('16 余额不足时礼物是 pending，且显示差额', () => {
  // 用相对价：当前余额 + 60，保证构造出「还差 60 分」的状态
  giftPrice = currentBalance(getState()) + 60;
  const g = addGift({ title: '一杯奶茶', price: giftPrice });
  giftId = g.id;
  const one = giftsWithStatus(getState()).find((x) => x.id === giftId);
  assert.equal(one.derived, 'pending');
  assert.equal(one.short, 60);
});

check('17 余额不足禁止兑换，且不写流水', () => {
  const len = getState().point_txn.length;
  const res = redeemGift(giftId);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'balance');
  assert.equal(getState().point_txn.length, len);
});

check('18 攒够 -> waiting（派生），兑换 -> 扣分 + redeemed', () => {
  // 造分：完成一批待办（每件 +2）
  const need = giftPrice - currentBalance(getState());
  const count = Math.ceil(need / 2);
  for (let i = 0; i < count; i += 1) {
    const t = capture(`补一件 ${i}`);
    completeTodo(t.id);
  }
  const before = currentBalance(getState());
  assert.ok(before >= giftPrice);

  const waiting = giftsWithStatus(getState()).find((x) => x.id === giftId);
  assert.equal(waiting.derived, 'waiting');

  const res = redeemGift(giftId);
  assert.equal(res.ok, true);
  assert.equal(currentBalance(getState()), before - giftPrice);

  const after = getState().gift.find((x) => x.id === giftId);
  assert.equal(after.status, 'redeemed');
  assert.ok(after.redeemed_at);
});

check('19 兑换后余额下降，其它 waiting 礼物自动退回 pending', () => {
  const bal = currentBalance(getState());
  const second = addGift({ title: '一本想要的书', price: bal + 10 });
  const one = giftsWithStatus(getState()).find((x) => x.id === second.id);
  assert.equal(one.derived, 'pending');
  assert.equal(deriveGiftStatus({ status: 'pending', price: 1 }, 0), 'pending');
});

// ------------------------------------------------------------
// 13. 日历
// ------------------------------------------------------------
check('20 日历按天统计待办数与逾期标记', () => {
  const past = addDays(today, -3);
  addTodo({ title: '三天前没做的事', plan_date: past });
  addTodo({ title: '明天的事', plan_date: addDays(today, 1) });
  const map = dayCountMap(getState());
  assert.ok(map.get(past).count >= 1);
  assert.equal(map.get(past).hasOverdue, true);
  assert.equal(map.get(addDays(today, 1)).hasOverdue, false);
});

// ------------------------------------------------------------
// 14. 持久化 + 可移植（换 adapter 重载）
// ------------------------------------------------------------
check('21 刷新后数据仍在（存储层可重载）', () => {
  const snapshot = exportJSON();
  assert.ok(snapshot.length > 100);

  const before = {
    goals: getState().goal.length,
    todos: getState().todo.length,
    txns: getState().point_txn.length,
    balance: currentBalance(getState()),
  };

  // 换一个指向同一份存储的 adapter，强制 state 重新从存储读
  useAdapter({
    name: 'test-adapter',
    read: () => memory['stepone.v1'] ?? null,
    write: (v) => { memory['stepone.v1'] = v; },
  });

  const after = {
    goals: getState().goal.length,
    todos: getState().todo.length,
    txns: getState().point_txn.length,
    balance: currentBalance(getState()),
  };

  assert.deepEqual(after, before);
});

check('22 账本不变量：只增不删、余额 = SUM(delta) 且 balance_after 连续', () => {
  const s = getState();
  const sum = s.point_txn.reduce((a, t) => a + t.delta, 0);
  assert.equal(sum, balance(s));

  let running = 0;
  for (const t of s.point_txn) {
    assert.equal(t.balance_before, running, `流水 ${t.id} 的 before 不连续`);
    running += t.delta;
    assert.equal(t.balance_after, running, `流水 ${t.id} 的 after 不连续`);
  }
  assert.equal(running, balance(s));
});

check('23 无手动加分入口（未导出任何直接改余额的函数）', async () => {
  // 结构性断言：points 模块只导出 pushTxn（需要 commit 上下文），无 setBalance
  const points = await import('../src/core/points.js');
  assert.equal(typeof points.setBalance, 'undefined');
  assert.equal(typeof points.addPoints, 'undefined');
  assert.equal(typeof points.pushTxn, 'function');
});


// ------------------------------------------------------------
// 重复任务（round 2 新增）
// ------------------------------------------------------------
let rtA = null;

check('24 建一条「每天」重复，今天立刻出现一条实例', () => {
  const r = createRoutine({ title: '拉伸 10 分钟', rule: 'daily' });
  rtA = r.id;
  const items = getState().todo.filter((t) => t.routine_id === r.id && t.plan_date === today);
  assert.equal(items.length, 1);
  assert.equal(items[0].source, 'routine');
  assert.equal(items[0].done_at, null);
});

check('25 roll 幂等：连跑两次不会多出实例', () => {
  rollRoutines();
  rollRoutines();
  const items = getState().todo.filter((t) => t.routine_id === rtA && t.plan_date === today);
  assert.equal(items.length, 1);
});

check('26 规则判定：工作日不含周末', () => {
  const r = { rule: 'weekdays', active: true, weekdays: [] };
  let d = today;
  for (let i = 0; i < 8 && parseDate(d).getDay() !== 6; i += 1) d = addDays(d, 1);
  assert.equal(parseDate(d).getDay(), 6);
  assert.equal(matchesDate(r, d), false);
  assert.equal(matchesDate(r, addDays(d, 1)), false); // 周日
  assert.equal(matchesDate(r, addDays(d, 2)), true);  // 周一
});

check('27 规则判定：每周只在选中的星期几出现', () => {
  let mon = today;
  for (let i = 0; i < 8 && parseDate(mon).getDay() !== 1; i += 1) mon = addDays(mon, 1);
  const r = { rule: 'weekly', active: true, weekdays: [1, 3] };
  assert.equal(matchesDate(r, mon), true);
  assert.equal(matchesDate(r, addDays(mon, 1)), false);
  assert.equal(matchesDate(r, addDays(mon, 2)), true);
  assert.equal(ruleLabel(r), '每周一·三');
});

check('28 暂停后不再生成新实例', () => {
  skipToday(rtA);
  setRoutineActive(rtA, false);
  rollRoutines();
  assert.equal(getState().todo.filter((t) => t.routine_id === rtA).length, 0);
});

check('29 「今天不做」后当天不再重建（换一种规则再验）', () => {
  setRoutineActive(rtA, true);
  skipToday(rtA);
  rollRoutines();
  assert.equal(
    getState().todo.filter((t) => t.routine_id === rtA && t.plan_date === today).length, 0,
  );
});

check('30 完成的实例走同一个 completeTodo：+2、幂等、记流水', () => {
  const r = createRoutine({ title: '喝水 8 杯', rule: 'daily' });
  const inst = getState().todo.find((t) => t.routine_id === r.id && t.plan_date === today);
  const before = currentBalance(getState());
  assert.equal(completeTodo(inst.id), true);
  assert.equal(completeTodo(inst.id), false); // 幂等
  assert.equal(currentBalance(getState()), before + 2);
  const txn = getState().point_txn.at(-1);
  assert.equal(txn.reason_code, 'todo_done');
  assert.equal(txn.ref_id, inst.id);
});

check('31 关掉几天再打开：只补今天，不生成逾期', () => {
  commit((st) => { st.setting.roll_date = addDays(today, -5); });
  const r = createRoutine({ title: '写 200 字', rule: 'daily' });
  rollRoutines();
  const list = getState().todo.filter((t) => t.routine_id === r.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].plan_date, today);
  assert.equal(todayBoard(getState()).overdue.filter((t) => t.routine_id === r.id).length, 0);
});

check('32 删除模板：今天未完成的实例一起清掉，已完成的保留', () => {
  const r = createRoutine({ title: '临时习惯', rule: 'daily' });
  const inst = getState().todo.find((t) => t.routine_id === r.id && t.plan_date === today);
  removeRoutine(r.id);
  assert.equal(getState().routine.some((x) => x.id === r.id), false);
  assert.equal(getState().todo.some((t) => t.id === inst.id), false);
});

check('33 v1 老存档加载时迁移出 routine 表与 roll_date', () => {
  const legacy = {
    schema_version: 1,
    setting: { id: 1, nickname: '' },
    goal: [], milestone: [], todo: [], joy_log: [], point_txn: [], gift: [],
  };
  const parsed = safeParse(JSON.stringify(legacy));
  const { data, changed } = migrate(parsed);
  assert.equal(changed, true);
  assert.equal(data.schema_version, SCHEMA_VERSION);
  assert.ok(Array.isArray(data.routine));
  assert.ok('roll_date' in data.setting);
  assert.equal(data.setting.nickname, ''); // 老字段不能被抹掉
});


// ------------------------------------------------------------
// 15. 日历能查到「里程碑 / 快乐」发生在哪一天（round 3）
// ------------------------------------------------------------
check('34 里程碑：计划日在日历上有，完成后落在做完那天', () => {
  const gid = createGoal({
    title: '日历验证', dimension: 'learn',
    start_date: addDays(today, -10), due_date: addDays(today, 14), rhythm: 'weekly',
  });
  const ms = getState().milestone.filter((m) => m.goal_id === gid)[0];
  const planDay = addDays(today, -3);
  commit((st) => { st.milestone.find((x) => x.id === ms.id).plan_date = planDay; });

  // 还没做：只出现在计划日，且标逾期
  let ev = eventsOfDay(planDay, getState()).filter((e) => e.kind === 'milestone' && e.id === ms.id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].role, 'plan');
  assert.equal(ev[0].overdue, true);

  // 做完：计划日那条不再算逾期，今天多一条「做成了」
  completeMilestone(ms.id, { note: '做到了' });
  ev = eventsOfDay(planDay, getState()).filter((e) => e.kind === 'milestone' && e.id === ms.id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].role, 'plan');
  assert.equal(ev[0].overdue, false);
  assert.equal(ev[0].done_on, today);

  const todayEv = eventsOfDay(today, getState()).filter((e) => e.kind === 'milestone' && e.id === ms.id);
  assert.equal(todayEv.length, 1);
  assert.equal(todayEv[0].role, 'done');

  // 感受和完成写在同一事务里
  assert.equal(getState().milestone.find((m) => m.id === ms.id).note, '做到了');
});

check('35 同一天既计划又完成：只留一条，不重复计数', () => {
  const gid = createGoal({
    title: '当天完成', dimension: 'life',
    start_date: today, due_date: addDays(today, 7), rhythm: 'once',
  });
  const ms = getState().milestone.find((m) => m.goal_id === gid);
  completeMilestone(ms.id);
  const ev = eventsOfDay(today, getState()).filter((e) => e.id === ms.id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].role, 'done');
});

check('36 快乐记录：出现在那天，带正文与分值', () => {
  const { record } = addJoy({ content: '楼下买了杯咖啡', score: 4 });
  const day = isoToDay(record.created_at);
  const ev = eventsOfDay(day, getState()).filter((e) => e.kind === 'joy');
  const one = ev.find((e) => e.id === record.id);
  assert.ok(one);
  assert.equal(one.title, '楼下买了杯咖啡');
  assert.equal(one.role, 'done');
  assert.equal(one.points, 4);
});

check('37 流水标题：快乐记录显示内容，老格式（只存档位）也能还原', () => {
  const { record } = addJoy({ content: '把阳台的花浇了', score: 3 });
  const txn = getState().point_txn.find((t) => t.ref_id === record.id);
  assert.equal(txnTitle(txn, getState()), '把阳台的花浇了');
  assert.equal(joyOfTxn(txn, getState()).id, record.id);

  // 模拟旧版本：note 是「记一条快乐「开心」」，正文只在 joy_log 里
  commit((st) => { st.point_txn.find((t) => t.id === txn.id).note = '记一条快乐「开心」'; });
  assert.equal(txnTitle(txn, getState()), '把阳台的花浇了');
});

check('38 导出 / 导入：完整往返；不像备份的文件会被拒绝', () => {
  const before = {
    goals: getState().goal.length,
    todos: getState().todo.length,
    txns: getState().point_txn.length,
    joy: getState().joy_log.length,
    bal: currentBalance(getState()),
  };
  const text = exportJSON();

  commit((st) => { st.goal = []; st.todo = []; st.joy_log = []; });
  assert.equal(getState().goal.length, 0);

  importJSON(text);
  assert.equal(getState().goal.length, before.goals);
  assert.equal(getState().todo.length, before.todos);
  assert.equal(getState().point_txn.length, before.txns);
  assert.equal(getState().joy_log.length, before.joy);
  assert.equal(currentBalance(getState()), before.bal);

  // 点错文件不能洗掉现有数据
  assert.throws(() => importJSON('{"oops":1}'), /格式/);
  assert.throws(() => importJSON('<xml/>'), /格式/);
  assert.throws(() => importJSON(''), /格式/);
  assert.equal(getState().goal.length, before.goals);
});

// ------------------------------------------------------------
// 16. 里程碑名字自带上下文（round 3 补）
// ------------------------------------------------------------
check('39 周期性目标：里程碑名字 = 目标前 10 字 · 第 N 个月/天', () => {
  const gid = createGoal({
    title: '把英语口语练到能在会上发言', dimension: 'learn',
    start_date: today, due_date: addDays(today, 90), rhythm: 'monthly',
  });
  const ms = milestonesOf(gid, getState());
  assert.ok(ms.length >= 2);
  assert.equal(ms[0].title, '把英语口语练到能在会… · 第 1 个月');
  assert.equal(ms[1].title, '把英语口语练到能在会… · 第 2 个月');

  // 目标名不到 10 个字：不截断、不加省略号
  const gid2 = createGoal({
    title: '背单词', dimension: 'learn',
    start_date: today, due_date: addDays(today, 2), rhythm: 'daily',
  });
  assert.deepEqual(
    milestonesOf(gid2, getState()).map((m) => m.title),
    ['背单词 · 第 1 天', '背单词 · 第 2 天', '背单词 · 第 3 天'],
  );
});

check('40 老数据补前缀：只补「第 N 个月」裸名字，手改过的不动、可重复执行', () => {
  const gid = createGoal({
    title: '复盘习惯', dimension: 'life',
    start_date: today, due_date: addDays(today, 75), rhythm: 'monthly',
  });
  const total = milestonesOf(gid, getState()).length;
  assert.ok(total >= 3);
  commit((st) => {
    let i = 0;
    for (const m of st.milestone) {
      if (m.goal_id !== gid) continue;
      i += 1;
      m.title = i === 2 ? '自己改的名字' : `第 ${i} 个月`;
    }
  });

  assert.equal(prefixMilestoneTitles(gid), total - 1);
  const titles = milestonesOf(gid, getState()).map((m) => m.title);
  assert.ok(titles.includes('自己改的名字'));
  assert.ok(titles.includes('复盘习惯 · 第 1 个月'));
  assert.equal(prefixMilestoneTitles(gid), 0); // 幂等
});

// ------------------------------------------------------------
// 输出
// ------------------------------------------------------------
const failed = rows.filter((r) => !r.ok);

console.log('\n验收对照（node 逻辑层）\n');
console.log('| # | 验收点 | 结果 |');
console.log('|---|---|---|');
for (const r of rows) {
  console.log(`| ${r.no} | ${r.name} | ${r.ok ? 'PASS' : 'FAIL: ' + r.note} |`);
}
console.log(`\n合计 ${rows.length} 项，通过 ${rows.length - failed.length} 项，失败 ${failed.length} 项`);

const s = getState();
console.log('\n最终数据：' + JSON.stringify({
  goal: s.goal.length,
  milestone: s.milestone.length,
  todo: s.todo.length,
  joy_log: s.joy_log.length,
  point_txn: s.point_txn.length,
  gift: s.gift.length,
  balance: currentBalance(s),
  income: incomeBreakdown(s).map((x) => `${x.label}:${x.value}`).join(' / '),
}, null, 0));

if (failed.length) process.exitCode = 1;
