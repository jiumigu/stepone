// ============================================================
// shot.mjs — 用 CDP 驱动 headless Chrome：注入演示数据 + 逐页截图
// 用途：开发期自查渲染与交互，不参与产物构建
// 运行：node tools/shot.mjs [port]
// ============================================================

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.argv[2] || 9333);
const BASE = process.env.BASE_URL || 'http://localhost:8123/index.html';
const OUT = process.env.OUT_DIR || path.join(os.tmpdir(), 'stepone-shots');
const WIDTH = Number(process.env.W || 390);
const HEIGHT = Number(process.env.H || 844);
const MOBILE = process.env.MOBILE !== '0';

fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stepone-cprof-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-crash-reporter',
  '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`,
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('CDP 未就绪');
}

const target = await getTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});

await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = (seq += 1);
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, awaitPromise = false) {
  const res = await send('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, userGesture: true,
  });
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails.exception?.description || res.result.exceptionDetails));
  }
  return res.result?.result?.value;
}

async function shoot(name) {
  await sleep(420);
  // 清掉 toast 残影，避免截到半透明的淡出帧
  await evaluate(`document.getElementById('toast')?.remove()`);
  const res = await send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'));
  console.log('shot ->', file);
}

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: MOBILE,
});

const consoleIssues = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
    consoleIssues.push(`[${msg.params.entry.level}] ${msg.params.entry.text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleIssues.push(`[exception] ${msg.params.exceptionDetails.text}`);
  }
});

await send('Page.navigate', { url: BASE });
await sleep(1400);

// ---- 注入演示数据（走 core 的真实写入口，顺带验证逻辑在浏览器里也通）----
const seedResult = await evaluate(`(async () => {
  localStorage.removeItem('stepone.v1');
  const store = await import(new URL('./src/core/store.js', location.href).href);
  const todos = await import(new URL('./src/core/todos.js', location.href).href);
  const goals = await import(new URL('./src/core/goals.js', location.href).href);
  const joy = await import(new URL('./src/core/joy.js', location.href).href);
  const gifts = await import(new URL('./src/core/gifts.js', location.href).href);
  const util = await import(new URL('./src/core/util.js', location.href).href);

  const today = util.todayStr();
  const back = (n) => util.addDays(today, -n);

  // 目标 1：半马（已经跑了两周）
  const g1 = goals.createGoal({
    title: '跑完半马', dimension: 'health',
    start_date: back(21), due_date: util.addDays(today, 35), rhythm: 'weekly',
  });
  const ms1 = goals.milestonesOf(g1, store.getState());
  goals.completeMilestone(ms1[0].id);
  goals.completeMilestone(ms1[1].id);

  // 目标 2：读书
  const g2 = goals.createGoal({
    title: '读完 12 本书', dimension: 'learn',
    start_date: back(40), due_date: util.addDays(today, 300), rhythm: 'monthly',
  });

  // 目标 3：公众号
  const g3 = goals.createGoal({
    title: '公众号更 20 篇', dimension: 'create',
    start_date: back(60), due_date: util.addDays(today, 120), rhythm: 'weekly',
  });
  const ms3 = goals.milestonesOf(g3, store.getState());
  goals.completeMilestone(ms3[0].id);

  // 目标 4：复现用户场景 —— 里程碑计划在未来，但今天已经做掉了
  const g4 = goals.createGoal({
    title: '2025年的目标', dimension: 'learn',
    start_date: back(1), due_date: util.addDays(today, 330), rhythm: 'monthly',
  });
  const ms4 = goals.milestonesOf(g4, store.getState());
  store.commit((s) => {
    s.milestone.find((m) => m.id === ms4[0].id).plan_date = util.addDays(today, 2);
  });
  goals.completeMilestone(ms4[0].id, { note: '我太棒了' });

  // 今天的三件事
  todos.capture('写 500 字');
  const t2 = todos.capture('跑 3km');
  todos.captureMany('回邮件\\n整理本周照片');
  todos.addTodo({ title: '读 20 页《系统之美》', plan_date: today, goal_id: g2 });

  // 昨天没做完的一件（逾期）
  const late = todos.addTodo({ title: '把发票报销单交了', plan_date: back(2) });

  // 完成一件
  todos.completeTodo(t2.id);

  // 三条重复：每天 / 工作日 / 每周一三五
  const routines = await import(new URL('./src/core/routines.js', location.href).href);
  routines.createRoutine({ title: '拉伸 10 分钟', rule: 'daily' });
  routines.createRoutine({ title: '背 20 个单词', rule: 'weekdays' });
  routines.createRoutine({ title: '写 200 字', rule: 'weekly', weekdays: [1, 3, 5] });

  // 两条快乐
  joy.addJoy({ content: '楼下咖啡师记得我不加糖', score: 4 });
  joy.addJoy({ content: '傍晚的风终于凉了', score: 3 });

  // 三个礼物
  gifts.addGift({ title: '一杯奶盖乌龙', price: 60 });
  gifts.addGift({ title: '想要很久的那本画册', price: 180 });
  gifts.addGift({ title: '去趟海边', price: 900 });

  store.commit((s) => { s.setting.onboarded = true; });
  return { balance: (await import(new URL('./src/core/points.js', location.href).href)).balance(store.getState()) };
})()`, true);

console.log('seed:', JSON.stringify(seedResult));

await send('Page.reload');
await sleep(1500);

await shoot('01-today');

// 交互核验：点第一件待办的圆圈 -> 余额应 +2，列表项应落到已完成区
const before = await evaluate(`document.querySelector('[data-stat]').textContent`);
await evaluate(`document.querySelector('.todo [data-check]').click()`);
await sleep(620); // 等 380ms 的沉底重排完成
const after = await evaluate(`document.querySelector('[data-stat]').textContent`);
const doneCount = await evaluate(`document.querySelectorAll('.todo.is-done').length`);
console.log('complete-todo:', JSON.stringify({ before: before.trim(), after: after.trim(), doneCount }));
await shoot('08-after-complete');

await evaluate(`document.querySelector('[data-routine]').click()`);
await shoot('09-routine-sheet');
await evaluate(`document.querySelector('[data-new]').click()`);
await sleep(200);
await shoot('10-routine-form');
await evaluate(`document.querySelector('.sheet-x')?.click()`);
await sleep(260);

await evaluate(`document.querySelector('[data-tab="goals"]').click()`);
await shoot('02-goals');

await evaluate(`document.querySelector('[data-goal]').click()`);
await shoot('03-goal-detail');

// 核验「里程碑名字补上目标名」：先把前两条打回裸格式，再从菜单点一次
const backfillBefore = await evaluate(`(async () => {
  const store = await import(new URL('./src/core/store.js', location.href).href);
  const goals = await import(new URL('./src/core/goals.js', location.href).href);
  const g = store.getState().goal.find((x) => x.title === '公众号更 20 篇');
  store.commit((st) => {
    let i = 0;
    for (const m of st.milestone) {
      if (m.goal_id === g.id && i < 2) { i += 1; m.title = '第 ' + i + ' 周'; }
    }
  });
  return goals.milestonesOf(g.id, store.getState()).slice(0, 2).map((m) => m.title);
})()`, true);
await evaluate(`document.querySelector('.detail [data-more]').click()`);
await sleep(280);
await evaluate(`[...document.querySelectorAll('.act-item')].find((b) => b.textContent.includes('补上目标名'))?.click()`);
await sleep(320);
const backfillAfter = await evaluate(
  `[...document.querySelectorAll('.detail .ms-title')].slice(0, 2).map((n) => n.textContent.trim())`,
);
console.log('backfill:', JSON.stringify({ before: backfillBefore, after: backfillAfter }));

await evaluate(`document.querySelector('[data-back]').click()`);

await evaluate(`document.querySelector('[data-tab="calendar"]').click()`);
await shoot('04-calendar');

// 交互核验：计划日在未来、但已经做掉的里程碑 —— 抽屉里标题必须带删除线，
// 勾选框不能填实（那天没做），点了要有话说（不能点了没反应）
const dayKey = await evaluate(`(async () => {
  const util = await import(new URL('./src/core/util.js', location.href).href);
  return util.addDays(util.todayStr(), 2);
})()`, true);
await evaluate(`document.querySelector('[data-day="${dayKey}"]').click()`);
await sleep(320);
const doneElseRow = await evaluate(`(() => {
  const row = document.querySelector('.sheet .todo[data-ev="milestone"]');
  if (!row) return { found: false };
  const title = row.querySelector('.todo-title');
  const box = row.querySelector('.todo-check');
  return {
    found: true,
    cls: row.className.trim(),
    text: title.textContent.trim(),
    strike: getComputedStyle(title).textDecorationLine,
    boxFilled: getComputedStyle(box).backgroundColor,
    meta: row.querySelector('.todo-meta')?.textContent.replace(/\\s+/g, ' ').trim(),
  };
})()`);
console.log('done-else row:', JSON.stringify(doneElseRow));
await shoot('11-cal-day-done-else');
await evaluate(`document.querySelector('.sheet .todo[data-ev="milestone"] [data-check]')?.click()`);
await sleep(200);
console.log('done-else toast:', await evaluate(`document.getElementById('toast')?.textContent`));
await evaluate(`document.querySelector('.sheet-x')?.click()`);
await sleep(240);

await evaluate(`document.querySelector('[data-tab="bank"]').click()`);
await shoot('05-bank');

// 抽屉
await evaluate(`document.querySelector('[data-tab="today"]').click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-joy]').click()`);
await shoot('06-joy-sheet');
await evaluate(`document.querySelector('.sheet-x')?.click()`);

await evaluate(`document.querySelector('[data-new]')?.click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-tab="goals"]').click()`);
await sleep(200);
await evaluate(`document.querySelector('[data-new]').click()`);
await shoot('07-goal-form');
await evaluate(`document.querySelector('.sheet-x')?.click()`);

console.log('console issues:', consoleIssues.length ? consoleIssues : 'none');
console.log('out dir:', OUT);

ws.close();
chrome.kill('SIGKILL');
process.exit(0);
