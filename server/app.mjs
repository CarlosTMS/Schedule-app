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
import * as XLSX from 'xlsx';
import { createPersistence } from './persistence.mjs';
import { getSharedAirtableRows } from './airtable-share.mjs';

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

const validateAirtableCheckSnapshot = (payload) => {
  if (!isObject(payload)) return 'Airtable Check payload must be an object';
  if (!isObject(payload.summary)) return 'Airtable Check payload must include a summary object';
  if (!isObject(payload.tables)) return 'Airtable Check payload must include tables';
  if (!Array.isArray(payload.tables.time_only) || !Array.isArray(payload.tables.people_only) || !Array.isArray(payload.tables.both)) {
    return 'Airtable Check payload must include time_only, people_only, and both arrays';
  }
  return null;
};

const validateEvaluationsSnapshot = (payload) => {
  if (!isObject(payload)) return 'Evaluations payload must be an object';
  if (!isObject(payload.inputs)) return 'Evaluations payload must include inputs';
  if (!Array.isArray(payload.records)) return 'Evaluations payload must include records';
  if (!Array.isArray(payload.evaluators)) return 'Evaluations payload must include evaluators';
  if (!isObject(payload.output)) return 'Evaluations payload must include output';
  if (!Array.isArray(payload.output.assignments) || !Array.isArray(payload.output.unassignedVats)) {
    return 'Evaluations payload output must include assignments and unassignedVats arrays';
  }
  return null;
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const escapeCsvCell = (value) => {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const renderAirtableCheckTable = (title, rows) => {
  const body = rows.length
    ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.airtableRowNumber)}</td>
        <td>${escapeHtml(row.sessionName)}</td>
        <td>${escapeHtml(row.calendarStart)}</td>
        <td>${escapeHtml(row.calendarEnd)}</td>
        <td>${escapeHtml(row.facilitator)}</td>
        <td>${escapeHtml(row.producer)}</td>
        <td>${escapeHtml(row.differenceLabels.join(', '))}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7">No sessions in this group.</td></tr>`;

  return `
    <section class="section">
      <h2><span class="section-badge">${rows.length}</span> ${escapeHtml(title)}</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Airtable Row</th>
              <th>Session Name</th>
              <th>Calendar Start (UTC)</th>
              <th>Calendar End (UTC)</th>
              <th>Facilitator</th>
              <th>Producer</th>
              <th>Changes</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
};

const flattenAirtableCheckRows = (payload) => [
  ...(Array.isArray(payload?.tables?.both) ? payload.tables.both : []),
  ...(Array.isArray(payload?.tables?.time_only) ? payload.tables.time_only : []),
  ...(Array.isArray(payload?.tables?.people_only) ? payload.tables.people_only : []),
];

const buildAirtableCheckWorkbookBuffer = (payload) => {
  const rows = flattenAirtableCheckRows(payload).map((row) => ({
    'Airtable Row': row.airtableRowNumber ?? '',
    'Airtable Record ID': row.airtableRecordId ?? '',
    'Session Name': row.sessionName ?? '',
    'Calendar Start': row.calendarStart ?? '',
    'Calendar End': row.calendarEnd ?? '',
    'Facilitator': row.facilitator ?? '',
    'Producer': row.producer ?? '',
    'Changes': Array.isArray(row.differenceLabels) ? row.differenceLabels.join(', ') : '',
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      'Airtable Row',
      'Airtable Record ID',
      'Session Name',
      'Calendar Start',
      'Calendar End',
      'Facilitator',
      'Producer',
      'Changes',
    ],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Airtable Changes');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const getEvaluationMemberEmail = (member) =>
  member?.Email ??
  member?.email ??
  member?.['E-mail'] ??
  member?.['Email Address'] ??
  member?.['Associate Email'] ??
  '';

const formatEvaluationMemberMeta = (member) => {
  const parts = [
    member?.Country,
    member?.Office,
    getEvaluationMemberEmail(member),
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(' | ')})` : '';
};

const formatEvaluationTeamMembersText = (members) => {
  if (!Array.isArray(members) || members.length === 0) return '';
  return members
    .map((member) => `${member?.['Full Name'] ?? 'Unknown'}${formatEvaluationMemberMeta(member)}`)
    .join('; ');
};

