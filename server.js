
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const express = require('express');
const morgan = require('morgan');
const compression = require('compression');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { marked } = require('marked');
const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

dotenv.config();
const app = express();
app.disable('x-powered-by');

const PORT = Number(process.env.PORT || 3001);
const BASE_PATH = (process.env.BASE_PATH || '/').replace(/\/+$/, '') + '/';
const FILES_DIR = process.env.FILES_DIR || '/srv/files';

const { generateMany } = require('./ymlGenerator');

app.use(morgan('combined'));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '1mb' }));

app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(BASE_PATH, express.static(FILES_DIR, {
  dotfiles: 'ignore',
  fallthrough: true,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=120');
  }
}));

function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '-';
  const u = ['B','KB','MB','GB','TB'];
  let i=0,v=bytes; while (v>=1024 && i<u.length-1) { v/=1024; i++; }
  return `${v.toFixed(v<10&&i>0?1:0)} ${u[i]}`;
}
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleString('ru-RU', { hour12: false });
}
async function listFiles() {
  await fsp.mkdir(FILES_DIR, { recursive: true });
  const names = await fsp.readdir(FILES_DIR);
  const list = [];
  for (const name of names) {
    const p = path.join(FILES_DIR, name);
    const st = await fsp.stat(p);
    if (st.isFile()) list.push({ name, size: st.size, mtime: st.mtimeMs });
  }
  list.sort((a,b)=>b.mtime-a.mtime);
  return list;
}

// Markdown render only for API.md
async function renderMarkdown(mdText, title) {
  marked.setOptions({ gfm: true });
  const raw = marked.parse(mdText);
  const window = new JSDOM('').window;
  const DOMPurify = createDOMPurify(window);
  const safe = DOMPurify.sanitize(raw);
  return `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown.min.css">
<style>
:root{color-scheme:light dark;}
body{margin:0;min-height:100vh;color:#eaeaea;background:
linear-gradient(rgba(5,6,10,.68), rgba(5,6,10,.78)),url('/assets/wow-bg.png') center/cover no-repeat fixed;
font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif}
.container{max-width:920px;margin:32px auto;padding:0 16px}
.markdown-body{background:rgba(13,14,17,.76);backdrop-filter:saturate(120%) blur(3px);
padding:24px;border-radius:12px;border:1px solid #24262a;color:#eaeaea}
.markdown-body code,.markdown-body pre{background:rgba(255,255,255,0.06)}
a{color:#8ab4ff}
.foot{margin-top:12px;color:#9aa3af;font-size:12px;text-align:right}
</style></head>
<body><div class="container">
<article class="markdown-body">${safe}</article>
<div class="foot">Created by <b>sayqow</b> + <b>unlalka</b> ©</div>
</div></body></html>`;
}

app.get(['/view', '/view/API.md'], async (req,res)=>{
  try {
    const p = path.join(FILES_DIR, 'API.md');
    if (!fs.existsSync(p)) return res.status(404).type('text').send('API.md not found');
    const md = await fsp.readFile(p, 'utf8');
    const html = await renderMarkdown(md, 'API.md · Docs');
    res.status(200).type('html').send(html);
  } catch(e){ console.error(e); res.status(500).type('text').send('Render error'); }
});
app.get('/view/:name', (req,res)=>{
  if (req.params.name !== 'API.md') return res.status(404).type('text').send('Not found');
  res.redirect(301, '/view/API.md');
});

