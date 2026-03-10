const fs = require('fs');
const content = `import { useState, useEffect } from 'react';
import { Download, Users, AlertTriangle, CheckCircle, Clock, ShieldAlert, LayoutDashboard, Calendar, Presentation, UserSquare2, Database } from 'lucide-react';
import { calculateMetrics } from '../lib/allocationEngine';
import type { AllocationResult } from '../lib/allocationEngine';
import { generateExcel } from '../lib/excelParser';
import { SessionBreakdown } from './SessionBreakdown';
import { VATVisualizer } from './VATVisualizer';
import { ScheduleOutlierBreakdown } from './ScheduleOutlierBreakdown';
import { CalendarExporter } from './CalendarExporter';
import { SMESchedule } from './SMESchedule';
import { FacultySchedule } from './FacultySchedule';
import { useI18n } from '../i18n';

interface DashboardProps {
    result: AllocationResult;
    onReset: () => void;
    previousMetrics?: AllocationResult['metrics'] | null;
    sessionLength?: number;
}

type TabType = 'overview' | 'sessions' | 'smes' | 'faculty' | 'vats' | 'data';

export function Dashboard({ result, onReset, previousMetrics, sessionLength = 90 }: DashboardProps) {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [filterType, setFilterType] = useState<string | null>(null);
    const [columnFilters, setColumnFilters] = useState<{ SA: string; Country: string; Office: string }>({ SA: '', Country: '', Office: '' });
    const [localRecords, setLocalRecords] = useState(result.records);
    const [localMetrics, setLocalMetrics] = useState(result.metrics);

    useEffect(() => {
        setLocalRecords(result.records);
        setLocalMetrics(result.metrics);
    }, [result]);

    const availableSchedules = Array.from(new Set(localRecords.map(r => r.Schedule).filter(s => s && s !== 'Outlier-Schedule'))).sort() as string[];
    const availableVATs = Array.from(new Set(localRecords.map(r => r.VAT).filter(v => v && v !== 'Outlier-Size' && v !== 'Unassigned'))).sort();
    
    // Derived Schedules mapped to SAs for SME/Faculty injection
    const schedulesBySA = localRecords.reduce((acc, r) => {
        const sa = r['Solution Week SA'];
        const schedule = r.Schedule;
        if (sa && schedule && schedule !== 'Outlier-Schedule' && schedule !== 'Unassigned') {
            if (!acc[sa]) acc[sa] = new Set();
            acc[sa].add(schedule);
        }
        return acc;
    }, {} as Record<string, Set<string>>);

    const getFilteredRecords = () => {
        if (!filterType) return [];
        if (filterType === 'schedule') return localRecords.filter(r => r.Schedule === 'Outlier-Schedule');
        if (filterType === 'vat') return localRecords.filter(r => r.VAT === 'Outlier-Size');
        return localRecords;
    };

    const baseFilteredRecords = getFilteredRecords();
    const uniqueSAs = Array.from(new Set(baseFilteredRecords.map(r => r['Solution Week SA']))).filter(Boolean).sort();
    const uniqueCountries = Array.from(new Set(baseFilteredRecords.map(r => r.Country))).filter(Boolean).sort();
    const uniqueOffices = Array.from(new Set(baseFilteredRecords.map(r => r.Office))).filter(Boolean).sort();

    const filteredRecords = baseFilteredRecords.filter(r => {
        if (columnFilters.SA && r['Solution Week SA'] !== columnFilters.SA) return false;
        if (columnFilters.Country && r.Country !== columnFilters.Country) return false;
        if (columnFilters.Office && r.Office !== columnFilters.Office) return false;
        return true;
    });

    useEffect(() => {
        setColumnFilters({ SA: '', Country: '', Office: '' });
    }, [filterType]);

    const handleEdit = (originalIndex: number | undefined, field: 'Schedule' | 'VAT', value: string) => {
        if (originalIndex === undefined) return;

        let finalValue = value;
        if (value === 'CREATE_NEW') {
            const name = prompt("Enter new VAT name (e.g., VAT Custom-1):");
            if (!name) return;
            finalValue = name;
        }

        const newRecords = [...localRecords];
        const recordIndex = newRecords.findIndex(r => r._originalIndex === originalIndex);
        if (recordIndex !== -1) {
            newRecords[recordIndex] = { ...newRecords[recordIndex], [field]: finalValue };
            setLocalRecords(newRecords);
            setLocalMetrics(calculateMetrics(newRecords));
        }
    };

    const handleDownload = () => {
        generateExcel(localRecords, result.config);
    };

    const navItems = [
        { id: 'overview', icon: LayoutDashboard, label: t('allocationDashboard') },
        { id: 'sessions', icon: Calendar, label: t('navSessions') },
        { id: 'smes', icon: UserSquare2, label: t('navSMEs') },
        { id: 'faculty', icon: Presentation, label: t('navFaculty') },
        { id: 'vats', icon: Users, label: t('navVATs') },
        { id: 'data', icon: Database, label: t('navData') },
    ] as const;

    return (
        <div style={{ display: 'flex', gap: '2rem', marginTop: '2rem', alignItems: 'flex-start' }}>
            {/* RETRO-MODERN SIDEBAR */}
            <aside style={{
                flexShrink: 0,
                width: '260px',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
                position: 'sticky',
                top: '2rem',
                backgroundColor: 'rgba(255, 255, 255, 0.8)',
                backdropFilter: 'blur(10px)',
                borderRadius: '12px',
                padding: '1rem',
                border: '1px solid var(--glass-border)',
                boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)'
            }}>
                <div style={{ padding: '0.5rem', marginBottom: '1rem', borderBottom: '2px solid var(--primary-color)' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-primary)' }}>
                        Menu
                    </h3>
                </div>
                
                {navItems.map(item => (
                    <button
                        key={item.id}
                        onClick={() => setActiveTab(item.id as TabType)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.75rem 1rem',
                            borderRadius: '8px',
                            border: 'none',
                            backgroundColor: activeTab === item.id ? 'var(--primary-color)' : 'transparent',
                            color: activeTab === item.id ? 'white' : 'var(--text-secondary)',
                            fontWeight: activeTab === item.id ? 600 : 500,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.2s',
                            boxShadow: activeTab === item.id ? '0 2px 4px rgba(37, 99, 235, 0.2)' : 'none',
                        }}
                    >
                        <item.icon size={18} />
                        {item.label}
                    </button>
                ))}
            </aside>

            {/* MAIN CONTENT AREA */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header Context Controls */}
                <div className="glass-panel animated-fade-in" style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ margin: 0 }}>
                            {navItems.find(n => n.id === activeTab)?.label}
                        </h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <button className="btn btn-secondary" onClick={onReset}>
                                {t('changeParameters')}
                            </button>
                            <button className="btn btn-primary" onClick={handleDownload} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Download size={18} /> {t('downloadResults')}
                            </button>
                            <CalendarExporter uniqueSchedules={availableSchedules} sessionLength={sessionLength} />
                        </div>
                    </div>
                </div>

                {/* TAB RENDERING */}
                {activeTab === 'overview' && (
                    <div className="animated-fade-in">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                            <div className="glass-panel" style={{ background: 'rgba(255,255,255,0.5)', padding: '1.5rem', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                                    <Users size={18} /> {t('totalStudents')}
                                </div>
                                <div style={{ fontSize: '2rem', fontWeight: 700 }}>{localMetrics.totalStudents}</div>
                            </div>

                            <div className="glass-panel" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', padding: '1.5rem', position: 'relative' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--success-color)' }}>
                                    <CheckCircle size={18} /> {t('assignedSuccess')}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--success-color)' }}>{localMetrics.assignedSuccess}</div>
                                    {previousMetrics && (
                                        <div style={{ fontSize: '0.9rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '12px', background: (localMetrics.assignedSuccess - previousMetrics.assignedSuccess) >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: (localMetrics.assignedSuccess - previousMetrics.assignedSuccess) >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                            {(localMetrics.assignedSuccess - previousMetrics.assignedSuccess) > 0 ? '+' : ''}{localMetrics.assignedSuccess - previousMetrics.assignedSuccess}
                                        </div>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.85rem', marginTop: '0.2rem' }}>
                                    {((localMetrics.assignedSuccess / localMetrics.totalStudents) * 100).toFixed(1)}% {t('successRate')}
                                </div>
                            </div>

                            <div className="glass-panel" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: '1.5rem', position: 'relative' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--danger-color)' }}>
                                    <AlertTriangle size={18} /> {t('totalOutliers')}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--danger-color)' }}>{localMetrics.outliersTotal}</div>
                                    {previousMetrics && (
                                        <div style={{ fontSize: '0.9rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '12px', background: (localMetrics.outliersTotal - previousMetrics.outliersTotal) <= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: (localMetrics.outliersTotal - previousMetrics.outliersTotal) <= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                            {(localMetrics.outliersTotal - previousMetrics.outliersTotal) > 0 ? '+' : ''}{localMetrics.outliersTotal - previousMetrics.outliersTotal}
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="glass-panel" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', padding: '1.5rem', position: 'relative' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--primary-color)' }}>
                                    <Users size={18} /> {t('vatsFormed')}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--primary-color)' }}>{localMetrics.perfectVats + localMetrics.imperfectVats}</div>
                                    {previousMetrics && (
                                        <div style={{ fontSize: '0.9rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: '12px', background: ((localMetrics.perfectVats + localMetrics.imperfectVats) - (previousMetrics.perfectVats + previousMetrics.imperfectVats)) >= 0 ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: ((localMetrics.perfectVats + localMetrics.imperfectVats) - (previousMetrics.perfectVats + previousMetrics.imperfectVats)) >= 0 ? 'var(--success-color)' : 'var(--danger-color)' }}>
                                            {((localMetrics.perfectVats + localMetrics.imperfectVats) - (previousMetrics.perfectVats + previousMetrics.imperfectVats)) > 0 ? '+' : ''}{(localMetrics.perfectVats + localMetrics.imperfectVats) - (previousMetrics.perfectVats + previousMetrics.imperfectVats)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '3rem' }}>
                            <h3 style={{ marginBottom: '1rem' }}>{t('dataTableFilter')}</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
                                <button
                                    className="btn glass-panel"
                                    style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '1.5rem', border: filterType === 'schedule' ? '2px solid var(--primary-color)' : '', transition: 'all 0.2s', textAlign: 'left', minHeight: '120px' }}
                                    onClick={() => setFilterType(filterType === 'schedule' ? null : 'schedule')}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger-color)' }}>
                                        <Clock size={16} /> {t('scheduleConflicts')}
                                    </div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{localMetrics.outliersSchedule}</div>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, marginTop: 'auto' }}>{t('scheduleConflictsDesc')}</p>
                                </button>

                                <button
                                    className="btn glass-panel"
                                    style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '1.5rem', border: filterType === 'vat' ? '2px solid var(--primary-color)' : '', transition: 'all 0.2s', textAlign: 'left', minHeight: '120px' }}
                                    onClick={() => setFilterType(filterType === 'vat' ? null : 'vat')}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger-color)' }}>
                                        <Users size={16} /> {t('vatSizeMismatch')}
                                    </div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: 700 }}>{localMetrics.outliersVatSize}</div>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, marginTop: 'auto' }}>{t('vatSizeMismatchDesc')}</p>
                                </button>

                                <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', minHeight: '120px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#f59e0b' }}>
                                        <ShieldAlert size={16} /> {localMetrics.imperfectVats > 0 ? "Duplicated VAT Roles" : "Perfect VAT Roles"}
                                    </div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: 700, color: '#f59e0b' }}>{localMetrics.outliersDupeRole}</div>
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0, marginTop: 'auto' }}>{t('duplicatedVatRoles').replace('{n}', localMetrics.imperfectVats.toString())}</p>
                                </div>
                            </div>
                            
                            {filterType && <ScheduleOutlierBreakdown records={localRecords} />}
                        </div>
                    </div>
                )}

                {activeTab === 'sessions' && (
                    <div className="animated-fade-in">
                        <SessionBreakdown records={localRecords} />
                    </div>
                )}

                {activeTab === 'smes' && (
                    <div className="animated-fade-in">
                        <SMESchedule schedulesBySA={schedulesBySA} />
                    </div>
                )}

                {activeTab === 'faculty' && (
                    <div className="animated-fade-in">
                        <FacultySchedule schedulesBySA={schedulesBySA} />
                    </div>
                )}

                {activeTab === 'vats' && (
                    <div className="animated-fade-in">
                        <VATVisualizer records={localRecords} />
                    </div>
                )}

                {activeTab === 'data' && (
                    <div className="animated-fade-in">
                        <div className="glass-panel" style={{ overflowX: 'auto', marginTop: '1rem' }}>
                            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                                <select
                                    value={columnFilters.SA}
                                    onChange={e => setColumnFilters(p => ({ ...p, SA: e.target.value }))}
                                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
                                >
                                    <option value="">All Solutions</option>
                                    {uniqueSAs.map(sa => <option key={sa} value={sa}>{sa}</option>)}
                                </select>
                                <select
                                    value={columnFilters.Country}
                                    onChange={e => setColumnFilters(p => ({ ...p, Country: e.target.value }))}
                                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
                                >
                                    <option value="">All Countries</option>
                                    {uniqueCountries.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                                <select
                                    value={columnFilters.Office}
                                    onChange={e => setColumnFilters(p => ({ ...p, Office: e.target.value }))}
                                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #d1d5db' }}
                                >
                                    <option value="">All Offices</option>
                                    {uniqueOffices.map(o => <option key={o} value={o}>{o}</option>)}
                                </select>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setColumnFilters({ SA: '', Country: '', Office: '' })}
                                    style={{ marginLeft: 'auto' }}
                                >
                                    Clear Column Filters
                                </button>
                            </div>

                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                                <thead>
                                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Name</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Country</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Office</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>Specialization</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>SA</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600 }}>UTC</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600, width: '180px' }}>Schedule</th>
                                        <th style={{ padding: '0.75rem 1rem', fontWeight: 600, width: '180px' }}>VAT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRecords.map((r) => (
                                        <tr key={r._originalIndex} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '0.75rem 1rem' }}>{r['Full Name']}</td>
                                            <td style={{ padding: '0.75rem 1rem' }}>{r.Country}</td>
                                            <td style={{ padding: '0.75rem 1rem' }}>{r.Office}</td>
                                            <td style={{ padding: '0.75rem 1rem' }}>{r['(AA) Secondary Specialization'] || 'Unknown'}</td>
                                            <td style={{ padding: '0.75rem 1rem' }}><span style={{ padding: '0.2rem 0.5rem', background: '#e0f2fe', color: '#0369a1', borderRadius: '12px', fontSize: '0.8rem' }}>{r['Solution Week SA']}</span></td>
                                            <td style={{ padding: '0.75rem 1rem' }}>{r._utcOffset !== undefined ? \`UTC\${r._utcOffset > 0 ? '+' : ''}\${r._utcOffset}\` : 'N/A'}</td>
                                            <td style={{ padding: '0.75rem 1rem' }}>
                                                {filterType === 'schedule' ? (
                                                    <select
                                                        value={r.Schedule || ''}
                                                        onChange={(e) => handleEdit(r._originalIndex, 'Schedule', e.target.value)}
                                                        style={{ width: '100%', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                                    >
                                                        <option value="Outlier-Schedule">Fix Conflict...</option>
                                                        {availableSchedules.map(s => <option key={s} value={s}>{s}</option>)}
                                                    </select>
                                                ) : (
                                                    <span style={{ color: r.Schedule === 'Outlier-Schedule' ? 'var(--danger-color)' : 'inherit', fontWeight: r.Schedule === 'Outlier-Schedule' ? 600 : 400 }}>
                                                        {r.Schedule}
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ padding: '0.75rem 1rem' }}>
                                                {filterType === 'vat' ? (
                                                    <select
                                                        value={r.VAT || ''}
                                                        onChange={(e) => handleEdit(r._originalIndex, 'VAT', e.target.value)}
                                                        style={{ width: '100%', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                                                    >
                                                        <option value="Outlier-Size">Fix Missing VAT...</option>
                                                        <option value="CREATE_NEW">+ Create New VAT</option>
                                                        <optgroup label="Available VATs">
                                                            {availableVATs.map((v, i) => <option key={i} value={v}>{v}</option>)}
                                                        </optgroup>
                                                    </select>
                                                ) : (
                                                    <span style={{ color: r.VAT === 'Outlier-Size' || r.VAT === 'Unassigned' ? 'var(--danger-color)' : 'inherit', fontWeight: r.VAT === 'Outlier-Size' || r.VAT === 'Unassigned' ? 600 : 400 }}>
                                                        {r.VAT}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                    {filteredRecords.length === 0 && (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                                                No records found for the current filters.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
`;
fs.writeFileSync('src/components/Dashboard.tsx', content);
