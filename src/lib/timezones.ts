import type { StudentRecord } from './excelParser';

export const getUtcOffset = (country: string, office: string): number => {
    const normalizedCountry = (country || '').toLowerCase().trim();
    const normalizedOffice = (office || '').toLowerCase().trim();

    // Americas
    const isUSA = normalizedCountry === 'usa' || normalizedCountry === 'us' || normalizedCountry === 'united states' || normalizedCountry === 'united states of america';
    if (isUSA) {
        if (normalizedOffice.includes('new york') || normalizedOffice.includes('east') || normalizedOffice.includes('atlanta')) return -5;
        if (normalizedOffice.includes('california') || normalizedOffice.includes('west') || normalizedOffice.includes('palo alto')) return -8;
        if (normalizedOffice.includes('chicago') || normalizedOffice.includes('central')) return -6;
        return -5; // Default EST
    }
    if (normalizedCountry.includes('canada')) {
        if (normalizedOffice.includes('vancouver')) return -8;
        return -5;
    }

    if (normalizedCountry.includes('brazil')) return -3;
    if (normalizedCountry.includes('mexico')) return -6;
    if (normalizedCountry.includes('colombia')) return -5;
    if (normalizedCountry.includes('argentina')) return -3;
    if (normalizedCountry.includes('chile')) return -4;

    // EMEA
    if (
        normalizedCountry === 'switzerland' || 
        normalizedCountry === 'ch' || 
        normalizedCountry === 'che' ||
        normalizedCountry.includes('germany') || 
        normalizedCountry.includes('france') || 
        normalizedCountry.includes('spain') || 
        normalizedCountry.includes('italy') ||
        normalizedCountry.includes('austria') ||
        normalizedCountry.includes('sweden')
    ) return 1;
    if (normalizedCountry.includes('egypt')) return 2;
    if (normalizedCountry.includes('turkey') || normalizedCountry.includes('turkiye')) return 3;
    if (normalizedCountry.includes('indonesia')) return 7;
    if (normalizedCountry.includes('uk') || normalizedCountry.includes('united kingdom') || normalizedCountry.includes('ireland')) return 0;
    if (normalizedCountry.includes('south africa')) return 2;
    if (normalizedCountry.includes('uae') || normalizedCountry.includes('united arab emirates')) return 4;
    if (normalizedCountry.includes('saudi arabia')) return 3;

    // APJ
    if (normalizedCountry.includes('india')) return 5.5;
    if (normalizedCountry.includes('singapore') || normalizedCountry.includes('china') || normalizedCountry.includes('malaysia') || normalizedCountry.includes('philippines')) return 8;
    if (normalizedCountry.includes('japan') || normalizedCountry.includes('korea')) return 9;
    if (normalizedCountry.includes('australia')) {
        if (normalizedOffice.includes('perth')) return 8;
        return 10; // Default AEST
    }
    if (normalizedCountry.includes('new zealand')) return 12;

    return 0; // Default UTC fallback
}

export const getAvailableUtcHours = (student: StudentRecord, startHourLocal: number, endHourLocal: number): number[] => {
    const offset = student._utcOffset ?? 0;
    const availableHours: number[] = [];

    for (let localHour = startHourLocal; localHour < endHourLocal; localHour++) {
        // UTC = Local - Offset
        let utcHour = localHour - offset;

        if (utcHour < 0) utcHour += 24;
        if (utcHour >= 24) utcHour -= 24;

        // We store the hour as an integer 0-23
        availableHours.push(Math.floor(utcHour));
    }
    return availableHours;
}

