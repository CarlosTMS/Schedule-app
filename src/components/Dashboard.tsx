import { useState, useEffect, type ReactNode } from 'react';
import { Download, Users, AlertTriangle, CheckCircle, CheckCircle2, Clock, ShieldAlert, LayoutDashboard, Calendar, Presentation, UserSquare2, Database, BarChart3, CalendarPlus } from 'lucide-react';
import { calculateMetrics } from '../lib/allocationEngine';
import type { AllocationResult } from '../lib/allocationEngine';
import { generateExcel } from '../lib/excelParser';
import type { StudentRecord } from '../lib/excelParser';
import { SessionBreakdown } from './SessionBreakdown';
import { VATVisualizer } from './VATVisualizer';
import { ScheduleOutlierBreakdown } from './ScheduleOutlierBreakdown';
import { CalendarExporter } from './CalendarExporter';
import { SMESchedule } from './SMESchedule';
import type { SmeAssignments, SmeConfirmationState } from './SMESchedule';
import { FacultySchedule } from './FacultySchedule';
import type { FacultyAssignments } from './FacultySchedule';
import { FacultyDebriefSchedule } from './FacultyDebriefSchedule';
import { Summary } from './Summary';
import { CalendarBlockers } from './CalendarBlockers';
import { Evaluations } from './Evaluations';
import type { EvaluationEngineOutput } from '../lib/evaluationEngine';
import { useI18n } from '../i18n';
import { loadSMEData, forceFetchSMEData } from '../lib/smeDataLoader';
import type { SMECacheStatus } from '../lib/smeDataLoader';
import type { SME } from '../lib/smeMatcher';

interface DashboardProps {
    result: AllocationResult;
    onReset: () => void;
    /** @deprecated replaced by autosave — kept for API compatibility but no longer rendered */
    onSave?: () => void;
    previousMetrics?: AllocationResult['metrics'] | null;
    sessionLength?: number;
    facultyStartHour?: number;
    // ── Controlled editable state (optional — if omitted, Dashboard uses internal state) ──
    sessionTimeOverrides?: Record<string, number>;
    sessionInstanceTimeOverrides?: Record<string, number>;
    onSessionInstanceTimeOverridesChange?: (v: Record<string, number>) => void;
    manualSmeAssignments?: SmeAssignments;
    onManualSmeAssignmentsChange?: (v: SmeAssignments) => void;
    smeConfirmationState?: SmeConfirmationState;
    onSmeConfirmationStateChange?: (v: SmeConfirmationState) => void;
    manualFacultyAssignments?: FacultyAssignments;
    onManualFacultyAssignmentsChange?: (v: FacultyAssignments) => void;
    evaluationsOutput?: EvaluationEngineOutput | null;
    onEvaluationsOutputChange?: (v: EvaluationEngineOutput | null) => void;
    versionInfo?: ReactNode;

    // ── Live editing state (if omitted, falls back to internal state) ──
    localRecords?: StudentRecord[];
    onLocalRecordsChange?: (records: StudentRecord[]) => void;
    localMetrics?: AllocationResult['metrics'];
    onLocalMetricsChange?: (metrics: AllocationResult['metrics']) => void;
    projectName?: string | null;
    versionLabel?: string | null;
}

type TabType = 'overview' | 'sessions' | 'smes' | 'faculty' | 'summary' | 'blockers' | 'debrief' | 'vats' | 'data' | 'evaluations';

