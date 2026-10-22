// 生成 PWA 图标：用 headless Chrome 把 SVG 渲染成精确尺寸的 PNG
// 用法：node tools/icon.mjs
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(ROOT, 'icons');
mkdirSync(OUT, { recursive: true });

const BRAND = '#E9793F';
const DEEP = '#CE6428';

/** scale：勾在画布里的占比。maskable 要留安全区，所以勾小一点 */
function html(size, scale, radius) {
  const s = Math.round(size * scale);
  const off = Math.round((size - s) / 2);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0;width:${size}px;height:${size}px;overflow:hidden;background:${BRAND}}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>
  <svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="${BRAND}"/>
    ${radius ? `<rect x="${size * 0.02}" y="${size * 0.02}" width="${size * 0.96}" height="${size * 0.96}" rx="${size * 0.16}" fill="${BRAND}"/>` : ''}
    <g transform="translate(${off} ${off}) scale(${s / 32})">
      <path d="M7 16.6l6.2 6.2L25 10.4" fill="none" stroke="#fff"
        stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg></body></html>`;
}

function render(name, size, scale, radius) {
  const tmp = path.join(tmpdir(), `stepone-icon-${name}.html`);
  const out = path.join(OUT, name);
  writeFileSync(tmp, html(size, scale, radius));
  const res = spawnSync(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${size},${size}`,
    `--screenshot=${out}`,
    `file://${tmp}`,
  ], { stdio: 'ignore' });
  console.log(res.status === 0 ? `ok  ${name}` : `FAIL ${name}`);
}

render('icon-192.png', 192, 0.62, false);
render('icon-512.png', 512, 0.62, false);
// maskable：内容缩到 52%，四周留出安全区，避免被系统裁成圆形时切掉勾
render('icon-maskable-512.png', 512, 0.46, false);
console.log('done ->', OUT);
