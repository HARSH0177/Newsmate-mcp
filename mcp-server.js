/**
 * ╔════════════════════════════════════════════════════════╗
 * ║   NewsMate MCP Web Search Server  v1.0                ║
 * ║   Provides web search to the NewsMate AI agent        ║
 * ╚════════════════════════════════════════════════════════╝
 *
 * Setup:
 *   npm install express cors helmet dotenv axios
 *   node mcp-server.js
 *
 * Required .env:
 *   NEWS_API_KEY=your_key      # https://newsapi.org (free: 100 req/day)
 *   GNEWS_API_KEY=your_key     # https://gnews.io   (free: 100 req/day)
 *   NEWSDATA_API_KEY=your_key  # https://newsdata.io (free: 200 req/day)
 *   PORT=3000
 *   ALLOWED_ORIGINS=http://localhost:8080,http://127.0.0.1:5500
 */

import express from 'express';
import cors    from 'cors';
import helmet  from 'helmet';
import dotenv  from 'dotenv';
import axios   from 'axios';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '10kb' }));

// ─── Authorized news sources ─────────────────────────────
const AUTHORIZED_SOURCES = [
  { name: 'CNN',             domain: 'cnn.com' },
  { name: 'BBC',             domain: 'bbc.com' },
  { name: 'Reuters',         domain: 'reuters.com' },
  { name: 'India Today',     domain: 'indiatoday.in' },
  { name: 'The Guardian',    domain: 'theguardian.com' },
  { name: 'AP News',         domain: 'apnews.com' },
  { name: 'Al Jazeera',      domain: 'aljazeera.com' },
  { name: 'The Hindu',       domain: 'thehindu.com' },
  { name: 'NDTV',            domain: 'ndtv.com' },
  { name: 'Times of India',  domain: 'timesofindia.indiatimes.com' },
  { name: 'NPR',             domain: 'npr.org' },
  { name: 'NY Times',        domain: 'nytimes.com' },
  { name: 'Washington Post', domain: 'washingtonpost.com' },
  { name: 'Bloomberg',       domain: 'bloomberg.com' },
  { name: 'The Economist',   domain: 'economist.com' },
  { name: 'Forbes',          domain: 'forbes.com' },
  { name: 'Financial Times', domain: 'ft.com' },
  { name: 'ABC News',        domain: 'abcnews.go.com' },
  { name: 'CBS News',        domain: 'cbsnews.com' }
];

function isAuthorized(url) {
  if (!url) return false;
  return AUTHORIZED_SOURCES.some(s => url.includes(s.domain));
}

function getSourceName(url) {
  const match = AUTHORIZED_SOURCES.find(s => url.includes(s.domain));
  return match?.name || 'Unknown';
}

// ─── Request logger ──────────────────────────────────────
app.use((req, _res, next) => {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────
// SEARCH PROVIDERS
// ─────────────────────────────────────────────────────────

/** NewsAPI.org */
async function fromNewsAPI(query, max) {
  if (!process.env.NEWS_API_KEY) return [];
  try {
    const { data } = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: query,
        apiKey: process.env.NEWS_API_KEY,
        pageSize: Math.min(max, 20),
        language: 'en',
        sortBy: 'relevancy'
      },
      timeout: 8000
    });

    return (data.articles || [])
      .filter(a => isAuthorized(a.url))
      .map(a => ({
        title:       a.title,
        description: a.description,
        content:     a.content,
        url:         a.url,
        source:      a.source?.name || getSourceName(a.url),
        publishedAt: a.publishedAt,
        author:      a.author,
        provider:    'newsapi'
      }));
  } catch (err) {
    console.error('[NewsAPI]', err.message);
    return [];
  }
}

/** GNews.io */
async function fromGNews(query, max) {
  if (!process.env.GNEWS_API_KEY) return [];
  try {
    const { data } = await axios.get('https://gnews.io/api/v4/search', {
      params: {
        q: query,
        token: process.env.GNEWS_API_KEY,
        lang: 'en',
        max: Math.min(max, 10)
      },
      timeout: 8000
    });

    return (data.articles || [])
      .filter(a => isAuthorized(a.url))
      .map(a => ({
        title:       a.title,
        description: a.description,
        content:     a.content,
        url:         a.url,
        source:      a.source?.name || getSourceName(a.url),
        publishedAt: a.publishedAt,
        provider:    'gnews'
      }));
  } catch (err) {
    console.error('[GNews]', err.message);
    return [];
  }
}