const renderEvaluationTeamMembersHtml = (members) => {
  if (!Array.isArray(members) || members.length === 0) return '<span class="muted">No team details</span>';
  return `
    <ul class="team-list">
      ${members.map((member) => `
        <li>
          <strong>${escapeHtml(member?.['Full Name'] ?? 'Unknown')}</strong>
          <span>${escapeHtml(formatEvaluationMemberMeta(member).replace(/^\s*/, ''))}</span>
        </li>
      `).join('')}
    </ul>
  `;
};

const flattenEvaluationRows = (payload) => {
  const assignedRows = Array.isArray(payload?.output?.assignments)
    ? payload.output.assignments.flatMap((assignment) =>
        (assignment.assignedVats ?? []).map((vat) => ({
          status: 'Assigned',
          evaluatorName: assignment.evaluator?.['Faculty Name'] ?? '',
          evaluatorRole: assignment.evaluator?.Role ?? '',
          evaluatorUtcOffset: assignment.utcOffset ?? assignment.evaluator?.utcOffset ?? '',
          vatName: vat.name ?? '',
          solutionArea: vat.sa ?? '',
          vatUtcOffset: vat.utcOffset ?? '',
          membersCount: Array.isArray(vat.members) ? vat.members.length : '',
          suggestedMeetingUtc: vat.suggestedMeetingUtcLabel ?? vat.suggestedUtcSlot ?? '',
          suggestedDateUtc: vat.suggestedDateUtc ?? '',
          suggestedDay: vat.suggestedDay ?? '',
          evaluatorLocalSlot: vat.evaluatorLocalSlot ?? '',
          vatMemberLocalRange: vat.vatMemberLocalRange ?? '',
          vatAverageLocalStart: vat.vatAvgLocalStart ?? '',
          timingQuality: vat.timingQuality ?? '',
          members: Array.isArray(vat.members) ? vat.members : [],
          teamDetails: formatEvaluationTeamMembersText(vat.members),
        }))
      )
    : [];

  const unassignedRows = Array.isArray(payload?.output?.unassignedVats)
    ? payload.output.unassignedVats.map((vat) => ({
        status: 'Unassigned',
        evaluatorName: '',
        evaluatorRole: '',
        evaluatorUtcOffset: '',
        vatName: vat.name ?? '',
        solutionArea: vat.sa ?? '',
        vatUtcOffset: vat.utcOffset ?? '',
        membersCount: Array.isArray(vat.members) ? vat.members.length : '',
        suggestedMeetingUtc: vat.suggestedMeetingUtcLabel ?? vat.suggestedUtcSlot ?? '',
        suggestedDateUtc: vat.suggestedDateUtc ?? '',
        suggestedDay: vat.suggestedDay ?? '',
        evaluatorLocalSlot: vat.evaluatorLocalSlot ?? '',
        vatMemberLocalRange: vat.vatMemberLocalRange ?? '',
        vatAverageLocalStart: vat.vatAvgLocalStart ?? '',
        timingQuality: vat.timingQuality ?? '',
        members: Array.isArray(vat.members) ? vat.members : [],
        teamDetails: formatEvaluationTeamMembersText(vat.members),
      }))
    : [];

  return [...assignedRows, ...unassignedRows];
};

const buildEvaluationsCsv = (payload) => {
  const headers = [
    'Status',
    'Evaluator Name',
    'Evaluator Role',
    'Evaluator UTC Offset',
    'VAT Name',
    'Solution Area',
    'VAT UTC Offset',
    'Members Count',
    'Suggested Meeting UTC',
    'Suggested Date UTC',
    'Suggested Day',
    'Evaluator Local Slot',
    'VAT Member Local Range',
    'VAT Average Local Start',
    'Timing Quality',
    'VAT Team',
  ];

  const rows = flattenEvaluationRows(payload).map((row) => ([
    row.status,
    row.evaluatorName,
    row.evaluatorRole,
    row.evaluatorUtcOffset,
    row.vatName,
    row.solutionArea,
    row.vatUtcOffset,
    row.membersCount,
    row.suggestedMeetingUtc,
    row.suggestedDateUtc,
    row.suggestedDay,
    row.evaluatorLocalSlot,
    row.vatMemberLocalRange,
    row.vatAverageLocalStart,
    row.timingQuality,
    row.teamDetails,
  ]));

  return [headers, ...rows].map((line) => line.map(escapeCsvCell).join(',')).join('\n');
};

