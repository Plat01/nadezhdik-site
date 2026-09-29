# Деплой на сервер

Сайт — статика (`dist/`) под nginx + маленький Node-сервис заявок (`server/lead-handler.mjs`) под systemd.
Деплой делает GitHub Actions (`.github/workflows/deploy.yml`) при каждом push в `main`:
сборка → `rsync` по SSH → перезапуск сервиса заявок → проверка `SITE_URL/` и `SITE_URL/api/health`.
Пока в репозитории не задана переменная `DEPLOY_HOST`, workflow только собирает сайт.

## GitHub Pages

`.github/workflows/pages.yml` при каждом push в `main` собирает сайт и публикует его на
https://plat01.github.io/nadezhdik-site/. Сайт там живёт в подпути, поэтому после сборки
`scripts/rebase-dist.mjs` дописывает `/nadezhdik-site` ко всем абсолютным путям (в репозитории пути не меняются).

Ограничения Pages: нет серверной части (форма заявки на `/api/lead` не работает), нет 301-редиректов
(`/2` → `/` сделан HTML-переадресацией в `astro.config.mjs`). Pages можно сделать основным хостингом:
Settings → Pages → Custom domain `nadezhdik.ru` + DNS у регистратора — тогда подпуть исчезнет автоматически,
но для заявок всё равно понадобится отдельный сервис (сервер ниже или внешний обработчик форм).

## 1. Разовая настройка сервера (Ubuntu/Debian, под root)

```bash
apt update && apt install -y nginx rsync certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs

# пользователь для деплоя
adduser --disabled-password --gecos "" deploy
install -d -o deploy -g deploy /var/www/nadezhdik/site /var/www/nadezhdik/server
install -d -m 700 -o deploy /home/deploy/.ssh
# сюда — публичная часть ключа, приватная пойдёт в секрет DEPLOY_SSH_KEY
nano /home/deploy/.ssh/authorized_keys && chown deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys

# deploy может перезапускать только сервис заявок
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart nadezhdik-leads' > /etc/sudoers.d/nadezhdik && chmod 440 /etc/sudoers.d/nadezhdik

# секреты сервиса заявок (шаблон переменных — .env.example, секция «Обработчик заявок»)
install -d -m 750 -o root -g deploy /etc/nadezhdik
install -m 640 -o root -g deploy /dev/null /etc/nadezhdik/leads.env
nano /etc/nadezhdik/leads.env     # TG_BOT_TOKEN=… TG_CHAT_ID=… и/или SMTP_*

# конфиги из репозитория (deploy/)
cp deploy/nadezhdik-leads.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable nadezhdik-leads
cp deploy/nginx.conf /etc/nginx/sites-available/nadezhdik.conf
ln -s /etc/nginx/sites-available/nadezhdik.conf /etc/nginx/sites-enabled/ && nginx -t && systemctl reload nginx
```

Ключ для деплоя (на своей машине): `ssh-keygen -t ed25519 -f nadezhdik_deploy -C github-actions -N ""`.

## 2. Настройки репозитория на GitHub

Settings → Secrets and variables → Actions:

| Тип | Имя | Значение |
|---|---|---|
| Secret | `DEPLOY_SSH_KEY` | приватный ключ `nadezhdik_deploy` целиком |
| Secret | `DEPLOY_KNOWN_HOSTS` | вывод `ssh-keyscan -H <сервер>` (рекомендуется; без него ключ берётся при каждом деплое) |
| Variable | `DEPLOY_HOST` | IP или домен сервера — **включает деплой** |
| Variable | `DEPLOY_USER` | `deploy` (по умолчанию) |
| Variable | `DEPLOY_PATH` | `/var/www/nadezhdik` (по умолчанию) |
| Variable | `SITE_URL` | адрес для проверки после деплоя; до переключения DNS — `http://<IP>` |
| Variable | `PUBLIC_YM_ID` | номер счётчика Яндекс.Метрики (необязательно) |

Первый запуск: Actions → Build and deploy → Run workflow (или push в `main`).

## 3. Переключение домена с Tilda

1. Проверить сайт на сервере по IP: все страницы, `/api/health`, отправку тестовой заявки.
2. У регистратора домена: A-запись `nadezhdik.ru` и `www` → IP сервера (TTL заранее уменьшить до 300).
3. После обновления DNS: `certbot --nginx -d nadezhdik.ru -d www.nadezhdik.ru`, затем `SITE_URL=https://nadezhdik.ru`.
4. В Tilda отвязать домен от проекта (Настройки сайта → Домен), чтобы Tilda не выпускала на него сертификат.

## Проверка вручную

```bash
curl -I https://nadezhdik.ru/                 # 200
curl -I https://nadezhdik.ru/2                # 301 → /
curl https://nadezhdik.ru/api/health          # {"ok":true,"channels":{…}}
journalctl -u nadezhdik-leads -n 50           # лог заявок и ошибок доставки
```