export const getKnownUtcOffset = (office: string | undefined): number => {
    if (!office) return 0;
    const o = office.toLowerCase();

    // Specific US Cities / States
    if (o.includes('san francisco') || o.includes('palo alto') || o.includes('california') || o.includes('west')) return -8;
    if (o.includes('denver') || o.includes('mountain')) return -7;
    if (o.includes('chicago') || o.includes('central')) return -6;
    if (o.includes('new york') || o.includes('atlanta') || o.includes('east') || o.includes('toronto') || o.includes('canada')) return -5;

    // Broad Regions for Americas
    if (o.includes('amer - us') || o.includes('us') || o.includes('usa')) return -5; // Default East
    if (o.includes('mexico')) return -6;
    if (o.includes('sao paulo') || o.includes('brazil') || o.includes('argentina')) return -3;
    if (o.includes('colombia')) return -5;

    // EMEA / MEE
    if (o.includes('london') || o.includes('ireland') || o.includes('uk')) return 0;
    if (o.includes('amsterdam') || o.includes('netherlands') || o.includes('barcelona') || o.includes('frankfurt') || o.includes('germany') || o.includes('france') || o.includes('spain') || o.includes('italy') || o.includes('switzerland') || o.includes('oslo') || o.includes('denmark') || o.includes('madrid') || o.includes('emea') || o.includes('mee') || o.includes('austria') || o.includes('vienna') || o.includes('sweden') || o.includes('stockholm')) return 1;
    if (o.includes('south africa') || o.includes('greece') || o.includes('finland') || o.includes('israel') || o.includes('egypt') || o.includes('cairo')) return 2;
    if (o.includes('turkey') || o.includes('turkiye') || o.includes('istanbul') || o.includes('ankara')) return 3;
    if (o.includes('dubai') || o.includes('uae')) return 4;

    // APJ
    if (o.includes('india') || o.includes('mumbai') || o.includes('delhi')) return 5.5;
    if (o.includes('singapore') || o.includes('manila') || o.includes('perth') || o.includes('china') || o.includes('philippines') || o.includes('malaysia')) return 8;
    if (o.includes('indonesia') || o.includes('jakarta')) return 7;
    if (o.includes('tokyo') || o.includes('seoul') || o.includes('korea') || o.includes('japan')) return 9;
    if (o.includes('sydney') || o.includes('melbourne') || o.includes('australia')) return 10;
    if (o.includes('nz') || o.includes('new zealand')) return 12;

    return 0; // Default
};

/** Extract a stable key from a schedule string (strips the time part). */
export const extractScheduleKey = (scheduleStr: string): string =>
    scheduleStr.replace(/ \(\d+:00 UTC\)/, '').trim();

/**
 * Resolve the effective UTC hour for a schedule string, applying an override if one exists.
 * @param scheduleStr  Full schedule string, e.g. "Cloud ERP Session 1 (14:00 UTC)"
 * @param overrides    Map of scheduleKey -> overridden UTC hour
 */
export const getEffectiveScheduleUtcHour = (
    scheduleStr: string,
    overrides: Record<string, number> = {}
): number => {
    const key = extractScheduleKey(scheduleStr);
    if (key in overrides) return overrides[key];
    const match = scheduleStr.match(/(\d+):00 UTC/);
    return match ? parseInt(match[1], 10) : 0;
};

/**
 * Update the schedule string with the effective overridden UTC hour if one exists.
 * e.g., "Cloud ERP Session 1 (08:00 UTC)" -> "Cloud ERP Session 1 (10:00 UTC)"
 */
export const formatEffectiveSchedule = (
    scheduleStr: string,
    overrides: Record<string, number> = {}
): string => {
    const effectiveHour = getEffectiveScheduleUtcHour(scheduleStr, overrides);
    return scheduleStr.replace(/\(\d+:00 UTC\)/, `(${effectiveHour.toString().padStart(2, '0')}:00 UTC)`);
};

export const getLocalTimeStr = (
    scheduleStr: string,
    assignedPersonOffice: string | undefined,
    overrides: Record<string, number> = {}
): string => {
    if (!assignedPersonOffice) return '';

    const utcHour = getEffectiveScheduleUtcHour(scheduleStr, overrides);
    const offset = getKnownUtcOffset(assignedPersonOffice);
    let localHour = utcHour + offset;

    if (localHour < 0) localHour += 24;
    if (localHour >= 24) localHour -= 24;

    const isHalf = localHour % 1 > 0;
    const h = Math.floor(localHour).toString().padStart(2, '0');
    const m = isHalf ? '30' : '00';
    return `${h}:${m} Local`;
};