const buildEvaluationsWorkbookBuffer = (payload) => {
  const rows = flattenEvaluationRows(payload).map((row) => ({
    Status: row.status,
    'Evaluator Name': row.evaluatorName,
    'Evaluator Role': row.evaluatorRole,
    'Evaluator UTC Offset': row.evaluatorUtcOffset,
    'VAT Name': row.vatName,
    'Solution Area': row.solutionArea,
    'VAT UTC Offset': row.vatUtcOffset,
    'Members Count': row.membersCount,
    'Suggested Meeting UTC': row.suggestedMeetingUtc,
    'Suggested Date UTC': row.suggestedDateUtc,
    'Suggested Day': row.suggestedDay,
    'Evaluator Local Slot': row.evaluatorLocalSlot,
    'VAT Member Local Range': row.vatMemberLocalRange,
    'VAT Average Local Start': row.vatAverageLocalStart,
    'Timing Quality': row.timingQuality,
    'VAT Team': row.teamDetails,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: [
      'Status',
      'Evaluator Name',
      'Evaluator Role',
      'Evaluator UTC Offset',
      'VAT Name',
      'Solution Area',
      'VAT UTC Offset',
      'Members Count',
      'Suggested Meeting UTC',
      'Suggested Date UTC',
      'Suggested Day',
      'Evaluator Local Slot',
      'VAT Member Local Range',
      'VAT Average Local Start',
      'Timing Quality',
      'VAT Team',
    ],
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Evaluations');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const renderEvaluationsTable = (title, rows) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const body = safeRows.length
    ? safeRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.evaluatorName)}</td>
        <td>${escapeHtml(row.vatName)}</td>
        <td>${escapeHtml(row.solutionArea)}</td>
        <td>${escapeHtml(row.suggestedMeetingUtc)}</td>
        <td>${escapeHtml(row.suggestedDay)}</td>
        <td>${escapeHtml(row.evaluatorLocalSlot)}</td>
        <td>${escapeHtml(row.vatMemberLocalRange)}</td>
        <td>${escapeHtml(row.timingQuality)}</td>
        <td>${renderEvaluationTeamMembersHtml(row.members)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="10">No rows in this group.</td></tr>`;

  return `
    <section class="section">
      <h2><span class="section-badge">${safeRows.length}</span> ${escapeHtml(title)}</h2>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Evaluator</th>
              <th>VAT</th>
              <th>Solution Area</th>
              <th>Suggested Meeting (UTC)</th>
              <th>Suggested Day</th>
              <th>Evaluator Local Slot</th>
              <th>VAT Member Range</th>
              <th>Timing Quality</th>
              <th>VAT Team</th>
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </section>
  `;
};

const renderAirtableCheckHtml = (payload) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Airtable Check</title>
    <style>
      :root {
        --bg: #eef3ef;
        --panel: rgba(255,255,255,0.94);
        --panel-strong: #ffffff;
        --border: rgba(45, 95, 75, 0.12);
        --text: #17201b;
        --muted: #5f7267;
        --primary: #2d5f4b;
        --primary-dark: #234a3a;
        --accent-soft: #edf8cf;
        --shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        font-family: Inter, system-ui, sans-serif;
        margin: 0;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(217,255,115,0.18), transparent 22%),
          radial-gradient(circle at top right, rgba(45,95,75,0.08), transparent 28%),
          var(--bg);
      }
      .page { max-width: 1260px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
      .hero {
        background: linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(243,248,244,0.97) 100%);
        border: 1px solid var(--border);
        border-radius: 28px;
        padding: 1.5rem;
        box-shadow: var(--shadow);
      }
      .brandbar { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
      .brandlockup { display: flex; align-items: center; gap: 1rem; min-width: 0; }
      .brandmark {
        width: 56px;
        height: 56px;
        border-radius: 18px;
        background: linear-gradient(180deg, #203029 0%, #111915 100%);
        border: 1px solid rgba(217,255,115,0.2);
        box-shadow: 0 14px 30px rgba(15,23,42,0.12);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.45rem;
        transition: transform 180ms ease, box-shadow 220ms ease, filter 220ms ease;
        transform-origin: center;
      }
      .brandmark img { width: 100%; height: 100%; display: block; transition: transform 220ms ease, filter 220ms ease; }
      .brandlockup:hover .brandmark {
        transform: translateY(-1px) scale(1.04) rotate(-2deg);
        box-shadow: 0 18px 34px rgba(15,23,42,0.16);
        filter: drop-shadow(0 0 18px rgba(217,255,115,0.22));
      }
      .brandlockup:hover .brandmark img {
        transform: scale(1.03);
        filter: drop-shadow(0 0 14px rgba(217,255,115,0.18));
      }
      .eyebrow { margin: 0 0 0.25rem; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
      h1 { margin: 0; font-size: clamp(1.8rem, 3vw, 2.5rem); line-height: 1.05; }
      .subtitle { margin: 0.45rem 0 0; color: var(--muted); max-width: 780px; line-height: 1.6; }
      .hero-meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0.75rem; margin-top: 1rem; }
      .meta-card { background: rgba(255,255,255,0.9); border: 1px solid var(--border); border-radius: 16px; padding: 0.9rem 1rem; }
      .meta-label { font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.35rem; }
      .meta-value { color: var(--text); font-weight: 600; word-break: break-word; }
      .summary { display:grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 1rem; margin-top: 1rem; }
      .card { background: linear-gradient(180deg, #ffffff 0%, #f4faec 100%); border:1px solid rgba(45, 95, 75, 0.12); border-radius:18px; padding:1rem; box-shadow: 0 10px 26px rgba(15,23,42,0.04); }
      .card-title { font-size: 0.82rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
      .card-value { font-size: 2rem; font-weight: 800; margin-top: 0.35rem; color: var(--primary-dark); }
      .actions { display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:1rem; }
      .button { display:inline-flex; align-items:center; gap:0.45rem; background: linear-gradient(135deg, #213d32 0%, var(--primary) 100%); color:white; padding:0.8rem 1rem; border-radius:14px; font-weight:700; border: 1px solid rgba(35, 74, 58, 0.22); box-shadow: 0 12px 28px rgba(33, 61, 50, 0.18); }
      .button.secondary { background:#ffffff; color:var(--primary); border:1px solid rgba(45, 95, 75, 0.14); box-shadow: 0 8px 20px rgba(15,23,42,0.04); }
      .section { margin-top: 1.25rem; background: var(--panel); border: 1px solid var(--border); border-radius: 24px; padding: 1.2rem; box-shadow: var(--shadow); }
      .section h2 { margin: 0 0 0.85rem; font-size: 1.2rem; display: flex; align-items: center; gap: 0.65rem; }
      .section-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 1.9rem; height: 1.9rem; padding: 0 0.55rem; border-radius: 999px; background: var(--accent-soft); color: var(--primary-dark); font-size: 0.82rem; font-weight: 800; }
      .table-wrap { overflow-x: auto; border-radius: 18px; border: 1px solid rgba(45, 95, 75, 0.1); background: var(--panel-strong); }
      .data-table { width:100%; border-collapse: collapse; font-size: 14px; }
      .data-table thead { background:#f4faec; }
      .data-table th { text-align:left; padding: 0.85rem 0.75rem; color: var(--muted); font-size: 0.75rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; }
      .data-table td { padding: 0.85rem 0.75rem; border-top: 1px solid rgba(45, 95, 75, 0.08); vertical-align: top; }
      a { color:var(--primary); text-decoration:none; }
      a:hover { text-decoration: underline; }
      @media (max-width: 640px) {
        .page { padding: 1rem 0.9rem 2rem; }
        .hero, .section { padding: 1rem; border-radius: 20px; }
        .brandmark { width: 48px; height: 48px; border-radius: 14px; }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="hero">
        <div class="brandbar">
          <div class="brandlockup">
            <div class="brandmark">
              <img src="/sessionzilla-mark.svg" alt="Sessionzilla" />
            </div>
            <div>
              <p class="eyebrow">Sessionzilla Public Report</p>
              <h1>Airtable Check</h1>
              <p class="subtitle">Shared comparison snapshot for manual Airtable updates, now styled like the rest of the kaiju-powered Sessionzilla experience.</p>
            </div>
          </div>
        </div>
        <div class="hero-meta">
          <div class="meta-card">
            <div class="meta-label">Generated at</div>
            <div class="meta-value">${escapeHtml(payload.generated_at)}</div>
          </div>
          ${payload.source_url ? `<div class="meta-card"><div class="meta-label">Source</div><div class="meta-value"><a href="${escapeHtml(payload.source_url)}" target="_blank" rel="noreferrer">${escapeHtml(payload.source_url)}</a></div></div>` : ''}
        </div>
        <div class="actions">
          <a class="button" href="/api/public/airtable-check.xlsx">Export to Excel</a>
          <a class="button secondary" href="/api/public/airtable-check" target="_blank" rel="noreferrer">View JSON</a>
        </div>
        <div class="summary">
          <div class="card"><div class="card-title">Total changed sessions</div><div class="card-value">${escapeHtml(payload.summary.total_changed_sessions)}</div></div>
          <div class="card"><div class="card-title">Time only</div><div class="card-value">${escapeHtml(payload.summary.time_only)}</div></div>
          <div class="card"><div class="card-title">SME / Faculty only</div><div class="card-value">${escapeHtml(payload.summary.people_only)}</div></div>
          <div class="card"><div class="card-title">Both / mixed changes</div><div class="card-value">${escapeHtml(payload.summary.both)}</div></div>
        </div>
      </div>
      ${renderAirtableCheckTable('Both / mixed changes', payload.tables.both)}
      ${renderAirtableCheckTable('Time changes', payload.tables.time_only)}
      ${renderAirtableCheckTable('SME / Faculty changes', payload.tables.people_only)}
    </div>
  </body>
</html>`;

const renderEvaluationsHtml = (payload) => {
  const rows = flattenEvaluationRows(payload);
  const assigned = rows.filter((row) => row.status === 'Assigned');
  const unassigned = rows.filter((row) => row.status === 'Unassigned');
  const notes = Array.isArray(payload?.output?.schedulingWindow?.notes) ? payload.output.schedulingWindow.notes : [];

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Evaluations</title>
    <style>
      :root {
        --bg: #eef3ef;
        --panel: rgba(255,255,255,0.94);
        --panel-strong: #ffffff;
        --border: rgba(45, 95, 75, 0.12);
        --text: #17201b;
        --muted: #5f7267;
        --primary: #2d5f4b;
        --primary-dark: #234a3a;
        --accent-soft: #edf8cf;
        --shadow: 0 18px 44px rgba(15, 23, 42, 0.08);
      }
      * { box-sizing: border-box; }
      body {
        font-family: Inter, system-ui, sans-serif;
        margin: 0;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(217,255,115,0.18), transparent 22%),
          radial-gradient(circle at top right, rgba(45,95,75,0.08), transparent 28%),
          var(--bg);
      }
      .page { max-width: 1260px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
      .hero, .section {
        background: linear-gradient(180deg, rgba(255,255,255,0.97) 0%, rgba(243,248,244,0.97) 100%);
        border: 1px solid var(--border);
        border-radius: 28px;
        padding: 1.5rem;
        box-shadow: var(--shadow);
      }
      .section { margin-top: 1.25rem; padding: 1.2rem; }
      .brandlockup { display:flex; align-items:center; gap:1rem; margin-bottom:1rem; }
      .brandmark {
        width: 56px; height: 56px; border-radius: 18px;
        background: linear-gradient(180deg, #203029 0%, #111915 100%);
        border: 1px solid rgba(217,255,115,0.2);
        box-shadow: 0 14px 30px rgba(15,23,42,0.12);
        display:inline-flex; align-items:center; justify-content:center; padding:0.45rem;
      }
      .brandmark img { width:100%; height:100%; display:block; }
      .eyebrow { margin:0 0 0.25rem; font-size:0.76rem; font-weight:800; letter-spacing:0.14em; text-transform:uppercase; color:var(--muted); }
      h1 { margin:0; font-size:clamp(1.8rem,3vw,2.5rem); line-height:1.05; }
      .subtitle { margin:0.45rem 0 0; color:var(--muted); max-width:780px; line-height:1.6; }
      .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:1rem; margin-top:1rem; }
      .card { background: linear-gradient(180deg, #ffffff 0%, #f4faec 100%); border:1px solid rgba(45,95,75,0.12); border-radius:18px; padding:1rem; box-shadow:0 10px 26px rgba(15,23,42,0.04); }
      .card-title { font-size:0.82rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; color:var(--muted); }
      .card-value { font-size:2rem; font-weight:800; margin-top:0.35rem; color:var(--primary-dark); }
      .actions { display:flex; gap:0.75rem; flex-wrap:wrap; margin-top:1rem; }
      .button { display:inline-flex; align-items:center; gap:0.45rem; background: linear-gradient(135deg, #213d32 0%, var(--primary) 100%); color:white; padding:0.8rem 1rem; border-radius:14px; font-weight:700; border:1px solid rgba(35,74,58,0.22); box-shadow:0 12px 28px rgba(33,61,50,0.18); text-decoration:none; }
      .button.secondary { background:#ffffff; color:var(--primary); border:1px solid rgba(45,95,75,0.14); box-shadow:0 8px 20px rgba(15,23,42,0.04); }
      .meta-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:0.75rem; margin-top:1rem; }
      .meta-card { background:rgba(255,255,255,0.9); border:1px solid var(--border); border-radius:16px; padding:0.9rem 1rem; }
      .meta-label { font-size:0.72rem; font-weight:800; letter-spacing:0.08em; text-transform:uppercase; color:var(--muted); margin-bottom:0.35rem; }
      .meta-value { color:var(--text); font-weight:600; word-break:break-word; }
      .section h2 { margin:0 0 0.85rem; font-size:1.2rem; display:flex; align-items:center; gap:0.65rem; }
      .section-badge { display:inline-flex; align-items:center; justify-content:center; min-width:1.9rem; height:1.9rem; padding:0 0.55rem; border-radius:999px; background:var(--accent-soft); color:var(--primary-dark); font-size:0.82rem; font-weight:800; }
      .table-wrap { overflow-x:auto; border-radius:18px; border:1px solid rgba(45,95,75,0.1); background:var(--panel-strong); }
      .data-table { width:100%; border-collapse:collapse; font-size:14px; }
      .data-table thead { background:#f4faec; }
      .data-table th { text-align:left; padding:0.85rem 0.75rem; color:var(--muted); font-size:0.75rem; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; }
      .data-table td { padding:0.85rem 0.75rem; border-top:1px solid rgba(45,95,75,0.08); vertical-align:top; }
      .team-list { margin: 0; padding-left: 1rem; }
      .team-list li + li { margin-top: 0.35rem; }
      .team-list strong { display: block; color: var(--text); }
      .team-list span, .muted { color: var(--muted); font-size: 0.92em; }
      ul { margin:0; padding-left:1.2rem; color:var(--text); }
      a { color:var(--primary); text-decoration:none; }
      a:hover { text-decoration:underline; }
    </style>
  </head>
  <body>
    <div class="page">
      <div class="hero">
        <div class="brandlockup">
          <div class="brandmark"><img src="/sessionzilla-mark.svg" alt="Sessionzilla" /></div>
          <div>
            <p class="eyebrow">Sessionzilla Public Report</p>
            <h1>Evaluations</h1>
            <p class="subtitle">Shared snapshot of evaluator assignments and suggested session times for review, export, and collaboration.</p>
          </div>
        </div>
        <div class="actions">
          <a class="button" href="/api/public/evaluations.xlsx">Export Excel</a>
          <a class="button" href="/api/public/evaluations.csv">Export CSV</a>
          <a class="button secondary" href="/api/public/evaluations" target="_blank" rel="noreferrer">View JSON</a>
        </div>
        <div class="meta-grid">
          <div class="meta-card"><div class="meta-label">Evaluation Date</div><div class="meta-value">${escapeHtml(payload?.inputs?.evaluationDate ?? '')}</div></div>
          <div class="meta-card"><div class="meta-label">Exported At</div><div class="meta-value">${escapeHtml(payload?.exportedAt ?? '')}</div></div>
          <div class="meta-card"><div class="meta-label">Timezone</div><div class="meta-value">${escapeHtml(payload?.output?.schedulingWindow?.timezone ?? 'UTC')}</div></div>
          <div class="meta-card"><div class="meta-label">Meeting Duration</div><div class="meta-value">${escapeHtml(payload?.output?.schedulingWindow?.meetingDurationMinutes ?? '')} minutes</div></div>
        </div>
        <div class="summary">
          <div class="card"><div class="card-title">Assigned VATs</div><div class="card-value">${assigned.length}</div></div>
          <div class="card"><div class="card-title">Unassigned VATs</div><div class="card-value">${unassigned.length}</div></div>
          <div class="card"><div class="card-title">Evaluators</div><div class="card-value">${escapeHtml(payload?.inputs?.evaluatorsCount ?? '')}</div></div>
          <div class="card"><div class="card-title">Records</div><div class="card-value">${escapeHtml(payload?.inputs?.recordsCount ?? '')}</div></div>
        </div>
      </div>
      ${notes.length ? `<section class="section"><h2><span class="section-badge">${notes.length}</span> Scheduling Notes</h2><ul>${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></section>` : ''}
      ${renderEvaluationsTable('Assigned VATs', assigned)}
      ${renderEvaluationsTable('Unassigned VATs', unassigned)}
    </div>
  </body>
</html>`;
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
    const forwardedProto = req.headers['x-forwarded-proto'];
    const publicProtocol = typeof forwardedProto === 'string' && forwardedProto.length > 0 ? forwardedProto.split(',')[0] : 'https';
    const publicHost = req.headers.host || `localhost:${PORT}`;
    const publicOrigin = `${publicProtocol}://${publicHost}`;

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

    if (pathname === '/api/public/airtable-check') {
      if (req.method === 'GET') {
        try {
          const data = await persistence.getAppState?.('airtable-check.latest');
          if (!data) {
            return jsonResponse(res, 404, { error: 'No Airtable Check snapshot published yet.' });
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
          const validationError = validateAirtableCheckSnapshot(parsed);
          if (validationError) return jsonResponse(res, 400, { error: validationError });
          await persistence.setAppState?.('airtable-check.latest', parsed);
          return jsonResponse(res, 200, {
            ok: true,
            saved_at: new Date().toISOString(),
            public_url: `${publicOrigin}/public/airtable-check`,
          });
        } catch (err) {
          return jsonResponse(res, 400, { error: `Invalid JSON body: ${err}` });
        }
      }

      return jsonResponse(res, 405, { error: `Method not allowed: ${req.method}` });
    }

    if (pathname === '/api/public/evaluations') {
      if (req.method === 'GET') {
        try {
          const data = await persistence.getAppState?.('evaluations.latest');
          if (!data) {
            return jsonResponse(res, 404, { error: 'No evaluations snapshot published yet.' });
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
          const validationError = validateEvaluationsSnapshot(parsed);
          if (validationError) return jsonResponse(res, 400, { error: validationError });

          await persistence.setAppState?.('evaluations.latest', parsed);
          return jsonResponse(res, 200, {
            ok: true,
            saved_at: new Date().toISOString(),
            public_url: `${publicOrigin}/public/evaluations`,
          });
        } catch (err) {
          return jsonResponse(res, 400, { error: `Invalid JSON body: ${err}` });
        }
      }

      return jsonResponse(res, 405, { error: `Method not allowed: ${req.method}` });
    }

    if (pathname === '/api/public/evaluations.csv' && req.method === 'GET') {
      try {
        const data = await persistence.getAppState?.('evaluations.latest');
        if (!data) {
          return jsonResponse(res, 404, { error: 'No evaluations snapshot published yet.' });
        }
        const csv = buildEvaluationsCsv(data);
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="evaluations-public.csv"',
          ...corsHeaders,
        });
        res.end(csv);
        return;
      } catch (err) {
        return jsonResponse(res, 500, { error: String(err) });
      }
    }

    if (pathname === '/api/public/evaluations.xlsx' && req.method === 'GET') {
      try {
        const data = await persistence.getAppState?.('evaluations.latest');
        if (!data) {
          return jsonResponse(res, 404, { error: 'No evaluations snapshot published yet.' });
        }
        const buffer = buildEvaluationsWorkbookBuffer(data);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="evaluations-public.xlsx"',
          ...corsHeaders,
        });
        res.end(buffer);
        return;
      } catch (err) {
        return jsonResponse(res, 500, { error: `Failed to build evaluations workbook: ${err}` });
      }
    }

    if (pathname === '/public/evaluations' && req.method === 'GET') {
      try {
        const data = await persistence.getAppState?.('evaluations.latest');
        if (!data) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>No evaluations snapshot published yet.</h1>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderEvaluationsHtml(data));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Failed to load evaluations report</h1><pre>${escapeHtml(String(err))}</pre>`);
        return;
      }
    }

    if (pathname === '/api/public/airtable-check.xlsx' && req.method === 'GET') {
      try {
        const data = await persistence.getAppState?.('airtable-check.latest');
        if (!data) {
          return jsonResponse(res, 404, { error: 'No Airtable Check snapshot published yet.' });
        }
        const buffer = buildAirtableCheckWorkbookBuffer(data);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="airtable-check-changes.xlsx"',
          ...corsHeaders,
        });
        res.end(buffer);
        return;
      } catch (err) {
        return jsonResponse(res, 500, { error: `Failed to build Airtable Check workbook: ${err}` });
      }
    }

    if (pathname === '/public/airtable-check' && req.method === 'GET') {
      try {
        const data = await persistence.getAppState?.('airtable-check.latest');
        if (!data) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>No Airtable Check snapshot published yet.</h1>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderAirtableCheckHtml(data));
        return;
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Failed to load Airtable Check report</h1><pre>${escapeHtml(String(err))}</pre>`);
        return;
      }
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

    if (pathname === '/api/integrations/airtable-check' && req.method === 'GET') {
      try {
        const data = await getSharedAirtableRows();
        return jsonResponse(res, 200, { ok: true, ...data });
      } catch (err) {
        return jsonResponse(res, 502, {
          ok: false,
          error: `Airtable check failed: ${String(err)}`,
        });
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
        if (req.method === 'GET') {
          const project = await persistence.getProject(id);
          if (!project) return jsonResponse(res, 404, { ok: false, error: 'Project not found' });
          return jsonResponse(res, 200, { ok: true, data: project });
        }
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
      const subRoute = pathname.split('/')[5];
      if (id && subRoute === 'presence') {
        if (req.method === 'GET') {
          const data = await persistence.getPresence?.(id);
          return jsonResponse(res, 200, { ok: true, data: data ?? [] });
        }
        if (req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { editor } = JSON.parse(body);
            if (!editor?.id || !editor?.name) {
              return jsonResponse(res, 400, { ok: false, error: 'editor.id and editor.name are required' });
            }
            const data = await persistence.touchPresence?.(id, editor);
            return jsonResponse(res, 200, { ok: true, data });
          } catch (e) {
            return jsonResponse(res, 400, { ok: false, error: String(e) });
          }
        }
      }
      if (id && !subRoute && req.method === 'GET') {
        const v = await persistence.getVersion(id);
        return v ? jsonResponse(res, 200, { ok: true, data: v }) : jsonResponse(res, 404, { ok: false });
      }
      if (id && !subRoute && req.method === 'PATCH') {
        try {
          const body = await readBody(req);
          const { snapshot, expectedRevision, editor } = JSON.parse(body);
          if (!snapshot) return jsonResponse(res, 400, { ok: false, error: 'Missing snapshot' });
          const existingVersion = await persistence.getVersionMeta?.(id) ?? await persistence.getVersion(id);
          if (!existingVersion) return jsonResponse(res, 404, { ok: false, error: 'Version not found' });
          const conflict = await persistence.getConflict(existingVersion.projectId, expectedRevision);
          if (conflict) {
            const currentVersion = await persistence.getVersion(id);
            return jsonResponse(res, 409, {
              ok: false,
              error: 'conflict',
              currentProject: conflict,
              currentVersion,
            });
          }
          const updated = await persistence.updateVersion(id, snapshot, { editor });
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
      if (id && !subRoute && req.method === 'DELETE') {
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
