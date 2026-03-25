import type { StudentRecord, EvaluatorRecord } from './excelParser';
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
    _facultyAssignments: any, // Unused as SA criteria is removed
    evaluationDate: Date,
    includeRAD: boolean
): EvaluationEngineOutput => {
    // 1. Reconstruct current VATs from student records
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

    // 2. Prepare Evaluators
    const eligibleEvaluators = evaluators.filter(e => {
        if (!includeRAD && e.Role === 'RAD') return false;
        return true;
    });

    const enrichedEvaluators = eligibleEvaluators.map(e => ({
        ...e,
        sas: [], // No SA restrictions
        utcOffset: getUtcOffset(e['Country Location'], e['City Location'], evaluationDate)
    }));

    const assignments: EvaluatorAssignmentResult[] = enrichedEvaluators.map(e => ({
        evaluator: e,
        assignedVats: [],
        sa: 'Generalist', // Simplified label as SA is no longer relevant
        utcOffset: e.utcOffset
    }));

    const unassignedVats: VatGroup[] = [];

    // 3. Global Round-Robin / Load Weighted Distribution
    // To ensure perfect "even distribution", we process in a round-robin way
    // or by always picking the currently least-busy valid evaluator.
    
    // Process VATs in a consistent alphabetical order
    const sortedVats = [...vats].sort((a,b) => a.name.localeCompare(b.name));

    sortedVats.forEach(vat => {
        // Find ALL evaluators within the 4-hour window (Criteria 1)
        const candidates = assignments.map(a => ({
            assignment: a,
            tzDiff: Math.abs(a.utcOffset - vat.utcOffset)
        })).filter(c => c.tzDiff <= 4);

        if (candidates.length === 0) {
            // Still unassigned if no one is in that 4 hour window
            unassignedVats.push(vat);
        } else {
            // Pick based on Criteria 2: Even distribution (Primary)
            // Tie-break with Timezone proximity (Secondary)
            candidates.sort((a, b) => {
                const countDiff = a.assignment.assignedVats.length - b.assignment.assignedVats.length;
                if (countDiff !== 0) return countDiff;
                return a.tzDiff - b.tzDiff;
            });

            candidates[0].assignment.assignedVats.push(vat);
        }
    });

    return {
        assignments: assignments.filter(a => a.assignedVats.length > 0),
        unassignedVats
    };
};
