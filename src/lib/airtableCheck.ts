import { buildSummaryExport, type SummaryExport } from './publicApiPayloads';
import { activePlanningSessions } from './sessionCatalog';
import { extractScheduleKey, parseSessionDate } from './timezones';
import type { StudentRecord } from './excelParser';
import type { SmeAssignments } from '../components/SMESchedule';
import type { FacultyAssignments } from '../components/FacultySchedule';
import type { SME } from './smeMatcher';
import type { SMECacheStatus } from './smeDataLoader';
import type { SessionId } from './smeMatcher';

const KP_SESSION_NAMES: Record<SessionId, string> = {
  introduction_to_business_case: 'Solution Weeks - Introduction to Business Case',
  role_and_account_dynamics: 'Solution Weeks - Role and Account Dynamics',
  overview: 'Solution Weeks - Solution Overview',
  process_mapping: 'Solution Weeks - Process to Solution mapping',
  industry_relevance: 'Solution Weeks - Industry Relevance',
  ai_strategy: 'Solution Weeks - AI Strategy',
  competitive_defense: 'Solution Weeks - Competitive Defense',
  adoption_risk: 'Solution Weeks - Adoption & Risk Prevention',
};

const sessionDateById = Object.fromEntries(
  activePlanningSessions.map((session) => [session.id, session.date])
) as Record<SessionId, string>;

export interface ComparableSessionRow {
  sessionName: string;
  calendarStartIso: string;
  calendarEndIso: string;
  facilitator: string;
  producer: string;
  numParticipants: number;
  participants: string[];
}

export interface AirtableRow extends ComparableSessionRow {
  id: string;
  rowNumber: number;
  raw: Record<string, unknown>;
}

export interface AirtableCheckDifference {
  field: 'calendarStart' | 'calendarEnd' | 'facilitator' | 'producer' | 'numParticipants' | 'participants';
  label: string;
  appValue: string;
  airtableValue: string;
}

export interface AirtableCheckMatchedRow {
  app: ComparableSessionRow;
  airtable: AirtableRow;
  differences: AirtableCheckDifference[];
  score: number;
}

export interface AirtableCheckResult {
  matched: AirtableCheckMatchedRow[];
  onlyInApp: ComparableSessionRow[];
  onlyInAirtable: AirtableRow[];
}

export interface AirtablePublicComparisonSectionRow {
  airtableRowNumber: number;
  airtableRecordId: string;
  sessionName: string;
  calendarStart: string;
  calendarEnd: string;
  facilitator: string;
  producer: string;
  differenceLabels: string[];
}

export interface AirtablePublicComparisonPayload {
  generated_at: string;
  source_url: string | null;
  summary: {
    total_changed_sessions: number;
    time_only: number;
    people_only: number;
    both: number;
  };
  tables: {
    time_only: AirtablePublicComparisonSectionRow[];
    people_only: AirtablePublicComparisonSectionRow[];
    both: AirtablePublicComparisonSectionRow[];
  };
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const PERSON_NAME_ALIASES: Record<string, string> = {
  'hanna': 'hanna kielland aalen',
  'hanna aalen': 'hanna kielland aalen',
  'daron': 'daron smith',
  'pau': 'pau pujol xicoy',
  'pau pujol': 'pau pujol xicoy',
  'fernando': 'fernando sanchez lara',
  'fernando sanchez': 'fernando sanchez lara',
  'juan': 'juan gonzalez',
  'nelly': 'nelly rebollo',
  'nick': 'nick goffi',
  'carlos': 'carlos moreno',
  'david': 'david uichanco',
  'reese': 'rissa colayco',
  'godfrey': 'godfrey leung',
  'selene': 'selene hernandez',
  'lilly': 'lilly schmidt',
  'ivan': 'ivan aguilar duclaud',
  'ivan aguilar': 'ivan aguilar duclaud',
  'sandra': 'sandra bissels',
};

export const normalizeSessionName = (value: string): string =>
  normalizeWhitespace(
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[–—-]/g, ' ')
      .replace(/[()/:,&]/g, ' ')
  );

const normalizePersonName = (value: string): string => {
  const normalized = normalizeSessionName(value);
  return PERSON_NAME_ALIASES[normalized] ?? normalized;
};

