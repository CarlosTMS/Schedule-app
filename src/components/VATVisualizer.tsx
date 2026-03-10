import { useMemo, useState } from 'react';
import type { StudentRecord } from '../lib/excelParser';
import { AlertTriangle, Users, AlertCircle } from 'lucide-react';

interface VATVisualizerProps {
    records: StudentRecord[];
    onMoveDelegate?: (originalIndex: number, targetVat: string) => void;
}

export function VATVisualizer({ records, onMoveDelegate }: VATVisualizerProps) {
    const [filterSA, setFilterSA] = useState<string>('All');

    const data = useMemo(() => {
        const formedVats: Record<string, StudentRecord[]> = {};
        const unassigned: StudentRecord[] = [];
        const allSAs = new Set<string>();

        records.forEach(r => {
            const sa = r['Solution Week SA'] || 'Unknown SA';
            allSAs.add(sa);

            if (r.VAT === 'Outlier-Size' || r.VAT === 'Unassigned' || !r.VAT) {
                unassigned.push(r);
            } else if (r.Schedule && r.Schedule !== 'Outlier-Schedule') {
                if (!formedVats[r.VAT]) formedVats[r.VAT] = [];
                formedVats[r.VAT].push(r);
            }
        });

        const vatsBySA: Record<string, typeof formedVats> = {};
        Object.entries(formedVats).forEach(([vatName, students]) => {
            const sa = students[0]['Solution Week SA'] || 'Unknown SA';
            if (!vatsBySA[sa]) vatsBySA[sa] = {};
            vatsBySA[sa][vatName] = students;
        });

        return {
            vatsBySA,
            unassigned,
            allSAs: Array.from(allSAs).sort()
        };
    }, [records]);

    const renderVatCard = (vatName: string, students: StudentRecord[], allVatsForSA: Record<string, StudentRecord[]>) => {
        const roles = students.map(s => s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown');
        const roleCounts = roles.reduce((acc, r) => {
            acc[r] = (acc[r] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const hasDuplicates = Object.values(roleCounts).some(c => c > 1);
        const isUndersized = students.length < 3;
        // Other VATs in the same SA (excluding current one)
        const otherVats = Object.keys(allVatsForSA).filter(v => v !== vatName);

        return (
            <div key={vatName} style={{
                border: `2px solid ${hasDuplicates ? '#ffedd5' : isUndersized ? '#fee2e2' : '#e5e7eb'}`,
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: hasDuplicates ? '#fffedd' : isUndersized ? '#fef2f2' : '#ffffff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{vatName}</h4>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {students[0].Schedule ? students[0].Schedule.split('(')[1]?.replace(')', '') || 'Unknown Time' : ''}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {hasDuplicates && <span title="Duplicated Roles" style={{ color: '#ea580c' }}><Users size={18} /></span>}
                        {isUndersized && <span title="Undersized VAT" style={{ color: '#ef4444' }}><AlertTriangle size={18} /></span>}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {students.map((s, idx) => {
                        const role = s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown';
                        const isDupe = roleCounts[role] > 1;
                        return (
                            <div key={idx} style={{
                                padding: '6px 8px',
                                backgroundColor: isDupe ? '#ffedd5' : '#f3f4f6',
                                borderRadius: '4px',
                                fontSize: '0.9rem'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{s['Full Name']}</span>
                                        <span style={{ fontSize: '0.75rem', color: isDupe ? '#c2410c' : 'var(--text-secondary)' }}>{role}</span>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                                        <div>{s.Country}</div>
                                        <div>UTC{s._utcOffset && s._utcOffset > 0 ? `+${s._utcOffset}` : s._utcOffset}</div>
                                    </div>
                                </div>
                                {onMoveDelegate && otherVats.length > 0 && (
                                    <select
                                        value=""
                                        onChange={(e) => {
                                            if (e.target.value && s._originalIndex !== undefined) {
                                                onMoveDelegate(s._originalIndex, e.target.value);
                                            }
                                        }}
                                        style={{
                                            marginTop: '0.4rem',
                                            width: '100%',
                                            padding: '3px 6px',
                                            fontSize: '0.78rem',
                                            borderRadius: '4px',
                                            border: '1px solid #d1d5db',
                                            backgroundColor: '#f9fafb',
                                            color: '#374151',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="" disabled>Move to another VAT…</option>
                                        {otherVats.map(v => (
                                            <option key={v} value={v}>{v}</option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    return (
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', margin: 0 }}>VAT Explorer Matrix</h2>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
                {['All', ...data.allSAs].map(sa => (
                    <button
                        key={sa}
                        onClick={() => setFilterSA(sa)}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '9999px',
                            border: '1px solid',
                            borderColor: filterSA === sa ? '#ce9600' : '#e5e7eb', // matches var(--glass-border) roughly
                            background: filterSA === sa ? '#ce9600' : 'rgba(255,255,255,0.5)',
                            color: filterSA === sa ? 'white' : 'var(--text-primary)',
                            fontWeight: filterSA === sa ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: filterSA === sa ? '0 4px 6px -1px rgba(234, 179, 8, 0.3)' : 'none'
                        }}
                    >
                        {sa === 'All' ? 'All Solution Areas' : sa}
                    </button>
                ))}
            </div>

            {/* Formed VATs Grid */}
            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary-color)' }}>Successfully Grouped VATs</h3>

                {Object.entries(data.vatsBySA)
                    .filter(([sa]) => filterSA === 'All' || sa === filterSA)
                    .map(([sa, vats]) => (
                        <div key={sa} style={{ marginBottom: '2rem' }}>
                            <h4 style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '0.5rem', marginBottom: '1rem', color: 'var(--text-secondary)' }}>{sa}</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                                {Object.entries(vats).map(([vatName, students]) => renderVatCard(vatName, students, vats))}
                            </div>
                        </div>
                    ))}
            </div>

            {/* Unassigned / Leftovers */}
            {data.unassigned.length > 0 && (
                <div style={{ backgroundColor: '#fffaf5', border: '1px solid #fed7aa', padding: '1.5rem', borderRadius: '8px' }}>
                    <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <AlertCircle size={24} />
                        Ungrouped Delegates ({data.unassigned.filter(u => filterSA === 'All' || (u['Solution Week SA'] || 'Unknown SA') === filterSA).length})
                    </h3>
                    <p style={{ color: '#9a3412', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                        These individuals could not form a perfect VAT. This usually happens when there are leftover pairs/individuals in a Solution Area that don't reach the required Minimum VAT size, or their timezones are too far apart to pair up.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
                        {data.unassigned
                            .filter(u => filterSA === 'All' || (u['Solution Week SA'] || 'Unknown SA') === filterSA)
                            .map((s, idx) => {
                                const sa = s['Solution Week SA'] || 'Unknown SA';
                                const validVatsForSA = data.vatsBySA[sa] ? Object.keys(data.vatsBySA[sa]) : [];

                                return (
                                    <div key={idx} style={{
                                        padding: '0.75rem',
                                        backgroundColor: '#fff',
                                        border: '1px solid #fed7aa',
                                        borderRadius: '6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <strong style={{ fontSize: '0.95rem' }}>{s['Full Name']}</strong>
                                            <span style={{ fontSize: '0.8rem', backgroundColor: '#ffedd5', color: '#9a3412', padding: '2px 6px', borderRadius: '12px' }}>
                                                {s['Solution Week SA'] || 'No SA'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown Role'}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#6b7280', display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                                            <span>{s.Country}</span>
                                            <span>UTC{s._utcOffset && s._utcOffset > 0 ? `+${s._utcOffset}` : s._utcOffset}</span>
                                        </div>
                                        {onMoveDelegate && validVatsForSA.length > 0 && (
                                            <div style={{ marginTop: '0.75rem', borderTop: '1px solid #fed7aa', paddingTop: '0.5rem' }}>
                                                <select
                                                    value=""
                                                    onChange={(e) => {
                                                        if (e.target.value && s._originalIndex !== undefined) {
                                                            onMoveDelegate(s._originalIndex, e.target.value);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.4rem',
                                                        fontSize: '0.85rem',
                                                        borderRadius: '4px',
                                                        border: '1px solid #f97316',
                                                        backgroundColor: '#fff7ed',
                                                        color: '#c2410c',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    <option value="" disabled>Move to existing VAT...</option>
                                                    {validVatsForSA.map(v => (
                                                        <option key={v} value={v}>{v}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}
        </div>
    );
}
