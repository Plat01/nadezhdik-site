#!/usr/bin/env node
// Приём заявок с сайта: POST /api/lead (JSON) → Telegram и/или почта.
//
// Каналы включаются наличием переменных окружения:
//   Telegram: TG_BOT_TOKEN, TG_CHAT_ID (можно несколько chat_id через запятую)
//   Почта:    SMTP_HOST, SMTP_PORT (465), SMTP_USER, SMTP_PASS, LEAD_EMAIL_TO, LEAD_EMAIL_FROM (= SMTP_USER)
// DRY_RUN=1 — ничего не отправлять, только писать заявку в лог (для локальной разработки).
// PORT (8787), HOST (127.0.0.1). На сервере nginx проксирует /api/ сюда, см. deploy/nginx.conf.
// Переменные читаются из окружения, а при локальном запуске — из .env в корне репозитория.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootEnv = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const env = process.env;
const PORT = Number(env.PORT || 8787);
const HOST = env.HOST || '127.0.0.1';
const DRY_RUN = env.DRY_RUN === '1';
const MAX_BODY = 16 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

const channels = {
  telegram: Boolean(env.TG_BOT_TOKEN && env.TG_CHAT_ID),
  email: Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.LEAD_EMAIL_TO),
};

const log = (...args) => console.log(new Date().toISOString(), ...args);

// --- Валидация -------------------------------------------------------------

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);

function validate(body) {
  const lead = {
    name: clean(body.name, 100),
    phone: clean(body.phone, 30),
    message: clean(body.message, 2000),
    page: clean(body.page, 200),
  };
  const errors = [];
  if (!lead.name) errors.push('name');
  if (lead.phone.replace(/\D/g, '').length < 7) errors.push('phone');
  return { lead, errors };
}

// --- Ограничение частоты по IP --------------------------------------------

const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 10000) hits.clear();
  return recent.length > RATE_LIMIT.max;
}

// --- Отправка ---------------------------------------------------------------

function format(lead) {
  return [
    'Новая заявка с сайта nadezhdik.ru',
    `Имя: ${lead.name}`,
    `Телефон: ${lead.phone}`,
    lead.message && `Вопрос: ${lead.message}`,
    lead.page && `Страница: ${lead.page}`,
  ].filter(Boolean).join('\n');
}

async function sendTelegram(text) {
  for (const chatId of env.TG_CHAT_ID.split(',').map((s) => s.trim()).filter(Boolean)) {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  }
}

let transporter;
async function sendEmail(text, lead) {
  if (!transporter) {
    const { default: nodemailer } = await import('nodemailer');
    const port = Number(env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
  }
  await transporter.sendMail({
    from: env.LEAD_EMAIL_FROM || env.SMTP_USER,
    to: env.LEAD_EMAIL_TO,
    subject: `Заявка с сайта: ${lead.name}`,
    text,
  });
}

async function deliver(lead) {
  const text = format(lead);
  if (DRY_RUN) {
    log('DRY_RUN заявка:\n' + text);
    return;
  }
  const jobs = [];
  if (channels.telegram) jobs.push(sendTelegram(text));
  if (channels.email) jobs.push(sendEmail(text, lead));
  if (!jobs.length) throw new Error('Не настроен ни один канал доставки (TG_* или SMTP_*)');
  const results = await Promise.allSettled(jobs);
  const failed = results.filter((r) => r.status === 'rejected');
  failed.forEach((r) => log('Ошибка доставки:', r.reason?.message));
  // Заявка считается принятой, если дошла хотя бы по одному каналу.
  if (failed.length === results.length) throw new Error('Все каналы доставки недоступны');
}

// --- HTTP -------------------------------------------------------------------

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, channels, dryRun: DRY_RUN });
  if (url.pathname !== '/api/lead') return send(res, 404, { ok: false });
  if (req.method !== 'POST') return send(res, 405, { ok: false });
  if (!String(req.headers['content-type']).includes('application/json')) return send(res, 415, { ok: false });

  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress);
  try {
    const body = await readJson(req);
    // Honeypot: поле website скрыто от людей, его заполняют только боты. Отвечаем «успехом», чтобы не подсказывать.
    if (body.website) return send(res, 200, { ok: true });
    if (rateLimited(ip)) return send(res, 429, { ok: false, error: 'rate_limited' });
    const { lead, errors } = validate(body);
    if (errors.length) return send(res, 422, { ok: false, errors });
    await deliver(lead);
    log(`Заявка принята (${lead.page || '-'})`);
    send(res, 200, { ok: true });
  } catch (err) {
    log('Ошибка:', err.message);
    send(res, err.status || 502, { ok: false });
  }
});

server.listen(PORT, HOST, () => {
  const active = Object.entries(channels).filter(([, on]) => on).map(([name]) => name);
  log(`lead-handler слушает http://${HOST}:${PORT} — каналы: ${DRY_RUN ? 'DRY_RUN' : active.join(', ') || 'НЕ НАСТРОЕНЫ'}`);
});
