/**
 * Production server for SAP BTP Cloud Foundry.
 *
 * Serves:
 * - Static frontend from /dist
 * - API endpoints:
 *   - GET/POST /api/public/summary
 *   - GET      /api/public/smes (proxy to upstream)
 *   - GET      /health
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { store as runtimeStore } from './runtime-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_FILE = path.join(__dirname, 'data', 'summary.latest.json');

const PORT = Number(process.env.PORT ?? 8080);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const SME_SOURCE_URL =
  process.env.SME_SOURCE_URL ??
  'https://solweeks-academy-web.cfapps.us10.hana.ondemand.com/api/public/smes';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonResponse = (res, statusCode, body) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
  res.end(JSON.stringify(body, null, 2));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const ensureDataDir = () => {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
};

const serveFile = (res, absPath) => {
  try {
    const ext = path.extname(absPath).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    const data = fs.readFileSync(absPath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
};

const serveStatic = (req, res, pathname) => {
  if (!fs.existsSync(DIST_DIR)) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('dist/ not found. Run "npm run build" first.');
    return;
  }

  // Normalize and prevent path traversal
  const cleanPath = pathname === '/' ? '/index.html' : pathname;
  const absPath = path.resolve(DIST_DIR, `.${cleanPath}`);
  if (!absPath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  if (fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    serveFile(res, absPath);
    return;
  }

  // SPA fallback
  serveFile(res, path.join(DIST_DIR, 'index.html'));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS' && pathname.startsWith('/api/')) {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (pathname === '/api/public/summary') {
    if (req.method === 'GET') {
      try {
        ensureDataDir();
        if (!fs.existsSync(DATA_FILE)) {
          return jsonResponse(res, 404, { error: 'No summary snapshot published yet.' });
        }
        const raw = fs.readFileSync(DATA_FILE, 'utf8');
        const data = JSON.parse(raw);
        return jsonResponse(res, 200, data);
      } catch (err) {
        return jsonResponse(res, 500, { error: String(err) });
      }
    }

    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        ensureDataDir();
        fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf8');
        return jsonResponse(res, 200, { ok: true, saved_at: new Date().toISOString() });
      } catch (err) {
        return jsonResponse(res, 400, { error: `Invalid JSON body: ${err}` });
      }
    }

    return jsonResponse(res, 405, { error: `Method not allowed: ${req.method}` });
  }

  if (pathname === '/api/public/smes' && req.method === 'GET') {
    try {
      const upstream = await fetch(SME_SOURCE_URL, { headers: { Accept: 'application/json' } });
      if (!upstream.ok) {
        return jsonResponse(res, upstream.status, { error: `SME upstream failed: HTTP ${upstream.status}` });
      }
      const data = await upstream.json();
      return jsonResponse(res, 200, data);
    } catch (err) {
      return jsonResponse(res, 502, { error: `SME proxy failed: ${String(err)}` });
    }
  }

  if (pathname === '/health' && req.method === 'GET') {
    return jsonResponse(res, 200, { status: 'ok', port: PORT });
  }

  // ── Runtime History API ──

  if (pathname === '/api/runtime/runs') {
    if (req.method === 'GET') {
      return jsonResponse(res, 200, { ok: true, data: runtimeStore.getRuns() });
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (!runtimeStore.isValidRun(parsed)) {
          return jsonResponse(res, 400, { ok: false, error: 'Invalid run structure' });
        }
        const saved = runtimeStore.upsertRun(parsed);
        console.log(`[runtime] Created/Updated run: ${saved.id} - ${saved.name}`);
        return jsonResponse(res, 200, { ok: true, data: saved });
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: String(err) });
      }
    }
  }

  if (pathname === '/api/runtime/active' && req.method === 'GET') {
    return jsonResponse(res, 200, { ok: true, data: runtimeStore.getActiveRunId() });
  }

  // Dynamic routes with ID
  if (pathname.startsWith('/api/runtime/runs/')) {
    const parts = pathname.split('/');
    const id = parts[4]; // /api/runtime/runs/:id/...
    const subRoute = parts[5];

    if (!id) return jsonResponse(res, 400, { ok: false, error: 'Missing run ID' });

    if (req.method === 'DELETE' && !subRoute) {
      const deleted = runtimeStore.deleteRun(id);
      console.log(`[runtime] Deleted run: ${id}`);
      return jsonResponse(res, deleted ? 200 : 404, { ok: deleted });
    }

    if (req.method === 'POST' && subRoute === 'activate') {
      runtimeStore.setActiveRunId(id);
      console.log(`[runtime] Activated run: ${id}`);
      return jsonResponse(res, 200, { ok: true });
    }

    if (req.method === 'PATCH') {
      try {
        const body = await readBody(req);
        const patch = JSON.parse(body);
        let updated = null;

        if (subRoute === 'core') {
          updated = runtimeStore.patchCore(id, patch);
        } else if (subRoute === 'dashboard') {
          updated = runtimeStore.patchDashboard(id, patch);
        } else if (subRoute === 'meta') {
          updated = runtimeStore.patchMeta(id, patch);
        }

        if (updated) {
          console.log(`[runtime] Patched ${subRoute || 'unknown'} for run: ${id}`);
          return jsonResponse(res, 200, { ok: true, data: updated });
        }
        return jsonResponse(res, 404, { ok: false, error: 'Run not found' });
      } catch (err) {
        return jsonResponse(res, 400, { ok: false, error: String(err) });
      }
    }
  }

  if (pathname.startsWith('/api/')) {
    return jsonResponse(res, 404, { error: `Not found: ${req.method} ${pathname}` });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`[app] Listening on http://localhost:${PORT}`);
  console.log(`[app] Static root: ${DIST_DIR}`);
});

