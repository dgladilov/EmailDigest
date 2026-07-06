#!/usr/bin/env node
// Генератор письма о релизе фичей.
// Запуск:  node build.js                 (берёт content.json, пишет email.html)
//          node build.js my.json out.html (свои пути)
//
// Режимы картинок (поле "image_mode" в content.json):
//   "inline" (по умолч.) — картинки вшиваются в HTML через data-URI → email.html
//   "cid"                — картинки идут вложениями (Content-ID)     → email.html + email.eml

const fs = require('fs');
const path = require('path');

const contentPath  = process.argv[2] || 'content.json';
const outPath      = process.argv[3] || 'email.html';
const templatePath = path.join(__dirname, 'template.html');

// Данные читаем сразу — настройки ниже зависят от них
const data = JSON.parse(fs.readFileSync(contentPath, 'utf8'));

// --- Настройки письма: объект "config" в content.json ---
//   "config": {
//     "image_mode": "inline" | "cid",     // по умолч. "inline"
//     "max_inline_image_kb": 1536         // по умолч. 1536 (1.5 МБ)
//   }
// Для обратной совместимости эти же поля читаются и с верхнего уровня,
// но приоритет — у config.
const config = (data.config && typeof data.config === 'object') ? data.config : {};
const pick = (key) => config[key] !== undefined ? config[key] : data[key];
if (data.image_mode !== undefined || data.max_inline_image_kb !== undefined) {
  console.warn('⚠  image_mode / max_inline_image_kb на верхнем уровне устарели — перенесите их в объект "config"');
}

// Порог размера картинки макета.
// Если файл больше — картинка НЕ добавляется, используется ссылка-фолбэк.
const DEFAULT_MAX_IMAGE_KB = 1536; // 1.5 МБ
const maxImageKb = Number(pick('max_inline_image_kb')) > 0
  ? Number(pick('max_inline_image_kb'))
  : DEFAULT_MAX_IMAGE_KB;

// Режим подключения картинок: "inline" (data-URI) или "cid" (вложения)
const imageMode = (pick('image_mode') || 'inline').toLowerCase();
if (!['inline', 'cid'].includes(imageMode)) {
  console.error(`✗ неизвестный image_mode: "${pick('image_mode')}" (ожидается "inline" или "cid")`);
  process.exit(1);
}

// Собранные CID-вложения: { cid, filename, mime, buffer }
const cidAttachments = [];

// MIME-типы по расширению файла картинки
const IMAGE_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp'
};

// --- SVG-логотипы платформ (data-URI, не зависят от внешних серверов) ---
const APPLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" width="11" height="11"><path fill="#0b6b2f" d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>';
const ANDROID_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" width="12" height="12"><path fill="#0b6b2f" d="M420.55 301.93a24 24 0 1 1 24-24 24 24 0 0 1-24 24m-265.1 0a24 24 0 1 1 24-24 24 24 0 0 1-24 24m273.7-144.48 47.94-83a10 10 0 1 0-17.27-10l-48.54 84.07a301.25 301.25 0 0 0-246.56 0L116.18 64.45a10 10 0 1 0-17.27 10l47.94 83C64.53 202.22 8.24 285.55 0 384h576c-8.24-98.45-64.54-181.78-146.85-226.55"/></svg>';
const dataUri = (svg) => 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');

// Стили бейджей по типу платформы
const PLATFORM_STYLE = {
  ios:     { label: 'iOS',     fg: '#0b6b2f', bg: '#e3f6ea', icon: dataUri(APPLE_SVG),   w: 11 },
  android: { label: 'Android', fg: '#0b6b2f', bg: '#e3f6ea', icon: dataUri(ANDROID_SVG), w: 12 },
  back:    { label: 'Back',    fg: '#055a78', bg: '#e0f3fb', icon: null }
};

