import { getKnownUtcOffset } from './timezones';

export interface SME {
    name: string;
    lob: string;
    office_location: string;
    overview: boolean;
    process_mapping: boolean;
    industry_relevance: boolean;
    ai_strategy: boolean;
    competitive_defense: boolean;
    adoption_risk: boolean;
    open_to_additional_sessions?: boolean;
    email?: string;
    notes?: string[];
    last_edited_at?: string;
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

const SA_MAPPING: Record<string, string[]> = {
    'btm': ['business transformation management', 'btm'],
    'btp': ['business technology platform', 'btp'],
    'cx': ['customer experience', 'cx'],
    'hcm': ['human capital management', 'hcm'],
    'scm': ['supply chain management', 'scm'],
    'ocfo': ['office of the cfo', 'ocfo'],
    'data & ai': ['data & ai', 'data', 'bdc'],
    'finance and spend (f&s)': ['cloud erp', 'ocfo', 'procurement', 'finance'],
    'industry account executive (iae)': ['cloud erp', 'btp', 'data & ai', 'iae'],
};

export const getEligibleSMEs = (solutionArea: string, sessionId: SessionId, smeList: SME[]): SME[] => {
    const saLower = solutionArea.toLowerCase().trim();
    const allowedLobs = SA_MAPPING[saLower] || [saLower];

    return smeList.filter((sme) => {
        const smeLob = sme.lob.toLowerCase();

        // Match if the SME's LOB matches any of the allowed terms for this SA
        const lobMatches = allowedLobs.some(term =>
            smeLob.includes(term) || term.includes(smeLob)
        );

        const hasSkill = sme[sessionId as keyof SME] === true;
        return lobMatches && hasSkill;
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

export const autoAssignSMEs = (
    solutionArea: string,
    schedules: string[],
    startHour: number = 0,
    endHour: number = 24,
    smeList: SME[] = []
): Record<string, Record<SessionId, SME | null>> => {
    const assignments: Record<string, Record<SessionId, SME | null>> = {};
    const assignedCounts: Record<string, number> = {};

    schedules.forEach(schedule => {
        assignments[schedule] = sessions.reduce(
            (acc, s) => ({ ...acc, [s.id]: null }),
            {} as Record<SessionId, SME | null>
        );

        sessions.forEach(session => {
            const eligible = getEligibleSMEs(solutionArea, session.id, smeList);
            if (eligible.length > 0) {
                eligible.forEach(s => { if (assignedCounts[s.name] === undefined) assignedCounts[s.name] = 0; });

                const match = schedule.match(/(\d+):00 UTC/);
                const utcHour = match ? parseInt(match[1], 10) : 0;

                const sortedEligible = [...eligible].sort((a, b) => {
                    const aLocal = (utcHour + getKnownUtcOffset(a.office_location) + 24) % 24;
                    const bLocal = (utcHour + getKnownUtcOffset(b.office_location) + 24) % 24;

                    const penaltyA = getDistance(aLocal, startHour, endHour) + (assignedCounts[a.name] * 12);
                    const penaltyB = getDistance(bLocal, startHour, endHour) + (assignedCounts[b.name] * 12);

                    return penaltyA - penaltyB;
                });

                const chosen = sortedEligible[0];
                assignments[schedule][session.id] = chosen;
                assignedCounts[chosen.name]++;
            }
        });
    });

    return assignments;
};