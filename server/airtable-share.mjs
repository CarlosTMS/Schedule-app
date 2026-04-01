const AIRTABLE_SHARED_VIEW_EMBED_URL =
  'https://airtable.com/embed/app6xLDFKHDd3wbbu/shrXO6drYPprN6A3E/tbl6O8mb0PXZOhWyH';

const decodeEscapedUrl = (value) =>
  value
    .replace(/\\u002F/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');

const extractPrefetchUrl = (html) => {
  const match = html.match(/urlWithParams: "([^"]+)"/);
  if (!match) return null;
  return decodeEscapedUrl(match[1]);
};

const normalizeLinkedValues = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'foreignRowDisplayName' in item) {
          return item.foreignRowDisplayName;
        }
        return String(item ?? '');
      })
      .filter(Boolean);
  }

  if (value && typeof value === 'object' && 'foreignRowDisplayName' in value) {
    return [value.foreignRowDisplayName].filter(Boolean);
  }

  return [];
};

const normalizeAirtableRows = (payload) => {
  const columns = Object.fromEntries((payload?.data?.table?.columns ?? []).map((column) => [column.id, column.name]));
  const rows = payload?.data?.table?.rows ?? [];

  return rows.map((row, index) => {
    const mapped = {};
    for (const [columnId, value] of Object.entries(row.cellValuesByColumnId ?? {})) {
      mapped[columns[columnId] ?? columnId] = value;
    }

    const participants = normalizeLinkedValues(mapped.Participants);
    const facilitator = normalizeLinkedValues(mapped.Facilitator).join(', ');
    const producer = normalizeLinkedValues(mapped.Producer).join(', ');

    return {
      id: row.id,
      rowNumber: index + 1,
      sessionName: String(mapped['Session Name'] ?? ''),
      calendarStartIso: mapped['Calendar Start'] ? new Date(mapped['Calendar Start']).toISOString() : '',
      calendarEndIso: mapped['Calendar End'] ? new Date(mapped['Calendar End']).toISOString() : '',
      facilitator,
      producer,
      numParticipants: Number(mapped['Num of Participants'] ?? participants.length ?? 0),
      participants,
      raw: mapped,
    };
  });
};

export const getSharedAirtableRows = async () => {
  const embedRes = await fetch(AIRTABLE_SHARED_VIEW_EMBED_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (compatible; ScheduleApp/1.0; +https://scheduler-app.cfapps.us10.hana.ondemand.com)',
    },
  });

  if (!embedRes.ok) {
    throw new Error(`Failed to load Airtable shared view HTML (${embedRes.status})`);
  }

  const html = await embedRes.text();
  const urlWithParams = extractPrefetchUrl(html);
  if (!urlWithParams) {
    throw new Error('Could not extract Airtable shared view prefetch URL');
  }

  const apiRes = await fetch(`https://airtable.com${urlWithParams}`, {
    headers: {
      'x-airtable-application-id': 'app6xLDFKHDd3wbbu',
      'x-airtable-page-load-id': `pgl-${Date.now().toString(36)}`,
      'X-Requested-With': 'XMLHttpRequest',
      'x-airtable-inter-service-client': 'webClient',
      'x-time-zone': 'America/Los_Angeles',
      'x-user-locale': 'en',
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; ScheduleApp/1.0; +https://scheduler-app.cfapps.us10.hana.ondemand.com)',
    },
  });

  if (!apiRes.ok) {
    throw new Error(`Failed to load Airtable shared view data (${apiRes.status})`);
  }

  const payload = await apiRes.json();
  return {
    fetchedAt: new Date().toISOString(),
    sourceUrl: AIRTABLE_SHARED_VIEW_EMBED_URL,
    rows: normalizeAirtableRows(payload),
  };
};
