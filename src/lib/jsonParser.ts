import type { StudentRecord } from './excelParser';
import type { SmeAssignments } from '../components/SMESchedule';
import type { FacultyAssignments } from '../components/FacultySchedule';
import { sessions as sessionDefs } from './smeMatcher';
import { calculateMetrics, type AllocationResult } from './allocationEngine';

export interface ParsedJsonSummary {
    records: StudentRecord[];
    manualSmeAssignments: SmeAssignments;
    manualFacultyAssignments: FacultyAssignments;
    sessionTimeOverrides: Record<string, number>;
    config: Record<string, unknown>;
    fakeResult: AllocationResult;
}

export const parseSummaryJson = async (file: File): Promise<ParsedJsonSummary> => {
    const text = await file.text();
    const data = JSON.parse(text);

    const records: StudentRecord[] = [];
    const manualSmeAssignments: SmeAssignments = {};
    const manualFacultyAssignments: FacultyAssignments = {};
    const sessionTimeOverrides: Record<string, number> = {};

    const userMap = new Map<string, StudentRecord>();
    let originalIndex = 0;

    if (!data.sessions || !Array.isArray(data.sessions)) {
        throw new Error("Invalid Summary JSON format");
    }

    data.sessions.forEach((session: Record<string, unknown>) => {
        const sa = session.solution_area as string;
        const scheduleFull = session.schedule as string;
        // The exported schedule string already contains the time, e.g., "BTM Session 1 (07:00 UTC)"
        // Re-extract the base key for overrides if necessary
        const scheduleKey = scheduleFull.replace(/ \(\d+:00 UTC\)/, '').trim();
        
        const utcHour = session.utc_hour as number;
        sessionTimeOverrides[scheduleKey] = utcHour;

        (session.attendees as Record<string, unknown>[]).forEach((att) => {
            const name = att.name as string;
            if (!userMap.has(name)) {
                const rec: StudentRecord = {
                    'Full Name': name,
                    'Country': att.country as string,
                    'Office': att.office as string,
                    '(AA) Secondary Specialization': att.specialization as string,
                    'Solution Weeks SA': sa,
                    Schedule: scheduleFull,
                    _utcOffset: att.utc_offset as number,
                    _originalIndex: originalIndex++,
                    VAT: 'Imported-JSON',
                    Role: att.specialization as string
                };
                userMap.set(name, rec);
                records.push(rec);
            }
        });

        const topicId = sessionDefs.find(s => s.title === session.session_topic)?.id;

        if (topicId) {
            if (session.sme) {
                if (!manualSmeAssignments[sa]) manualSmeAssignments[sa] = {};
                if (!manualSmeAssignments[sa][scheduleFull]) manualSmeAssignments[sa][scheduleFull] = {} as Record<import('../lib/smeMatcher').SessionId, import('../lib/smeMatcher').SME | null>;
                manualSmeAssignments[sa][scheduleFull][topicId as import('../lib/smeMatcher').SessionId] = session.sme as import('../lib/smeMatcher').SME;
            }

            if (session.faculty) {
                if (!manualFacultyAssignments[sa]) manualFacultyAssignments[sa] = {};
                if (!manualFacultyAssignments[sa][scheduleFull]) manualFacultyAssignments[sa][scheduleFull] = {} as Record<import('../lib/facultyMatcher').SessionId, import('../lib/facultyMatcher').Faculty | null>;
                manualFacultyAssignments[sa][scheduleFull][topicId as import('../lib/facultyMatcher').SessionId] = session.faculty as import('../lib/facultyMatcher').Faculty;
            }
        }
    });

    const metrics = calculateMetrics(records);

    const fakeResult: AllocationResult = {
        records,
        metrics,
        config: {
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
        }
    };

    return {
        records,
        manualSmeAssignments,
        manualFacultyAssignments,
        sessionTimeOverrides,
        config: data.config,
        fakeResult
    };
};
