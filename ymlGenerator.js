
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { scrapeProduct, normalizePrice } = require('./scraper');
const { xml } = require('xmlbuilder2');
const { google } = require('googleapis');
const pLimit = require('p-limit');

const FILES_DIR = process.env.FILES_DIR || '/srv/files';
const SHEET_SETTINGS = process.env.SHEET_SETTINGS || 'Настройки';
const SHEET_CATEGORIES = process.env.SHEET_CATEGORIES || 'Категории';
const SHEET_PRODUCTS = process.env.SHEET_PRODUCTS || 'Товары';
const SCRAPE_CONCURRENCY = Number(process.env.SCRAPE_CONCURRENCY || 5);
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS || 12000);

function escapeXml(s){ return (s||'').toString(); }
function nowDate(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

async function authGoogle(){
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return await auth.getClient();
}

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

async function buildYmlForSheet(spreadsheetId, reqBase){
  const auth = await authGoogle();
  const { settings, categoryByName, categoryList, products } = await readSpreadsheet(auth, spreadsheetId);

  const limit = pLimit(SCRAPE_CONCURRENCY > 0 ? SCRAPE_CONCURRENCY : 1);
  const offers = await Promise.all(products.map((row, idx)=> limit(async ()=>{
    const rowObj = {};
    for (const k in row) rowObj[k] = row[k];
    const url = rowObj.url ? String(rowObj.url).trim() : '';
    const scraped = await scrapeProduct(url, SCRAPE_TIMEOUT_MS);

    // prefer scraped for name/description, fallback to sheet
    const name = scraped.name || rowObj.name || '';
    const description = scraped.description || rowObj.description || '';

    // price: prefer scraped non-zero, fallback to sheet non-zero
    const price = (normalizePrice(scraped.price) && normalizePrice(scraped.price) !== '0')
      ? normalizePrice(scraped.price)
      : normalizePrice(rowObj.price);

    // picture: only one (scraped og:image or from sheet 'picture')
    let picture = scraped.pictures && scraped.pictures[0] ? scraped.pictures[0] : (rowObj.picture || '');
    if (Array.isArray(picture)) picture = picture[0] || '';

    // categoryId
    let categoryId = '0';
    if (rowObj.category) categoryId = categoryByName[String(rowObj.category).trim()] || '0';
    else if (rowObj.categoryid) categoryId = String(rowObj.categoryid);

    return { id: idx+1, url, name, description, categoryId, price, currencyId: settings.currencyId || 'RUB', picture };
  })));

  // build XML
  const doc = {
    yml_catalog: {
      '@date': nowDate(),
      shop: {
        name: escapeXml(settings.name),
        company: escapeXml(settings.company),
        url: escapeXml(settings.url),
        currencies: { currency: { '@id': settings.currencyId || 'RUB', '@rate': '1' } },
        categories: { category: categoryList.map(c => ({ '@id': c.id, '#': c.name })) },
        offers: { offer: offers.map(o => {
          const offerNode = {
            '@id': String(o.id),
            '@available': 'true',
            url: escapeXml(o.url || ''),
            name: escapeXml(o.name || ''),
            description: escapeXml(o.description || ''),
            categoryId: escapeXml(o.categoryId || '0'),
            currencyId: escapeXml(o.currencyId || 'RUB')
          };
          if (o.price && Number(o.price) > 0) offerNode.price = o.price;
          if (o.picture) offerNode.picture = o.picture;
          return offerNode;
        })}
      }
    }
  };

  const xmlText = xml(doc, { encoding:'UTF-8', prettyPrint:true });
  await fsp.mkdir(FILES_DIR, { recursive:true });

  // filename: settings.name or Spreadsheet ID
  const safeName = (settings.name || `feed_${spreadsheetId}`).replace(/[^\w\-]+/g,'_');
  const fileName = `Feed_${safeName}.xml`;
  const outPath = path.join(FILES_DIR, fileName);
  await fsp.writeFile(outPath, xmlText, 'utf8');

  const url = reqBase ? `${reqBase}${encodeURIComponent(fileName)}` : outPath;
  return { spreadsheetId, file: fileName, url };
}

async function resolveSpreadsheets(){
  const envIds = (process.env.SPREADSHEET_IDS || '').split(',').map(s=>s.trim()).filter(Boolean);
  if (envIds.length) return envIds;
  const auth = await authGoogle();
  const items = await listAccessibleSpreadsheets(auth);
  return items.map(i=>i.id);
}

async function generateMany({ reqBase } = {}){
  const ids = await resolveSpreadsheets();
  if (!ids.length) throw new Error('Нет доступных таблиц (SPREADSHEET_IDS пуст и Drive API ничего не вернул)');
  const out = [];
  for (const id of ids){
    const item = await buildYmlForSheet(id, reqBase);
    out.push(item);
  }
  return out;
}

module.exports = { generateMany };
