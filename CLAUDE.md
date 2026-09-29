# Надеждик — nadezhdik.ru

Сайт детской академии «Надеждик», перенесённый из Tilda. Статика на Astro + сервис заявок на Node.
Команды — в `README.md`, деплой — `docs/deploy.md`, дизайн-система — `docs/design-system.md`.

## Две части сайта

- **Старые страницы** (`public/index.html`, `public/{school,dance,football}/index.html`) — экспорт Tilda
  (Zero Block: абсолютные координаты на 5 брейкпоинтах). Ресурсы — в `public/tilda/`. Не переверстывать и не
  копировать их разметку. Правки: тексты/ссылки прямо в HTML; стили — только в `public/assets/legacy-overrides.css`
  с селектором `#rec…` и комментарием «страница, блок». Страницу, которой нужна серьёзная переделка, пересобираем
  целиком на компонентах в `src/pages/` и удаляем её HTML из `public/` (и добавляем в `REBUILT` в
  `scripts/tilda_export.py`). Так уже пересобрана `/english/`.
- **Новые страницы** — `src/pages/*.astro` на `src/layouts/Base.astro` и компонентах из `src/components/`.
  Шаблоны секций — на `/styleguide` (`src/pages/styleguide.astro`).

## Правила для новых страниц

- Только токены из `src/styles/tokens.css` (`--c-*`, `--fs-*`, `--space-*`, `--tilt`). Новый цвет/кегль — сначала в токены.
- Не использовать классы Tilda (`t-*`, `tn-*`, `t396`) и не подключать `public/tilda/*` в новых страницах.
- Вёрстка на flex/grid, mobile-first; брейкпоинты сайта: 480, 640, 960, 1200. Горизонтального скролла быть не должно.
- Контакты, соцсети, меню — `src/data/site.ts`. Новую страницу добавить в `nav`, если она должна быть в меню.
- Картинки для новых страниц — в `public/images/<страница>/`, с осмысленными именами, `alt` на русском.
- Форма заявки — только `LeadForm.astro` (временный дизайн, заменим по макету); endpoint `/api/lead`.

## Проверка после любых изменений

1. `npm run build` — без ошибок.
2. `npm run preview` (или dev) и `npm run check:visual -- <путь>` — посмотреть скриншоты в `reports/visual/<имя>/`
   на всех 5 ширинах. Для старых страниц — `--ref https://nadezhdik.ru<путь>` (пока домен на Tilda), diff ≈ 0%.
3. Для макета — `--ref design/specs/<имя>/preview.png`.

## Секреты и репозиторий

Репозиторий публичный. Ключи Tilda, токены Telegram/SMTP — только в `.env` (локально) и на сервере
(`/etc/nadezhdik/leads.env`). PSD-макеты и `design/specs/` в git не попадают.