// Экранирование пользовательского текста
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderBadge(p) {
  const style = PLATFORM_STYLE[p.type];
  if (!style) { console.warn(`⚠  неизвестная платформа: "${p.type}" (ожидается ios/android/back)`); return ''; }
  const iconImg = style.icon
    ? `<img src="${style.icon}" width="${style.w}" height="${style.w}" alt="" style="vertical-align:-1px;">&nbsp;`
    : '';
  const ver = p.version ? `&nbsp;${esc(p.version)}` : '';
  return `<td style="padding-right:6px; padding-bottom:6px;"><span style="display:inline-block; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; color:${style.fg}; background-color:${style.bg}; border-radius:5px; padding:4px 9px;">${iconImg}${esc(style.label)}${ver}</span></td>`;
}

const linkStyle = 'font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#21A038;';
const mkLink = (url, label) => {
  const u = (url == null ? '' : String(url)).trim();
  return u ? `<a href="${esc(u)}" style="${linkStyle}">${label}&nbsp;→</a>` : '';
};

// Возвращает { image, link } для макета фичи.
//   image — HTML с картинкой (data-URI или cid:, по режиму) или ''
//   link  — HTML ссылки "Макеты" (или '')
// Правила:
//   - есть mockup_image, файл найден и влезает в порог → картинка в письме
//     (inline: вшита через data-URI; cid: вложение + ссылка cid: в HTML);
//   - файла нет / он большой / формат неизвестен → картинки нет, предупреждение;
//   - mockup_url задан → всегда доступен как ссылка (в т.ч. как фолбэк).
function renderMockup(f, featureIndex) {
  const result = { image: '', link: '' };
  const urlFallback = (f.mockup_url || f.mockups_url || '').trim(); // mockups_url — старое имя, поддержим
  const imgPath = (f.mockup_image || '').trim();

  if (imgPath) {
    const abs = path.isAbsolute(imgPath) ? imgPath : path.join(path.dirname(contentPath), imgPath);
    const ext = path.extname(imgPath).toLowerCase();
    const mime = IMAGE_MIME[ext];

    if (!mime) {
      console.warn(`⚠  [${f.name}] неподдерживаемый формат картинки "${imgPath}" (нужно png/jpg/gif/webp)`);
    } else if (!fs.existsSync(abs)) {
      console.warn(`⚠  [${f.name}] файл макета не найден: ${abs}`);
    } else {
      const sizeKb = fs.statSync(abs).size / 1024;
      if (sizeKb > maxImageKb) {
        const hint = urlFallback ? 'использую ссылку mockup_url' : 'уменьшите файл или добавьте mockup_url';
        console.warn(`⚠  [${f.name}] картинка ${Math.round(sizeKb)} КБ > ${maxImageKb} КБ — не добавлена, ${hint}`);
      } else {
        let src;
        if (imageMode === 'cid') {
          // Вложение с Content-ID: в HTML идёт ссылка cid:, файл — в email.eml
          const cid = `mockup${featureIndex + 1}@release`;
          cidAttachments.push({
            cid,
            filename: path.basename(abs),
            mime,
            buffer: fs.readFileSync(abs),
            sourcePath: path.resolve(abs)
          });
          src = `cid:${cid}`;
        } else {
          const b64 = fs.readFileSync(abs).toString('base64');
          src = `data:${mime};base64,${b64}`;
        }
        // Картинка кликабельна, если есть ссылка-фолбэк (открыть полный макет)
        const img = `<img src="${src}" alt="Макет: ${esc(f.name)}" width="518" style="width:100%; max-width:518px; height:auto; border-radius:10px; border:1px solid #eceff2; display:block;">`;
        const imgCell = urlFallback
          ? `<a href="${esc(urlFallback)}" style="text-decoration:none;">${img}</a>`
          : img;
        // Обёртка-таблица: единственный способ разметки, который движок Word
        // (классический Outlook) уважает стабильно. Абзац <p> с margin Word
        // может "потерять" при вставке, и картинка уедет к левому краю.
        result.image = `
              <table role="presentation" width="518" cellpadding="0" cellspacing="0" style="width:100%; max-width:518px;">
                <tr><td style="padding:0 0 10px 0;">${imgCell}</td></tr>
              </table>`;
      }
    }
  }

  // Если картинки в письме нет, а ссылка есть — даём текстовую ссылку "Макеты"
  if (!result.image && urlFallback) {
    result.link = mkLink(urlFallback, 'Макеты');
  }
  return result;
}

