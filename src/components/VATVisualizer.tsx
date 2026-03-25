import { useMemo, useState } from 'react';
import type { StudentRecord } from '../lib/excelParser';
import { AlertTriangle, Users, AlertCircle, Plus, CheckSquare, Square, Zap, Info, ArrowRight, Send, CheckCircle, CalendarDays, Calendar, RotateCcw } from 'lucide-react';
import { useI18n } from '../i18n';
import { extractScheduleKey as tzExtractKey, formatUtcHourLabel } from '../lib/timezones';

interface VATVisualizerProps {
    records: StudentRecord[];
    onMoveDelegate?: (originalIndex: number, targetVat: string) => void;
    onMoveMultipleDelegates?: (originalIndices: number[], targetVat: string) => void;
    onSyncVatsToSessions?: () => void;
    onUndoSync?: () => void;
    hasSyncHistory?: boolean;
    sessionTimeOverrides?: Record<string, number>;
}

interface VatsExport {
    generated_at: string;
    total_records: number;
    source_records_count: number;
    excluded_records_count: number;
    total_vats: number;
    vats: {
        vat: string;
        members_count: number;
        solution_areas: string[];
        schedules: string[];
        members: {
            name: string;
            email: string;
            country: string;
            office: string;
            solution_area: string;
            specialization: string;
            schedule: string;
            utc_offset: number | undefined;
        }[];
    }[];
}

interface Recommendation {
    type: 'pair' | 'cross-sa' | 'single-role' | 'sun-thu';
    title: string;
    description: string;
    indices: number[];
    sa: string;
    names: string;
}

const SUN_THU_COUNTRIES = [
    'saudi arabia', 'arabia saudita', 
    'kuwait', 
    'qatar', 
    'bahrain', 'bahrein', 
    'oman', 
    'jordan', 'jordania', 
    'egypt', 'egipto', 
    'israel'
];

const resolveApiBase = (): string => {
    const envBase = import.meta.env.VITE_API_BASE as string | undefined;
    if (envBase && envBase.trim() !== '') return envBase;
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (isLocal) return `${window.location.protocol}//${host}:8787`;
    return window.location.origin;
};

const API_BASE = resolveApiBase();

// Helper to extract session name without time
const localExtractUtcHour = (name: string) => {
    const m = name.match(/(\d{1,2}):(\d{2}) UTC/);
    if (m) {
        const h = parseInt(m[1], 10);
        const mPart = parseInt(m[2], 10);
        return h + (mPart / 60);
    }
    return 0;
};

