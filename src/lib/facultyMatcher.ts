import facultyData from '../solution-weeks-faculty-coverage.json';
import { getKnownUtcOffset } from './timezones';

export interface Faculty {
    name: string;
    office: string;
    sa: string;
    email?: string;
}

const normalizeText = (value: string): string =>
    value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();

const FACULTY_EMAIL_BY_ALIAS: Record<string, string> = {
    'amy': 'amy.hawkins@sap.com',
    'amy hawkins': 'amy.hawkins@sap.com',
    'carlos': 'carlos.edgar.moreno@sap.com',
    'carlos moreno': 'carlos.edgar.moreno@sap.com',
    'daron': 'daron.smith@sap.com',
    'daron smith': 'daron.smith@sap.com',
    'david': 'david.uichanco@sap.com',
    'david uichanco': 'david.uichanco@sap.com',
    'fernando': 'fernando.sanchez@sap.com',
    'fernando sanchez': 'fernando.sanchez@sap.com',
    'godfrey': 'godfrey.leung@sap.com',
    'godfrey leung': 'godfrey.leung@sap.com',
    'hanna': 'hanna.kielland.aalen@sap.com',
    'hanna kielland aalen': 'hanna.kielland.aalen@sap.com',
    'jessica': 'jessica.zhang@sap.com',
    'jessica zhang': 'jessica.zhang@sap.com',
    'juan': 'juan.gonzalez02@sap.com',
    'juan antonio gonzalez': 'juan.gonzalez02@sap.com',
    'nelly': 'nelly.rebollo@sap.com',
    'nelly rebollo': 'nelly.rebollo@sap.com',
    'nick': 'nicholas.goffi@sap.com',
    'nicholas goffi': 'nicholas.goffi@sap.com',
    'pau': 'pau.pujol-xicoy@sap.com',
    'pau pujol-xicoy': 'pau.pujol-xicoy@sap.com',
    'sandra': 'sandra.bissels@sap.com',
    'sandra bissels': 'sandra.bissels@sap.com',
    'selene': 'selene.hernandez@sap.com',
    'selene hernandez': 'selene.hernandez@sap.com',
};

const getFacultyEmail = (faculty: Pick<Faculty, 'name' | 'office'>): string | undefined => {
    const fullKey = normalizeText(`${faculty.name}|${faculty.office}`);
    const nameKey = normalizeText(faculty.name);

    const byOfficeAlias: Record<string, string> = {
        [normalizeText('amy|perth')]: 'amy.hawkins@sap.com',
        [normalizeText('carlos|frankfurt')]: 'carlos.edgar.moreno@sap.com',
        [normalizeText('daron|san francisco')]: 'daron.smith@sap.com',
        [normalizeText('david|san francisco')]: 'david.uichanco@sap.com',
        [normalizeText('fernando|san francisco')]: 'fernando.sanchez@sap.com',
        [normalizeText('godfrey|san francisco')]: 'godfrey.leung@sap.com',
        [normalizeText('hanna|oslo')]: 'hanna.kielland.aalen@sap.com',
        [normalizeText('jessica|san francisco')]: 'jessica.zhang@sap.com',
        [normalizeText('juan|madrid')]: 'juan.gonzalez02@sap.com',
        [normalizeText('nelly|mexico df')]: 'nelly.rebollo@sap.com',
        [normalizeText('nick|atlanta')]: 'nicholas.goffi@sap.com',
        [normalizeText('pau|barcelona')]: 'pau.pujol-xicoy@sap.com',
        [normalizeText('sandra|amsterdam')]: 'sandra.bissels@sap.com',
        [normalizeText('selene|barcelona')]: 'selene.hernandez@sap.com',
    };

    return byOfficeAlias[fullKey] || FACULTY_EMAIL_BY_ALIAS[nameKey];
};

export const sessions = [
    { id: 'overview', title: 'Overview', onlineSessionDay: 'Week 1 - Day 3', date: 'Wednesday, April 15, 2026' },
    { id: 'process_mapping', title: 'Process Mapping', onlineSessionDay: 'Week 1 - Day 4', date: 'Thursday, April 16, 2026' },
    { id: 'industry_relevance', title: 'Industry Relevance', onlineSessionDay: 'Week 2 - Day 1', date: 'Monday, April 20, 2026' },
    { id: 'ai_strategy', title: 'AI Strategy', onlineSessionDay: 'Week 2 - Day 2', date: 'Tuesday, April 21, 2026' },
    { id: 'competitive_defense', title: 'Competitive Defense', onlineSessionDay: 'Week 2 - Day 3', date: 'Wednesday, April 22, 2026' },
    { id: 'adoption_risk', title: 'Adoption Risk', onlineSessionDay: 'Week 2 - Day 4', date: 'Thursday, April 23, 2026' },
] as const;

export type SessionId = typeof sessions[number]['id'];

export const getEligibleFaculty = (solutionArea: string): Faculty[] => {
    return (facultyData.solution_weeks_faculty_coverage as Faculty[])
        .filter((fac) => {
            return fac.sa.toLowerCase() === solutionArea.toLowerCase();
        })
        .map((fac) => ({
            ...fac,
            email: fac.email || getFacultyEmail(fac),
        }));
};

const getDistance = (localHour: number, startHour: number, endHour: number) => {
    if (localHour >= startHour && localHour < endHour) return 0;
    let distToStart = startHour - localHour;
    if (distToStart < 0) distToStart += 24;
    let distToEnd = localHour - (endHour - 1);
    if (distToEnd < 0) distToEnd += 24;
    return Math.min(distToStart, distToEnd);
};

export const autoAssignFaculty = (solutionArea: string, schedules: string[], startHour: number = 0, endHour: number = 24): Record<string, Record<SessionId, Faculty | null>> => {
    const assignments: Record<string, Record<SessionId, Faculty | null>> = {};
    const eligibleFaculty = getEligibleFaculty(solutionArea);
    const sortedSchedules = [...schedules].sort((a, b) => a.localeCompare(b));
    const assignedCounts: Record<string, number> = {};

    eligibleFaculty.forEach(f => assignedCounts[f.name] = 0);

    sortedSchedules.forEach(schedule => {
        assignments[schedule] = { ...sessions.reduce((acc, s) => ({ ...acc, [s.id]: null }), {} as Record<SessionId, Faculty | null>) };

        if (eligibleFaculty.length > 0) {
            const match = schedule.match(/(\d+):00 UTC/);
            const utcHour = match ? parseInt(match[1], 10) : 0;

            const sortedEligible = [...eligibleFaculty].sort((a, b) => {
                const aLocal = (utcHour + getKnownUtcOffset(a.office) + 24) % 24;
                const bLocal = (utcHour + getKnownUtcOffset(b.office) + 24) % 24;

                const penaltyA = getDistance(aLocal, startHour, endHour) + assignedCounts[a.name] * 12;
                const penaltyB = getDistance(bLocal, startHour, endHour) + assignedCounts[b.name] * 12;

                return penaltyA - penaltyB;
            });

            const assignedFaculty = sortedEligible[0];
            assignedCounts[assignedFaculty.name]++;

            sessions.forEach(session => {
                assignments[schedule][session.id] = assignedFaculty;
            });
        }
    });

    return assignments;
};
