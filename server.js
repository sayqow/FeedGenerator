// server.js
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const compression = require('compression');
const morgan = require('morgan');

const {
  generateMany,
  listAccessibleSpreadsheets,
  authGoogle,
} = require('./ymlGenerator');

const PORT = Number(process.env.PORT || 3001);
const BASE_PATH = (process.env.BASE_PATH || '/').replace(/\/+$/, '') || '';
const FILES_DIR = process.env.FILES_DIR || '/srv/files';
const NEXT_RUN_FILE = process.env.NEXT_RUN_FILE || '/var/run/filesvc-next-run.iso';

const app = express();
app.disable('x-powered-by');
app.use(compression());
app.use(morgan('dev'));
app.use(express.json({ limit: '200mb' }));
app.use(express.raw({ type: '*/*', limit: '200mb' }));

function bp(p){ return `${BASE_PATH}${p}`.replace(/\/{2,}/g,'/'); }

// --------- utils ----------
async function countOffersInXml(filePath){
  try{
    const txt = await fsp.readFile(filePath, 'utf8');
    const m = txt.match(/<offer\b/gi);
    return m ? m.length : 0;
  }catch{ return 0; }
}

// ---------- files ----------
app.get(bp('/file/:name'), async (req, res) => {
  try {
    const file = path.join(FILES_DIR, req.params.name);
    await fsp.access(file);
    res.sendFile(file);
  } catch {
    res.status(404).send('Not found');
  }
});

