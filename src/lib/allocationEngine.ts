import type { StudentRecord } from './excelParser';
import { getUtcOffset, getAvailableUtcHours } from './timezones';
import type { AllocationRule } from '../components/RuleBuilder';
import type { DistributionTarget } from '../components/Randomizer';
import type { Assumptions } from '../components/Configurator';

export interface AllocationResult {
    records: StudentRecord[];
    metrics: {
        totalStudents: number;
        assignedSuccess: number;
        outliersTotal: number;
        outliersSchedule: number;
        outliersVatSize: number;
        outliersDupeRole: number;
        perfectVats: number;
        imperfectVats: number;
    };
    config: {
        startHour: number;
        endHour: number;
        assumptions: Assumptions;
        rules: AllocationRule[];
        fsDistributions: DistributionTarget[];
        aeDistributions: DistributionTarget[];
    };
}

export const runAllocation = (
    rawRecords: StudentRecord[],
    startHour: number,
    endHour: number,
    rules: AllocationRule[],
    fsDistributions: DistributionTarget[],
    aeDistributions: DistributionTarget[],
    assumptions: Assumptions
): AllocationResult => {
    const records = [...rawRecords.map(r => ({ ...r }))];

    // Paso A: Convert properties and offsets
    records.forEach(r => {
        r._utcOffset = getUtcOffset(r.Country, r.Office);
    });

    // 1. Manual Rules
    records.forEach(r => {
        for (const rule of rules) {
            if (r[rule.field as keyof StudentRecord] === rule.value) {
                // When manual rules fire, they override everything into 'Solution Weeks SA'
                r['Solution Weeks SA'] = rule.targetSA;
                break;
            }
        }
    });

    // 2. Random Distribution
    const applyDistribution = (associates: StudentRecord[], dists: DistributionTarget[]) => {
        const total = associates.length;
        if (total === 0) return;

        // Group by role to ensure balanced VAT formation potential in each SA
        const byRole: Record<string, StudentRecord[]> = {};
        associates.forEach(r => {
            const spec = (r['(AA) Secondary Specialization'] || '').toLowerCase();
            let role = 'other';
            if (spec.includes('csm')) role = 'csm';
            else if (spec.includes('sa') || spec.includes('advisor') || spec.includes('solution advisor')) role = 'advisor';
            else if (spec.includes('sales')) role = 'sales';
            
            if (!byRole[role]) byRole[role] = [];
            byRole[role].push(r);
        });

        // Sort each role group by UTC offset to maximize session viability cluster
        Object.values(byRole).forEach(list => {
            list.sort((a, b) => (a._utcOffset || 0) - (b._utcOffset || 0));
        });

        // Determine targets for each SA
        const saTargets = dists.map(d => ({ sa: d.sa, target: Math.round((d.percentage / 100) * total), current: 0 }));
        const currentTotal = saTargets.reduce((sum, t) => sum + t.target, 0);
        if (currentTotal !== total && saTargets.length > 0) {
            saTargets[0].target += (total - currentTotal);
        }

        // Shuffle SA order to avoid alphabetical bias while filling targets
        const saOrder = [...saTargets].sort(() => Math.random() - 0.5);

        // Distribute role stacks into SAs
        Object.values(byRole).forEach(roleList => {
            roleList.forEach(associate => {
                const saObj = saOrder.find(s => s.current < s.target);
                if (saObj) {
                    associate['Solution Weeks SA'] = saObj.sa;
                    saObj.current++;
                } else {
                    const fallback = saOrder[0];
                    associate['Solution Weeks SA'] = fallback.sa;
                }
            });
        });
    };

    const unassignedAssociates = records.filter(r => {
        const swsSA = (r['Solution Weeks SA'] || '').trim().toLowerCase();
        return !swsSA || swsSA === '-' || swsSA === 'tbd' || swsSA === 'n/a' || swsSA === 'na' || swsSA === 'unassigned' || swsSA === 'unknown' || swsSA.includes('??');
    });

    const fsAssociates = unassignedAssociates.filter(r => {
        const bg = (r['(AA) Business Group'] || '').toUpperCase();
        return bg.includes('F&S') || bg.includes('FAND') || bg.includes('FACULTY');
    });
    const aeAssociates = unassignedAssociates.filter(r => {
        const bg = (r['(AA) Business Group'] || '').toUpperCase();
        return bg.includes('IAE') || bg.includes('ACCOUNT') || bg.includes('GENERALIST');
    });

    applyDistribution(fsAssociates, fsDistributions);
    applyDistribution(aeAssociates, aeDistributions);

    // Paso C: Session Balancing
    const bySA = records.reduce((acc, r) => {
        const sa = r['Solution Weeks SA'] || 'Unassigned';
        if (!acc[sa]) acc[sa] = [];
        acc[sa].push(r);
        return acc;
    }, {} as Record<string, StudentRecord[]>);

    Object.entries(bySA).forEach(([sa, students]) => {
        students.forEach(s => {
            s._availInfo = getAvailableUtcHours(s, startHour, endHour);
        });

        const unassignedStudents = [...students];

        // 1. Unique hours available in this SA
        const allHours = new Set<number>();
        unassignedStudents.forEach(s => {
            (s._availInfo || []).forEach((h: number) => allHours.add(h));
        });
        const uniqueHours = Array.from(allHours);

        // 2. Generate combinations iterator/array up to maxSessionsPerDay
        function getCombinations(arr: number[], k: number): number[][] {
            if (k === 0) return [[]];
            if (arr.length === 0) return [];
            const [first, ...rest] = arr;
            const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
            const withoutFirst = getCombinations(rest, k);
            return [...withFirst, ...withoutFirst];
        }

        let allCombinations: number[][] = [];
        for (let i = 1; i <= Math.min(assumptions.maxSessionsPerDay, uniqueHours.length); i++) {
            allCombinations = allCombinations.concat(getCombinations(uniqueHours, i));
        }

        let bestCoverage = -1;
        let bestCombo: number[] = [];
        let bestAssignment: Map<number, StudentRecord[]> = new Map();

        // If this Solution Area has fewer people than the globally required minSessionSize, 
        // we temporarily lower the threshold so they don't get entirely left out.
        let effectiveMinSessionSize = assumptions.minSessionSize;
        if (unassignedStudents.length > 0 && unassignedStudents.length < effectiveMinSessionSize) {
            effectiveMinSessionSize = unassignedStudents.length;
        }

        // 3. Evaluate each combination
        for (const combo of allCombinations) {
            // Find students who can attend AT LEAST ONE hour in this combo
            const availableStudents = unassignedStudents.filter(s => {
                const hours: number[] = s._availInfo || [];
                return combo.some(h => hours.includes(h));
            });

            // Fast skip: if total available students < combo.length * effectiveMinSessionSize, impossible to satisfy
            if (availableStudents.length < combo.length * effectiveMinSessionSize) {
                continue;
            }

            // Greedy assignment to maximize balanced coverage
            // Sort students: those with fewer options in this combo first (harder to map)
            const sortedStudents = [...availableStudents].sort((a, b) => {
                const aOpts = combo.filter(h => (a._availInfo || []).includes(h)).length;
                const bOpts = combo.filter(h => (b._availInfo || []).includes(h)).length;
                return aOpts - bOpts;
            });

            const comboAssignment = new Map<number, StudentRecord[]>();
            combo.forEach(h => comboAssignment.set(h, []));

            let currentCoverage = 0;
            for (const s of sortedStudents) {
                const hours: number[] = s._availInfo || [];
                const possibleHours = combo.filter(h => hours.includes(h));

                let bestH = -1;
                let minGroupSize = Infinity;

                for (const h of possibleHours) {
                    const group = comboAssignment.get(h)!;
                    // Assign to the smallest group to keep balanced, but don't exceed maxSessionSize
                    if (group.length < assumptions.maxSessionSize && group.length < minGroupSize) {
                        minGroupSize = group.length;
                        bestH = h;
                    }
                }

                if (bestH !== -1) {
                    comboAssignment.get(bestH)!.push(s);
                    currentCoverage++;
                }
            }

            // Validate MIN constraint
            let isValid = true;
            for (const h of combo) {
                if (comboAssignment.get(h)!.length < effectiveMinSessionSize) {
                    isValid = false;
                    break;
                }
            }

            if (isValid) {
                if (currentCoverage > bestCoverage || (currentCoverage === bestCoverage && combo.length < bestCombo.length)) {
                    bestCoverage = currentCoverage;
                    bestCombo = combo;
                    bestAssignment = new Map();
                    combo.forEach(h => bestAssignment.set(h, [...comboAssignment.get(h)!]));
                }
            }
        }

        // --- FALLBACK Leniency ---
        // If we found NO solution for this SA and it has students, try lowering minSessionSize to 2
        if (bestCombo.length === 0 && unassignedStudents.length > 0 && effectiveMinSessionSize > 2) {
             effectiveMinSessionSize = 2;
             // Re-evaluate (copying logic loop briefly for fallback)
             for (const combo of allCombinations) {
                 const availableStudents = unassignedStudents.filter(s => (s._availInfo || []).some(h => combo.includes(h)));
                 if (availableStudents.length < combo.length * 2) continue;
                 const comboAssignment = new Map<number, StudentRecord[]>();
                 combo.forEach(h => comboAssignment.set(h, []));
                 let coverage = 0;
                 for (const s of availableStudents) {
                     const h = combo.find(ch => (s._availInfo || []).includes(ch) && comboAssignment.get(ch)!.length < assumptions.maxSessionSize);
                     if (h !== undefined) {
                         comboAssignment.get(h)!.push(s);
                         coverage++;
                     }
                 }
                 const valid = combo.every(h => comboAssignment.get(h)!.length >= 2);
                 if (valid && coverage > bestCoverage) {
                     bestCoverage = coverage;
                     bestCombo = combo;
                     bestAssignment = new Map();
                     combo.forEach(h => bestAssignment.set(h, [...comboAssignment.get(h)!]));
                 }
             }
        }
        // -------------------------

        // 4. Apply best assignment
        if (bestCombo.length > 0) {
            const coveredIds = new Set<number>();
            let sessionIndex = 1;

            const sortedBestHours = [...bestCombo].sort((a, b) => a - b);

            for (const h of sortedBestHours) {
                const assigned = bestAssignment.get(h)!;
                assigned.forEach(s => {
                    s.Schedule = `${sa} Session ${sessionIndex} (${h}:00 UTC)`;
                    coveredIds.add(s._originalIndex ?? -1);
                });
                sessionIndex++;
            }

            unassignedStudents.forEach(s => {
                if (!coveredIds.has(s._originalIndex ?? -1)) {
                    s.Schedule = 'Outlier-Schedule';
                }
            });
        } else {
            unassignedStudents.forEach(s => {
                s.Schedule = 'Outlier-Schedule';
            });
        }
    });

    recalculateVATs(records, assumptions);

    return {
        records,
        metrics: calculateMetrics(records),
        config: {
            startHour,
            endHour,
            assumptions,
            rules,
            fsDistributions,
            aeDistributions
        }
    };
};

