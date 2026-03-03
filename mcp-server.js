const express = require('express');
const https = require('https');
const http = require('http');
const app = express();
const PORT = process.env.PORT || 3000;
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(express.json());
const SOURCES = {
  'cnn.com':'CNN','bbc.com':'BBC','reuters.com':'Reuters',
  'indiatoday.in':'India Today','theguardian.com':'The Guardian',
  'apnews.com':'AP News','aljazeera.com':'Al Jazeera',
  'thehindu.com':'The Hindu','ndtv.com':'NDTV',
  'timesofindia.indiatimes.com':'Times of India','npr.org':'NPR',
  'nytimes.com':'NY Times','washingtonpost.com':'Washington Post',
  'bloomberg.com':'Bloomberg','economist.com':'The Economist',
  'forbes.com':'Forbes','ft.com':'Financial Times',
  'abcnews.go.com':'ABC News','cbsnews.com':'CBS News'
};
const DOMAINS = Object.keys(SOURCES);
function isAuth(url) { return url && DOMAINS.some(d => url.includes(d)); }
function srcName(url) { const d = DOMAINS.find(d => url && url.includes(d)); return d ? SOURCES[d] : 'Unknown'; }
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: {'User-Agent':'NewsMate/2.0'} }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch(e) { reject(new Error('JSON parse failed')); }
      });
    });
    req.setTimeout(9000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.on('error', e => reject(new Error(e.message)));
  });
}
async function fromNewsAPI(q, max) {
  const key = process.env.NEWS_API_KEY;
  if (!key) return [];
  try {
    const {status, data} = await httpGet(`https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&apiKey=${key}&pageSize=${max}&language=en&sortBy=relevancy`);
    if (status !== 200 || !data.articles) return [];
    return data.articles.filter(a => isAuth(a.url)).map(a => ({
      title: a.title||'', description: a.description||'', url: a.url,
      source: a.source?.name || srcName(a.url), provider: 'newsapi'
    }));
  } catch(e) { console.error('[NewsAPI]', e.message); return []; }
}
async function fromGNews(q, max) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) return [];
  try {
    const {status, data} = await httpGet(`https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&token=${key}&lang=en&max=${max}`);
    if (status !== 200 || !data.articles) return [];
    return data.articles.filter(a => isAuth(a.url)).map(a => ({
      title: a.title||'', description: a.description||'', url: a.url,
      source: a.source?.name || srcName(a.url), provider: 'gnews'
    }));
  } catch(e) { console.error('[GNews]', e.message); return []; }
}
async function searchAll(q, max) {
  const [a, b] = await Promise.all([fromNewsAPI(q, max), fromGNews(q, max)]);
  const seen = new Set(), out = [];
  for (const x of [...a,...b]) { if (!x.url||seen.has(x.url)) continue; seen.add(x.url); out.push(x); }
  return out;
}
app.use((req,_,next) => { console.log(`${new Date().toISOString()} ${req.method} ${req.path}`); next(); });
app.get('/', (_,res) => res.json({ name:'NewsMate MCP v2', status:'running',
  newsapi: !!process.env.NEWS_API_KEY, gnews: !!process.env.GNEWS_API_KEY }));
app.get('/health', (_,res) => res.json({ status:'ok', cors:'enabled',
  newsapi: !!process.env.NEWS_API_KEY, gnews: !!process.env.GNEWS_API_KEY,
  time: new Date().toISOString() }));
app.post('/mcp/search', async (req, res) => {
  const {query, queries, maxResults=8} = req.body||{};
  if (!query && !(Array.isArray(queries)&&queries.length))
    return res.status(400).json({success:false, error:'Provide query or queries'});
  const terms = (Array.isArray(queries)&&queries.length) ? queries.slice(0,3) : [query];
  try {
    const all = [];
    for (const q of terms) all.push(...await searchAll(q, maxResults));
    const seen = new Set(), final = [];
    for (const a of all) { if (!a.url||seen.has(a.url)) continue; seen.add(a.url); final.push(a); }
    console.log('[search] ' + terms.length + ' queries -> ' + final.length + ' results');
    res.json({success:true, queries:terms, count:final.length, results:final.slice(0,maxResults)});
  } catch(e) { res.status(500).json({success:false, error:e.message}); }
});
app.get('/mcp/search', async (req, res) => {
  const results = await searchAll(req.query.q||'news', 5);
  res.json({success:true, count:results.length, results});
});
app.use((req,res) => res.status(404).json({error:'Not found'}));
app.listen(PORT, () => {
  console.log('\n✅ NewsMate MCP v2.0 on port ' + PORT);
  console.log('   NewsAPI: ' + (process.env.NEWS_API_KEY?'✅':'❌ set NEWS_API_KEY'));
  console.log('   GNews:   ' + (process.env.GNEWS_API_KEY?'✅':'❌ set GNEWS_API_KEY') + '\n');
});
