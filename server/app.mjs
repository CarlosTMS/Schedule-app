/**
 * Production server for SAP BTP Cloud Foundry.
 *
 * Serves:
 * - Static frontend from /dist
 * - API endpoints:
 *   - GET/POST /api/public/summary
 *   - GET/POST /api/public/vats
 *   - GET      /api/public/smes (proxy to upstream)
 *   - GET      /health
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPersistence } from './persistence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const DATA_FILE = path.join(__dirname, 'data', 'summary.latest.json');
const VATS_DATA_FILE = path.join(__dirname, 'data', 'vats.latest.json');

const PORT = Number(process.env.PORT ?? 8080);
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN ?? '*';
const SME_SOURCE_URL =
  process.env.SME_SOURCE_URL ??
  'https://solweeks-academy-web.cfapps.us10.hana.ondemand.com/api/public/smes';
const persistence = createPersistence();

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
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const jsonResponse = (res, statusCode, body) => {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders });
  res.end(JSON.stringify(body, null, 2));
};

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const validateSummarySnapshot = (payload) => {
  if (!isObject(payload)) return 'Summary payload must be an object';
  if (!Array.isArray(payload.sessions)) return 'Summary payload must include a sessions array';

  for (const session of payload.sessions) {
    if (!isObject(session)) return 'Each summary session must be an object';
    if (typeof session.solution_area !== 'string' || typeof session.schedule !== 'string' || typeof session.session_topic !== 'string') {
      return 'Each summary session must include solution_area, schedule, and session_topic';
    }
    if (!Array.isArray(session.attendees)) return 'Each summary session must include an attendees array';
    const hasModernWarnings = Array.isArray(session.warning_codes);
    const hasLegacyWarnings = Array.isArray(session.warnings);
    if (!hasModernWarnings && !hasLegacyWarnings) {
      return 'Each summary session must include warning_codes or legacy warnings';
    }
  }

  return null;
};

const validateVatsSnapshot = (payload) => {
  if (!isObject(payload)) return 'VAT payload must be an object';
  if (!Array.isArray(payload.vats)) return 'VAT payload must include a vats array';

  for (const vat of payload.vats) {
    if (!isObject(vat)) return 'Each VAT entry must be an object';
    if (typeof vat.vat !== 'string' || typeof vat.members_count !== 'number') {
      return 'Each VAT entry must include vat and members_count';
    }
    if (!Array.isArray(vat.members)) return 'Each VAT entry must include a members array';
  }

  return null;
};

const versionedPublicationKey = (type, projectId, versionId) => `${type}.project.${projectId}.version.${versionId}`;

const normalizeTypeFromPath = (segment) => {
  if (segment === 'summary') return 'summary';
  if (segment === 'vats') return 'vats';
  return null;
};

const syncLatestPublicationIfNeeded = async ({ type, projectId, versionId, payload }) => {
  const source = await persistence.getPublicApiSource?.();
  if (!source || source.projectId !== projectId || source.versionId !== versionId) {
    return null;
  }

  const latestKey = `${type}.latest`;
  return persistence.savePublication(latestKey, payload, {
    type,
    sourceProjectId: projectId,
    sourceVersionId: versionId,
  });
};

const saveVersionedPublication = async ({ type, projectId, versionId, payload }) => {
  const key = versionedPublicationKey(type, projectId, versionId);
  const saved = await persistence.savePublication(key, payload, {
    type,
    sourceProjectId: projectId,
    sourceVersionId: versionId,
  });
  const latest = await syncLatestPublicationIfNeeded({ type, projectId, versionId, payload });
  return { saved, latestSynced: Boolean(latest) };
};

const isClientAbortError = (err) =>
  Boolean(err) && (
    err.code === 'ECONNRESET' ||
    err.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    err.name === 'AbortError' ||
    String(err.message || '').toLowerCase().includes('aborted')
  );

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
      req.off('close', onClose);
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onData = (c) => chunks.push(c);
    const onEnd = () => finish(resolve, Buffer.concat(chunks).toString('utf8'));
    const onError = (err) => finish(reject, err);
    const onAborted = () => finish(reject, Object.assign(new Error('Request aborted by client'), { code: 'ECONNRESET' }));
    const onClose = () => {
      if (!req.complete) {
        finish(reject, Object.assign(new Error('Request connection closed before complete body was received'), { code: 'ECONNRESET' }));
      }
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
    req.on('close', onClose);
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
  try {
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
          const data = await persistence.getPublication('summary.latest');
          if (!data) {
            return jsonResponse(res, 404, { error: 'No summary snapshot published yet.' });
          }
          return jsonResponse(res, 200, data);
        } catch (err) {
          return jsonResponse(res, 500, { error: String(err) });
        }
      }

      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body);
          const validationError = validateSummarySnapshot(parsed);
          if (validationError) return jsonResponse(res, 400, { error: validationError });
          const result = await persistence.savePublication('summary.latest', parsed);
          return jsonResponse(res, 200, { ok: true, saved_at: result.savedAt });
        } catch (err) {
          return jsonResponse(res, 400, { error: `Invalid JSON body: ${err}` });
        }
      }

      return jsonResponse(res, 405, { error: `Method not allowed: ${req.method}` });
    }

    if (pathname === '/api/public/vats') {
      if (req.method === 'GET') {
        try {
          const data = await persistence.getPublication('vats.latest');
          if (!data) {
            return jsonResponse(res, 404, { error: 'No VAT snapshot published yet.' });
          }
          return jsonResponse(res, 200, data);
        } catch (err) {
          return jsonResponse(res, 500, { error: String(err) });
        }
      }

      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body);
          const validationError = validateVatsSnapshot(parsed);
          if (validationError) return jsonResponse(res, 400, { error: validationError });
          const result = await persistence.savePublication('vats.latest', parsed);
          return jsonResponse(res, 200, { ok: true, saved_at: result.savedAt });
        } catch (err) {
          return jsonResponse(res, 400, { error: `Invalid JSON body: ${err}` });
        }
      }

      return jsonResponse(res, 405, { error: `Method not allowed: ${req.method}` });
    }

    if (pathname === '/api/public/status' && req.method === 'GET') {
      try {
        const [publicSource, summaryRecord, vatsRecord] = await Promise.all([
          persistence.getPublicApiSource?.() ?? null,
          persistence.getPublicationRecord?.('summary.latest') ?? null,
          persistence.getPublicationRecord?.('vats.latest') ?? null,
        ]);

        return jsonResponse(res, 200, {
          ok: true,
          data: {
            publicSource,
            latest: {
              summary: summaryRecord
                ? {
                    publishedAt: summaryRecord.publishedAt,
                    sourceProjectId: summaryRecord.sourceProjectId,
                    sourceVersionId: summaryRecord.sourceVersionId,
                    url: '/api/public/summary',
                  }
                : null,
              vats: vatsRecord
                ? {
                    publishedAt: vatsRecord.publishedAt,
                    sourceProjectId: vatsRecord.sourceProjectId,
                    sourceVersionId: vatsRecord.sourceVersionId,
                    url: '/api/public/vats',
                  }
                : null,
            },
          },
        });
      } catch (err) {
        return jsonResponse(res, 500, { error: String(err) });
      }
    }

    const publicVersionMatch = pathname.match(/^\/api\/public\/projects\/([^/]+)\/versions\/([^/]+)\/(summary|vats)$/);
    if (publicVersionMatch) {
      const [, projectId, versionId, typeSegment] = publicVersionMatch;
      const type = normalizeTypeFromPath(typeSegment);
      if (!type) {
        return jsonResponse(res, 404, { error: `Unsupported publication type: ${typeSegment}` });
      }

      if (req.method === 'GET') {
        try {
          const data = await persistence.getPublication(versionedPublicationKey(type, projectId, versionId));
          if (!data) {
            return jsonResponse(res, 404, { error: `No ${type} snapshot published for this project version yet.` });
          }
          return jsonResponse(res, 200, data);
        } catch (err) {
          return jsonResponse(res, 500, { error: String(err) });
        }
      }

      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          const parsed = JSON.parse(body);
          const validationError = type === 'summary'
            ? validateSummarySnapshot(parsed)
            : validateVatsSnapshot(parsed);
          if (validationError) {
            return jsonResponse(res, 400, { error: validationError });
          }

          const result = await saveVersionedPublication({ type, projectId, versionId, payload: parsed });
          return jsonResponse(res, 200, {
            ok: true,
            saved_at: result.saved.savedAt,
            latest_synced: result.latestSynced,
          });
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
      return jsonResponse(res, 200, { status: 'ok', port: PORT, persistence: persistence.getStatus() });
    }

    // ── Runtime Versioning API ──

    if (pathname === '/api/runtime/projects') {
      if (req.method === 'GET') {
        return jsonResponse(res, 200, { ok: true, data: await persistence.getProjects() });
      }
      if (req.method === 'POST') {
        try {
          const body = await readBody(req);
          const project = JSON.parse(body);

          if (!persistence.isValidProject(project)) return jsonResponse(res, 400, { ok: false, error: 'Invalid project' });

          const saved = await persistence.upsertProject(project);
          return jsonResponse(res, 200, { ok: true, data: saved });
        } catch (e) {
          return jsonResponse(res, 400, { ok: false, error: String(e) });
        }
      }
    }

    if (pathname === '/api/runtime/public-api-source') {
      if (req.method === 'GET') {
        try {
          const data = await persistence.getPublicApiSource?.();
          return jsonResponse(res, 200, { ok: true, data: data ?? null });
        } catch (err) {
          return jsonResponse(res, 500, { ok: false, error: String(err) });
        }
      }

      if (req.method === 'PATCH') {
        try {
          const body = await readBody(req);
          const { projectId, versionId } = JSON.parse(body);
          if (!projectId || !versionId) {
            return jsonResponse(res, 400, { ok: false, error: 'projectId and versionId are required' });
          }

          const version = await persistence.getVersion(versionId);
          if (!version || version.projectId !== projectId) {
            return jsonResponse(res, 400, { ok: false, error: 'Version does not belong to the specified project' });
          }

          const data = await persistence.setPublicApiSource(projectId, versionId);
          return jsonResponse(res, 200, { ok: true, data });
        } catch (err) {
          return jsonResponse(res, 400, { ok: false, error: String(err) });
        }
      }
    }

    if (pathname.startsWith('/api/runtime/projects/')) {
      const parts = pathname.split('/');
      const id = parts[4];
      const subRoute = parts[5];

      if (id && !subRoute) {
        if (req.method === 'PATCH') {
          try {
            const body = await readBody(req);
            const { expectedRevision, ...metadata } = JSON.parse(body);

            const conflict = await persistence.getConflict(id, expectedRevision);
            if (conflict) {
              console.warn(`[runtime] Conflict detected on project ${id}: Expected ${expectedRevision}, Actual ${conflict.revision}`);
              return jsonResponse(res, 409, { ok: false, error: 'conflict', current: conflict });
            }

            const existing = await persistence.getProject(id);
            if (!existing) return jsonResponse(res, 404, { ok: false, error: 'Project not found' });

            // Strictly prune metadata to avoid bloating persistence
            const cleanMetadata = { ...metadata };
            delete cleanMetadata.expectedRevision;

            const updated = await persistence.upsertProject({
              ...existing,
              ...cleanMetadata
            });

            console.log(`[runtime] Patched project: ${id} (Rev: ${updated.revision})`);
            return jsonResponse(res, 200, { ok: true, data: updated });
          } catch (e) {
            if (isClientAbortError(e)) {
              console.warn(`[runtime] Client aborted PATCH for project ${id}`);
              return;
            }
            return jsonResponse(res, 400, { ok: false, error: String(e) });
          }
        }

        if (req.method === 'DELETE') {
          const ok = await persistence.deleteProject(id);
          return jsonResponse(res, ok ? 200 : 404, { ok });
        }
      }

      if (id && subRoute === 'versions') {
        if (req.method === 'GET') {
          return jsonResponse(res, 200, { ok: true, data: await persistence.getVersions(id) });
        }
        if (req.method === 'POST') {
          try {
            const body = await readBody(req);
            const v = JSON.parse(body);
            if (!persistence.isValidVersion(v)) return jsonResponse(res, 400, { ok: false, error: 'Invalid version' });
            const saved = await persistence.addVersion(v);
            return jsonResponse(res, 200, { ok: true, data: saved });
          } catch (e) {
            if (isClientAbortError(e)) {
              console.warn(`[runtime] Client aborted version POST for project ${id}`);
              return;
            }
            return jsonResponse(res, 400, { ok: false, error: String(e) });
          }
        }
      }
    }

    if (pathname.startsWith('/api/runtime/versions/')) {
      const id = pathname.split('/')[4];
      if (id && req.method === 'GET') {
        const v = await persistence.getVersion(id);
        return v ? jsonResponse(res, 200, { ok: true, data: v }) : jsonResponse(res, 404, { ok: false });
      }
      if (id && req.method === 'PATCH') {
        try {
          const body = await readBody(req);
          const { snapshot } = JSON.parse(body);
          if (!snapshot) return jsonResponse(res, 400, { ok: false, error: 'Missing snapshot' });
          const updated = await persistence.updateVersion(id, snapshot);
          if (!updated) return jsonResponse(res, 404, { ok: false, error: 'Version not found' });
          return jsonResponse(res, 200, { ok: true, data: updated });
        } catch (e) {
          if (isClientAbortError(e)) {
            console.warn(`[runtime] Client aborted version PATCH for ${id}`);
            return;
          }
          return jsonResponse(res, 400, { ok: false, error: String(e) });
        }
      }
      if (id && req.method === 'DELETE') {
        const deleted = await persistence.deleteVersion(id);
        if (!deleted.ok) return jsonResponse(res, 404, { ok: false, error: deleted.error });
        return jsonResponse(res, 200, { ok: true, data: deleted });
      }
    }

    if (pathname === '/api/runtime/sync/batch' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const { projects = [], versions = [] } = JSON.parse(body);
        const result = await persistence.syncBatch(projects, versions);
        console.log(`[runtime] Batch sync: ${result.addedProjects} projects, ${result.addedVersions} versions added.`);
        return jsonResponse(res, 200, { ok: true, data: result });
      } catch (e) {
        if (isClientAbortError(e)) {
          console.warn('[runtime] Client aborted batch sync');
          return;
        }
        return jsonResponse(res, 400, { ok: false, error: String(e) });
      }
    }

    if (pathname.startsWith('/api/')) {
      return jsonResponse(res, 404, { error: `Not found: ${req.method} ${pathname}` });
    }

    serveStatic(req, res, pathname);
  } catch (err) {
    if (isClientAbortError(err)) {
      console.warn(`[app] Ignoring aborted request: ${req.method ?? 'UNKNOWN'} ${req.url ?? ''}`);
      return;
    }

    console.error('[app] Unhandled request error:', err);
    if (!res.writableEnded && !res.destroyed) {
      jsonResponse(res, 500, { error: 'Internal server error' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`[app] Listening on http://localhost:${PORT}`);
  console.log(`[app] Static root: ${DIST_DIR}`);
});