export const calculateMetrics = (records: StudentRecord[]) => {
    let outliersScheduleCount = 0;
    let outliersVatSizeCount = 0;
    let outliersDupeRoleCount = 0;
    let perfectVats = 0;
    let imperfectVats = 0;

    const byVAT: Record<string, StudentRecord[]> = {};

    records.forEach(r => {
        if (r.Schedule === 'Outlier-Schedule') {
            outliersScheduleCount++;
        }
        if (r.VAT === 'Outlier-Size') {
            outliersVatSizeCount++;
        }

        if (r.VAT && r.VAT !== 'Outlier-Size' && r.VAT !== 'Unassigned') {
            if (!byVAT[r.VAT]) byVAT[r.VAT] = [];
            byVAT[r.VAT].push(r);
        }
    });

    Object.values(byVAT).forEach(vat => {
        const progsInVat = new Set(vat.map(v => v['(AA) Secondary Specialization']));
        if (vat.length === 3 && progsInVat.size === 3) {
            perfectVats++;
        } else {
            imperfectVats++;
            if (vat.length === 3) outliersDupeRoleCount++;
        }
    });

    const assignedSuccess = records.filter(r => r.Schedule && r.Schedule !== 'Outlier-Schedule').length;

    return {
        totalStudents: records.length,
        assignedSuccess,
        outliersTotal: outliersScheduleCount + outliersVatSizeCount + outliersDupeRoleCount,
        outliersSchedule: outliersScheduleCount,
        outliersVatSize: outliersVatSizeCount,
        outliersDupeRole: outliersDupeRoleCount,
        perfectVats,
        imperfectVats
    };
};

