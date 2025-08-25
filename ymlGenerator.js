const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { scrapeProduct, normalizePrice } = require('./scraper');
const { create } = require('xmlbuilder2');          // xmlbuilder2 v3+
const { google } = require('googleapis');

// p-limit ESM/CJS совместимость
const pLimitMod = require('p-limit');
const pLimit = pLimitMod && pLimitMod.default ? pLimitMod.default : pLimitMod;

const FILES_DIR = process.env.FILES_DIR || '/srv/files';
const SHEET_SETTINGS = process.env.SHEET_SETTINGS || 'Настройки';
const SHEET_CATEGORIES = process.env.SHEET_CATEGORIES || 'Категории';
const SHEET_PRODUCTS = process.env.SHEET_PRODUCTS || 'Товары';
const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 5);
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS || 12000);

function escapeXml(s){ return (s||'').toString(); }
function nowDate(){
  const d=new Date(); const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

async function authGoogle(){
  const auth = new google.auth.GoogleAuth({
    scopes: [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ]
  });
  return await auth.getClient();
}

// список доступных таблиц (id + name)
async function listAccessibleSpreadsheets(auth){
  const drive = google.drive({ version:'v3', auth });
  const out = [];
  let pageToken = undefined;
  do{
    const resp = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields: 'files(id,name), nextPageToken',
      pageSize: 1000,
      pageToken
    });
    for (const f of (resp.data.files||[])){
      out.push({ id:f.id, name:f.name });
    }
    pageToken = resp.data.nextPageToken;
  } while(pageToken);
  return out;
}

// имя таблицы по id
async function getSpreadsheetName(auth, spreadsheetId){
  const drive = google.drive({ version:'v3', auth });
  const resp = await drive.files.get({ fileId: spreadsheetId, fields: 'name' });
  return resp.data?.name || `spreadsheet_${spreadsheetId}`;
}

// утилиты таблицы
function rowsToObjects(values){
  if (!values || values.length===0) return [];
  const headers = values[0].map(h => String(h||'').trim().toLowerCase());
  const out=[];
  for (let i=1;i<values.length;i++){
    const row = values[i];
    const obj = {};
    headers.forEach((h,idx)=>{ obj[h] = row[idx]; });
    out.push(obj);
  }
  return out;
}

async function readSpreadsheet(auth, spreadsheetId){
  const sheets = google.sheets({ version:'v4', auth });
  const resp = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: [`${SHEET_SETTINGS}!A:B`, `${SHEET_CATEGORIES}!A:B`, `${SHEET_PRODUCTS}`]
  });
  const [settingsRaw, categoriesRaw, productsRaw] = resp.data.valueRanges || [];

  // settings
  const settings = {};
  if (settingsRaw?.values){
    for (let i=1;i<settingsRaw.values.length;i++){
      const k = String(settingsRaw.values[i][0]||'').trim().toLowerCase();
      const v = settingsRaw.values[i][1];
      if (k) settings[k]=v;
    }
  }
  if (!settings.name) throw new Error('Нет поля "name" в листе "Настройки"');
  if (!settings.company) throw new Error('Нет поля "company" в листе "Настройки"');
  if (!settings.url) throw new Error('Нет поля "url" в листе "Настройки"');
  settings.currencyId = settings.currencyId || 'RUB';

  // categories
  const categoryByName = {};
  const categoryList = [];
  if (categoriesRaw?.values){
    const cats = rowsToObjects(categoriesRaw.values);
    for (const c of cats){
      if (c.id && c.name){
        categoryByName[String(c.name).trim()] = String(c.id);
        categoryList.push({ id: String(c.id), name: String(c.name).trim() });
      }
    }
  }

  // products
  const products = rowsToObjects(productsRaw?.values || []);
  return { settings, categoryByName, categoryList, products };
}

