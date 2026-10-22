// ============================================================
// data.js — 数据与备份
//
// 这个产品的数据只在浏览器 localStorage 里：换设备、清缓存、换浏览器都会丢。
// 所以「导出」不是高级功能，它是唯一的安全出口，必须有个显眼的位置。
// ============================================================

import { getState, commit, exportJSON, importJSON } from '../core/store.js';
import { todayStr, esc, fmtDaySmart } from '../core/util.js';
import { toast, openSheet, confirmSheet } from './components.js';

function counts(s) {
  return [
    ['目标', s.goal.length],
    ['里程碑', s.milestone.length],
    ['待办', s.todo.length],
    ['重复', s.routine.length],
    ['快乐', s.joy_log.length],
    ['流水', s.point_txn.length],
    ['想要', s.gift.length],
  ];
}

function sizeKB(s) {
  try {
    return (new Blob([JSON.stringify(s)]).size / 1024).toFixed(1);
  } catch {
    return '—';
  }
}

function lastExportText(s) {
  const at = s.setting.last_export_at;
  if (!at) return '还没导出过';
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtDaySmart(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 给别处（银行页那一行）复用同一句话，避免两处各写一遍格式 */
export function lastExportLabel(s) {
  return lastExportText(s);
}

function download(text) {
  const name = `stepone-backup-${todayStr()}.json`;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

function sheetHtml(s) {
  return `
    <p class="data-warn">
      这份数据只存在<strong>这台设备的这个浏览器</strong>里。换手机、清缓存、换浏览器，
      攒了几个月的积分和记录会一起消失 —— 没有任何云端备份。
    </p>

    <div class="data-grid">
      ${counts(s).map(([label, n]) => `<div class="data-cell"><span>${esc(label)}</span><strong>${n}</strong></div>`).join('')}
      <div class="data-cell"><span>存储占用</span><strong>${sizeKB(s)}<small>KB</small></strong></div>
    </div>

    <div class="data-actions">
      <button class="btn btn-primary btn-block" data-export="1">导出备份文件</button>
      <p class="hint">会下载一个 JSON 文件，存到网盘或发给自己。上次导出：${esc(lastExportText(s))}</p>
      <button class="btn btn-soft btn-block" data-import="1">从备份文件恢复</button>
      <p class="hint">恢复会<strong>覆盖</strong>这台设备上的现有数据。</p>
    </div>
  `;
}

export function openDataSheet() {
  const sheet = openSheet({ title: '数据与备份', html: sheetHtml(getState()) });

  const rerender = () => {
    sheet.body.innerHTML = sheetHtml(getState());
  };

  sheet.el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-export]')) {
      const name = download(exportJSON());
      commit((st) => { st.setting.last_export_at = new Date().toISOString(); });
      rerender();
      toast(`已导出 ${name}`);
      return;
    }

    if (e.target.closest('[data-import]')) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.hidden = true;
      // 挂在文档里再点：Safari 对游离节点的 change 事件不可靠
      sheet.body.appendChild(input);
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) { input.remove(); return; }
        let text = '';
        try {
          text = await file.text();
        } catch {
          toast('这个文件读不出来', 'warn');
          return;
        }

        // 先校验再覆盖：不能因为点错文件就把现有数据洗成空白
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          toast('不是合法的备份文件（JSON 解析失败）', 'warn');
          return;
        }
        const looksValid = parsed
          && typeof parsed === 'object'
          && parsed.setting
          && Array.isArray(parsed.goal)
          && Array.isArray(parsed.todo)
          && Array.isArray(parsed.point_txn);
        if (!looksValid) {
          toast('这个文件不像「一步」的备份', 'warn');
          return;
        }

        const cur = getState();
        const ok = await confirmSheet({
          title: '用备份覆盖现在这份数据？',
          message: `备份里有 ${parsed.goal.length} 个目标、${parsed.todo.length} 条待办、${parsed.point_txn.length} 条流水。`
            + `这台设备上现在的 ${cur.goal.length} 个目标、${cur.todo.length} 条待办会被替换，且不能撤销。`,
          okText: '覆盖',
          danger: true,
        });
        if (!ok) return;

        try {
          importJSON(text);
        } catch (err) {
          toast(`导入失败：${err.message}`, 'warn');
          return;
        }

        input.remove();
        sheet.close();
        document.dispatchEvent(new CustomEvent('stepone:data-replaced'));
        toast('已经从备份恢复');
      });
      input.click();
    }
  });

  return sheet;
}
