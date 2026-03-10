import facultyData from '../solution-weeks-faculty-coverage.json';
import { getKnownUtcOffset } from './timezones';

export interface Faculty {
    name: string;
    office: string;
    sa: string;
}

export const sessions = [
    { id: 'overview', title: 'Overview' },
    { id: 'process_mapping', title: 'Process Mapping' },
    { id: 'industry_relevance', title: 'Industry Relevance' },
    { id: 'ai_strategy', title: 'AI Strategy' },
    { id: 'competitive_defense', title: 'Competitive Defense' },
    { id: 'adoption_risk', title: 'Adoption Risk' },
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
        assignments[schedule] = { ...sessions.reduce((acc, s) => ({ ...acc, [s.id]: null }), {} as any) };

        if (eligibleFaculty.length > 0) {
            const match = schedule.match(/(\d+):00 UTC/);
            const utcHour = match ? parseInt(match[1], 10) : 0;
            
            const sortedEligible = [...eligibleFaculty].sort((a,b) => {
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