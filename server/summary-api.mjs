/**
 * summary-api.mjs
 *
 * Minimal Node.js HTTP server (no dependencies) that exposes:
 *   GET  /api/public/summary  → returns the last published summary JSON
 *   POST /api/public/summary  → saves a new snapshot sent from the frontend
 *   GET  /api/public/smes     → proxy to live SME API (avoids browser CORS issues)
 *
 * Run with:  node server/summary-api.mjs
 * Default port: 8787  (override with PORT env var)
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, 'data', 'summary.latest.json');
const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const SME_SOURCE_URL =
    process.env.SME_SOURCE_URL ??
    'https://solweeks-academy-web.cfapps.us10.hana.ondemand.com/api/public/smes';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonResponse = (res, statusCode, body) => {
    res.writeHead(statusCode, { 'Content-Type': 'application/json', ...corsHeaders });
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

// ─── Request handler ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    // CORS pre-flight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders);
        res.end();
        return;
    }

    if (url.pathname === '/api/public/summary') {
        // ── GET ──────────────────────────────────────────────────────────────
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

        // ── POST ─────────────────────────────────────────────────────────────
        if (req.method === 'POST') {
            try {
                const body = await readBody(req);
                const parsed = JSON.parse(body);          // validate JSON
                ensureDataDir();
                fs.writeFileSync(DATA_FILE, JSON.stringify(parsed, null, 2), 'utf8');
                console.log(`[summary-api] Snapshot saved — ${parsed.sessions?.length ?? 0} sessions @ ${parsed.generated_at}`);
                return jsonResponse(res, 200, { ok: true, saved_at: new Date().toISOString() });
            } catch (err) {
                return jsonResponse(res, 400, { error: `Invalid JSON body: ${err}` });
            }
        }
    }

    // ── SME proxy (server-to-server fetch) ───────────────────────────────────
    if (url.pathname === '/api/public/smes' && req.method === 'GET') {
        try {
            const upstream = await fetch(SME_SOURCE_URL, { headers: { Accept: 'application/json' } });
            if (!upstream.ok) {
                return jsonResponse(res, upstream.status, {
                    error: `SME upstream failed: HTTP ${upstream.status}`,
                });
            }
            const data = await upstream.json();
            return jsonResponse(res, 200, data);
        } catch (err) {
            return jsonResponse(res, 502, { error: `SME proxy failed: ${String(err)}` });
        }
    }

    // ── Health check ──────────────────────────────────────────────────────────
    if (url.pathname === '/health' && req.method === 'GET') {
        return jsonResponse(res, 200, { status: 'ok', port: PORT });
    }

    // ── 404 ───────────────────────────────────────────────────────────────────
    jsonResponse(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
});

server.listen(PORT, () => {
    console.log(`[summary-api] Listening on http://localhost:${PORT}`);
    console.log(`[summary-api] Endpoints:`);
    console.log(`  GET  http://localhost:${PORT}/api/public/summary`);
    console.log(`  POST http://localhost:${PORT}/api/public/summary`);
    console.log(`  GET  http://localhost:${PORT}/api/public/smes`);
    console.log(`  GET  http://localhost:${PORT}/health`);
});