export const recalculateVATs = (records: StudentRecord[], assumptions: Assumptions) => {
    let vatCounter = 1;

    const bySchedule = records.reduce((acc, r) => {
        if (r.Schedule === 'Outlier-Schedule' || !r.Schedule) return acc;
        const key = r.Schedule;
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
    }, {} as Record<string, StudentRecord[]>);

    Object.entries(bySchedule).forEach(([, students]) => {
        const remaining = [...students];
        const formedVatsForSchedule: StudentRecord[][] = [];

        const getRole = (r: StudentRecord): 'csm' | 'sa' | 'sales' | 'other' => {
            const spec = (r['(AA) Secondary Specialization'] || '').toLowerCase();
            const roleStr = (r.Role || '').toLowerCase();
            const combined = `${spec} ${roleStr}`;
            
            if (combined.includes('csm')) return 'csm';
            if (combined.includes('sa') || combined.includes('solution advisor') || combined.includes('advisory')) return 'sa';
            if (combined.includes('sales') || combined.includes('account executive')) return 'sales';
            return 'other';
        };

        const vat: StudentRecord[] = [];

        const tryPick = (preferredRoles: string[], fallback: boolean = false): boolean => {
            const idx = remaining.findIndex(r => {
                const rRole = getRole(r);
                const rOffset = typeof r._utcOffset === 'number' ? r._utcOffset : 0;

                // Timezone check
                if (vat.length > 0) {
                    const offsets = vat.map(v => typeof v._utcOffset === 'number' ? v._utcOffset : 0);
                    const minOffset = Math.min(...offsets, rOffset);
                    const maxOffset = Math.max(...offsets, rOffset);
                    let distance = maxOffset - minOffset;
                    if (distance > 12) distance = 24 - distance;
                    if (distance > assumptions.maxTimezoneDifference) return false;
                }

                if (fallback) return true;

                // Role check
                const currentRolesInVat = vat.map(v => getRole(v));
                if (preferredRoles.length > 0) {
                    return preferredRoles.includes(rRole) && !currentRolesInVat.includes(rRole);
                }
                
                return !currentRolesInVat.includes(rRole);
            });

            if (idx !== -1) {
                vat.push(remaining.splice(idx, 1)[0]);
                return true;
            }
            return false;
        };

        const tryFormVat = (size: number): boolean => {
            if (remaining.length < size) return false;
            vat.length = 0;

            tryPick(['csm']);
            tryPick(['sa']);
            tryPick(['sales']);

            while (vat.length < size && remaining.length > 0) {
                if (!tryPick([])) break;
            }

            while (vat.length < size && remaining.length > 0) {
                if (!tryPick([], true)) break; 
            }

            if (vat.length < size) {
                remaining.push(...vat);
                vat.length = 0;
                return false;
            }

            const sa = vat[0]['Solution Weeks SA'];
            const vatName = `VAT ${vatCounter}-${sa}`;

            vat.forEach(v => {
                v.VAT = vatName;
                if (size !== 3) {
                    v._isDiscrepancy = true;
                    v._discrepancyReason = `VAT Size ${size}`;
                }
            });
            formedVatsForSchedule.push(vat);
            vatCounter++;
            return true;
        };

        let formed = false;
        do {
            formed = false;
            if (assumptions.allowedVATSizes.includes(3) && remaining.length >= 3) {
                if (remaining.length === 4 && assumptions.allowedVATSizes.includes(4)) {
                    formed = tryFormVat(4);
                    continue;
                }
                if (remaining.length === 5 && assumptions.allowedVATSizes.includes(2) && assumptions.allowedVATSizes.includes(3)) {
                    formed = tryFormVat(3);
                    continue;
                }
                if (remaining.length === 2 && assumptions.allowedVATSizes.includes(2)) {
                    formed = tryFormVat(2);
                    continue;
                }
                formed = tryFormVat(3);
            } else if (assumptions.allowedVATSizes.includes(4) && remaining.length >= 4) {
                formed = tryFormVat(4);
            } else if (assumptions.allowedVATSizes.includes(2) && remaining.length >= 2) {
                formed = tryFormVat(2);
            }
        } while (formed);

        const maxAllowedSize = Math.max(...assumptions.allowedVATSizes);
        if (remaining.length > 0 && formedVatsForSchedule.length > 0) {
            for (let i = remaining.length - 1; i >= 0; i--) {
                const r = remaining[i];
                const rOffset = typeof r._utcOffset === 'number' ? r._utcOffset : 0;

                const suitableVat = formedVatsForSchedule.find(v => {
                    if (v.length >= maxAllowedSize) return false;
                    if (!assumptions.allowedVATSizes.includes(v.length + 1)) return false;

                    const offsets = v.map(member => typeof member._utcOffset === 'number' ? member._utcOffset : 0);
                    const minOffset = Math.min(...offsets, rOffset);
                    const maxOffset = Math.max(...offsets, rOffset);
                    let distance = maxOffset - minOffset;
                    if (distance > 12) distance = 24 - distance;
                    if (distance > assumptions.maxTimezoneDifference) return false;

                    const rRole = getRole(r);
                    return !v.some(member => getRole(member) === rRole);
                });

                const fallbackVat = !suitableVat && formedVatsForSchedule.find(v => {
                    if (v.length >= maxAllowedSize) return false;
                    if (!assumptions.allowedVATSizes.includes(v.length + 1)) return false;
                    const offsets = v.map(member => typeof member._utcOffset === 'number' ? member._utcOffset : 0);
                    const minOffset = Math.min(...offsets, rOffset);
                    const maxOffset = Math.max(...offsets, rOffset);
                    let distance = maxOffset - minOffset;
                    if (distance > 12) distance = 24 - distance;
                    return distance <= assumptions.maxTimezoneDifference;
                });

                const targetVat = suitableVat || fallbackVat;

                if (targetVat) {
                    targetVat.push(r);
                    r.VAT = targetVat[0].VAT;

                    targetVat.forEach(member => {
                        if (targetVat.length !== 3) {
                            member._isDiscrepancy = true;
                            member._discrepancyReason = `VAT Size ${targetVat.length}`;
                        } else {
                            member._isDiscrepancy = false;
                            member._discrepancyReason = undefined;
                        }
                    });

                    remaining.splice(i, 1);
                }
            }
        }

        remaining.forEach(r => {
            r.VAT = 'Outlier-Size';
        });
    });
};
