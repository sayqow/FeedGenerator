
const axios = require('axios');
const cheerio = require('cheerio');

function normalizePrice(val){
  if (!val) return '';
  const s = String(val).replace(/\s+/g,'').replace(/,/g,'.');
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

async function scrapeProduct(url, timeoutMs=12000){
  const out = { price:'', name:'', description:'', pictures:[] };
  if (!url) return out;
  try{
    const res = await axios.get(url, {
      timeout: timeoutMs,
      headers:{
        'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept-Language':'ru-RU,ru;q=0.9,en;q=0.8'
      },
      maxRedirects: 5,
      validateStatus: s => s>=200 && s<400
    });
    const html = res.data;
    const $ = cheerio.load(html);

    // name
    out.name = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || '';
    // description
    out.description = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';

    // price sources
    let price =
      $('meta[itemprop="price"]').attr('content') ||
      $('meta[property="product:price:amount"]').attr('content') ||
      $('meta[property="og:price:amount"]').attr('content') ||
      $('[itemprop="price"]').attr('content') ||
      $('[itemprop="price"]').text();

    // JSON-LD
    $('script[type="application/ld+json"]').each((i,el)=>{
      try{
        const txt = $(el).contents().text();
        const json = JSON.parse(txt);
        const arr = Array.isArray(json)?json:[json];
        for (const node of arr){
          const offer = node.offers || node.offers?.[0];
          if (offer?.price && !price) price = offer.price;
          if (node?.name && !out.name) out.name = node.name;
          if (node?.description && !out.description) out.description = node.description;
        }
      }catch{}
    });

    out.price = normalizePrice(price);

    // picture (first only)
    const firstImg =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      $('img[src]').attr('src');

    if (firstImg) out.pictures = [firstImg];

  }catch(e){
    console.error('[scrape error]', url, e.message);
  }
  return out;
}

module.exports = { scrapeProduct, normalizePrice };
