import type { StudentRecord } from './excelParser';
import type { SessionId as SmeSessionId } from './smeMatcher';

const PROGRAM_REFERENCE_DATE = new Date('2026-04-15T12:00:00Z');

const normalizeLocation = (value: string | undefined): string =>
    (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\u00a0/g, ' ')
        .replace(/['’]/g, '')
        .toLowerCase()
        .trim();

export const SUN_THU_COUNTRIES = [
    'saudi arabia', 'arabia saudita', 
    'kuwait', 
    'qatar', 
    'bahrain', 'bahrein', 
    'oman', 
    'jordan', 'jordania', 
    'egypt', 'egipto', 
    'israel'
];

const OFFICE_TIME_ZONES: Array<[string, string]> = [
    ['hong kong', 'Asia/Hong_Kong'],
    ['singapore', 'Asia/Singapore'],
    ['shanghai', 'Asia/Shanghai'],
    ['shenzhen', 'Asia/Shanghai'],
    ['beijing', 'Asia/Shanghai'],
    ['manila', 'Asia/Manila'],
    ['kuala lumpur', 'Asia/Kuala_Lumpur'],
    ['jakarta', 'Asia/Jakarta'],
    ['tokyo', 'Asia/Tokyo'],
    ['seoul', 'Asia/Seoul'],
    ['mumbai', 'Asia/Kolkata'],
    ['gurgaon', 'Asia/Kolkata'],
    ['delhi', 'Asia/Kolkata'],
    ['doha', 'Asia/Qatar'],
    ['riyadh', 'Asia/Riyadh'],
    ['manama', 'Asia/Bahrain'],
    ['dubai', 'Asia/Dubai'],
    ['istanbul libadiye', 'Europe/Istanbul'],
    ['istanbul', 'Europe/Istanbul'],
    ['new cairo', 'Africa/Cairo'],
    ['cairo', 'Africa/Cairo'],
    ['johannesburg', 'Africa/Johannesburg'],
    ['nairobi', 'Africa/Nairobi'],
    ['espoo', 'Europe/Helsinki'],
    ['athens', 'Europe/Athens'],
    ['helsinki', 'Europe/Helsinki'],
    ['amsterdam', 'Europe/Amsterdam'],
    ['s-hertogenbosch', 'Europe/Amsterdam'],
    ['frankfurt', 'Europe/Berlin'],
    ['eschborn', 'Europe/Berlin'],
    ['garching', 'Europe/Berlin'],
    ['munchen', 'Europe/Berlin'],
    ['munich', 'Europe/Berlin'],
    ['hamburg', 'Europe/Berlin'],
    ['ratingen', 'Europe/Berlin'],
    ['walldorf', 'Europe/Berlin'],
    ['berlin', 'Europe/Berlin'],
    ['zurich-flughafen', 'Europe/Zurich'],
    ['zurich', 'Europe/Zurich'],
    ['barcelona', 'Europe/Madrid'],
    ['madrid', 'Europe/Madrid'],
    ['milan', 'Europe/Rome'],
    ['milano', 'Europe/Rome'],
    ['porto salvo', 'Europe/Lisbon'],
    ['oslo', 'Europe/Oslo'],
    ['stockholm', 'Europe/Stockholm'],
    ['copenhagen', 'Europe/Copenhagen'],
    ['brussels', 'Europe/Brussels'],
    ['paris', 'Europe/Paris'],
    ['vienna', 'Europe/Vienna'],
    ['london', 'Europe/London'],
    ['feltham', 'Europe/London'],
    ['dublin', 'Europe/Dublin'],
    ['mexico df', 'America/Mexico_City'],
    ['bogota', 'America/Bogota'],
    ['lima', 'America/Lima'],
    ['sao paulo', 'America/Sao_Paulo'],
    ['toronto', 'America/Toronto'],
    ['montreal', 'America/Toronto'],
    ['new york', 'America/New_York'],
    ['boston', 'America/New_York'],
    ['atlanta', 'America/New_York'],
    ['dallas', 'America/Chicago'],
    ['houston', 'America/Chicago'],
    ['chicago', 'America/Chicago'],
    ['tempe', 'America/Phoenix'],
    ['palo alto', 'America/Los_Angeles'],
    ['newport beach', 'America/Los_Angeles'],
    ['san francisco', 'America/Los_Angeles'],
    ['san ramon', 'America/Los_Angeles'],
    ['nsq', 'Australia/Sydney'],
    ['sydney', 'Australia/Sydney'],
    ['melbourne', 'Australia/Melbourne'],
    ['perth', 'Australia/Perth'],
];

const COUNTRY_DEFAULT_TIME_ZONES: Array<[string, string]> = [
    ['germany', 'Europe/Berlin'],
    ['france', 'Europe/Paris'],
    ['spain', 'Europe/Madrid'],
    ['italy', 'Europe/Rome'],
    ['austria', 'Europe/Vienna'],
    ['sweden', 'Europe/Stockholm'],
    ['belgium', 'Europe/Brussels'],
    ['netherlands', 'Europe/Amsterdam'],
    ['denmark', 'Europe/Copenhagen'],
    ['norway', 'Europe/Oslo'],
    ['switzerland', 'Europe/Zurich'],
    ['portugal', 'Europe/Lisbon'],
    ['united kingdom', 'Europe/London'],
    ['ireland', 'Europe/Dublin'],
    ['greece', 'Europe/Athens'],
    ['finland', 'Europe/Helsinki'],
    ['turkey', 'Europe/Istanbul'],
    ['turkiye', 'Europe/Istanbul'],
    ['egypt', 'Africa/Cairo'],
    ['south africa', 'Africa/Johannesburg'],
    ['kenya', 'Africa/Nairobi'],
    ['uae', 'Asia/Dubai'],
    ['united arab emirates', 'Asia/Dubai'],
    ['qatar', 'Asia/Qatar'],
    ['bahrain', 'Asia/Bahrain'],
    ['bahrein', 'Asia/Bahrain'],
    ['kingdom of saudi arabia', 'Asia/Riyadh'],
    ['saudi arabia', 'Asia/Riyadh'],
    ['india', 'Asia/Kolkata'],
    ['singapore', 'Asia/Singapore'],
    ['china', 'Asia/Shanghai'],
    ['malaysia', 'Asia/Kuala_Lumpur'],
    ['philippines', 'Asia/Manila'],
    ['indonesia', 'Asia/Jakarta'],
    ['japan', 'Asia/Tokyo'],
    ['south korea', 'Asia/Seoul'],
    ['australia', 'Australia/Sydney'],
    ['new zealand', 'Pacific/Auckland'],
    ['mexico', 'America/Mexico_City'],
    ['colombia', 'America/Bogota'],
    ['peru', 'America/Lima'],
    ['perú', 'America/Lima'],
    ['brazil', 'America/Sao_Paulo'],
    ['canada', 'America/Toronto'],
    ['united states', 'America/New_York'],
    ['usa', 'America/New_York'],
    ['us', 'America/New_York'],
];

const resolveCountryLikeTimeZone = (value: string): string | null => {
    if (!value) return null;

    for (const [needle, timeZone] of COUNTRY_DEFAULT_TIME_ZONES) {
        if (value === needle || value.endsWith(` ${needle}`) || value.includes(`- ${needle}`) || value.includes(`/${needle}`)) {
            return timeZone;
        }
    }

    return null;
};

const resolveTimeZone = (office?: string, country?: string): string => {
    const normalizedOffice = normalizeLocation(office);
    const normalizedCountry = normalizeLocation(country);

    for (const [needle, timeZone] of OFFICE_TIME_ZONES) {
        if (normalizedOffice.includes(needle)) return timeZone;
    }

    const officeCountryLike = resolveCountryLikeTimeZone(normalizedOffice);
    if (officeCountryLike) return officeCountryLike;

    for (const [needle, timeZone] of COUNTRY_DEFAULT_TIME_ZONES) {
        if (normalizedCountry.includes(needle)) return timeZone;
    }

    return 'UTC';
};

const MONTH_MAP: Record<string, string> = { 'January': '01', 'February': '02', 'March': '03', 'April': '04', 'May': '05', 'June': '06', 'July': '07', 'August': '08', 'September': '09', 'October': '10', 'November': '11', 'December': '12' };

export const parseSessionDate = (dateStr: string): Date => {
    // Safely parse "Tuesday, April 14, 2026" formats to standard ISO string to ensure correct cross-browser parsing
    const match = dateStr.match(/,\s*([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);
    if (match) {
        const month = MONTH_MAP[match[1]];
        const day = match[2].padStart(2, '0');
        const year = match[3];
        if (month) {
            return new Date(`${year}-${month}-${day}T12:00:00Z`);
        }
    }
    
    return new Date(`${dateStr} 12:00:00 UTC`);
};

const getReferenceDate = (referenceDate?: Date | string): Date => {
    if (!referenceDate) return PROGRAM_REFERENCE_DATE;
    if (referenceDate instanceof Date) return referenceDate;
    
    const parsed = parseSessionDate(referenceDate);
    return isNaN(parsed.getTime()) ? PROGRAM_REFERENCE_DATE : parsed;
};

const parseOffsetFromParts = (timeZone: string, date: Date): number => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(date);

    const label = parts.find(part => part.type === 'timeZoneName')?.value || 'GMT';
    if (label === 'GMT' || label === 'UTC') return 0;

    const match = label.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
    if (!match) return 0;

    const hours = Number(match[1]);
    const minutes = Number(match[2] || '0');
    return hours >= 0 ? hours + (minutes / 60) : hours - (minutes / 60);
};

export const getTimeZoneForLocation = (office?: string, country?: string): string =>
    resolveTimeZone(office, country);

export const getUtcOffset = (country: string, office: string, referenceDate?: Date | string): number => {
    const timeZone = resolveTimeZone(office, country);
    return parseOffsetFromParts(timeZone, getReferenceDate(referenceDate));
};

export const getAvailableUtcHours = (student: StudentRecord, startHourLocal: number, endHourLocal: number): number[] => {
    const offset = student._utcOffset ?? 0;
    const availableHours: number[] = [];

    for (let localHour = startHourLocal; localHour < endHourLocal; localHour++) {
        let utcHour = localHour - offset;

        if (utcHour < 0) utcHour += 24;
        if (utcHour >= 24) utcHour -= 24;

        availableHours.push(utcHour);
    }
    return availableHours;
};

export const getKnownUtcOffset = (
    office: string | undefined,
    referenceDate?: Date | string,
    country?: string
): number => {
    const timeZone = resolveTimeZone(office, country);
    return parseOffsetFromParts(timeZone, getReferenceDate(referenceDate));
};

export const extractScheduleKey = (scheduleStr: string): string =>
    scheduleStr.replace(/ \(\d{1,2}:\d{2} UTC\)/, '').trim();

export const makeSessionInstanceOverrideKey = (
    solutionArea: string,
    scheduleStr: string,
    sessionId: SmeSessionId
): string => `${solutionArea}__${extractScheduleKey(scheduleStr)}__${sessionId}`;

export const wrapUtcHour = (hour: number): number => ((hour % 24) + 24) % 24;

export const getEffectiveScheduleUtcHour = (
    scheduleStr: string,
    overrides: Record<string, number> = {}
): number => {
    const key = extractScheduleKey(scheduleStr);
    if (key in overrides) return overrides[key];
    const match = scheduleStr.match(/(\d{1,2}):(\d{2}) UTC/);
    if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        return h + (m / 60);
    }
    return 0;
};

export const getEffectiveSessionUtcHour = (
    solutionArea: string,
    scheduleStr: string,
    sessionId: SmeSessionId,
    sessionOverrides: Record<string, number> = {},
    scheduleOverrides: Record<string, number> = {}
): number => {
    const key = makeSessionInstanceOverrideKey(solutionArea, scheduleStr, sessionId);
    if (key in sessionOverrides) return sessionOverrides[key];
    return getEffectiveScheduleUtcHour(scheduleStr, scheduleOverrides);
};

export const formatUtcHourLabel = (utcHour: number): string => {
    const totalMinutes = Math.round(wrapUtcHour(utcHour) * 60);
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const m = (totalMinutes % 60).toString().padStart(2, '0');
    return `${h}:${m} UTC`;
};

export const formatEffectiveSessionSchedule = (
    solutionArea: string,
    scheduleStr: string,
    sessionId: SmeSessionId,
    sessionOverrides: Record<string, number> = {},
    scheduleOverrides: Record<string, number> = {}
): string => {
    const effectiveHour = getEffectiveSessionUtcHour(solutionArea, scheduleStr, sessionId, sessionOverrides, scheduleOverrides);
    return scheduleStr.replace(/\(\d{1,2}:\d{2} UTC\)/, `(${formatUtcHourLabel(effectiveHour)})`);
};

export const formatEffectiveSchedule = (
    scheduleStr: string,
    overrides: Record<string, number> = {}
): string => {
    const effectiveHour = getEffectiveScheduleUtcHour(scheduleStr, overrides);
    return scheduleStr.replace(/\(\d{1,2}:\d{2} UTC\)/, `(${formatUtcHourLabel(effectiveHour)})`);
};

export const getLocalTimeStr = (
    scheduleStr: string,
    assignedPersonOffice: string | undefined,
    overrides: Record<string, number> = {},
    referenceDate?: Date | string,
    country?: string
): string => {
    if (!assignedPersonOffice) return '';

    const utcHour = getEffectiveScheduleUtcHour(scheduleStr, overrides);
    return getLocalTimeForUtcHour(utcHour, assignedPersonOffice, referenceDate, country);
};

export const getLocalTimeForUtcHour = (
    utcHour: number,
    assignedPersonOffice: string | undefined,
    referenceDate?: Date | string,
    country?: string
): string => {
    if (!assignedPersonOffice) return '';

    const offset = getKnownUtcOffset(assignedPersonOffice, referenceDate, country);
    let localHour = utcHour + offset;

    while (localHour < 0) localHour += 24;
    while (localHour >= 24) localHour -= 24;

    const totalMinutes = Math.round(localHour * 60);
    const h = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const m = (totalMinutes % 60).toString().padStart(2, '0');
    return `${h}:${m} Local`;
};