app.get('/', async (req,res,next)=>{
  try {
    const files = await listFiles();
    const rows = files.map(f=>`
      <tr data-name="${f.name.toLowerCase()}">
        <td class="name"><div class="row">📄 <a href="${BASE_PATH}${encodeURIComponent(f.name)}">${f.name}</a></div></td>
        <td class="muted">${fmtBytes(f.size)}</td>
        <td class="muted">${fmtDate(f.mtime)}</td>
        <td class="actions"><a class="btn" href="${BASE_PATH}download/${encodeURIComponent(f.name)}" download>↓</a></td>
      </tr>`).join('');
    const html = `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>~/ file /</title>
<style>
:root{color-scheme:light dark;}*{box-sizing:border-box}
body{margin:0;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Arial,sans-serif;
color:#eaeaea;min-height:100vh;background:
linear-gradient(rgba(5,6,10,.68), rgba(5,6,10,.78)),url('/assets/wow-bg.png') center/cover no-repeat fixed}
.wrap{max-width:1100px;margin:32px auto;padding:0 16px}h1{margin:0 0 16px}
.head{display:flex;gap:12px;flex-wrap:wrap;justify-content:space-between;align-items:center}
.badge{padding:4px 10px;border:1px solid #2a2a2d;border-radius:999px;background:#121216;color:#bfc3c9}
.search{min-width:260px;flex:1 1 260px;display:flex;gap:8px}
.search input{flex:1;border:1px solid #2a2a2d;background:#101114;color:#eaeaea;border-radius:8px;padding:10px 12px;outline:none}
.search input:focus{border-color:#3c7cff;box-shadow:0 0 0 2px #3c7cff22}
table{width:100%;border-collapse:separate;border-spacing:0;margin-top:14px;background:rgba(13,14,17,.72);
backdrop-filter:saturate(120%) blur(3px);border:1px solid #24262a;border-radius:12px;overflow:hidden}
thead th{background:rgba(17,19,24,.8);color:#9aa3af;font-weight:600;text-align:left;padding:12px 14px;border-bottom:1px solid #24262a}
tbody td{padding:12px 14px;border-bottom:1px solid #191b20}tbody tr:last-child td{border-bottom:none}
a{color:#8ab4ff;text-decoration:none}a:hover{text-decoration:underline}
.row{display:flex;align-items:center;gap:10px}.name a{word-break:break-all}
.btn{padding:6px 10px;border:1px solid #2a2a2d;border-radius:8px;background:rgba(17,19,24,.75);color:#eaeaea;text-decoration:none;cursor:pointer}
.btn:hover{background:#1a1e25}.muted{color:#9aa3af}.actions{white-space:nowrap}
.btn.primary{border-color:#3c7cff;background:#1a2336}
.btn.primary:disabled{opacity:.6;cursor:progress}
.empty{padding:24px;color:#c9ced6;background:rgba(17,19,24,.6);border:1px dashed #2a2a2d;border-radius:10px}
.note{margin-top:10px;padding:10px 12px;border:1px solid #2a2a2d;border-radius:8px;background:rgba(17,19,24,.72);color:#c9ced6}
.foot{margin-top:14px;color:#9aa3af;font-size:12px;display:flex;gap:10px;justify-content:space-between;align-items:center}
</style></head>
<body><div class="wrap">
  <div class="head">
    <h1>~/ file /</h1>
    <div class="search"><input id="q" placeholder="Поиск по имени…" autocomplete="off" /><span class="badge">${files.length} files</span></div>
    <button id="genBtn" class="btn primary" title="Сгенерировать YML по всем доступным таблицам">Сгенерировать YML</button>
  </div>
  <div id="note" class="note" style="display:none"></div>
  ${files.length ? `<table id="tbl"><thead><tr><th style="width:60%">Name</th><th style="width:15%">Size</th><th style="width:20%">Modified</th><th style="width:5%"></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<div class="empty">Папка пуста: ${FILES_DIR}</div>`}
  <div class="foot"><span>File server · BASE_PATH="${BASE_PATH}" · DIR="${FILES_DIR}"</span><span>Created by <b>sayqow</b> + <b>unlalka</b> ©</span></div>
</div>
<script>
const q=document.getElementById('q'); const rows=[...document.querySelectorAll('#tbl tbody tr')];
q&&q.addEventListener('input',()=>{const s=(q.value||'').trim().toLowerCase();rows.forEach(tr=>{const n=tr.dataset.name||'';tr.style.display=n.includes(s)?'':'none';});});
const note=document.getElementById('note'); const genBtn=document.getElementById('genBtn');
async function buildFeeds(){
  note.style.display='block'; note.textContent='Генерация…';
  genBtn.disabled=true;
  try{
    const r=await fetch('/api/feed/yml/build',{method:'POST'});
    const data=await r.json().catch(()=>({}));
    if(!r.ok||!data.ok) throw new Error((data&&data.error)||('HTTP '+r.status));
    const links=(data.feeds||[]).map(f=>`<li><a href="${f.url}" target="_blank" rel="noopener">${f.file}</a></li>`).join('');
    note.innerHTML='Готово!<ul>'+links+'</ul>';
    setTimeout(()=>location.reload(), 1500);
  }catch(e){ note.textContent='Ошибка: '+e.message; }
  finally{ genBtn.disabled=false; }
}
genBtn&&genBtn.addEventListener('click', buildFeeds);
</script>
</body></html>`;
    res.status(200).type('html').send(html);
  } catch(e){ next(e); }
});

// uploads (raw + multipart)
app.post('/upload/:name', express.raw({ type: '*/*', limit: '200mb' }), async (req,res)=>{
  try{
    const target = path.join(FILES_DIR, req.params.name);
    await fsp.writeFile(target, req.body);
    res.json({ ok:true, file:req.params.name, size:req.body?.length||0 });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

const storage = multer.diskStorage({
  destination: async (req,file,cb)=>{ try{ await fsp.mkdir(FILES_DIR,{recursive:true}); cb(null, FILES_DIR); }catch(e){ cb(e); } },
  filename: (req,file,cb)=> cb(null, file.originalname)
});
const upload = multer({ storage, limits: { fileSize: 200*1024*1024 } });
app.post('/upload-multi', upload.array('files', 50), async (req,res)=>{
  try {
    const uploaded = (req.files||[]).map(f=>({ name:f.originalname, size:f.size }));
    res.json({ ok:true, files: uploaded });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});

// downloads
app.get('/download/:name', async (req,res)=>{
  const file = path.join(FILES_DIR, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).json({ ok:false, error:'Not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(req.params.name)}"`);
  res.sendFile(file);
});

app.get('/healthz', (req,res)=>res.type('text').send('OK'));

// YML API
app.post('/api/feed/yml/build', async (req,res)=>{
  try{
    const base = `${req.protocol}://${req.get('host')}${BASE_PATH}`;
    const feeds = await generateMany({ reqBase: base });
    res.json({ ok:true, feeds });
  }catch(e){ res.status(500).json({ ok:false, error:e.message }); }
});
app.get('/api/feed/yml/download/:name', (req,res)=>{
  const file = path.join(FILES_DIR, req.params.name);
  if (!fs.existsSync(file)) return res.status(404).json({ ok:false, error:'Not found' });
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(req.params.name)}"`);
  res.sendFile(file);
});

app.use((req,res)=>res.status(404).json({ ok:false, error:'Not found' }));
app.use((err,req,res,next)=>{ console.error(err); res.status(500).json({ ok:false, error:'Internal error' }); });

app.listen(PORT, '0.0.0.0', async ()=>{
  await fsp.mkdir(FILES_DIR, { recursive:true });
  console.log(`[OK] File server on 0.0.0.0:${PORT} | BASE_PATH="${BASE_PATH}" | DIR="${FILES_DIR}"`);
});