function renderFeature(f, index, isLast) {
  const badges = (f.platforms || []).map(renderBadge).join('');
  const badgeBlock = badges
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>${badges}</tr></table>`
    : '';
  const divider = isLast ? '' :
    `<tr><td style="padding:24px 40px 0 40px;" class="px"><div style="border-top:1px solid #eceff2; font-size:0; line-height:0;">&nbsp;</div></td></tr>`;

  // --- Макет: картинка (вшитая) и/или ссылка ---
  const mockup = renderMockup(f, index);

  // --- Ссылки: Аналитика + Макеты(если текстовая ссылка) ---
  const analytics = mkLink(f.analytics_url, 'Аналитика');
  const mockupsLink = mockup.link;
  const sep = (analytics && mockupsLink) ? '<span style="color:#d0d5dd;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>' : '';
  const linksBlock = (analytics || mockupsLink)
    ? `\n              <p style="margin:0;">${analytics}${sep}${mockupsLink}</p>`
    : '';

  // --- Опциональное описание ---
  const desc = (f.description == null ? '' : String(f.description)).trim();
  const descBlock = desc
    ? `\n              <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#6b7280;">${esc(desc)}</p>`
    : '';

  // Если под названием ничего нет — убираем нижний отступ у названия
  const hasBody = descBlock || mockup.image || linksBlock;
  const nameMargin = hasBody ? 'margin:0 0 6px 0;' : 'margin:0;';

  return `
          <tr>
            <td style="padding:24px 40px 0 40px;" class="px">
              ${badgeBlock}
              <p style="${nameMargin} font-family:Arial,Helvetica,sans-serif; font-size:18px; font-weight:bold; line-height:1.4; color:#1f1f1f;">${esc(f.name)}</p>${descBlock}${mockup.image}${linksBlock}
            </td>
          </tr>${divider}`;
}

// --- сборка ---
const features = (data.features || []);
if (!features.length) console.warn('⚠  в content.json нет ни одной фичи');

const featuresHtml = features.map((f, i) => renderFeature(f, i, i === features.length - 1)).join('\n');

// --- Блок "Полезные материалы" (опциональный) ---
// data.resources — массив ссылок: [{ "title": "...", "url": "..." }, ...]
// Показывается только если массив непустой.
function renderResources(resources) {
  const items = (resources || []).filter(r => r && (r.url || '').trim());
  if (!items.length) return '';
  const rows = items.map(r => {
    const title = esc((r.title || r.url || '').toString().trim());
    const url = esc(r.url.toString().trim());
    return `<tr><td style="padding:3px 0;"><a href="${url}" style="font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:bold; color:#21A038; text-decoration:none;">${title}&nbsp;→</a></td></tr>`;
  }).join('');
  const heading = esc((data.resources_title || 'Полезные материалы').toString());
  return `
          <tr>
            <td style="padding:8px 40px 0 40px;" class="px">
              <div style="border-top:1px solid #eceff2; padding-top:20px;">
                <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; letter-spacing:0.08em; text-transform:uppercase; color:#9aa6b2;">${heading}</p>
                <table role="presentation" cellpadding="0" cellspacing="0">${rows}</table>
              </div>
            </td>
          </tr>`;
}

// --- Подвал (опциональный) ---
// Показывается, если задан contact и/или team. Нет обоих — подвала нет.
function renderFooter(contact, team) {
  const c = (contact == null ? '' : String(contact)).trim();
  const t = (team == null ? '' : String(team)).trim();
  if (!c && !t) return '';
  const contactLine = c ? `Вопросы по релизу — пишите в ${esc(c)}.` : '';
  const teamLine = t ? esc(t) : '';
  const br = (contactLine && teamLine) ? '<br>' : '';
  return `
          <tr>
            <td style="padding:24px 40px 36px 40px;" class="px">
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.6; color:#9aa6b2;">${contactLine}${br}${teamLine}</p>
            </td>
          </tr>`;
}

const resourcesHtml = renderResources(data.resources);
const footerHtml = renderFooter(data.contact, data.team);