app.get(bp('/api/feed/yml/list'), async (_req, res) => {
  try {
    await fsp.mkdir(FILES_DIR, { recursive: true });
    const names = (await fsp.readdir(FILES_DIR)).filter(n=>!n.startsWith('.'));
    const out = [];
    for (const n of names){
      const full = path.join(FILES_DIR, n);
      const st = await fsp.stat(full).catch(()=>null);
      if(!st) continue;
      const offers = n.toLowerCase().endsWith('.xml') ? await countOffersInXml(full) : 0;
      out.push({
        name: n,
        url: bp(`/file/${encodeURIComponent(n)}`),
        mtime: st.mtimeMs,
        mtimeIso: st.mtime.toISOString(),
        offers
      });
    }
    out.sort((a,b)=>b.mtime - a.mtime);
    res.json({ files: out });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

app.post(bp('/upload/:name'), async (req, res) => {
  try {
    await fsp.mkdir(FILES_DIR, { recursive: true });
    const target = path.join(FILES_DIR, req.params.name);
    await fsp.writeFile(target, req.body);
    res.json({ ok: true, file: req.params.name });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ---------- build ----------
async function callBuild(req){
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host  = req.headers['x-forwarded-host'] || req.headers.host;
  const baseUrl = `${proto}://${host}${BASE_PATH}`.replace(/\/{2,}/g,'/');
  const reqBase = `${baseUrl}/file/`;
  return await generateMany({ reqBase });
}

app.post(bp('/api/feed/yml/build'), async (req, res) => {
  try {
    const result = await callBuild(req);
    res.json({ ok: true, feeds: result });
  } catch (e) {
    const ts = new Date().toISOString().replace(/[:.]/g,'-');
    const name = `build-error-${ts}.log`;
    try{
      await fsp.mkdir(FILES_DIR, { recursive: true });
      await fsp.writeFile(path.join(FILES_DIR, name), String(e.stack || e), 'utf8');
    }catch{}
    res.status(500).json({ ok:false, error: e.message, log: name });
  }
});

// ---------- sheets ----------
app.get(bp('/api/spreadsheets'), async (_req, res) => {
  try {
    const auth = await authGoogle();
    const items = await listAccessibleSpreadsheets(auth); // [{id,name}]
    res.json({ items });
  } catch (e) {
    res.status(500).json({ ok:false, error: e.message });
  }
});

// ---------- next run (ENV -> FILE -> systemd timer) ----------
const { execFile } = require('child_process');

app.get(bp('/api/next-run'), async (_req, res) => {
  try {
    
    
   
    

    // 2) файл со временем следующего запуска
    try {
      const raw = await fsp.readFile(NEXT_RUN_FILE, 'utf8');
      const iso = raw.trim();
      if (iso) return res.json({ ok: true, nextTs: iso });
    } catch { /* no file or unreadable */ }

    // 3) fallback: берём время из systemd‑таймера
    execFile('systemctl',
      ['list-timers', '--all', '--no-legend', '--time-format=iso'],
      (err, stdout) => {
        if (err || !stdout) return res.json({ ok: true, nextTs: null });

        // формат колонок: NEXT | LEFT | LAST | PASSED | UNIT | ACTIVATES
        const line = stdout.split('\n').find(l => /filesvc-feed\.timer/.test(l));
        if (!line) return res.json({ ok: true, nextTs: null });

        const cols = line.trim().split(/\s{2,}/); // бьём по двойным пробелам
        const nextCol = cols[0] || '';            // например: 2025-09-01 07:00:00 MSK
        if (!nextCol) return res.json({ ok: true, nextTs: null });

        // делаем из "YYYY-MM-DD HH:mm:ss MSK" валидную ISO-строку
        let iso = null;
        try {
          // если systemd печатает "MSK", добавим смещение
          const withTz = nextCol
            .replace(' ', 'T')           // 2025-09-01T07:00:00 MSK
            .replace(/\sMSK$/, '+03:00'); // -> 2025-09-01T07:00:00+03:00
          iso = new Date(withTz).toISOString();
        } catch { /* ignore */ }

        return res.json({ ok: true, nextTs: iso || null });
      }
    );
  } catch (e) {
    return res.json({ ok: true, nextTs: null });
  }
});

// ---------- MIT license (from GitHub raw, cached) ----------
let _licCache = { at:0, text:'' };
app.get(bp('/api/license')), async (_req, res) => { res.redirect(bp('/api/license')); }; // keep old links
app.get(bp('/api/license'), async (_req, res) => {
  const now = Date.now();
  if (_licCache.text && now - _licCache.at < 6*60*60*1000) return res.type('text/plain').send(_licCache.text);

  const url = 'https://raw.githubusercontent.com/sayqow/FeedGenerator/main/LICENSE';
  https.get(url, r => {
    if (r.statusCode !== 200){ res.status(502).send('Cannot fetch license'); return; }
    let data = '';
    r.setEncoding('utf8');
    r.on('data', chunk => data += chunk);
    r.on('end', () => {
      _licCache = { at: Date.now(), text: data };
      res.type('text/plain').send(data);
    });
  }).on('error', () => res.status(502).send('Cannot fetch license'));
});

// ---------- health ----------
app.get(bp('/healthz'), (_req, res) => res.json({ ok:true, ts:new Date().toISOString() }));

// ---------- assets ----------
app.get(bp('/assets/app.css'), (_req, res) => {
  res.type('text/css').send(`
:root{
  --bg:#0b1117;--card:#111a22;--text:#e8f0f7;--muted:#9fb0bf;
  --accent:#60a5fa;--btn:#3b82f6;--btn-h:#2563eb;--shadow:rgba(0,0,0,.35);
  --chip:#0f1720;--chip-b:#223041;--ok:#16a34a;--ok-h:#15803d;--bad:#ef4444;--bad-h:#dc2626;
}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,Segoe UI,Roboto,Ubuntu,Arial,sans-serif}
.container{max-width:1200px;margin:28px auto;padding:0 20px}

/* header + burger */
.header{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:18px}
.h-left{display:flex;align-items:center;gap:10px}
.h-title{font-size:20px;font-weight:700}
.burger{width:38px;height:38px;border-radius:10px;border:1px solid #1e2936;background:var(--chip);display:flex;align-items:center;justify-content:center;cursor:pointer}
.burger:hover{background:#0e1620}
.burger span{display:block;width:18px;height:2px;background:#9fb0bf;position:relative}
.burger span::before,.burger span::after{content:"";position:absolute;left:0;width:18px;height:2px;background:#9fb0bf}
.burger span::before{top:-6px}.burger span::after{top:6px}

.menu{position:relative}
.menu-panel{position:absolute;top:46px;right:0;background:var(--card);border:1px solid #1e2936;border-radius:12px;min-width:260px;box-shadow:0 10px 30px var(--shadow);padding:8px;display:none;z-index:40}
.menu-panel.open{display:block}
.menu-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;cursor:pointer;color:var(--text);text-decoration:none}
.menu-item:hover{background:#0e1620}
.menu-item svg{width:16px;height:16px}

/* cards */
.card{background:var(--card);border-radius:14px;box-shadow:0 10px 30px var(--shadow);border:1px solid #1e2936;padding:18px 20px;margin:18px 0}
.card h3{margin:0 0 12px;font-size:18px}

/* buttons */
.btn{border:none;border-radius:12px;padding:12px 16px;cursor:pointer;transition:.15s}
.btn-ok{background:var(--ok);color:#fff}.btn-ok:hover{background:var(--ok-h)}
.btn-bad{background:var(--bad);color:#fff}.btn-bad:hover{background:var(--bad-h)}
.btn-ghost{background:var(--chip);border:1px solid #1e2936;color:var(--text)}
.btn-ghost:hover{background:#0e1620}

.list{padding-left:18px;margin:8px 0 0}
.list a{color:var(--accent);text-decoration:none}
.footer{color:var(--muted);font-size:13px;margin-top:8px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}

/* table */
.table{width:100%;border-collapse:collapse}
.table th,.table td{padding:10px;border-bottom:1px solid #1e2936;text-align:left}
.table th{color:var(--muted);font-weight:600}
.faded{color:var(--muted)}

/* modals */
.modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:flex-start;justify-content:center;padding:60px 16px;z-index:60}
.modal.open{display:flex}
.modal .box{background:var(--card);max-width:900px;width:100%;border-radius:14px;border:1px solid #1e2936;box-shadow:0 10px 30px var(--shadow)}
.modal .head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid #172230}
.modal .body{padding:16px}
  `.trim());
});

app.get(bp('/assets/favicon.svg'), (_req,res) => {
  res.type('image/svg+xml').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#60a5fa"/><stop offset="1" stop-color="#2563eb"/></linearGradient></defs><rect rx="12" width="64" height="64" fill="#0b1117"/><path fill="url(#g)" d="M20 44h24a2 2 0 0 0 2-2V18a2 2 0 0 0-2-2H20a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2Zm2-6V20h20v18Z"/></svg>`
  );
});

// ---------- page ----------
app.get(bp('/')), async (_req,res)=>{ res.redirect(bp('/')); };
app.get(bp('/'), async (_req, res) => {
  const html = `
<!doctype html><html lang="ru"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<link rel="icon" href="${bp('/assets/favicon.svg')}" />
<link rel="stylesheet" href="${bp('/assets/app.css')}">
<title>File & Feed Service</title>
</head><body>
<div class="container">
  <div class="header">
    <div class="h-left">
      <div class="h-title">File & Feed Service</div>
      <div class="faded"></div>
    </div>
    <div class="menu" id="menu">
      <button class="burger" id="burger" aria-label="Меню"><span></span></button>
      <div class="menu-panel" id="menuPanel" role="menu">
        <a class="menu-item" id="miNext" role="menuitem">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 8v5l4 2-.7 1.9L10 14V8z"/></svg>
          Время до автозапуска
        </a>
        <a class="menu-item" id="miDocs" role="menuitem">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m8 1.5V8h4.5z"/></svg>
          Документация
        </a>
        <a class="menu-item" id="miSheets" role="menuitem">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 4a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM14 3.5V8h4.5"/></svg>
          Доступные таблицы
        </a>
        <a class="menu-item" id="miMIT" role="menuitem">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12,2A10,10 0 1,0 22,12A10,10 0 0,0 12,2Z"/></svg>
          MIT License
        </a>
      </div>
    </div>
  </div>

  <div class="card">
    <h3>Сборка YML</h3>
    <button class="btn btn-ok" id="btnBuild">Собрать YML сейчас</button>
  </div>

  <div class="card">
    <h3>Файлы</h3>
    <table class="table" id="filesTable">
      <thead><tr><th>Имя</th><th>Изменён</th><th>Товаров</th><th>Скачать</th></tr></thead>
      <tbody><tr><td colspan="4" class="faded">Загружается…</td></tr></tbody>
    </table>
    <div class="footer">Created by <b>sayqow</b> + <b>unlalka</b> • <a href="#" id="linkMIT">MIT</a></div>
  </div>
</div>

<!-- Модалы -->
<div class="modal" id="mdNext">
  <div class="box">
    <div class="head"><b>Информация</b><button class="btn btn-ghost" onclick="closeModal('mdNext')">Закрыть</button></div>
    <div class="body"><div id="nextText" class="faded">Загружаю…</div></div>
  </div>
</div>

<div class="modal" id="mdDocs">
  <div class="box">
    <div class="head"><b>Документация</b><a class="btn btn-ghost" href="${bp('/')}">На главную</a></div>
    <div class="body">
      <ul class="list">
        <li><code>POST ${bp('/api/feed/yml/build')}</code> — собрать фиды и сохранить в <code>${FILES_DIR}</code></li>
        <li><code>GET ${bp('/api/feed/yml/list')}</code> — список файлов</li>
        <li><code>GET ${bp('/api/spreadsheets')}</code> — доступные Google таблицы</li>
        <li><code>GET ${bp('/api/next-run')}</code> — время следующего запуска (если задано)</li>
        <li><code>GET ${bp('/healthz')}</code> — health‑check</li>
      </ul>
    </div>
  </div>
</div>

<div class="modal" id="mdSheets">
  <div class="box">
    <div class="head"><b>Доступные Google таблицы</b><button class="btn btn-ghost" onclick="closeModal('mdSheets')">Закрыть</button></div>
    <div class="body">
      <table class="table" id="tblSheets">
        <thead><tr><th>Имя</th><th>ID</th><th>Ссылка</th></tr></thead>
        <tbody><tr><td colspan="3" class="faded">Нет данных…</td></tr></tbody>
      </table>
    </div>
  </div>
</div>

<div class="modal" id="mdMIT">
  <div class="box">
    <div class="head"><b>MIT License</b><button class="btn btn-ghost" onclick="closeModal('mdMIT')">Закрыть</button></div>
    <div class="body"><pre id="mitText" style="white-space:pre-wrap" class="mono faded">Загружаю…</pre></div>
  </div>
</div>

<script>
const BP = ${JSON.stringify(BASE_PATH||'')};

function esc(s){return String(s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]))}
function openModal(id){document.getElementById(id).classList.add('open')}
function closeModal(id){document.getElementById(id).classList.remove('open')}

function fmtDt(iso){
  try{
    const dt = new Date(iso);
    return new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium', timeStyle:'short'}).format(dt);
  }catch{ return iso || ''; }
}

async function refreshFiles(){
  const tbody = document.querySelector('#filesTable tbody');
  tbody.innerHTML = '<tr><td colspan="4" class="faded">Загружаю…</td></tr>';
  try{
    const r = await fetch(BP + '/api/feed/yml/list');
    const d = await r.json();
    const rows = (d.files||[]).map(f =>
      '<tr>'+
        '<td>'+esc(f.name)+'</td>'+
        '<td>'+esc(fmtDt(f.mtimeIso))+'</td>'+
        '<td>'+(f.offers||0)+'</td>'+
        '<td><a class="btn btn-ghost" href="'+f.url+'" download>Скачать</a></td>'+
      '</tr>'
    ).join('');
    tbody.innerHTML = rows || '<tr><td colspan="4" class="faded">Пока пусто…</td></tr>';
  }catch(e){
    tbody.innerHTML = '<tr><td colspan="4" class="faded">Ошибка: '+esc(e.message)+'</td></tr>';
  }
}

// build button with 60s cooldown
let buildCooldown = 0, buildTimer = null;
function setBuildState(enabled, label){
  const btn = document.getElementById('btnBuild');
  btn.disabled = !enabled;
  btn.classList.toggle('btn-ok', enabled);
  btn.classList.toggle('btn-bad', !enabled);
  btn.textContent = label;
}
function startCooldown(sec){
  buildCooldown = sec;
  setBuildState(false, 'Повторно через '+buildCooldown+'с');
  buildTimer = setInterval(()=>{
    buildCooldown--;
    if(buildCooldown<=0){
      clearInterval(buildTimer);
      setBuildState(true, 'Собрать YML сейчас');
    }else{
      setBuildState(false, 'Повторно через '+buildCooldown+'с');
    }
  },1000);
}

document.getElementById('btnBuild').onclick = async ()=>{
  if(buildCooldown>0) return;
  setBuildState(false,'Собираю…');
  try{
    const r = await fetch(BP + '/api/feed/yml/build', { method:'POST' });
    const d = await r.json();
    if(!r.ok || d.ok===false) throw new Error(d.error || 'Ошибка');
    await refreshFiles();
    startCooldown(60);
  }catch(e){
    setBuildState(true,'Собрать YML сейчас');
    alert('Ошибка: '+e.message);
  }
};

// burger
const burger = document.getElementById('burger');
const panel  = document.getElementById('menuPanel');
burger.addEventListener('click', e=>{ e.stopPropagation(); panel.classList.toggle('open'); });
document.addEventListener('click', e=>{ if(!panel.contains(e.target) && e.target!==burger){ panel.classList.remove('open'); } });

// menu items
document.getElementById('miDocs').onclick = ()=>{ panel.classList.remove('open'); openModal('mdDocs'); };

document.getElementById('miNext').onclick = async ()=>{
  panel.classList.remove('open'); openModal('mdNext');
  const box = document.getElementById('nextText');
  try{
    const r = await fetch(BP + '/api/next-run'); const d = await r.json();
    if(d.nextTs){
      const dt = new Date(d.nextTs);
      const intl = new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow', dateStyle:'full', timeStyle:'short'});
      box.textContent = 'Следующий автосбор: ' + intl.format(dt) + ' (МСК)';
    }else{
      box.textContent = 'Автосбор не настроен.';
    }
  }catch(e){ box.textContent = 'Ошибка: '+e.message; }
};

document.getElementById('miSheets').onclick = async ()=>{
  panel.classList.remove('open'); openModal('mdSheets');
  const tbody = document.querySelector('#tblSheets tbody');
  tbody.innerHTML = '<tr><td colspan="3" class="faded">Загружаю…</td></tr>';
  try{
    const r = await fetch(BP + '/api/spreadsheets'); const d = await r.json();
    const rows = (d.items||[]).map(x =>
      '<tr><td>'+esc(x.name||x.id)+'</td><td class="mono">'+esc(x.id)+'</td>'+
      '<td><a target="_blank" rel="noopener" href="https://docs.google.com/spreadsheets/d/'+encodeURIComponent(x.id)+'/edit">Открыть</a></td></tr>'
    ).join('');
    tbody.innerHTML = rows || '<tr><td colspan="3" class="faded">Нет доступных таблиц.</td></tr>';
  }catch(e){ tbody.innerHTML = '<tr><td colspan="3" class="faded">Ошибка: '+esc(e.message)+'</td></tr>'; }
};

document.getElementById('miMIT').onclick = async ()=>{
  panel.classList.remove('open'); openModal('mdMIT');
  const pre = document.getElementById('mitText'); pre.textContent = 'Загружаю…';
  try{
    const r = await fetch(BP + '/api/license'); const t = await r.text();
    pre.classList.remove('faded'); pre.textContent = t;
  }catch(e){ pre.textContent = 'Не удалось получить лицензию: ' + e.message; }
};
document.getElementById('linkMIT').onclick = (e)=>{ e.preventDefault(); document.getElementById('miMIT').click(); };

refreshFiles();
</script>
</body></html>
  `.trim();
  res.type('html').send(html);
});

// ---------- listen ----------
app.listen(PORT, () => {
  console.log(`[filesvc] listening on :${PORT} base=${BASE_PATH||'/'} files=${FILES_DIR}`);
});
