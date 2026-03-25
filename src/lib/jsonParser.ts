import type { StudentRecord } from './excelParser';
import type { SmeAssignments, SmeConfirmationState } from '../components/SMESchedule';
import type { FacultyAssignments } from '../components/FacultySchedule';
import { sessions as sessionDefs } from './smeMatcher';
import { calculateMetrics, recalculateVATs, type AllocationResult } from './allocationEngine';
import type { SME, SessionId as SmeSessionId } from './smeMatcher';
import type { Faculty, SessionId as FacultySessionId } from './facultyMatcher';
import { extractScheduleKey, getUtcOffset, makeSessionInstanceOverrideKey } from './timezones';
import { FACULTY_LED_SME_LABEL, isFacultyOnlySession } from './sessionCatalog';

export interface ParsedJsonSummary {
    records: StudentRecord[];
    manualSmeAssignments: SmeAssignments;
    smeConfirmationState: SmeConfirmationState;
    manualFacultyAssignments: FacultyAssignments;
    sessionTimeOverrides: Record<string, number>;
    sessionInstanceTimeOverrides: Record<string, number>;
    config: Record<string, unknown>;
    fakeResult: AllocationResult;
}

export const parseEnrichedExcel = (records: StudentRecord[]): ParsedJsonSummary => {
    const manualSmeAssignments: SmeAssignments = {};
    const smeConfirmationState: SmeConfirmationState = {};
    const manualFacultyAssignments: FacultyAssignments = {};
    const sessionTimeOverrides: Record<string, number> = {};
    const sessionInstanceTimeOverrides: Record<string, number> = {};

    const getAssignedSA = (record: StudentRecord): string => {
        const legacy = (record as StudentRecord & { 'Solution Week SA'?: string })['Solution Week SA'];
        return record['Solution Weeks SA'] || legacy || '';
    };

    const parseAssignmentMap = (value?: string): Map<string, string> => {
        const map = new Map<string, string>();
        if (!value) return map;

        const parts = value.split('|').map(part => part.trim()).filter(Boolean);
        const structured = parts.every(part => part.includes(':'));
        if (!structured) {
            map.set('*', value.trim());
            return map;
        }

        parts.forEach(part => {
            const separatorIndex = part.indexOf(':');
            if (separatorIndex === -1) return;
            const topic = part.slice(0, separatorIndex).trim();
            const assignee = part.slice(separatorIndex + 1).trim();
            if (topic && assignee) map.set(topic, assignee);
        });

        return map;
    };

    const buildImportedSME = (name: string): SME => ({
        name,
        office_location: '',
        lob: '',
        introduction_to_business_case: false,
        role_and_account_dynamics: false,
        overview: false,
        process_mapping: false,
        industry_relevance: false,
        ai_strategy: false,
        competitive_defense: false,
        adoption_risk: false,
    });

    const buildImportedFaculty = (name: string, sa: string): Faculty => ({
        name,
        office: '',
        sa
    });

    records.forEach(rec => {
        rec._utcOffset = getUtcOffset(rec.Country, rec.Office);
        const sa = getAssignedSA(rec);
        const scheduleFull = rec.Schedule;
        if (!sa || !scheduleFull) return;

        const smeAssignments = parseAssignmentMap(rec['Asignacion de SMEs']);
        const facultyAssignments = parseAssignmentMap(rec['Asignacion de Faculty']);

        if (smeAssignments.size > 0 || facultyAssignments.size > 0) {
            sessionDefs.forEach(sessionDef => {
                const topicId = sessionDef.id;
                const smeName = smeAssignments.get(sessionDef.title) || smeAssignments.get('*');
                const facultyName = facultyAssignments.get(sessionDef.title) || facultyAssignments.get('*');

                if (smeName && !isFacultyOnlySession(topicId) && smeName !== FACULTY_LED_SME_LABEL) {
                    if (!manualSmeAssignments[sa]) manualSmeAssignments[sa] = {};
                    if (!manualSmeAssignments[sa][scheduleFull]) manualSmeAssignments[sa][scheduleFull] = {} as Record<SmeSessionId, SME | null>;
                    manualSmeAssignments[sa][scheduleFull][topicId as SmeSessionId] = buildImportedSME(smeName);
                }

                if (facultyName) {
                    if (!manualFacultyAssignments[sa]) manualFacultyAssignments[sa] = {};
                    if (!manualFacultyAssignments[sa][scheduleFull]) manualFacultyAssignments[sa][scheduleFull] = {} as Record<FacultySessionId, Faculty | null>;
                    manualFacultyAssignments[sa][scheduleFull][topicId as FacultySessionId] = buildImportedFaculty(facultyName, sa);
                }
            });
        }
    });

    const config = {
        startHour: 8,
        endHour: 18,
        assumptions: {
            minSessionSize: 10,
            maxSessionSize: 40,
            maxSessionsPerDay: 2,
            allowedVATSizes: [3, 4],
            sessionLength: 90,
            maxTimezoneDifference: 5,
            allowSingleRoleVat: false,
            facultyStartHour: 6,
        },
        rules: [],
        fsDistributions: [],
        aeDistributions: []
    };

    const vatsPresentCount = records.filter(r => r.VAT && r.VAT !== 'Unassigned' && r.VAT !== 'Imported-JSON').length;
    const isMainlyAssigned = vatsPresentCount > (records.length * 0.5);

    if (!isMainlyAssigned) {
        recalculateVATs(records, config.assumptions);
    }

    const metrics = calculateMetrics(records);

    const fakeResult: AllocationResult = {
        records,
        metrics,
        config
    };

    return {
        records,
        manualSmeAssignments,
        smeConfirmationState,
        manualFacultyAssignments,
        sessionTimeOverrides,
        sessionInstanceTimeOverrides,
        config: fakeResult.config,
        fakeResult
    };
};