const toIsoAtUtcHour = (sessionDateLabel: string, utcHour: number): string => {
  const baseDate = parseSessionDate(sessionDateLabel);
  const hours = Math.floor(utcHour);
  const minutes = Math.round((utcHour % 1) * 60);
  return new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    hours,
    minutes,
    0,
    0
  )).toISOString();
};

const addMinutes = (isoString: string, minutes: number): string =>
  new Date(new Date(isoString).getTime() + minutes * 60 * 1000).toISOString();

const sessionNameForSummaryRow = (sessionId: SessionId, schedule: string): string =>
  `${KP_SESSION_NAMES[sessionId]} (${extractScheduleKey(schedule)})`;

export const buildComparableAppRows = ({
  records,
  schedulesBySA,
  startHour,
  endHour,
  facultyStartHour,
  sessionTimeOverrides,
  sessionInstanceTimeOverrides,
  manualSmeAssignments,
  manualFacultyAssignments,
  smeList,
  smeStatus,
}: {
  records: StudentRecord[];
  schedulesBySA: Record<string, Set<string>>;
  startHour: number;
  endHour: number;
  facultyStartHour?: number;
  sessionTimeOverrides: Record<string, number>;
  sessionInstanceTimeOverrides: Record<string, number>;
  manualSmeAssignments: SmeAssignments;
  manualFacultyAssignments: FacultyAssignments;
  smeList: SME[];
  smeStatus: SMECacheStatus | null;
}): ComparableSessionRow[] => {
  const payload: SummaryExport = buildSummaryExport({
    records,
    schedulesBySA,
    startHour,
    endHour,
    facultyStartHour,
    sessionTimeOverrides,
    sessionInstanceTimeOverrides,
    manualSmeAssignments,
    manualFacultyAssignments,
    smeList,
    smeStatus,
  });

  return payload.sessions.map((session) => {
    const startIso = toIsoAtUtcHour(sessionDateById[session.session_id], session.utc_hour);
    const endIso = addMinutes(startIso, 120);
    const participants = session.attendees.map((attendee) => attendee.name).filter(Boolean);

    return {
      sessionName: sessionNameForSummaryRow(session.session_id, session.schedule),
      calendarStartIso: startIso,
      calendarEndIso: endIso,
      facilitator: session.facilitator_type === 'faculty_only'
        ? (session.faculty?.name ?? '')
        : (session.sme?.name ?? 'Faculty-led'),
      producer: session.facilitator_type === 'faculty_only' ? '' : (session.faculty?.name ?? ''),
      numParticipants: session.attendees_count,
      participants,
    };
  });
};