// ---- выбор 1 главной картинки ----
function pickMainImage(scrapedPictures = [], sheetPicture = '') {
  const pics = [];
  const pushUnique = (u)=>{
    if (!u) return;
    const url = String(u).trim();
    if (!url) return;
    if (!pics.includes(url)) pics.push(url);
  };
  (scrapedPictures || []).forEach(pushUnique);
  pushUnique(sheetPicture);
  if (!pics.length) return '';

  const banRe = /(logo\.svg|favicon|apple\-touch|size\-chart|sprites?\.|\/logo|\/icons?\/|\/svg\/|\/placeholder)/i;
  const tinyRe = /(^|[\/\-_])w_0*9[0-9]([\/\-_]|$)|(^|[\/\-_])h_0*9[0-9]([\/\-_]|$)/i;
  const mainDesignRe = /\/design\/.*\/1(?:a)?\.(?:jpe?g|png)(?:[\/\?].*)?$/i;

  function score(url){
    let s = 0;
    if (banRe.test(url)) return -1e6;
    if (tinyRe.test(url)) s -= 300;

    if (mainDesignRe.test(url)) s += 2000;
    if (/\/design\//i.test(url)) s += 400;
    if (/\/1\.(?:jpe?g|png)/i.test(url) || /\/1a\.(?:jpe?g|png)/i.test(url)) s += 350;

    const m = url.match(/(?:^|[\/\-_])w_(\d+)(?:[\/\-_]|$)/i);
    if (m) s += Math.min(1500, parseInt(m[1],10) || 0);

    if (/cdn\./i.test(url)) s += 80;
    if (/\.(?:jpe?g|png)(?:[?#].*)?$/.test(url)) s += 30;

    return s;
  }

  let best = pics[0], bestScore = score(best);
  for (let i=1;i<pics.length;i++){
    const sc = score(pics[i]);
    if (sc > bestScore){ bestScore = sc; best = pics[i]; }
  }
  return bestScore <= -1e5 ? (sheetPicture || scrapedPictures[0] || '') : best;
}

async function buildYmlForSheet(auth, spreadsheetId, spreadsheetName, reqBase){
  const { settings, categoryByName, categoryList, products } = await readSpreadsheet(auth, spreadsheetId);

  const limit = pLimit(SCRAPE_CONCURRENCY > 0 ? SCRAPE_CONCURRENCY : 1);
  const offers = await Promise.all(products.map((row, idx)=> limit(async ()=>{
    const rowObj = { ...row };
    const url = rowObj.url ? String(rowObj.url).trim() : '';
    const scraped = await scrapeProduct(url, SCRAPE_TIMEOUT_MS);

    // имя/описание
    const name = scraped.name || rowObj.name || '';
    const description = scraped.description || rowObj.description || '';

    // цена: не ноль — приоритетно со страницы, иначе из таблицы
    const priceScr = normalizePrice(scraped.price);
    const price = (priceScr && priceScr !== '0') ? priceScr : normalizePrice(rowObj.price);

    // 1 картинка
    const picture = pickMainImage(scraped.pictures, rowObj.picture);

    // категория
    let categoryId = '0';
    if (rowObj.category) categoryId = categoryByName[String(rowObj.category).trim()] || '0';
    else if (rowObj.categoryid) categoryId = String(rowObj.categoryid);

    return {
      id: idx+1, url, name, description,
      categoryId, price, currencyId: settings.currencyId || 'RUB', picture
    };
  })));


  // Сборка XML в нужном порядке узлов:
  const doc = create({ version: '1.0', encoding: 'UTF-8' });
  const root = doc.ele('yml_catalog', { date: nowDate() });
  const shop = root.ele('shop');

  shop.ele('name').txt(escapeXml(settings.name)).up();
  shop.ele('company').txt(escapeXml(settings.company)).up();
  shop.ele('url').txt(escapeXml(settings.url)).up();

  const currencies = shop.ele('currencies');
  currencies.ele('currency', { id: settings.currencyId || 'RUB', rate: '1' }).up();
  currencies.up();

  const categories = shop.ele('categories');
  for (const c of categoryList){
    categories.ele('category', { id: c.id }).txt(c.name).up();
  }
  categories.up();

  const offersNode = shop.ele('offers');
  for (const o of offers){
    const of = offersNode.ele('offer', { id: String(o.id), available: 'true' });

    // порядок: name → url → price → currencyId → categoryId → picture → description
    of.ele('name').txt(o.name || '').up();
    of.ele('url').txt(o.url || '').up();
    if (o.price && Number(o.price) > 0) of.ele('price').txt(o.price).up();
    of.ele('currencyId').txt(o.currencyId || 'RUB').up();
    of.ele('categoryId').txt(o.categoryId || '0').up();
    if (o.picture) of.ele('picture').txt(o.picture).up();
    of.ele('description').txt(o.description || '').up();

    of.up();
  }
  offersNode.up();
  shop.up();
  root.up();

  const xmlText = doc.end({ prettyPrint: true });

  // имя файла = имя таблицы
  const safeName = String(spreadsheetName || settings.name || `spreadsheet_${spreadsheetId}`)
    .replace(/[\/\\:*?"<>|]+/g,'_')
    .trim() || `spreadsheet_${spreadsheetId}`;
  const fileName = `${safeName}.xml`;
  await fsp.mkdir(FILES_DIR, { recursive:true });
  const outPath = path.join(FILES_DIR, fileName);
  await fsp.writeFile(outPath, xmlText, 'utf8');

  const url = reqBase ? `${reqBase}${encodeURIComponent(fileName)}` : outPath;
  return { spreadsheetId, file: fileName, url };
}

async function resolveSpreadsheetsWithNames(){
  const envIds = (process.env.SPREADSHEET_IDS || '')
    .split(',').map(s=>s.trim()).filter(Boolean);

  const auth = await authGoogle();
  if (envIds.length){
    const out = [];
    for (const id of envIds){
      const name = await getSpreadsheetName(auth, id).catch(()=>`spreadsheet_${id}`);
      out.push({ id, name });
    }
    return { auth, items: out };
  }
  const items = await listAccessibleSpreadsheets(auth); // уже {id,name}
  return { auth, items };
}

async function generateMany({ reqBase } = {}){
  const { auth, items } = await resolveSpreadsheetsWithNames();
  if (!items.length) throw new Error('Нет доступных таблиц (SPREADSHEET_IDS пуст и Drive API ничего не вернул)');
  const out = [];
  for (const { id, name } of items){
    const item = await buildYmlForSheet(auth, id, name, reqBase);
    out.push(item);
  }
  return out;
}

// ВАЖНО: экспортируем и генератор, и функции для /api/spreadsheets
module.exports = {
  generateMany,
  authGoogle,
  listAccessibleSpreadsheets,
  getSpreadsheetName
};