export function VATVisualizer({ 
    records, 
    onMoveDelegate, 
    onMoveMultipleDelegates, 
    onSyncVatsToSessions, 
    onUndoSync, 
    hasSyncHistory,
    sessionTimeOverrides = {}
}: VATVisualizerProps) {
    const { t } = useI18n();
    const getAssignedSA = (record: StudentRecord): string => {
        const legacy = (record as StudentRecord & { 'Solution Week SA'?: string })['Solution Week SA'];
        return record['Solution Weeks SA'] || legacy || '';
    };
    const [filterSA, setFilterSA] = useState<string>('All');
    const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
    const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [publishingVats, setPublishingVats] = useState(false);
    const [publishedVatsUrl, setPublishedVatsUrl] = useState<string | null>(null);

    const data = useMemo(() => {
        const formedVats: Record<string, StudentRecord[]> = {};
        const unassigned: StudentRecord[] = [];
        const allSAs = new Set<string>();

        records.forEach(r => {
            const sa = getAssignedSA(r) || 'Unknown SA';
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
            const sa = getAssignedSA(students[0]) || 'Unknown SA';
            if (!vatsBySA[sa]) vatsBySA[sa] = {};
            vatsBySA[sa][vatName] = students;
        });

        return {
            vatsBySA,
            unassigned,
            allSAs: Array.from(allSAs).sort()
        };
    }, [records]);

    const kpis = useMemo(() => {
        let sunThu = 0;
        let s3 = 0;
        let s4 = 0;
        let dupes = 0;

        Object.values(data.vatsBySA).forEach(saVats => {
            Object.values(saVats).forEach(students => {
                if (students.some(s => SUN_THU_COUNTRIES.some(c => (s.Country || '').toLowerCase().includes(c)))) {
                    sunThu++;
                }
                if (students.length === 3) s3++;
                if (students.length === 4) s4++;
                
                const roles = students.map(s => s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown');
                const uniqueRoles = new Set(roles);
                if (uniqueRoles.size < students.length) {
                    dupes++;
                }
            });
        });

        return [
            { label: 'Sun-Thu Teams', value: sunThu, color: '#10b981', icon: <CalendarDays size={20} /> },
            { label: 'Size 3 VATs', value: s3, color: '#3b82f6', icon: <Users size={20} /> },
            { label: 'Size 4 VATs', value: s4, color: '#6366f1', icon: <Users size={20} /> },
            { label: 'Role Conflicts', value: dupes, color: '#f59e0b', icon: <AlertTriangle size={20} /> },
            { label: 'Ungrouped', value: data.unassigned.length, color: '#ef4444', icon: <AlertCircle size={20} /> },
        ];
    }, [data.vatsBySA, data.unassigned]);

    const buildVatsPayload = (): VatsExport => {
        const grouped = new Map<string, StudentRecord[]>();
        for (const r of records) {
            const vat = (r.VAT || '').trim();
            if (!vat || vat === 'Unassigned' || vat === 'Outlier-Size' || !r.Schedule || r.Schedule === 'Outlier-Schedule') continue;
            const list = grouped.get(vat) || [];
            list.push(r);
            grouped.set(vat, list);
        }

        const vats = Array.from(grouped.entries())
            .map(([vat, members]) => ({
                vat,
                members_count: members.length,
                solution_areas: Array.from(new Set(members.map(m => getAssignedSA(m)).filter(Boolean))).sort() as string[],
                schedules: Array.from(new Set(members.map(m => m.Schedule).filter(Boolean))).sort() as string[],
                members: members.map(m => ({
                    name: m['Full Name'] ?? '',
                    email: m.Email ?? '',
                    country: m.Country ?? '',
                    office: m.Office ?? '',
                    solution_area: getAssignedSA(m),
                    specialization: m['(AA) Secondary Specialization'] ?? '',
                    schedule: m.Schedule ?? '',
                    utc_offset: m._utcOffset,
                }))
            }))
            .sort((a, b) => a.vat.localeCompare(b.vat));

        const exportedRecordsCount = vats.reduce((sum, vat) => sum + vat.members_count, 0);

        return {
            generated_at: new Date().toISOString(),
            total_records: exportedRecordsCount,
            source_records_count: records.length,
            excluded_records_count: records.length - exportedRecordsCount,
            total_vats: vats.length,
            vats
        };
    };

    const handlePublishVatsAPI = async () => {
        setPublishingVats(true);
        try {
            const payload = buildVatsPayload();
            const res = await fetch(`${API_BASE}/api/public/vats`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setPublishedVatsUrl(`${API_BASE}/api/public/vats`);
        } catch (err) {
            setPublishedVatsUrl(null);
            alert(t('publishFailed').replace('{err}', String(err)));
        } finally {
            setPublishingVats(false);
        }
    };

    const renderVatCard = (vatName: string, students: StudentRecord[]) => {
        const roles = students.map(s => s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown');
        const roleCounts = roles.reduce((acc, r) => {
            acc[r] = (acc[r] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const hasDuplicates = Object.values(roleCounts).some(c => c > 1);
        const isUndersized = students.length < 3;
        
        const isSunThuVat = students.some(s => 
            SUN_THU_COUNTRIES.some(c => (s.Country || '').toLowerCase().includes(c))
        );

        return (
            <div key={vatName} style={{
                border: `2px solid ${isSunThuVat ? '#10b981' : hasDuplicates ? '#ffedd5' : isUndersized ? '#fee2e2' : '#e5e7eb'}`,
                borderRadius: '8px',
                padding: '1rem',
                backgroundColor: isSunThuVat ? '#f0fdf4' : hasDuplicates ? '#fffedd' : isUndersized ? '#fef2f2' : '#ffffff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                        <h4 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{vatName}</h4>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {(() => {
                                const schedule = students[0].Schedule;
                                if (!schedule) return '';
                                const key = tzExtractKey(schedule);
                                const utcHour = key in sessionTimeOverrides ? sessionTimeOverrides[key] : localExtractUtcHour(schedule);
                                return formatUtcHourLabel(utcHour);
                            })()}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        {isSunThuVat && <span title="Sunday - Thursday Schedule" style={{ color: '#059669' }}><CalendarDays size={18} /></span>}
                        {hasDuplicates && <span title="Duplicated Roles" style={{ color: '#ea580c' }}><Users size={18} /></span>}
                        {isUndersized && <span title="Undersized VAT" style={{ color: '#ef4444' }}><AlertTriangle size={18} /></span>}
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                    {students.map((s, idx) => {
                        const displayTitle = s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown';
                        const isDupe = roleCounts[displayTitle] > 1;
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
                                        <span style={{ fontSize: '0.75rem', color: isDupe ? '#c2410c' : 'var(--text-secondary)' }}>{displayTitle}</span>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'right' }}>
                                        <div>{s.Country}</div>
                                        <div>UTC{s._utcOffset && s._utcOffset > 0 ? `+${s._utcOffset}` : s._utcOffset}</div>
                                    </div>
                                </div>
                                {onMoveDelegate && (
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
                                        <option value="" disabled>Actions…</option>
                                        <option value="Unassigned" style={{ color: '#ef4444' }}>× Remove from VAT</option>
                                        {Object.entries(data.vatsBySA).map(([sa, saVats]) => {
                                            return (
                                                <optgroup key={sa} label={sa}>
                                                    {Object.keys(saVats)
                                                        .filter(v => v !== vatName) // Exclude the current VAT
                                                        .map(v => (
                                                            <option key={v} value={v}>{v}</option>
                                                        ))}
                                                </optgroup>
                                            );
                                        })}
                                    </select>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    };

    const getNextVatName = (sa: string) => {
        let maxNum = 0;
        records.forEach(r => {
            if (r.VAT) {
                const match = r.VAT.match(/VAT (\d+)/i);
                if (match) {
                    const num = parseInt(match[1], 10);
                    if (num > maxNum) maxNum = num;
                }
            }
        });
        return `VAT ${maxNum + 1}-${sa}`;
    };

    const handleCreateNewVat = () => {
        if (selectedIndices.size === 0) {
            // Find first ungrouped in current filter
            const ungroupedInSA = data.unassigned.filter(u => filterSA === 'All' || (u['Solution Weeks SA'] || 'Unknown SA') === filterSA);
            if (ungroupedInSA.length === 0) {
                alert("No ungrouped delegates to add to a new VAT.");
                return;
            }
            const first = ungroupedInSA[0];
            const sa = first['Solution Weeks SA'] || 'Unknown SA';
            const nextName = getNextVatName(sa);
            if (onMoveDelegate && first._originalIndex !== undefined) {
                onMoveDelegate(first._originalIndex, nextName);
            }
        } else {
            // Use selected
            const indices = Array.from(selectedIndices);
            const firstRecord = records.find(r => r._originalIndex === indices[0]);
            const sa = firstRecord?.['Solution Weeks SA'] || 'Unknown SA';
            const nextName = getNextVatName(sa);
            if (onMoveMultipleDelegates) {
                onMoveMultipleDelegates(indices, nextName);
            } else if (onMoveDelegate) {
                indices.forEach(idx => onMoveDelegate(idx, nextName));
            }
            setSelectedIndices(new Set());
        }
    };

    const toggleSelection = (idx: number) => {
        const next = new Set(selectedIndices);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        setSelectedIndices(next);
    };

    const groupSunThuOnly = () => {
        setIsAnalyzing(true);
        setTimeout(() => {
            const ungrouped = data.unassigned;
            const sunThuDelegates = ungrouped.filter(u => 
                SUN_THU_COUNTRIES.some(c => (u.Country || '').toLowerCase().includes(c))
            );

            if (sunThuDelegates.length === 0) {
                alert("No unassigned Sunday-Thursday delegates found.");
                setIsAnalyzing(false);
                return;
            }

            const recs: Recommendation[] = [];
            // Group by SA/TZ to suggest specific VATs
            const bySA: Record<string, StudentRecord[]> = {};
            sunThuDelegates.forEach(s => {
                const sa = s['Solution Weeks SA'] || 'Unknown SA';
                if (!bySA[sa]) bySA[sa] = [];
                bySA[sa].push(s);
            });

            Object.entries(bySA).forEach(([sa, students]) => {
                if (students.length >= 2) {
                    recs.push({
                        type: 'sun-thu',
                        title: `Group Sun-Thu Team in ${sa}`,
                        description: `These ${students.length} delegates from Sun-Thu countries can be grouped to align their working weeks.`,
                        indices: students.map(s => s._originalIndex!),
                        sa,
                        names: students.map(s => s['Full Name']).join(', ')
                    });
                }
            });

            if (recs.length === 0) {
                alert("Could not find enough unassigned Sunday-Thursday delegates in the same Solution Area to form a VAT.");
            } else {
                setRecommendations(recs);
            }
            setIsAnalyzing(false);
        }, 800);
    };

    const runAnalysis = () => {
        setIsAnalyzing(true);
        // Simulate thinking time for "premium" feel
        setTimeout(() => {
            const ungrouped = data.unassigned;
            const recs: Recommendation[] = [];

            // 1. Group by timezone
            const byTZ: Record<number, StudentRecord[]> = {};
            ungrouped.forEach(u => {
                const tz = u._utcOffset || 0;
                if (!byTZ[tz]) byTZ[tz] = [];
                byTZ[tz].push(u);
            });

            Object.entries(byTZ).forEach(([tzStr, students]) => {
                const tz = parseFloat(tzStr);

                // Option A: Form pairs (Size 2) in same SA
                const bySA: Record<string, StudentRecord[]> = {};
                students.forEach(s => {
                    const sa = s['Solution Weeks SA'] || 'Unknown SA';
                    if (!bySA[sa]) bySA[sa] = [];
                    bySA[sa].push(s);
                });

                Object.entries(bySA).forEach(([sa, saStudents]) => {
                    if (saStudents.length === 2) {
                        recs.push({
                            type: 'pair',
                            title: `Form a pair in ${sa}`,
                            description: `These two individuals share the same SA and timezone (UTC${tz > 0 ? '+' : ''}${tz}).`,
                            indices: saStudents.map(s => s._originalIndex),
                            sa,
                            names: saStudents.map(s => s['Full Name']).join(', ')
                        });
                    }
                });

                // Option B: Cross-SA VAT
                if (students.length >= 3) {
                    const sas = Array.from(new Set(students.map(s => s['Solution Weeks SA'] || 'Unknown SA')));
                    if (sas.length > 1) {
                        recs.push({
                            type: 'cross-sa',
                            title: `Form Cross-SA VAT (UTC${tz > 0 ? '+' : ''}${tz})`,
                            description: `Combine delegates from ${sas.join(', ')} into a single VAT to clear the backlog.`,
                            indices: students.slice(0, 4).map(s => s._originalIndex), // suggest up to 4
                            sa: sas[0],
                            names: students.slice(0, 3).map(s => s['Full Name']).join(', ') + (students.length > 3 ? '...' : '')
                        });
                    }
                }

                // Option C: Single Role VATs (Relaxing complexity)
                Object.entries(bySA).forEach(([sa, saStudents]) => {
                    if (saStudents.length >= 3) {
                        const roles = saStudents.map(s => s.Program || s.Role || 'Unknown');
                        const uniqueRoles = new Set(roles);
                        if (uniqueRoles.size < saStudents.length) {
                            recs.push({
                                type: 'single-role',
                                title: `Allow Duplicate Roles in ${sa}`,
                                description: `These ${saStudents.length} delegates are compatible but share roles. Redoing them into a "relaxed" VAT would work.`,
                                indices: saStudents.map(s => s._originalIndex),
                                sa,
                                names: saStudents.map(s => s['Full Name']).join(', ')
                            });
                        }
                    }
                });

                // Option D: Regional Grouping (Sunday-Thursday)
                const sunThuInTZ = students.filter(s => 
                    SUN_THU_COUNTRIES.some(c => (s.Country || '').toLowerCase().includes(c))
                );
                if (sunThuInTZ.length >= 2) {
                    const sa = sunThuInTZ[0]['Solution Weeks SA'] || 'Unknown SA';
                    recs.push({
                        type: 'sun-thu',
                        title: `Prioritize Sun-Thu Grouping (UTC${tz > 0 ? '+' : ''}${tz})`,
                        description: `These ${sunThuInTZ.length} individuals from Sun-Thu countries should be grouped to align schedules.`,
                        indices: sunThuInTZ.map(s => s._originalIndex!),
                        sa,
                        names: sunThuInTZ.map(s => s['Full Name']).join(', ')
                    });
                }
            });

            setRecommendations(recs);
            setIsAnalyzing(false);
        }, 800);
    };

    return (
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', margin: 0 }}>VAT Explorer Matrix</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                        onClick={handlePublishVatsAPI}
                        disabled={publishingVats}
                        className="btn"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', background: '#0ea5e9', color: 'white', border: 'none', opacity: publishingVats ? 0.7 : 1 }}
                    >
                        <Send size={15} /> {publishingVats ? '...' : t('publishVatsAPI')}
                    </button>
                    {publishedVatsUrl && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.8rem', padding: '0.35rem 0.75rem', borderRadius: '9999px', background: 'rgba(14,165,233,0.1)', border: '1px solid rgba(14,165,233,0.3)', color: '#0369a1' }}>
                            <CheckCircle size={13} />
                            {t('vatsPublicURL')}:&nbsp;
                            <a href={publishedVatsUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>{publishedVatsUrl}</a>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.25rem', marginBottom: '0.5rem' }}>
                {kpis.map((kpi, idx) => (
                    <div key={idx} style={{
                        background: 'white',
                        padding: '1.5rem',
                        borderRadius: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                        border: `1px solid ${kpi.color}30`,
                        boxShadow: `0 4px 6px -1px ${kpi.color}10`,
                        position: 'relative',
                        overflow: 'hidden'
                    }}>
                        <div style={{
                            position: 'absolute',
                            top: '-5px',
                            right: '-5px',
                            opacity: 0.1,
                            color: kpi.color,
                            transform: 'scale(2.5)'
                        }}>
                            {kpi.icon}
                        </div>
                        <span style={{ fontSize: '2.5rem', fontWeight: 800, color: kpi.color, lineHeight: 1 }}>{kpi.value}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'center' }}>{kpi.label}</span>
                    </div>
                ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {['All', ...data.allSAs].map(sa => (
                        <button
                            key={sa}
                            onClick={() => setFilterSA(sa)}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '9999px',
                                border: '1px solid',
                                borderColor: filterSA === sa ? '#ce9600' : '#e5e7eb',
                                background: filterSA === sa ? 'rgba(206, 150, 0, 0.1)' : 'rgba(255,255,255,0.5)',
                                color: filterSA === sa ? '#854d0e' : 'var(--text-primary)',
                                fontWeight: filterSA === sa ? 700 : 400,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem'
                            }}
                        >
                            {sa === 'All' ? 'All Areas' : sa}
                            {filterSA === sa && <CheckCircle size={14} />}
                        </button>
                    ))}
                </div>

                <div style={{ 
                    marginLeft: 'auto', 
                    display: 'flex', 
                    gap: '0.75rem',
                    padding: '0.5rem',
                    background: 'rgba(255,255,255,0.7)',
                    backdropFilter: 'blur(8px)',
                    borderRadius: '12px',
                    border: '1px solid #e5e7eb',
                    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
                }}>
                    <button
                        onClick={groupSunThuOnly}
                        disabled={isAnalyzing}
                        title="Maximize Sun-Thu Grouping"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            border: '1px solid #10b981',
                            background: 'white',
                            color: '#059669',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        <Users size={18} />
                        Group Sun-Thu
                    </button>

                    <button
                        onClick={runAnalysis}
                        disabled={isAnalyzing}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.6rem 1rem',
                            borderRadius: '8px',
                            border: '1px solid #3b82f6',
                            background: 'white',
                            color: '#2563eb',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                        }}
                    >
                        <Zap size={18} className={isAnalyzing ? 'animate-pulse' : ''} />
                        Optimizer
                    </button>

                    <div style={{ width: '1px', background: '#e5e7eb', margin: '0 0.25rem' }} />

                    {onUndoSync && hasSyncHistory && (
                        <button
                            onClick={onUndoSync}
                            title="Undo Session Sync"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.4rem',
                                padding: '0.6rem 0.8rem',
                                borderRadius: '8px',
                                border: '1px solid #f87171',
                                background: 'white',
                                color: '#ef4444',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            <RotateCcw size={16} />
                            Undo
                        </button>
                    )}

                    {onSyncVatsToSessions && (
                        <button
                            onClick={onSyncVatsToSessions}
                            title="Push VAT Groups to Sessions Breakdown"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                padding: '0.6rem 1rem',
                                borderRadius: '8px',
                                border: '1px solid #8b5cf6',
                                background: 'white',
                                color: '#7c3aed',
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Calendar size={18} />
                            Sync to Sessions
                        </button>
                    )}

                    <div style={{ width: '1px', background: '#e5e7eb', margin: '0 0.25rem' }} />

                    <button
                        onClick={handleCreateNewVat}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.6rem 1.2rem',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #2563eb 0%, #1e40af 100%)',
                            color: 'white',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            boxShadow: '0 4px 6px -1px rgba(37, 99, 235, 0.3)'
                        }}
                    >
                        <Plus size={18} />
                        {selectedIndices.size > 0 ? `Create (${selectedIndices.size})` : 'New VAT'}
                    </button>
                </div>
            </div>

            {/* Recommendations Panel */}
            {recommendations.length > 0 && (
                <div style={{
                    backgroundColor: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: '12px',
                    padding: '1.5rem',
                    boxShadow: '0 4px 12px rgba(59, 130, 246, 0.08)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#1e40af' }}>
                            <Zap size={20} fill="#3b82f6" style={{ color: '#3b82f6' }} />
                            Optimization Recommendations ({recommendations.length})
                        </h3>
                        <button
                            onClick={() => setRecommendations([])}
                            style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '0.85rem' }}
                        >
                            Dismiss
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1rem' }}>
                        {recommendations.map((rec, i) => (
                            <div key={i} style={{
                                backgroundColor: 'white',
                                padding: '1rem',
                                borderRadius: '10px',
                                border: '1px solid #dbeafe',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.75rem'
                            }}>
                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                    <div style={{
                                        backgroundColor: rec.type === 'pair' ? '#dcfce7' : rec.type === 'sun-thu' ? '#d1fae5' : rec.type === 'cross-sa' ? '#fef9c3' : '#ffedd5',
                                        color: rec.type === 'pair' ? '#166534' : rec.type === 'sun-thu' ? '#065f46' : rec.type === 'cross-sa' ? '#854d0e' : '#9a3412',
                                        width: '32px', height: '32px', borderRadius: '8px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                    }}>
                                        <Info size={18} />
                                    </div>
                                    <div>
                                        <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e3a8a' }}>{rec.title}</h4>
                                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: '#64748b', lineHeight: 1.4 }}>{rec.description}</p>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.78rem', color: '#94a3b8', background: '#f8fafc', padding: '0.5rem', borderRadius: '4px' }}>
                                    <Users size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                                    {rec.names}
                                </div>
                                <button
                                    onClick={() => {
                                        const vatName = getNextVatName(rec.sa);
                                        if (onMoveMultipleDelegates) {
                                            onMoveMultipleDelegates(rec.indices, vatName);
                                        } else if (onMoveDelegate) {
                                            rec.indices.forEach((idx: number) => onMoveDelegate(idx, vatName));
                                        }
                                        setRecommendations(prev => prev.filter((_, idx) => idx !== i));
                                    }}
                                    style={{
                                        marginTop: 'auto',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        padding: '0.5rem',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: '#3b82f6',
                                        color: 'white',
                                        fontSize: '0.85rem',
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Apply Fix <ArrowRight size={14} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div style={{ backgroundColor: '#fff', padding: '1.5rem', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <h3 style={{ marginBottom: '1.5rem', fontSize: '1.2rem', color: 'var(--primary-color)' }}>Successfully Grouped VATs</h3>

                {Object.entries(data.vatsBySA)
                    .filter(([sa]) => filterSA === 'All' || sa === filterSA)
                    .map(([sa, vats]) => (
                        <div key={sa} style={{ marginBottom: '3rem' }}>
                            <h3 style={{ borderBottom: '2px solid #3b82f6', display: 'inline-block', paddingBottom: '0.25rem', marginBottom: '1.5rem', color: '#1e3a8a' }}>{sa}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                                {Object.entries(vats).map(([vn, students]) => renderVatCard(vn, students))}
                            </div>
                        </div>
                    ))}
            </div>

            {/* Unassigned / Leftovers */}
            {data.unassigned.length > 0 && (
                <div style={{ backgroundColor: '#fffaf5', border: '1px solid #fed7aa', padding: '1.5rem', borderRadius: '8px' }}>
                    <h3 style={{ marginBottom: '1rem', fontSize: '1.2rem', color: '#c2410c', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <AlertCircle size={24} />
                        Ungrouped Delegates ({data.unassigned.filter(u => filterSA === 'All' || (u['Solution Weeks SA'] || 'Unknown SA') === filterSA).length})
                    </h3>
                    <p style={{ color: '#9a3412', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                        These individuals could not form a perfect VAT. This usually happens when there are leftover pairs/individuals in a Solution Area that don't reach the required Minimum VAT size, or their timezones are too far apart to pair up.
                    </p>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
                        {data.unassigned
                            .filter(u => filterSA === 'All' || (u['Solution Weeks SA'] || 'Unknown SA') === filterSA)
                            .map(s => {
                                const sa = s['Solution Weeks SA'] || 'Unknown SA';
                                const validVatsForSA = data.vatsBySA[sa] ? Object.keys(data.vatsBySA[sa]) : [];

                                return (
                                    <div key={s._originalIndex} style={{
                                        padding: '0.75rem',
                                        backgroundColor: '#fff',
                                        border: '1px solid #fed7aa',
                                        borderRadius: '6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '0.25rem'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                {s._originalIndex !== undefined && (
                                                    <button
                                                        onClick={() => toggleSelection(s._originalIndex!)}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            padding: 0,
                                                            cursor: 'pointer',
                                                            color: selectedIndices.has(s._originalIndex) ? 'var(--primary-color)' : '#d1d5db'
                                                        }}
                                                    >
                                                        {selectedIndices.has(s._originalIndex) ? <CheckSquare size={20} /> : <Square size={20} />}
                                                    </button>
                                                )}
                                                <strong style={{ fontSize: '0.95rem' }}>{s['Full Name']}</strong>
                                            </div>
                                            <span style={{ fontSize: '0.8rem', backgroundColor: '#ffedd5', color: '#9a3412', padding: '2px 6px', borderRadius: '12px' }}>
                                                {s['Solution Weeks SA'] || 'No SA'}
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '1.75rem' }}>{s.Program || s.Role || s['(AA) Secondary Specialization'] || 'Unknown Role'}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#6b7280', display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem', paddingLeft: '1.75rem' }}>
                                            <span>{s.Country}</span>
                                            <span>UTC{s._utcOffset && s._utcOffset > 0 ? `+${s._utcOffset}` : s._utcOffset}</span>
                                        </div>
                                        {onMoveDelegate && validVatsForSA.length > 0 && (
                                            <div style={{ marginTop: '0.75rem', borderTop: '1px solid #fed7aa', paddingTop: '0.5rem' }}>
                                                <select
                                                    value=""
                                                    onChange={(e) => {
                                                        if (e.target.value === 'CREATE_NEW' && s._originalIndex !== undefined) {
                                                            const sa = s['Solution Weeks SA'] || 'Unknown SA';
                                                            onMoveDelegate(s._originalIndex, getNextVatName(sa));
                                                        } else if (e.target.value && s._originalIndex !== undefined) {
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
                                                    <option value="CREATE_NEW">+ Create New VAT (Auto-name)</option>
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
