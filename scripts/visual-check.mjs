#!/usr/bin/env node
// Скриншоты страницы на брейкпоинтах сайта и сравнение с эталоном.
//
//   node scripts/visual-check.mjs <путь|URL> [--ref <URL|путь|файл.png>] [--widths 320,480,640,960,1200]
//                                 [--base http://localhost:4321] [--name имя] [--max 2]
//
// <путь> вида /school/ открывается относительно --base (по умолчанию локальный `npm run preview`/`dev`).
// --ref URL — эталон снимается на тех же ширинах (например, живой сайт).
// --ref файл.png — эталон-картинка (превью PSD); сравнение на ширине картинки, если --widths не задан.
// Результат: reports/visual/<имя>/{<w>-page.png,<w>-ref.png,<w>-diff.png}, таблица расхождений.
// Дополнительно печатает ошибки консоли и запросы к доменам Tilda.
// Код выхода 1, если расхождение на какой-либо ширине больше --max процентов.

import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import fs from 'node:fs';
import path from 'node:path';

const BREAKPOINTS = [320, 480, 640, 960, 1200];

function parseArgs(argv) {
  const args = { target: null, ref: null, widths: null, base: 'http://localhost:4321', name: null, max: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ref') args.ref = argv[++i];
    else if (a === '--widths') args.widths = argv[++i].split(',').map(Number);
    else if (a === '--base') args.base = argv[++i];
    else if (a === '--name') args.name = argv[++i];
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (!args.target) args.target = a;
  }
  if (!args.target) {
    console.error('Использование: node scripts/visual-check.mjs <путь|URL> [--ref URL|PNG] [--widths ...]');
    process.exit(2);
  }
  return args;
}

const toUrl = (target, base) => (/^https?:\/\//.test(target) ? target : new URL(target, base).href);
const slug = (s) => s.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';

async function shoot(browser, url, width, file, log) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && log.errors.add(`${m.text()}`));
  page.on('pageerror', (e) => log.errors.add(e.message));
  page.on('request', (r) => /tilda(cdn)?\.(com|ws|cc|info|pro)/.test(new URL(r.url()).host) && log.tilda.add(r.url()));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  // Прокрутка до низа, чтобы сработали lazyload и анимации появления Tilda.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  // Анимации появления Tilda стартуют по IntersectionObserver и зависят от скорости прокрутки —
  // для стабильного снимка переводим все такие элементы в конечное состояние.
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelectorAll('.t-animate').forEach((el) => el.classList.add('t-animate_started')));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  await page.close();
}

function compare(aFile, bFile, diffFile) {
  const a = PNG.sync.read(fs.readFileSync(aFile));
  const b = PNG.sync.read(fs.readFileSync(bFile));
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const crop = (img) => {
    const out = new PNG({ width, height });
    PNG.bitblt(img, out, 0, 0, width, height, 0, 0);
    return out;
  };
  const diff = new PNG({ width, height });
  const changed = pixelmatch(crop(a).data, crop(b).data, diff.data, width, height, { threshold: 0.1 });
  fs.writeFileSync(diffFile, PNG.sync.write(diff));
  return { percent: (changed / (width * height)) * 100, heights: [a.height, b.height], widths: [a.width, b.width] };
}

const args = parseArgs(process.argv.slice(2));
const url = toUrl(args.target, args.base);
const refIsImage = args.ref && /\.png$/i.test(args.ref) && fs.existsSync(args.ref);
const refPng = refIsImage ? PNG.sync.read(fs.readFileSync(args.ref)) : null;
const widths = args.widths ?? (refPng ? [refPng.width] : BREAKPOINTS);
const outDir = path.join('reports', 'visual', args.name ?? slug(args.target));
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const log = { errors: new Set(), tilda: new Set() };
const rows = [];
try {
  for (const w of widths) {
    const pageFile = path.join(outDir, `${w}-page.png`);
    await shoot(browser, url, w, pageFile, log);
    const row = { width: w, page: pageFile };
    if (args.ref) {
      const refFile = path.join(outDir, `${w}-ref.png`);
      if (refIsImage) fs.copyFileSync(args.ref, refFile);
      else await shoot(browser, toUrl(args.ref, args.base), w, refFile, { errors: new Set(), tilda: new Set() });
      Object.assign(row, compare(pageFile, refFile, path.join(outDir, `${w}-diff.png`)));
    }
    rows.push(row);
  }
} finally {
  await browser.close();
}

console.log(`\n${url}${args.ref ? `  ⇄  ${args.ref}` : ''}\nОтчёт: ${outDir}/`);
for (const r of rows) {
  const diff = r.percent === undefined ? '' : `  diff ${r.percent.toFixed(2)}%  высота ${r.heights[0]} / ${r.heights[1]}`;
  console.log(`  ${String(r.width).padStart(5)}px${diff}`);
}
if (log.errors.size) console.log(`Ошибки консоли:\n  ${[...log.errors].join('\n  ')}`);
if (log.tilda.size) console.log(`Запросы к Tilda (${log.tilda.size}):\n  ${[...log.tilda].slice(0, 10).join('\n  ')}`);
if (args.max !== null && rows.some((r) => r.percent > args.max)) process.exit(1);