/** NewsData.io */
async function fromNewsData(query, max) {
  if (!process.env.NEWSDATA_API_KEY) return [];
  try {
    const { data } = await axios.get('https://newsdata.io/api/1/news', {
      params: {
        q: query,
        apikey: process.env.NEWSDATA_API_KEY,
        language: 'en',
        size: Math.min(max, 10)
      },
      timeout: 8000
    });

    return (data.results || [])
      .filter(a => isAuthorized(a.link))
      .map(a => ({
        title:       a.title,
        description: a.description,
        content:     a.content,
        url:         a.link,
        source:      a.source_id || getSourceName(a.link),
        publishedAt: a.pubDate,
        provider:    'newsdata'
      }));
  } catch (err) {
    console.error('[NewsData]', err.message);
    return [];
  }
}

/** Merge + deduplicate results across providers */
async function searchAllProviders(query, maxResults) {
  // Run all providers in parallel
  const [newsapi, gnews, newsdata] = await Promise.all([
    fromNewsAPI(query, maxResults),
    fromGNews(query, maxResults),
    fromNewsData(query, maxResults)
  ]);

  const combined = [...newsapi, ...gnews, ...newsdata];
  const seen = new Set();
  const unique = [];

  for (const article of combined) {
    if (!article.url || seen.has(article.url)) continue;
    seen.add(article.url);
    unique.push(article);
  }

  return unique.slice(0, maxResults);
}

// ─────────────────────────────────────────────────────────
// MCP ENDPOINTS
// ─────────────────────────────────────────────────────────

/**
 * POST /mcp/search
 * Body: { query: string, maxResults?: number, queries?: string[] }
 * 
 * If `queries` array is provided, searches all of them and merges results.
 * This is used by the NewsMate Orchestrator Agent which generates 3 queries.
 */
app.post('/mcp/search', async (req, res) => {
  const { query, queries, maxResults = 10 } = req.body;

  if (!query && (!queries || queries.length === 0)) {
    return res.status(400).json({ success: false, error: 'query or queries field required' });
  }

  const searchTerms = queries?.length > 0 ? queries : [query];

  try {
    let allResults = [];
    for (const q of searchTerms.slice(0, 3)) {
      const results = await searchAllProviders(q, maxResults);
      allResults.push(...results);
    }

    // Deduplicate across multi-query
    const seen = new Set();
    const finalResults = [];
    for (const a of allResults) {
      if (!a.url || seen.has(a.url)) continue;
      seen.add(a.url); finalResults.push(a);
    }

    res.json({
      success:      true,
      query:        searchTerms[0],
      queries:      searchTerms,
      resultsCount: finalResults.length,
      results:      finalResults.slice(0, maxResults),
      timestamp:    new Date().toISOString()
    });

  } catch (err) {
    console.error('[/mcp/search]', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/** GET /health — health check */
app.get('/health', (_req, res) => {
  res.json({
    status:    'healthy',
    version:   '1.0.0',
    timestamp: new Date().toISOString(),
    providers: {
      newsapi:  !!process.env.NEWS_API_KEY,
      gnews:    !!process.env.GNEWS_API_KEY,
      newsdata: !!process.env.NEWSDATA_API_KEY
    },
    authorizedSources: AUTHORIZED_SOURCES.length
  });
});

/** GET /mcp/info — MCP capability manifest */
app.get('/mcp/info', (_req, res) => {
  res.json({
    name:     'NewsMate MCP Web Search Server',
    version:  '1.0.0',
    protocol: 'MCP',
    tools: [
      {
        name:        'search',
        description: 'Search authorized news sources for articles relevant to a query or claim',
        endpoint:    'POST /mcp/search',
        parameters: {
          query:      'string (required if queries not set) — single search term',
          queries:    'string[] (optional) — multiple queries, results merged',
          maxResults: 'number (optional, default 10) — max articles to return'
        },
        returns: 'Array of { title, description, content, url, source, publishedAt, provider }'
      }
    ],
    authorizedSources: AUTHORIZED_SOURCES
  });
});

/** 404 handler */
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found. See GET /mcp/info' });
});

// ─── Start ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  NewsMate MCP Server  v1.0            ║');
  console.log(`╚══════════════════════════════════════╝`);
  console.log(`\n  🌐 Running at http://localhost:${PORT}`);
  console.log(`  📡 Health:   http://localhost:${PORT}/health`);
  console.log(`  🔍 Search:   POST http://localhost:${PORT}/mcp/search`);
  console.log(`  📋 Info:     http://localhost:${PORT}/mcp/info`);
  console.log('\n  Active providers:');
  console.log(`    NewsAPI:   ${process.env.NEWS_API_KEY  ? '✓' : '✗ (set NEWS_API_KEY)'}`);
  console.log(`    GNews:     ${process.env.GNEWS_API_KEY ? '✓' : '✗ (set GNEWS_API_KEY)'}`);
  console.log(`    NewsData:  ${process.env.NEWSDATA_API_KEY ? '✓' : '✗ (set NEWSDATA_API_KEY)'}`);
  console.log('\n');
});

export default app;
