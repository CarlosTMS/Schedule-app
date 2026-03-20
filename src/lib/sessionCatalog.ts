export type FacilitatorType = 'faculty_only' | 'sme_and_faculty';

export interface SessionDefinition {
    id: string;
    title: string;
    onlineSessionDay: string;
    date: string;
    facilitatorType: FacilitatorType;
    planningStatus: 'active' | 'disabled';
}

export const FACULTY_LED_SME_LABEL = 'Faculty Led Session';

export const sessions = [
    {
        id: 'introduction_to_business_case',
        title: 'Introduction to Business Case',
        onlineSessionDay: 'Week 1 - Day 1',
        date: 'Monday, April 13, 2026',
        facilitatorType: 'faculty_only',
        planningStatus: 'active',
    },
    {
        id: 'role_and_account_dynamics',
        title: 'Role and Account Dynamics',
        onlineSessionDay: 'Week 1 - Day 2',
        date: 'Tuesday, April 14, 2026',
        facilitatorType: 'faculty_only',
        planningStatus: 'active',
    },
    {
        id: 'overview',
        title: 'Overview',
        onlineSessionDay: 'Week 1 - Day 3',
        date: 'Wednesday, April 15, 2026',
        facilitatorType: 'sme_and_faculty',
        planningStatus: 'active',
    },
    {
        id: 'process_mapping',
        title: 'Process Mapping',
        onlineSessionDay: 'Week 1 - Day 4',
        date: 'Thursday, April 16, 2026',
        facilitatorType: 'sme_and_faculty',
        planningStatus: 'active',
    },
    {
        id: 'industry_relevance',
        title: 'Industry Relevance',
        onlineSessionDay: 'Week 2 - Day 1',
        date: 'Monday, April 20, 2026',
        facilitatorType: 'sme_and_faculty',
        planningStatus: 'active',
    },
    {
        id: 'ai_strategy',
        title: 'AI Strategy',
        onlineSessionDay: 'Week 2 - Day 2',
        date: 'Tuesday, April 21, 2026',
        facilitatorType: 'sme_and_faculty',
        planningStatus: 'active',
    },
    {
        id: 'competitive_defense',
        title: 'Competitive Defense',
        onlineSessionDay: 'Week 2 - Day 3',
        date: 'Wednesday, April 22, 2026',
        facilitatorType: 'sme_and_faculty',
        planningStatus: 'disabled',
    },
    {
        id: 'adoption_risk',
        title: 'Adoption Risk',
        onlineSessionDay: 'Week 2 - Day 4',
        date: 'Thursday, April 23, 2026',
        facilitatorType: 'sme_and_faculty',
        planningStatus: 'active',
    },
] as const satisfies readonly SessionDefinition[];

export type SessionId = typeof sessions[number]['id'];

const sessionById = new Map(sessions.map(session => [session.id, session]));

export const getSessionById = (sessionId: SessionId | string) =>
    sessionById.get(sessionId as SessionId);

export const isFacultyOnlySession = (sessionId: SessionId | string): boolean =>
    getSessionById(sessionId)?.facilitatorType === 'faculty_only';

export const isPlanningSessionActive = (sessionId: SessionId | string): boolean =>
    getSessionById(sessionId)?.planningStatus !== 'disabled';

export const activePlanningSessions = sessions.filter(session => session.planningStatus === 'active');
