// assets/app.js
async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function humanNext(cronExpr, tz) {
  // очень простой текст вместо парсинга cron: показываем МСК 07:00 понедельник
  // если нужен точный расчёт — подключи later.js/cron-parser.
  return 'каждый понедельник в 07:00 (МСК)';
}

async function refreshFiles() {
  const ul = document.getElementById('filesList');
  ul.innerHTML = '<li class="muted">Загрузка…</li>';
  try {
    const data = await fetchJSON('/api/feed/yml/list');
    if (!data.files || !data.files.length) {
      ul.innerHTML = '<li class="muted">Пока пусто…</li>';
      return;
    }
    ul.innerHTML = '';
    data.files.sort((a,b)=>b.mtime-a.mtime).forEach(f => {
      const li = document.createElement('li');
      const a  = document.createElement('a');
      a.href = f.url; a.textContent = f.name; a.target = '_blank';
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = ` ${(f.size/1024).toFixed(1)} KB`;
      li.appendChild(a); li.appendChild(meta);
      ul.appendChild(li);
    });
  } catch (e) {
    ul.innerHTML = `<li class="muted">Ошибка: ${e.message}</li>`;
  }
}

async function buildNow() {
  const btn = document.getElementById('buildBtn');
  btn.disabled = true; btn.textContent = 'Собираю…';
  try {
    const data = await fetchJSON('/api/feed/yml/build', { method:'POST' });
    if (data.ok) {
      alert(`Готово: ${data.feeds.map(f => f.file).join(', ')}`);
      refreshFiles();
    } else {
      alert('Ошибка: ' + (data.error || 'unknown'));
    }
  } catch (e) {
    alert('Ошибка: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Собрать YML сейчас';
  }
}

function setNextRun() {
  const div = document.getElementById('nextRun');
  const { cron, tz } = window.APP_CFG || {};
  div.textContent = 'Автосбор: ' + humanNext(cron, tz);
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('buildBtn').addEventListener('click', buildNow);
  setNextRun();
  refreshFiles();
});
