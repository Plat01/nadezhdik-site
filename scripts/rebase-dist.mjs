#!/usr/bin/env node
// Переписывает абсолютные пути в собранном dist/ под подпуть — для GitHub Pages вида
// https://<user>.github.io/<repo>/, где сайт живёт не в корне домена.
//
//   node scripts/rebase-dist.mjs dist /nadezhdik-site
//
// Пустой base (свой домен на Pages или обычный сервер) — ничего не делает.
// Трогает только ссылки на то, что реально лежит в корне dist/ (tilda/, brand/, english/ …) и на сам корень "/",
// поэтому внешние URL, протокол-относительные //… и произвольные строки в JS не меняются.

import fs from 'node:fs';
import path from 'node:path';

const [dir = 'dist', rawBase = ''] = process.argv.slice(2);
const base = rawBase.replace(/\/+$/, '');
if (!base) {
  console.log('rebase-dist: base пустой — пути не меняются');
  process.exit(0);
}
if (!base.startsWith('/')) {
  console.error(`rebase-dist: base должен начинаться с "/": ${rawBase}`);
  process.exit(2);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const topLevel = fs.readdirSync(dir).map(escape);
// "/" + (имя из корня dist, за которым конец пути) или "/" сам по себе (перед кавычкой, #, ?, скобкой).
const target = `/(?=(?:${topLevel.join('|')})(?=[/"'?#)\\s]|$)|["'#?)])`;
// Контексты: значение атрибута ="/…", url(/…) в CSS, url=/… в meta refresh.
const pattern = new RegExp(`(=["']|url\\(["']?|url=)${target}`, 'g');

let files = 0;
let replacements = 0;
const walk = (d) => {
  for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(html|css)$/.test(entry.name)) {
      const text = fs.readFileSync(full, 'utf8');
      let count = 0;
      const next = text.replace(pattern, (_, prefix) => (count++, `${prefix}${base}/`));
      if (count) {
        fs.writeFileSync(full, next);
        files++;
        replacements += count;
      }
    }
  }
};
walk(dir);
console.log(`rebase-dist: ${replacements} путей в ${files} файлах → ${base}/`);
