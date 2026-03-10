import { useMemo } from 'react';
import type { StudentRecord } from '../lib/excelParser';

interface VATOutlierBreakdownProps {
    records: StudentRecord[];
}

export function VATOutlierBreakdown({ records }: VATOutlierBreakdownProps) {
    const data = useMemo(() => {
        const byVAT: Record<string, StudentRecord[]> = {};

        records.forEach(r => {
            if (r.VAT && r.VAT !== 'Outlier-Size' && r.VAT !== 'Unassigned') {
                if (!byVAT[r.VAT]) byVAT[r.VAT] = [];
                byVAT[r.VAT].push(r);
            }
        });

        const sizeOutliers: { vat: string, size: number, students: StudentRecord[] }[] = [];
        const roleOutliersBySA: Record<string, { vats: string[], studentsCount: number, reason: string }> = {};

        // Single Unassigned/Leftover Grouping
        const unassignedSizeOutliers = records.filter(r => r.VAT === 'Outlier-Size');
        if (unassignedSizeOutliers.length > 0) {
            sizeOutliers.push({
                vat: 'TBD / Unassigned',
                size: unassignedSizeOutliers.length,
                students: unassignedSizeOutliers
            });
        }

        Object.entries(byVAT).forEach(([vatName, students]) => {
            const sa = students[0]['Solution Weeks SA'] || 'Unassigned';

            // 1. Size Outliers (< 3 members)
            if (students.length < 3) {
                sizeOutliers.push({ vat: vatName, size: students.length, students });
            }

            // 2. Duplicate Role Outliers
            const programs = new Set(students.map(s => s['(AA) Secondary Specialization']));
            if (programs.size < students.length) {
                // Determine reason based on the specific programs duplicated
                const progCounts = students.reduce((acc, s) => {
                    const spec = s['(AA) Secondary Specialization'] || 'Unknown';
                    acc[spec] = (acc[spec] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);

                let reason = '';
                const dupes = Object.entries(progCounts).filter(([, count]) => count > 1).map(([prog]) => prog);
                if (dupes.length === 1 && dupes[0].toLowerCase().includes('sales') && students.length === 3 && programs.size === 1) {
                    reason = `All ${students.length} students assigned to ${sa} happen to be from the Sales specialization. Consequently, every single VAT in this area consists entirely of duplicated Sales representatives.`;
                } else if (dupes.length === 1 && dupes[0].toLowerCase().includes('sales')) {
                    reason = `Required doubling up on Sales representatives.`;
                } else if (dupes.length === 1 && dupes[0].toLowerCase().includes('csm')) {
                    reason = `Ended up with multiple CSMs.`;
                } else if (dupes.length === 1 && dupes[0].toLowerCase().includes('advisory')) {
                    reason = `Driven by an excess of Solution Advisory students.`;
                } else {
                    reason = `Duplicates happened between ${dupes.join(' and ')}.`;
                }

                if (!roleOutliersBySA[sa]) {
                    roleOutliersBySA[sa] = { vats: [], studentsCount: 0, reason: '' };
                }
                const vatNum = vatName.split('-')[0].replace('VAT ', '');
                roleOutliersBySA[sa].vats.push(vatNum);
                roleOutliersBySA[sa].studentsCount += students.length;
                // Accumulate/prefer the "all same role" reason if it exists
                if (reason.startsWith('All') || roleOutliersBySA[sa].reason === '') {
                    roleOutliersBySA[sa].reason = reason;
                }
            }
        });

        const formattedRoleOutliers = Object.entries(roleOutliersBySA)
            .map(([sa, info]) => {
                const teamsWord = info.vats.length === 1 ? 'team' : 'teams';
                return {
                    sa,
                    teamCount: info.vats.length,
                    teamsWord,
                    vatsStr: info.vats.join(', '),
                    reason: info.reason
                };
            })
            .sort((a, b) => b.teamCount - a.teamCount); // Sort by most affected SAs first

        return {
            sizeOutliers: sizeOutliers.sort((a, b) => a.vat.localeCompare(b.vat)),
            roleOutliers: formattedRoleOutliers,
            totalProblematicVATsRole: Object.values(roleOutliersBySA).reduce((sum, info) => sum + info.vats.length, 0)
        };

    }, [records]);

    return (
        <div style={{ marginTop: '3rem', backgroundColor: '#fff', padding: '2rem', borderRadius: 'var(--border-radius-md)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
            <h2 style={{ marginBottom: '2rem', fontSize: '1.4rem' }}>VAT Details & Outliers Narrative</h2>

            <div style={{ marginBottom: '3rem' }}>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    1. VATs with sizes different than 3 people
                </h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
                    Because the total number of students within specific Solution Areas and Schedules wasn't always perfectly divisible by 3, a few "remainder" teams had to be formed. There are exactly <strong>{data.sizeOutliers.length}</strong> VATs (or groups) with fewer than 3 members:
                </p>
                <ul style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', color: 'var(--text-primary)' }}>
                    {data.sizeOutliers.map(outlier => (
                        <li key={outlier.vat}>
                            <strong style={{ minWidth: '120px', display: 'inline-block' }}>{outlier.vat}:</strong> {outlier.size} {outlier.size === 1 ? 'member' : 'members'}
                            {outlier.vat === 'TBD / Unassigned' && (
                                <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic', marginLeft: '0.5rem' }}>
                                    (Aggregated ungroupable associates)
                                </span>
                            )}
                        </li>
                    ))}
                    {data.sizeOutliers.length === 0 && (
                        <li style={{ color: 'var(--success-color)' }}>All generated VATs have exactly 3 members.</li>
                    )}
                </ul>
            </div>

            <div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    2. VATs with duplicated roles
                </h3>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
                    While the goal was to mix different specializations in every team, the actual distribution of specializations across the Associates is naturally imbalanced. This mathematically forced <strong>{data.totalProblematicVATsRole} VATs</strong> to have duplicated specializations in order to respect the Solution Area boundaries.
                </p>
                <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
                    Here is where those duplicates occurred:
                </p>

                <ul style={{ paddingLeft: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', color: 'var(--text-primary)' }}>
                    {data.roleOutliers.map(outlier => (
                        <li key={outlier.sa} style={{ lineHeight: 1.5 }}>
                            <strong>{outlier.sa}</strong> ({outlier.teamCount} {outlier.teamsWord} - VAT {outlier.vatsStr}): {outlier.reason}
                        </li>
                    ))}
                    {data.roleOutliers.length === 0 && (
                        <li style={{ color: 'var(--success-color)' }}>All generated VATs possess perfect specialization diversity.</li>
                    )}
                </ul>
            </div>
        </div>
    );
}
