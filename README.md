# nadezhdik.ru

Сайт детской академии «Надеждик». Перенесён из Tilda: старые страницы хранятся как статический экспорт,
новые собираются на [Astro](https://astro.build) из компонентов в стиле сайта. Заявки с форм принимает
маленький Node-сервис и отправляет владельцу в Telegram и/или на почту.

## Быстрый старт

Нужны Node 22+, [uv](https://docs.astral.sh/uv/) (для Python-скриптов) и один раз — браузер для скриншотов.

```bash
npm install
npx playwright install chromium   # один раз, для npm run check:visual
cp .env.example .env              # заполнить то, что нужно (см. ниже)
npm run dev                       # http://localhost:4321  (витрина компонентов: /styleguide/)
```

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | локальная разработка с автообновлением, http://localhost:4321 |
| `npm run build` | сборка сайта в `dist/` |
| `npm run preview` | просмотр собранного `dist/` |
| `npm run leads:dev` | сервис заявок локально в режиме DRY_RUN (заявки только в лог); `npm run dev` проксирует на него `/api` |
| `npm run check:visual -- /school/` | скриншоты страницы на 320/480/640/960/1200 в `reports/visual/school/` |
| `npm run check:visual -- /school/ --ref https://nadezhdik.ru/school/` | то же + сравнение с эталоном, diff в % |
| `npm run check:visual -- /promo/ --ref design/specs/promo/preview.png` | сравнение с превью PSD-макета |
| `npm run psd -- design/mockups/promo.psd` | разбор PSD → `design/specs/promo/` (preview.png, слои, spec.md, spec.json) |
| `npm run psd -- --selftest` | проверка PSD-скрипта на сгенерированном файле |
| `npm run export:tilda` | выгрузка страниц из Tilda API в `public/` (существующие не трогает) |
| `npm run export:tilda -- --force --page 71702115` | перезаписать конкретную страницу (ID — в `docs/tilda-pages.json`) |
| `git push origin main` | деплой на сервер через GitHub Actions (`docs/deploy.md`) |

`check:visual` открывает локальный сайт (`npm run dev` или `preview` должен быть запущен) или любой URL.
Флаги: `--widths 320,1200`, `--base http://localhost:4322`, `--name отчёт`, `--max 2` (код 1, если diff больше 2%).

## Как работать с Claude Code

В репозитории есть `CLAUDE.md` (правила проекта) и скилы в `.claude/skills/`. Просить можно обычными словами,
скил подхватится сам, или вызвать явно:

| Скил | Пример запроса |
|---|---|
| `/new-page` | «Сделай страницу /dance/ для хореографической академии: расписание, преподаватели, цены, форма записи» |
| `/psd-to-page` | «Сверстай design/mockups/football.psd как страницу /football/» |
| `/deploy` | «Задеплой изменения и проверь живой сайт» |
| `/tilda-export` | «Перевыгрузи из Tilda страницу School» (только пока домен ещё на Tilda) |

Точечные правки старых страниц: «На главной поменяй телефон в подвале», «На School замени ссылку на
документ» — Claude правит HTML в `public/` или добавляет CSS в `public/assets/legacy-overrides.css`.

PSD-макеты кладите в `design/mockups/` — папка не попадает в git (репозиторий публичный).

## Структура

```
src/pages/            новые страницы (.astro), /styleguide, 404
src/components/       компоненты дизайн-системы
src/styles/tokens.css цвета, шрифты, кегли, отступы
src/data/site.ts      телефон, соцсети, меню
public/               старые страницы из Tilda (index.html, english/, school/, …) и их ресурсы (tilda/)
public/brand, fonts   логотип, маскот, иконки, шрифты для новых страниц
server/               сервис заявок POST /api/lead → Telegram / SMTP
scripts/              экспорт Tilda, разбор PSD, визуальная проверка
deploy/               nginx и systemd для сервера
docs/                 деплой, дизайн-система, данные Tilda API
```

## Переменные окружения (`.env`)

| Переменная | Для чего |
|---|---|
| `PUB_KEY`, `SECRET_KEY` | Tilda API, только для `export:tilda` |
| `PUBLIC_YM_ID` | номер счётчика Яндекс.Метрики для новых страниц (в CI — переменная репозитория) |
| `TG_BOT_TOKEN`, `TG_CHAT_ID` | заявки в Telegram (на сервере — в `/etc/nadezhdik/leads.env`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `LEAD_EMAIL_TO` | заявки на почту |

## Документация

- [docs/deploy.md](docs/deploy.md) — настройка сервера, секреты GitHub, переключение домена
- [docs/design-system.md](docs/design-system.md) — токены, компоненты, шаблоны секций
- [docs/README.md](docs/README.md) — проект в Tilda и его API
