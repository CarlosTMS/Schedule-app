import type { StudentRecord, EvaluatorRecord } from './excelParser';
import type { FacultyAssignments } from '../components/FacultySchedule';
import { getUtcOffset } from './timezones';

export interface EnrichedEvaluator extends EvaluatorRecord {
    sas: string[];
    utcOffset: number;
}

export interface EvaluatorAssignmentResult {
    evaluator: EnrichedEvaluator;
    assignedVats: VatGroup[];
    sa: string;
    utcOffset: number;
}

export interface VatGroup {
    name: string;
    sa: string;
    members: StudentRecord[];
    utcOffset: number; // Average offset
}

export interface EvaluationEngineOutput {
    assignments: EvaluatorAssignmentResult[];
    unassignedVats: VatGroup[];
}

export const assignEvaluators = (
    records: StudentRecord[],
    evaluators: EvaluatorRecord[],
    facultyAssignments: FacultyAssignments,
    evaluationDate: Date,
    includeRAD: boolean
): EvaluationEngineOutput => {
    // 1. Reconstruct existing VATs
    const vatMap = new Map<string, StudentRecord[]>();
    records.forEach(r => {
        if (!r.VAT || r.VAT === 'Unassigned' || r.VAT === 'Outlier-Size') return;
        const list = vatMap.get(r.VAT) || [];
        list.push(r);
        vatMap.set(r.VAT, list);
    });

    const vats: VatGroup[] = [];
    vatMap.forEach((members, name) => {
        const sa = members[0]['Solution Weeks SA'] || 'Unknown SA';
        const sumOffset = members.reduce((sum, m) => sum + getUtcOffset(m.Country, m.Office, evaluationDate), 0);
        const avgOffset = sumOffset / members.length;
        vats.push({ name, sa, members, utcOffset: avgOffset });
    });

    // 2. Filter Evaluators & Map to SAs
    const eligibleEvaluators = evaluators.filter(e => {
        if (!includeRAD && e.Role === 'RAD') return false;
        return true;
    });

    // Evaluator Name -> Set of SAs they are assigned to in Faculty Assignments
    const evaluatorSAMap = new Map<string, Set<string>>();
    Object.entries(facultyAssignments).forEach(([sa, schedules]) => {
        Object.values(schedules).forEach(topics => {
            Object.values(topics).forEach(faculty => {
                if (faculty && faculty.name) {
                    const name = faculty.name.trim();
                    if (!evaluatorSAMap.has(name)) evaluatorSAMap.set(name, new Set());
                    evaluatorSAMap.get(name)!.add(sa);
                }
            });
        });
    });

    const enrichedEvaluators = eligibleEvaluators.map(e => ({
        ...e,
        sas: Array.from(evaluatorSAMap.get(e['Faculty Name'].trim()) || []),
        utcOffset: getUtcOffset(e['Country Location'], e['City Location'], evaluationDate)
    }));

    const assignments: EvaluatorAssignmentResult[] = enrichedEvaluators.map(e => ({
        evaluator: e,
        assignedVats: [],
        sa: e.sas.join(', '), 
        utcOffset: e.utcOffset
    }));

    const unassignedVats: VatGroup[] = [];

    // 3. Assign VATs per SA
    // To ensure even distribution across SAs, we group VATs by SA first
    const vatsBySA = new Map<string, VatGroup[]>();
    vats.forEach(v => {
        const list = vatsBySA.get(v.sa) || [];
        list.push(v);
        vatsBySA.set(v.sa, list);
    });

    vatsBySA.forEach((saVats, sa) => {
        // Find evaluators that CAN evaluate this SA
        const saEvaluators = assignments.filter(a => a.evaluator.sas.includes(sa));
        
        saVats.forEach(vat => {
            if (saEvaluators.length === 0) {
                unassignedVats.push(vat);
                return;
            }

            // Find eligible evaluators within +/- 4 hrs tz diff
            const eligibleForVat = saEvaluators.map(e => ({
                e,
                diff: Math.abs(e.utcOffset - vat.utcOffset)
            })).filter(item => item.diff <= 4);

            if (eligibleForVat.length === 0) {
                unassignedVats.push(vat);
                return;
            }

            // Even distribution constraint: Pick the evaluator with the least VATs assigned across all SAs so far.
            // If there's a tie, pick the one with the smallest timezone diff.
            eligibleForVat.sort((a, b) => {
                const countDiff = a.e.assignedVats.length - b.e.assignedVats.length;
                if (countDiff !== 0) return countDiff;
                return a.diff - b.diff;
            });

            const chosen = eligibleForVat[0].e;
            chosen.assignedVats.push(vat);
        });
    });

    // Clean out evaluators who got 0 assignments and filter to valid
    return {
        assignments: assignments.filter(a => a.assignedVats.length > 0 || a.evaluator.sas.length > 0), // keep them if they have SAs but no assignments to show distribution? The prompt says "show how many VATs were non assigned", doesn't explicitly restrict empty evaluators. Let's keep them if they have an active SA.
        unassignedVats
    };
};
