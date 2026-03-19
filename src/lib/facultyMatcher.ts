import facultyData from '../solution-weeks-faculty-coverage.json';
import { getKnownUtcOffset } from './timezones';

export interface Faculty {
    name: string;
    office: string;
    sa: string;
}

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
    return (facultyData.solution_weeks_faculty_coverage as Faculty[]).filter((fac) => {
        return fac.sa.toLowerCase() === solutionArea.toLowerCase();
    });
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