export const parseSummaryJson = async (file: File): Promise<ParsedJsonSummary> => {
    const text = await file.text();
    const data = JSON.parse(text);

    const records: StudentRecord[] = [];
    const manualSmeAssignments: SmeAssignments = {};
    const smeConfirmationState: SmeConfirmationState = {};
    const manualFacultyAssignments: FacultyAssignments = {};
    const sessionTimeOverrides: Record<string, number> = isRecordNumberMap(data.config?.sessionTimeOverrides) ? data.config.sessionTimeOverrides : {};
    const sessionInstanceTimeOverrides: Record<string, number> = isRecordNumberMap(data.config?.sessionInstanceTimeOverrides) ? data.config.sessionInstanceTimeOverrides : {};

    const userMap = new Map<string, StudentRecord>();
    let originalIndex = 0;

    const normalizeSME = (value: Record<string, unknown>): SME => ({
        name: String(value.name ?? ''),
        lob: String(value.lob ?? ''),
        office_location: String(value.office_location ?? value.office ?? ''),
        introduction_to_business_case: false,
        role_and_account_dynamics: false,
        overview: false,
        process_mapping: false,
        industry_relevance: false,
        ai_strategy: false,
        competitive_defense: false,
        adoption_risk: false,
        email: value.email ? String(value.email) : undefined,
    });

    const normalizeFaculty = (value: Record<string, unknown>, sa: string): Faculty => ({
        name: String(value.name ?? ''),
        office: String(value.office ?? ''),
        sa: typeof value.sa === 'string' ? value.sa : sa,
        email: value.email ? String(value.email) : undefined,
    });

    if (!data.sessions || !Array.isArray(data.sessions)) {
        throw new Error("Invalid Summary JSON format");
    }

    data.sessions.forEach((session: Record<string, unknown>) => {
        const sa = session.solution_area as string;
        const scheduleFull = session.schedule as string;
        const scheduleKey = extractScheduleKey(scheduleFull);
        
        const utcHour = session.utc_hour as number;

        (session.attendees as Record<string, unknown>[]).forEach((att) => {
            const name = att.name as string;
            if (!userMap.has(name)) {
                const program = typeof att.program === 'string'
                    ? att.program
                    : (typeof att.Program === 'string' ? att.Program : undefined);
                const rec: StudentRecord = {
                    'Full Name': name,
                    'Country': att.country as string,
                    'Office': att.office as string,
                    'Email': att.email as string | undefined,
                    '(AA) Secondary Specialization': att.specialization as string,
                    'Solution Weeks SA': sa,
                    Schedule: scheduleFull,
                    _utcOffset: getUtcOffset(att.country as string, att.office as string),
                    _originalIndex: originalIndex++,
                    Program: program,
                    VAT: (att.vat as string) || 'Imported-JSON',
                    Role: att.specialization as string
                };
                userMap.set(name, rec);
                records.push(rec);
            }
        });

        const topicId = ((session.session_id as SmeSessionId | undefined) ?? sessionDefs.find(s => s.title === session.session_topic)?.id);

        if (topicId) {
            sessionInstanceTimeOverrides[makeSessionInstanceOverrideKey(sa, scheduleFull, topicId)] = utcHour;
            if (session.sme && !isFacultyOnlySession(topicId)) {
                const rawSme = session.sme as Record<string, unknown>;
                if (String(rawSme.name ?? '') !== FACULTY_LED_SME_LABEL) {
                if (!manualSmeAssignments[sa]) manualSmeAssignments[sa] = {};
                if (!manualSmeAssignments[sa][scheduleFull]) manualSmeAssignments[sa][scheduleFull] = {} as Record<SmeSessionId, SME | null>;
                manualSmeAssignments[sa][scheduleFull][topicId as SmeSessionId] = normalizeSME(rawSme);
                }
            }

            if (session.faculty) {
                if (!manualFacultyAssignments[sa]) manualFacultyAssignments[sa] = {};
                if (!manualFacultyAssignments[sa][scheduleFull]) manualFacultyAssignments[sa][scheduleFull] = {} as Record<FacultySessionId, Faculty | null>;
                manualFacultyAssignments[sa][scheduleFull][topicId as FacultySessionId] = normalizeFaculty(session.faculty as Record<string, unknown>, sa);
            }
        } else {
            sessionTimeOverrides[scheduleKey] = utcHour;
        }
    });

    const config = {
        startHour: data.config?.startHour || 8,
        endHour: data.config?.endHour || 18,
        assumptions: {
            minSessionSize: 10,
            maxSessionSize: 40,
            maxSessionsPerDay: 2,
            allowedVATSizes: [3, 4],
            sessionLength: 90,
            maxTimezoneDifference: 5,
            allowSingleRoleVat: false,
            facultyStartHour: 6,
        },
        rules: [],
        fsDistributions: [],
        aeDistributions: []
    };

    const vatsPresent = records.filter(r => r.VAT && r.VAT !== 'Unassigned' && r.VAT !== 'Imported-JSON').length;
    const isMainlyAssigned = vatsPresent > (records.length * 0.5); // Use heuristic if more than half have VATs

    if (!isMainlyAssigned) {
        recalculateVATs(records, config.assumptions);
    }

    const metrics = calculateMetrics(records);

    const fakeResult: AllocationResult = {
        records,
        metrics,
        config
    };

    return {
        records,
        manualSmeAssignments,
        smeConfirmationState,
        manualFacultyAssignments,
        sessionTimeOverrides,
        sessionInstanceTimeOverrides,
        config: data.config,
        fakeResult
    };
};

const isRecordNumberMap = (value: unknown): value is Record<string, number> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.values(value).every(item => typeof item === 'number');
};