const jaccardSimilarity = (left: string, right: string): number => {
  const leftTokens = new Set(normalizeSessionName(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeSessionName(right).split(' ').filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
};

const compareParticipantLists = (appParticipants: string[], airtableParticipants: string[]): boolean => {
  const left = [...appParticipants].map(normalizePersonName).sort();
  const right = [...airtableParticipants].map(normalizePersonName).sort();
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

const diffMinutes = (leftIso: string, rightIso: string): number =>
  Math.abs(new Date(leftIso).getTime() - new Date(rightIso).getTime()) / 60000;

const buildDifferences = (appRow: ComparableSessionRow, airtableRow: AirtableRow): AirtableCheckDifference[] => {
  const diffs: AirtableCheckDifference[] = [];

  if (appRow.calendarStartIso !== airtableRow.calendarStartIso) {
    diffs.push({ field: 'calendarStart', label: 'Calendar Start', appValue: appRow.calendarStartIso, airtableValue: airtableRow.calendarStartIso });
  }
  if (appRow.calendarEndIso !== airtableRow.calendarEndIso) {
    diffs.push({ field: 'calendarEnd', label: 'Calendar End', appValue: appRow.calendarEndIso, airtableValue: airtableRow.calendarEndIso });
  }
  if (normalizePersonName(appRow.facilitator) !== normalizePersonName(airtableRow.facilitator)) {
    diffs.push({ field: 'facilitator', label: 'Facilitator', appValue: appRow.facilitator, airtableValue: airtableRow.facilitator });
  }
  if (normalizePersonName(appRow.producer) !== normalizePersonName(airtableRow.producer)) {
    diffs.push({ field: 'producer', label: 'Producer', appValue: appRow.producer, airtableValue: airtableRow.producer });
  }
  if (appRow.numParticipants !== airtableRow.numParticipants) {
    diffs.push({ field: 'numParticipants', label: 'Num of Participants', appValue: String(appRow.numParticipants), airtableValue: String(airtableRow.numParticipants) });
  }
  if (!compareParticipantLists(appRow.participants, airtableRow.participants)) {
    diffs.push({
      field: 'participants',
      label: 'Participants',
      appValue: appRow.participants.join(', '),
      airtableValue: airtableRow.participants.join(', '),
    });
  }

  return diffs;
};

const scoreCandidate = (appRow: ComparableSessionRow, airtableRow: AirtableRow): number => {
  let score = 0;
  const nameSimilarity = jaccardSimilarity(appRow.sessionName, airtableRow.sessionName);
  score += nameSimilarity * 100;
  if (normalizeSessionName(appRow.sessionName) === normalizeSessionName(airtableRow.sessionName)) {
    score += 120;
  }
  const startDiff = diffMinutes(appRow.calendarStartIso, airtableRow.calendarStartIso);
  if (startDiff === 0) score += 40;
  else if (startDiff <= 5) score += 30;
  else if (startDiff <= 60) score += 10;
  if (appRow.numParticipants === airtableRow.numParticipants) score += 20;
  return score;
};

export const compareAgainstAirtable = (
  appRows: ComparableSessionRow[],
  airtableRows: AirtableRow[]
): AirtableCheckResult => {
  const remainingAirtable = new Map(airtableRows.map((row) => [row.id, row]));
  const matched: AirtableCheckMatchedRow[] = [];
  const onlyInApp: ComparableSessionRow[] = [];

  for (const appRow of appRows) {
    let bestMatch: AirtableRow | null = null;
    let bestScore = 0;

    for (const airtableRow of remainingAirtable.values()) {
      const score = scoreCandidate(appRow, airtableRow);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = airtableRow;
      }
    }

    if (!bestMatch || bestScore < 75) {
      onlyInApp.push(appRow);
      continue;
    }

    remainingAirtable.delete(bestMatch.id);
    matched.push({
      app: appRow,
      airtable: bestMatch,
      differences: buildDifferences(appRow, bestMatch),
      score: bestScore,
    });
  }

  return {
    matched,
    onlyInApp,
    onlyInAirtable: [...remainingAirtable.values()],
  };
};

const formatUtcForExport = (isoString: string): string => {
  if (!isoString) return '';
  const date = new Date(isoString);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min} UTC`;
};

export const buildAirtablePublicComparisonPayload = (
  result: AirtableCheckResult,
  sourceUrl: string | null
): AirtablePublicComparisonPayload => {
  const changedRows = result.matched.filter((row) => row.differences.length > 0);

  const toRow = (row: AirtableCheckMatchedRow): AirtablePublicComparisonSectionRow => ({
    airtableRowNumber: row.airtable.rowNumber,
    airtableRecordId: row.airtable.id,
    sessionName: row.app.sessionName,
    calendarStart: formatUtcForExport(row.app.calendarStartIso),
    calendarEnd: formatUtcForExport(row.app.calendarEndIso),
    facilitator: row.app.facilitator,
    producer: row.app.producer,
    differenceLabels: row.differences.map((difference) => difference.label),
  });

  const timeOnly = changedRows.filter((row) => row.differences.every((difference) => difference.field === 'calendarStart' || difference.field === 'calendarEnd'));
  const peopleOnly = changedRows.filter((row) => row.differences.every((difference) => difference.field === 'facilitator' || difference.field === 'producer'));
  const both = changedRows.filter((row) => !timeOnly.includes(row) && !peopleOnly.includes(row));

  return {
    generated_at: new Date().toISOString(),
    source_url: sourceUrl,
    summary: {
      total_changed_sessions: changedRows.length,
      time_only: timeOnly.length,
      people_only: peopleOnly.length,
      both: both.length,
    },
    tables: {
      time_only: timeOnly.map(toRow),
      people_only: peopleOnly.map(toRow),
      both: both.map(toRow),
    },
  };
};