export function Dashboard({
    result, onReset, previousMetrics, sessionLength = 90,
    facultyStartHour = 6,
    sessionTimeOverrides: controlledOverrides,
    sessionInstanceTimeOverrides: controlledSessionInstanceOverrides,
    onSessionInstanceTimeOverridesChange,
    manualSmeAssignments: controlledSme,
    onManualSmeAssignmentsChange,
    smeConfirmationState: controlledSmeConfirmationState,
    onSmeConfirmationStateChange,
    manualFacultyAssignments: controlledFaculty,
    onManualFacultyAssignmentsChange,
    evaluationsOutput: controlledEvaluations,
    onEvaluationsOutputChange,
    versionInfo,
    localRecords: controlledRecords,
    onLocalRecordsChange,
    localMetrics: controlledMetrics,
    onLocalMetricsChange,
    projectName,
    versionLabel,
}: DashboardProps) {

    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState<TabType>('overview');
    const [filterType, setFilterType] = useState<string | null>(null);
    const [columnFilters, setColumnFilters] = useState<{ SA: string; Country: string; Office: string }>({ SA: '', Country: '', Office: '' });

    // Internal fallback state — used when parent does NOT pass controlled props
    const [internalRecords, setInternalRecords] = useState(result.records);
    const [internalMetrics, setInternalMetrics] = useState(result.metrics);
    const [syncHistory, setSyncHistory] = useState<StudentRecord[][]>([]);

    const localRecords = controlledRecords ?? internalRecords;
    const localMetrics = controlledMetrics ?? internalMetrics;

    const liftRecords = (recs: StudentRecord[]) => {
        if (onLocalRecordsChange) onLocalRecordsChange(recs);
        else setInternalRecords(recs);
        const mets = calculateMetrics(recs);
        if (onLocalMetricsChange) onLocalMetricsChange(mets);
        else setInternalMetrics(mets);
    };

    // Internal fallback state — used when parent does NOT pass controlled props
    const [internalOverrides] = useState<Record<string, number>>({});
    const [internalSessionInstanceOverrides, setInternalSessionInstanceOverrides] = useState<Record<string, number>>({});
    const [internalSme, setInternalSme] = useState<SmeAssignments>({});
    const [internalSmeConfirmationState, setInternalSmeConfirmationState] = useState<SmeConfirmationState>({});
    const [internalFaculty, setInternalFaculty] = useState<FacultyAssignments>({});
    const [internalEvaluations, setInternalEvaluations] = useState<EvaluationEngineOutput | null>(null);

    // Resolve: prefer controlled props, fall back to internal
    const sessionTimeOverrides = controlledOverrides ?? internalOverrides;
    const sessionInstanceTimeOverrides = controlledSessionInstanceOverrides ?? internalSessionInstanceOverrides;
    const manualSmeAssignments = controlledSme ?? internalSme;
    const smeConfirmationState = controlledSmeConfirmationState ?? internalSmeConfirmationState;
    const manualFacultyAssignments = controlledFaculty ?? internalFaculty;
    const evaluationsOutput = controlledEvaluations ?? internalEvaluations;

    const setSessionInstanceTimeOverrides = (v: Record<string, number> | ((p: Record<string, number>) => Record<string, number>)) => {
        const next = typeof v === 'function' ? v(sessionInstanceTimeOverrides) : v;
        if (onSessionInstanceTimeOverridesChange) onSessionInstanceTimeOverridesChange(next);
        else setInternalSessionInstanceOverrides(next);
    };
    const setManualSmeAssignments = (v: SmeAssignments | ((p: SmeAssignments) => SmeAssignments)) => {
        const next = typeof v === 'function' ? v(manualSmeAssignments) : v;
        if (onManualSmeAssignmentsChange) onManualSmeAssignmentsChange(next);
        else setInternalSme(next);
    };
    const setSmeConfirmationState = (v: SmeConfirmationState | ((p: SmeConfirmationState) => SmeConfirmationState)) => {
        const next = typeof v === 'function' ? v(smeConfirmationState) : v;
        if (onSmeConfirmationStateChange) onSmeConfirmationStateChange(next);
        else setInternalSmeConfirmationState(next);
    };
    const setManualFacultyAssignments = (v: FacultyAssignments | ((p: FacultyAssignments) => FacultyAssignments)) => {
        const next = typeof v === 'function' ? v(manualFacultyAssignments) : v;
        if (onManualFacultyAssignmentsChange) onManualFacultyAssignmentsChange(next);
        else setInternalFaculty(next);
    };

    const setEvaluationsOutput = (v: EvaluationEngineOutput | null | ((p: EvaluationEngineOutput | null) => EvaluationEngineOutput | null)) => {
        const next = typeof v === 'function' ? v(evaluationsOutput) : v;
        if (onEvaluationsOutputChange) onEvaluationsOutputChange(next);
        else setInternalEvaluations(next);
    };

    const [smeList, setSmeList] = useState<SME[]>([]);
    const [smeStatus, setSmeStatus] = useState<SMECacheStatus | null>(null);

    // Fetch SME data on mount; daily cache prevents unnecessary network calls
    useEffect(() => {
        loadSMEData().then(({ smes, status }) => {
            setSmeList(smes);
            setSmeStatus(status);
        });
    }, []);

    const handleRefreshSMEs = () => {
        forceFetchSMEData().then(({ smes, status }) => {
            setSmeList(smes);
            setSmeStatus(status);
        });
    };

    const handleMoveToSession = (recordIndices: number[], targetSchedule: string) => {
        const newRecords = [...localRecords];
        const vatsToMove = new Set<string>();

        // 1. Identify all VAT names that involve these indices
        recordIndices.forEach(idx => {
            const r = newRecords.find(rec => rec._originalIndex === idx);
            if (r?.VAT && r.VAT !== 'Outlier-Size' && r.VAT !== 'Unassigned') {
                vatsToMove.add(r.VAT);
            }
        });

        // 2. Move everyone who is EITHER in the target indices OR in an affected VAT
        newRecords.forEach((r, i) => {
            const isTarget = recordIndices.includes(r._originalIndex || -1);
            const isInTargetVat = r.VAT && vatsToMove.has(r.VAT);
            
            if (isTarget || isInTargetVat) {
                newRecords[i] = { ...r, Schedule: targetSchedule };
            }
        });
        liftRecords(newRecords);
    };
    
    const handleGlobalApplyAll = () => {
        // The user wants a button that ensures the "SME Assignment" and "Faculty Assignment" 
        // tabs follow exactly what is shown in the "Session Breakdown" (global schedule). 
        // To do this, we simply clear all granular instance-level overrides.
        setSessionInstanceTimeOverrides({});
    };

    const handleSyncVatsToSessions = () => {
        // Prepare to store history
        setSyncHistory(prev => [...prev.slice(-4), [...localRecords.map(r => ({ ...r })) ]]);

        const newRecords = [...localRecords.map(r => ({ ...r }))];
        
        // Group by VAT
        const vats: Record<string, StudentRecord[]> = {};
        newRecords.forEach(r => {
            if (r.VAT && r.VAT !== 'Unassigned' && r.VAT !== 'Outlier-Size') {
                if (!vats[r.VAT]) vats[r.VAT] = [];
                vats[r.VAT].push(r);
            }
        });

        // For each VAT, find the consensus schedule (or just use the first one available)
        Object.values(vats).forEach((members) => {
            const schedules = members.map(m => m.Schedule).filter(s => s && s !== 'Outlier-Schedule' && s !== 'Unassigned');
            if (schedules.length > 0) {
                const targetSchedule = schedules[0]; // Simple consensus: use the first valid schedule found in the group
                members.forEach(m => {
                    const idx = newRecords.findIndex(r => r._originalIndex === m._originalIndex);
                    if (idx !== -1) {
                        newRecords[idx].Schedule = targetSchedule;
                    }
                });
            }
        });

        liftRecords(newRecords);
    };

    const handleUndoSync = () => {
        if (syncHistory.length === 0) return;
        const previous = syncHistory[syncHistory.length - 1];
        setSyncHistory(prev => prev.slice(0, -1));
        liftRecords(previous);
    };

    const handleMoveToVAT = (recordIndices: number[], targetVat: string) => {
        const newRecords = [...localRecords];
        
        // Find a template record already in that VAT to copy SA and Schedule if moving cross-SA
        const template = targetVat !== 'Unassigned' 
            ? localRecords.find(r => r.VAT === targetVat && r.VAT !== 'Unassigned' && r.VAT !== 'Outlier-Size') 
            : null;

        recordIndices.forEach(originalIndex => {
            const idx = newRecords.findIndex(r => r._originalIndex === originalIndex);
            if (idx !== -1) {
                const updatedRecord = { ...newRecords[idx], VAT: targetVat };
                
                // If we have a template member in the target VAT, sync their SA and Schedule
                if (template) {
                    updatedRecord['Solution Weeks SA'] = template['Solution Weeks SA'];
                    updatedRecord.Schedule = template.Schedule;
                }
                
                newRecords[idx] = updatedRecord;
            }
        });
        liftRecords(newRecords);
    };

    const handleFilterTypeChange = (type: string | null) => {
        setFilterType(type);
        setColumnFilters({ SA: '', Country: '', Office: '' });
    };

    const availableSchedules = Array.from(new Set(localRecords.map(r => r.Schedule).filter(s => s && s !== 'Outlier-Schedule'))).sort() as string[];
    const availableVATs = Array.from(new Set(localRecords.map(r => r.VAT).filter(v => v && v !== 'Outlier-Size' && v !== 'Unassigned'))).sort();

    const getAssignedSA = (r: StudentRecord): string => {
        const legacy = (r as StudentRecord & { 'Solution Week SA'?: string })['Solution Week SA'];
        return r['Solution Weeks SA'] || legacy || '';
    };

    // Derived Schedules mapped to SAs for SME/Faculty injection
    const schedulesBySA = localRecords.reduce((acc, r) => {
        const sa = getAssignedSA(r);
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
    const uniqueSAs = Array.from(new Set(baseFilteredRecords.map(r => getAssignedSA(r)))).filter(Boolean).sort() as string[];
    const uniqueCountries = Array.from(new Set(baseFilteredRecords.map(r => r.Country))).filter(Boolean).sort();
    const uniqueOffices = Array.from(new Set(baseFilteredRecords.map(r => r.Office))).filter(Boolean).sort();

    const filteredRecords = baseFilteredRecords.filter(r => {
        if (columnFilters.SA && getAssignedSA(r) !== columnFilters.SA) return false;
        if (columnFilters.Country && r.Country !== columnFilters.Country) return false;
        if (columnFilters.Office && r.Office !== columnFilters.Office) return false;
        return true;
    });



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
            liftRecords(newRecords);
        }
    };

    const handleDownload = () => {
        generateExcel(localRecords, result.config);
    };

    // Navigation — debrief is intentionally excluded from the visible menu (requirement)
    const navItems = [
        { id: 'overview', icon: LayoutDashboard, label: t('allocationDashboard') },
        { id: 'sessions', icon: Calendar, label: t('navSessions') },
        { id: 'smes', icon: UserSquare2, label: t('navSMEs') },
        { id: 'faculty', icon: Presentation, label: t('navFaculty') },
        { id: 'summary', icon: BarChart3, label: t('navSummary') },
        { id: 'blockers', icon: CalendarPlus, label: t('navBlockers') },
        { id: 'vats', icon: Users, label: t('navVATs') },
        { id: 'data', icon: Database, label: t('navData') },
        { id: 'evaluations', icon: Users, label: 'Evaluations' },
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

                {/* New version info widget slot */}
                {versionInfo && (
                    <div style={{ marginTop: 'auto', borderTop: '1px solid var(--glass-border)', paddingTop: '1.25rem' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-secondary)', marginBottom: '0.75rem', opacity: 0.6 }}>{t('versionsTitle')}</div>
                        {versionInfo}
                    </div>
                )}
            </aside>


            {/* MAIN CONTENT AREA */}
            <div style={{ flex: 1, minWidth: 0 }}>
                {/* Header Context Controls */}
                <div className="glass-panel animated-fade-in" style={{ marginBottom: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h2 style={{ margin: 0 }}>
                            {navItems.find(n => n.id === activeTab)?.label ?? t('facultyDebrief')}
                        </h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <button className="btn btn-secondary" onClick={onReset}>
                                {t('changeParameters')}
                            </button>
                            {activeTab === 'sessions' && (
                                <button 
                                    className="btn btn-primary" 
                                    onClick={handleGlobalApplyAll} 
                                    style={{ 
                                        backgroundColor: 'var(--primary-color)', 
                                        display: 'flex', 
                                        alignItems: 'center', 
                                        gap: '0.4rem',
                                        boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)' 
                                    }}
                                >
                                    <CheckCircle2 size={16} /> Apply to all
                                </button>
                            )}
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
                                    onClick={() => handleFilterTypeChange(filterType === 'schedule' ? null : 'schedule')}
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
                                    onClick={() => handleFilterTypeChange(filterType === 'vat' ? null : 'vat')}
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
                        <SessionBreakdown
                            records={localRecords}
                            sessionTimeOverrides={sessionTimeOverrides}
                            onMoveToSession={handleMoveToSession}
                            maxSessionSize={result.config.assumptions.maxSessionSize}
                            schedulesBySA={schedulesBySA}
                            sessionInstanceTimeOverrides={sessionInstanceTimeOverrides}
                            onSessionInstanceTimeOverridesChange={setSessionInstanceTimeOverrides}
                        />
                    </div>
                )}

                {activeTab === 'smes' && (
                    <div className="animated-fade-in">
                        <SMESchedule
                            schedulesBySA={schedulesBySA}
                            startHour={result.config.startHour}
                            endHour={result.config.endHour}
                            facultyStartHour={facultyStartHour}
                            sessionTimeOverrides={sessionTimeOverrides}
                            sessionInstanceTimeOverrides={sessionInstanceTimeOverrides}
                            onSessionInstanceTimeOverridesChange={setSessionInstanceTimeOverrides}
                            smeList={smeList}
                            smeStatus={smeStatus}
                            onRefreshSMEs={handleRefreshSMEs}
                            manualSmeAssignments={manualSmeAssignments}
                            onSmeAssignmentsChange={setManualSmeAssignments}
                            smeConfirmationState={smeConfirmationState}
                            onSmeConfirmationStateChange={setSmeConfirmationState}
                            manualFacultyAssignments={manualFacultyAssignments}
                        />
                    </div>
                )}

                {activeTab === 'faculty' && (
                    <div className="animated-fade-in">
                        <FacultySchedule
                            schedulesBySA={schedulesBySA}
                            startHour={result.config.startHour}
                            endHour={result.config.endHour}
                            facultyStartHour={facultyStartHour}
                            sessionTimeOverrides={sessionTimeOverrides}
                            sessionInstanceTimeOverrides={sessionInstanceTimeOverrides}
                            onSessionInstanceTimeOverridesChange={setSessionInstanceTimeOverrides}
                            manualFacultyAssignments={manualFacultyAssignments}
                            onFacultyAssignmentsChange={setManualFacultyAssignments}
                        />
                    </div>
                )}

                {activeTab === 'summary' && (
                    <div className="animated-fade-in">
                        <Summary
                            records={localRecords}
                            schedulesBySA={schedulesBySA}
                            startHour={result.config.startHour}
                            endHour={result.config.endHour}
                            facultyStartHour={facultyStartHour}
                            sessionTimeOverrides={sessionTimeOverrides}
                            sessionInstanceTimeOverrides={sessionInstanceTimeOverrides}
                            manualSmeAssignments={manualSmeAssignments}
                            onSmeAssignmentsChange={setManualSmeAssignments}
                            manualFacultyAssignments={manualFacultyAssignments}
                            onFacultyAssignmentsChange={setManualFacultyAssignments}
                            smeList={smeList}
                            smeStatus={smeStatus}
                        />
                    </div>
                )}

                {activeTab === 'blockers' && (
                    <div className="animated-fade-in">
                        <CalendarBlockers
                            schedulesBySA={schedulesBySA}
                            startHour={result.config.startHour}
                            endHour={result.config.endHour}
                            facultyStartHour={facultyStartHour}
                            sessionTimeOverrides={sessionTimeOverrides}
                            sessionInstanceTimeOverrides={sessionInstanceTimeOverrides}
                            manualSmeAssignments={manualSmeAssignments}
                            manualFacultyAssignments={manualFacultyAssignments}
                            smeList={smeList}
                            projectName={projectName}
                            versionLabel={versionLabel}
                        />
                    </div>
                )}

                {/* Debrief is hidden from menu but still renderable if activeTab is set programmatically */}
                {activeTab === 'debrief' && (
                    <div className="animated-fade-in">
                        <FacultyDebriefSchedule
                            records={localRecords}
                            startHour={result.config.startHour}
                            endHour={result.config.endHour}
                            sessionLength={sessionLength}
                            sessionTimeOverrides={sessionTimeOverrides}
                        />
                    </div>
                )}

                {activeTab === 'vats' && (
                    <div className="animated-fade-in">
                        <VATVisualizer
                            records={localRecords}
                            onMoveDelegate={(idx, targetVat) => handleMoveToVAT([idx], targetVat)}
                            onMoveMultipleDelegates={(indices, targetVat) => handleMoveToVAT(indices, targetVat)}
                            onSyncVatsToSessions={handleSyncVatsToSessions}
                            onUndoSync={handleUndoSync}
                            hasSyncHistory={syncHistory.length > 0}
                            sessionTimeOverrides={sessionTimeOverrides}
                        />
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
                                            <td style={{ padding: '0.75rem 1rem' }}><span style={{ padding: '0.2rem 0.5rem', background: '#e0f2fe', color: '#0369a1', borderRadius: '12px', fontSize: '0.8rem' }}>{r['Solution Weeks SA']}</span></td>
                                            <td style={{ padding: '0.75rem 1rem' }}>{r._utcOffset !== undefined ? `UTC${r._utcOffset > 0 ? '+' : ''}${r._utcOffset}` : 'N/A'}</td>
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

                {activeTab === 'evaluations' && (
                    <div className="animated-fade-in">
                        <Evaluations
                            records={localRecords}
                            facultyAssignments={manualFacultyAssignments}
                            output={evaluationsOutput}
                            onOutputChange={setEvaluationsOutput}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
