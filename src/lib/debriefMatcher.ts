import facultyData from '../faculty-locations.json';
import { getKnownUtcOffset, getEffectiveScheduleUtcHour } from './timezones';
import type { StudentRecord } from './excelParser';

export interface DebriefFaculty {
    name: string;
    city: string;
    country: string;
}

export interface DebriefBatch {
    batchId: string;
    baseSchedules: string[]; // List of unique SME sessions inside this batch
    debriefStartUtcTime: string; // e.g., "09:45 UTC"
    debriefEndUtcTime: string; // e.g., "10:15 UTC"
    debriefStartUtcDecimal: number;
    associates: StudentRecord[];
    assignedFaculty: DebriefFaculty | null;
}

/** Parse the UTC hour from a schedule string, applying any override. */
const parseScheduleToUtcHour = (schedule: string, overrides: Record<string, number> = {}): number | null => {
    const effective = getEffectiveScheduleUtcHour(schedule, overrides);
    // getEffectiveScheduleUtcHour returns 0 as fallback; only treat as null if the schedule has no time at all
    const match = schedule.match(/(\d+):00 UTC/);
    if (!match && !(Object.keys(overrides).some(k => schedule.startsWith(k)))) return null;
    return effective;
};

const formatTimeFromDecimal = (decimalHour: number): string => {
    let normalized = decimalHour % 24;
    if (normalized < 0) normalized += 24;
    const h = Math.floor(normalized);
    const m = Math.round((normalized - h) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} UTC`;
};

const isWithinWorkingHours = (utcDecimal: number, durationHours: number, city: string, startHour: number, endHour: number): boolean => {
    const localStart = (utcDecimal + getKnownUtcOffset(city) + 24) % 24;
    const localEnd = localStart + durationHours;
    return localStart >= startHour && localEnd <= endHour;
};

export const autoAssignDebriefs = (
    records: StudentRecord[],
    startHour: number = 0,
    endHour: number = 24,
    sessionLengthMins: number = 90,
    sessionTimeOverrides: Record<string, number> = {}
): DebriefBatch[] => {
    const allFaculty: DebriefFaculty[] = facultyData.faculty_locations.map(f => ({
        name: f["Faculty Name"],
        city: f["City Location"],
        country: f["Country Location"]
    }));

    const eligibleAssociates = records
        .filter(r => r.Schedule && r.Schedule !== 'Outlier-Schedule' && r.Schedule !== 'Unassigned')
        .map(r => {
            const utcHour = parseScheduleToUtcHour(r.Schedule!, sessionTimeOverrides);
            const minDebrief = utcHour !== null ? utcHour + (sessionLengthMins / 60) + 0.25 : null;
            return { record: r, minDebrief };
        })
        .filter(x => x.minDebrief !== null) as { record: StudentRecord, minDebrief: number }[];

    // Group by base session time (minDebrief)
    const poolsMap = new Map<number, StudentRecord[]>();
    for (const ea of eligibleAssociates) {
        if (!poolsMap.has(ea.minDebrief)) poolsMap.set(ea.minDebrief, []);
        poolsMap.get(ea.minDebrief)!.push(ea.record);
    }

    const sortedPoolTimes = Array.from(poolsMap.keys()).sort((a, b) => a - b);
    const debriefBatches: DebriefBatch[] = [];
    let unassignedFaculty = [...allFaculty];

    for (const poolTime of sortedPoolTimes) {
        const associatesInPool = poolsMap.get(poolTime)!;
        // Sort associates by timezone offset (East to West) descending to keep similar regions together
        associatesInPool.sort((a, b) => (b._utcOffset || 0) - (a._utcOffset || 0));

        const numBatches = Math.ceil(associatesInPool.length / 20);
        if (numBatches === 0) continue;

        const baseSize = Math.floor(associatesInPool.length / numBatches);
        let remainder = associatesInPool.length % numBatches;

        let start = 0;
        for (let i = 0; i < numBatches; i++) {
            const size = baseSize + (remainder > 0 ? 1 : 0);
            remainder--;

            const batchAssociates = associatesInPool.slice(start, start + size);
            start += size;

            const minRequiredTime = poolTime;
            const avgOffset = batchAssociates.reduce((sum, r) => sum + (r._utcOffset || 0), 0) / batchAssociates.length;

            let assignedFaculty: DebriefFaculty | null = null;
            let finalStartDecimal = minRequiredTime;

            if (unassignedFaculty.length > 0) {
                for (let t = minRequiredTime; t < minRequiredTime + 12; t += 0.25) {
                    const candidates = unassignedFaculty.filter(f =>
                        isWithinWorkingHours(t, 0.5, f.city, startHour, endHour)
                    );

                    if (candidates.length > 0) {
                        // Scoring function: Middle East/Asia (>= 2) maps to Europe/Asia (>= 0). Western/UK (< 2) maps to US (< 0).
                        const isBatchEastern = avgOffset >= 2;

                        candidates.sort((a, b) => {
                            const aOffset = getKnownUtcOffset(a.city);
                            const bOffset = getKnownUtcOffset(b.city);

                            const scoreCandidate = (fOffset: number) => {
                                const isFacultyEastern = fOffset >= 0;
                                let alignmentScore = 0;
                                if (isBatchEastern && isFacultyEastern) alignmentScore += 100;
                                if (!isBatchEastern && !isFacultyEastern) alignmentScore += 100;
                                const idealOffset = isBatchEastern ? 1 : -8; // Europe vs US-West
                                const proximity = -Math.abs(fOffset - idealOffset);
                                return alignmentScore + proximity;
                            };

                            return scoreCandidate(bOffset) - scoreCandidate(aOffset);
                        });

                        assignedFaculty = candidates[0];
                        finalStartDecimal = t;
                        break;
                    }
                }

                if (assignedFaculty) {
                    unassignedFaculty = unassignedFaculty.filter(f => f.name !== assignedFaculty!.name);
                } else {
                    finalStartDecimal = minRequiredTime;
                }
            } else {
                finalStartDecimal = minRequiredTime;
            }

            const uniqueSchedules = Array.from(new Set(batchAssociates.map(r => {
                const parts = r.Schedule!.split(' (');
                return parts[0];
            }))).sort();

            debriefBatches.push({
                batchId: `Mixed-Batch-${debriefBatches.length + 1}`,
                baseSchedules: uniqueSchedules,
                debriefStartUtcTime: formatTimeFromDecimal(finalStartDecimal),
                debriefEndUtcTime: formatTimeFromDecimal(finalStartDecimal + 0.5),
                debriefStartUtcDecimal: finalStartDecimal,
                associates: batchAssociates,
                assignedFaculty
            });
        }
    }

    return debriefBatches;
};