// Нижний отступ у контейнера должен остаться, даже если подвала нет:
// если футера нет, добавим отступ через пустую строку.
const tailSpacer = footerHtml ? '' :
  `\n          <tr><td style="padding:0 40px 36px 40px; font-size:0; line-height:0;" class="px">&nbsp;</td></tr>`;

let html = fs.readFileSync(templatePath, 'utf8')
  .replace(/\{\{RELEASE_TITLE\}\}/g, esc(data.release_title))
  .replace(/\{\{INTRO_TEXT\}\}/g, esc(data.intro))
  .replace(/\{\{FEATURES\}\}/g, featuresHtml)
  .replace(/\{\{RESOURCES\}\}/g, resourcesHtml)
  .replace(/\{\{FOOTER\}\}/g, footerHtml + tailSpacer);

fs.writeFileSync(outPath, html);
const parts = [`фичей: ${features.length}`];
if (resourcesHtml) parts.push(`материалов: ${(data.resources || []).filter(r => r && (r.url||'').trim()).length}`);
console.log(`✓ ${outPath} собран — ${parts.join(', ')}`);

// Предупреждение о размере: тяжёлый HTML подвешивает Outlook при вставке из буфера
const htmlSizeKb = Buffer.byteLength(html, 'utf8') / 1024;
if (imageMode === 'inline' && htmlSizeKb > 1024) {
  console.warn(`⚠  email.html весит ${Math.round(htmlSizeKb)} КБ — при вставке в Outlook письмо такого размера может подвесить клиент.`);
  console.warn(`   Сожмите картинки (ширина ~1040px, JPEG качество 75-80) или понизьте порог: "config": { "max_inline_image_kb": 300 }`);
}

// --- CID-режим: собираем полноценное письмо email.eml (MIME multipart/related) ---
// .eml можно открыть в Outlook / Apple Mail / Thunderbird и отправить как есть,
// либо скормить SMTP-инструменту. Картинки лежат внутри как вложения с Content-ID.
if (imageMode === 'cid') {
  const emlPath = outPath.replace(/\.html?$/i, '') + '.eml';

  // Тема письма в UTF-8 (RFC 2047 encoded-word)
  const subject = `=?UTF-8?B?${Buffer.from(String(data.release_title || 'Release')).toString('base64')}?=`;

  // base64 с переносом строк по 76 символов (требование MIME)
  const b64wrap = (buf) => buf.toString('base64').replace(/(.{76})/g, '$1\r\n');

  const boundary = 'RELEASE-EMAIL-BOUNDARY';
  const lines = [];
  lines.push('X-Unsent: 1'); // Outlook откроет .eml как неотправленный черновик с кнопкой "Отправить"
  lines.push('Subject: ' + subject);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/related; boundary="${boundary}"; type="text/html"`);
  lines.push('');
  lines.push('--' + boundary);
  lines.push('Content-Type: text/html; charset=utf-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(b64wrap(Buffer.from(html, 'utf8')));

  for (const att of cidAttachments) {
    lines.push('--' + boundary);
    lines.push(`Content-Type: ${att.mime}; name="${att.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-ID: <${att.cid}>`);
    lines.push(`Content-Disposition: inline; filename="${att.filename}"`);
    lines.push('');
    lines.push(b64wrap(att.buffer));
  }
  lines.push('--' + boundary + '--');
  lines.push('');

  fs.writeFileSync(emlPath, lines.join('\r\n'));
  console.log(`✓ ${emlPath} собран — вложений: ${cidAttachments.length} (режим cid)`);
  if (!cidAttachments.length) {
    console.warn('⚠  режим cid включён, но ни одной картинки не добавлено — .eml собран без вложений');
  }

  // Манифест вложений для send.js: какие файлы прикладывать и с какими cid
  const manifestPath = outPath.replace(/\.html?$/i, '') + '.attachments.json';
  const manifest = {
    subject: String(data.release_title || 'Release'),
    html: path.resolve(outPath),
    attachments: cidAttachments.map(a => ({
      cid: a.cid,
      filename: a.filename,
      path: a.sourcePath
    }))
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✓ ${manifestPath} — манифест для send.js`);
}
