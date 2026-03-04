const express = require('express');
const https = require('https');
const http = require('http');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced CORS configuration for Railway deployment
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  credentials: false
}));

// Additional CORS headers for extra compatibility
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Get API keys from environment variables (Railway) or hardcoded (local)
const NEWS_API_KEY = process.env.NEWS_API_KEY || '9550ad0e2cba4aa9b654bf68694cea23';
const GNEWS_API_KEY = process.env.GNEWS_API_KEY || 'bff953d35e1603c9e54aa91dc79dba70';

console.log('🔑 API Keys Status:');
console.log('  NewsAPI:', NEWS_API_KEY ? '✓ Configured' : '✗ Missing');
console.log('  GNews:', GNEWS_API_KEY ? '✓ Configured' : '✗ Missing');

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

function isAuth(url) {
  return url && DOMAINS.some(d => url.includes(d));
}

function srcName(url) {
  const d = DOMAINS.find(d => url && url.includes(d));
  return d ? SOURCES[d] : 'Unknown';
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { 
      headers: {'User-Agent':'NewsMate/2.0'},
      timeout: 10000
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch(e) {
          reject(new Error('JSON parse failed: ' + e.message));
        }
      });
    });
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.on('error', e => reject(new Error(e.message)));
  });
}

// Fetch from NewsAPI
async function fromNewsAPI(q, max) {
  if (!NEWS_API_KEY || NEWS_API_KEY.includes('YOUR')) return [];
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&apiKey=${NEWS_API_KEY}&pageSize=${max}&language=en&sortBy=relevancy`;
    const { status, data } = await httpGet(url);
    if (status !== 200 || !data.articles) {
      console.log('NewsAPI error:', data.message || 'Unknown error');
      return [];
    }
    return data.articles
      .filter(a => isAuth(a.url))
      .map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source?.name || srcName(a.url),
        provider: 'newsapi'
      }));
  } catch(e) {
    console.error('NewsAPI error:', e.message);
    return [];
  }
}

// Fetch from GNews
async function fromGNews(q, max) {
  if (!GNEWS_API_KEY || GNEWS_API_KEY.includes('YOUR')) return [];
  try {
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(q)}&token=${GNEWS_API_KEY}&lang=en&max=${max}`;
    const { status, data } = await httpGet(url);
    if (status !== 200 || !data.articles) {
      console.log('GNews error:', data.message || 'Unknown error');
      return [];
    }
    return data.articles
      .filter(a => isAuth(a.url))
      .map(a => ({
        title: a.title,
        description: a.description || '',
        url: a.url,
        source: a.source?.name || srcName(a.url),
        provider: 'gnews'
      }));
  } catch(e) {
    console.error('GNews error:', e.message);
    return [];
  }
}

// Combined search
async function searchAll(q, max) {
  const [a, b] = await Promise.all([
    fromNewsAPI(q, max),
    fromGNews(q, max)
  ]);
  const seen = new Set();
  const out = [];
  for (const x of [...(a||[]), ...(b||[])]) {
    if (!x.url || seen.has(x.url)) continue;
    seen.add(x.url);
    out.push(x);
  }
  return out;
}

// Logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    cors: 'enabled',
    newsapi: !!NEWS_API_KEY && !NEWS_API_KEY.includes('YOUR'),
    gnews: !!GNEWS_API_KEY && !GNEWS_API_KEY.includes('YOUR'),
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (_, res) => {
  res.json({
    status: 'running',
    service: 'NewsMate MCP Server',
    version: '2.0',
    port: PORT,
    endpoints: {
      health: '/health',
      search: '/mcpsearch (POST)',
      searchAlt: '/mcp/search (POST)'
    }
  });
});

// Main search endpoint (both routes for compatibility)
const searchHandler = async (req, res) => {
  const { query, queries, maxResults = 8 } = req.body;

  console.log('📥 Search request:', { query, queries: queries?.length, maxResults });

  if (!query && (!Array.isArray(queries) || queries.length === 0)) {
    return res.status(400).json({
      success: false,
      error: 'Provide "query" (string) or "queries" (array)'
    });
  }

  const terms = Array.isArray(queries) && queries.length ? queries.slice(0, 3) : [query];

  try {
    const all = [];
    for (const q of terms) {
      console.log(`🔍 Searching for: "${q}"`);
      const results = await searchAll(q, maxResults);
      all.push(...results);
      console.log(`  ✓ Found ${results.length} articles`);
    }

    // Deduplicate by URL
    const seen = new Set();
    const final = [];
    for (const a of all) {
      if (!a.url || seen.has(a.url)) continue;
      seen.add(a.url);
      final.push(a);
    }

    console.log(`📊 Total unique articles: ${final.length}`);

    res.json({
      success: true,
      count: final.length,
      results: final.slice(0, maxResults)
    });
  } catch(e) {
    console.error('Search error:', e.message);
    res.status(500).json({
      success: false,
      error: e.message
    });
  }
};

// Register both endpoint paths
app.post('/mcpsearch', searchHandler);
app.post('/mcp/search', searchHandler);

// Optional GET endpoint for testing
app.get('/mcpsearch', async (req, res) => {
  const query = req.query.q || 'news';
  const results = await searchAll(query, 5);
  res.json({
    success: true,
    count: results.length,
    results
  });
});

app.get('/mcp/search', async (req, res) => {
  const query = req.query.q || 'news';
  const results = await searchAll(query, 5);
  res.json({
    success: true,
    count: results.length,
    results
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method,
    availableEndpoints: ['/', '/health', '/mcpsearch', '/mcp/search']
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 NewsMate MCP Server running at http://0.0.0.0:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  console.log(`   Search: POST http://localhost:${PORT}/mcp/search`);
  console.log(`\n💡 API Status:`);
  console.log(`   NewsAPI: ${NEWS_API_KEY && !NEWS_API_KEY.includes('YOUR') ? '✓' : '✗ Add your key'}`);
  console.log(`   GNews: ${GNEWS_API_KEY && !GNEWS_API_KEY.includes('YOUR') ? '✓' : '✗ Add your key'}`);
  console.log();
});

// Error handler
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
