import { useState, Fragment } from 'react';
import {
    FileSpreadsheet, FileText, FileJson, Send, ChevronDown, ChevronRight,
    AlertTriangle, CheckCircle, UserCircle2, Presentation, MapPin, Globe,
    Building2, Mail
} from 'lucide-react';
import { sessions, getEligibleSMEs, autoAssignSMEs } from '../lib/smeMatcher';
import type { SME, SessionId } from '../lib/smeMatcher';
import { getEligibleFaculty, autoAssignFaculty } from '../lib/facultyMatcher';
import type { Faculty } from '../lib/facultyMatcher';
import { extractScheduleKey, getEffectiveScheduleUtcHour, getKnownUtcOffset, formatEffectiveSchedule } from '../lib/timezones';
import type { StudentRecord } from '../lib/excelParser';
import { generateExcel } from '../lib/excelParser';
import type { SMECacheStatus } from '../lib/smeDataLoader';
import type { SmeAssignments } from './SMESchedule';
import type { FacultyAssignments } from './FacultySchedule';
import { useI18n } from '../i18n';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SummaryProps {
    records: StudentRecord[];
    schedulesBySA: Record<string, Set<string>>;
    startHour: number;
    endHour: number;
    facultyStartHour?: number;
    sessionTimeOverrides: Record<string, number>;
    manualSmeAssignments: SmeAssignments;
    onSmeAssignmentsChange: (next: SmeAssignments) => void;
    manualFacultyAssignments: FacultyAssignments;
    onFacultyAssignmentsChange: (next: FacultyAssignments) => void;
    smeList: SME[];
    smeStatus: SMECacheStatus | null;
}

interface SessionWarning {
    type: 'noSME' | 'noFaculty' | 'smeOutOfHours' | 'facultyOutOfHours';
    label: string;
}

interface SessionRow {
    sa: string;
    schedule: string;
    sessionDef: (typeof sessions)[number];
    utcHour: number;
    attendees: StudentRecord[];
    assignedSME: SME | null;
    assignedFaculty: Faculty | null;
    eligibleSMEs: SME[];
    eligibleFaculty: Faculty[];
    warnings: SessionWarning[];
}

// ─── JSON export shape ────────────────────────────────────────────────────────

interface SummaryExportSession {
    solution_area: string;
    schedule: string;
    session_topic: string;
    utc_hour: number;
    attendees_count: number;
    attendees: {
        name: string;
        email?: string;
        country: string;
        office: string;
        specialization: string;
        utc_offset: number | undefined;
    }[];
    sme: { name: string; lob: string; office_location: string; office: string; email: string } | null;
    faculty: { name: string; office: string } | null;
    warnings: { code: SessionWarning['type']; label: string }[];
    warning_codes: SessionWarning['type'][];
}

interface SummaryExport {
    generated_at: string;
    source: {
        sme_last_updated_at: string | null;
        sme_source: string;
    };
    config: {
        startHour: number;
        endHour: number;
    };
    sessions: SummaryExportSession[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isOutOfHours = (utcHour: number, offsetHours: number, startHour: number, endHour: number): boolean => {
    const localHour = (utcHour + offsetHours + 24) % 24;
    return localHour < startHour || localHour >= endHour;
};

const KP_SESSION_NAMES: Record<SessionId, string> = {
    overview: 'Solution Weeks — Solution Overview',
    process_mapping: 'Solution Weeks — Process to Solution mapping',
    industry_relevance: 'Solution Weeks — Industry Relevance',
    ai_strategy: 'Solution Weeks — AI Strategy',
    competitive_defense: 'Solution Weeks — Competitive Defense',
    adoption_risk: 'Solution Weeks — Adoption & Risk Prevention',
};

const toKpDateTime = (dateValue: Date): string => {
    const month = dateValue.getUTCMonth() + 1;
    const day = dateValue.getUTCDate();
    const year = dateValue.getUTCFullYear();
    const hours = dateValue.getUTCHours().toString().padStart(2, '0');
    const minutes = dateValue.getUTCMinutes().toString().padStart(2, '0');
    return `${month}/${day}/${year} ${hours}:${minutes}`;
};

const buildUtcDateForSession = (sessionDateLabel: string, utcHour: number): Date => {
    const baseDate = new Date(`${sessionDateLabel} 00:00:00 UTC`);
    return new Date(Date.UTC(
        baseDate.getUTCFullYear(),
        baseDate.getUTCMonth(),
        baseDate.getUTCDate(),
        utcHour,
        0,
        0,
        0
    ));
};

const buildKpSessionName = (sessionId: SessionId, schedule: string): string => {
    const scheduleKey = extractScheduleKey(schedule);
    return `${KP_SESSION_NAMES[sessionId]} (${scheduleKey})`;
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Resolves API base at runtime:
 * - VITE_API_BASE (if provided) wins.
 * - Local dev defaults to :8787 (separate API process).
 * - Deployed environments default to same-origin.
 */
const resolveApiBase = (): string => {
    const envBase = import.meta.env.VITE_API_BASE as string | undefined;
    if (envBase && envBase.trim() !== '') return envBase;

    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    if (isLocal) return `${window.location.protocol}//${host}:8787`;
    return window.location.origin;
};

const API_BASE = resolveApiBase();

export function Summary({
    records,
    schedulesBySA,
    startHour,
    endHour,
    facultyStartHour,
    sessionTimeOverrides,
    manualSmeAssignments,
    onSmeAssignmentsChange,
    manualFacultyAssignments,
    onFacultyAssignmentsChange,
    smeList,
    smeStatus,
}: SummaryProps) {
    const { t } = useI18n();
    const effectiveFacultyStartHour = facultyStartHour ?? startHour;
    const getAssignedSA = (r: StudentRecord): string => {
        const legacy = (r as StudentRecord & { 'Solution Week SA'?: string })['Solution Week SA'];
        return r['Solution Weeks SA'] || legacy || '';
    };
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [showOnlyWarnings, setShowOnlyWarnings] = useState(false);
    const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
    const [publishing, setPublishing] = useState(false);

    // ── Build session rows ──────────────────────────────────────────────────

    const sessionRows: SessionRow[] = [];

    const allSAs = Object.keys(schedulesBySA).sort();

    for (const sa of allSAs) {
        const schedules = Array.from(schedulesBySA[sa] || []).sort();

        const autoSme = autoAssignSMEs(sa, schedules, startHour, endHour, smeList);
        const autoFac = autoAssignFaculty(sa, schedules, effectiveFacultyStartHour, endHour);

        const smeAssignmentsForSA = manualSmeAssignments[sa] || autoSme;
        const facAssignmentsForSA = manualFacultyAssignments[sa] || autoFac;

        for (const schedule of schedules) {
            for (const session of sessions) {
                const utcHour = getEffectiveScheduleUtcHour(schedule, sessionTimeOverrides);
                const attendees = records.filter(
                    r => getAssignedSA(r) === sa && r.Schedule === schedule && r.Schedule !== 'Outlier-Schedule'
                );

                const assignedSME = smeAssignmentsForSA[schedule]?.[session.id] ?? null;
                const assignedFaculty = facAssignmentsForSA[schedule]?.[session.id] ?? null;
                const eligibleSMEs = getEligibleSMEs(sa, session.id, smeList);
                const eligibleFaculty = getEligibleFaculty(sa);

                const warnings: SessionWarning[] = [];
                if (eligibleSMEs.length === 0) warnings.push({ type: 'noSME', label: t('warnNoSME') });
                if (eligibleFaculty.length === 0) warnings.push({ type: 'noFaculty', label: t('warnNoFaculty') });
                if (assignedSME && isOutOfHours(utcHour, getKnownUtcOffset(assignedSME.office_location), startHour, endHour)) {
                    warnings.push({ type: 'smeOutOfHours', label: t('warnSMEOutOfHours') });
                }
                if (assignedFaculty && isOutOfHours(utcHour, getKnownUtcOffset(assignedFaculty.office), effectiveFacultyStartHour, endHour)) {
                    warnings.push({ type: 'facultyOutOfHours', label: t('warnFacultyOutOfHours') });
                }

                sessionRows.push({
                    sa,
                    schedule,
                    sessionDef: session,
                    utcHour,
                    attendees,
                    assignedSME,
                    assignedFaculty,
                    eligibleSMEs,
                    eligibleFaculty,
                    warnings,
                });
            }
        }
    }

    const warningsCount = sessionRows.filter(r => r.warnings.length > 0).length;
    const visibleRows = showOnlyWarnings ? sessionRows.filter(r => r.warnings.length > 0) : sessionRows;

    const buildAssignmentSummary = (sa: string, schedule: string, kind: 'sme' | 'faculty'): string => {
        return sessionRows
            .filter(row => row.sa === sa && row.schedule === schedule)
            .map(row => {
                const assignee = kind === 'sme' ? row.assignedSME?.name : row.assignedFaculty?.name;
                return assignee ? `${row.sessionDef.title}: ${assignee}` : null;
            })
            .filter((value): value is string => Boolean(value))
            .join(' | ');
    };

    // ── SME change handler ──────────────────────────────────────────────────

    const handleSMEChange = (sa: string, schedule: string, sessionId: SessionId, smeName: string) => {
        const eligible = getEligibleSMEs(sa, sessionId, smeList);
        const newSME = eligible.find(s => s.name === smeName) || null;
        const schedules = Array.from(schedulesBySA[sa] || []).sort();
        const currentAuto = autoAssignSMEs(sa, schedules, startHour, endHour, smeList);
        const saData = manualSmeAssignments[sa] || currentAuto;
        onSmeAssignmentsChange({
            ...manualSmeAssignments,
            [sa]: { ...saData, [schedule]: { ...saData[schedule], [sessionId]: newSME } },
        });
    };

    // ── Faculty change handler ──────────────────────────────────────────────

    const handleFacultyChange = (sa: string, schedule: string, sessionId: SessionId, facultyName: string) => {
        const eligible = getEligibleFaculty(sa);
        const newFac = eligible.find(f => f.name === facultyName) || null;
        const schedules = Array.from(schedulesBySA[sa] || []).sort();
        const currentAuto = autoAssignFaculty(sa, schedules, effectiveFacultyStartHour, endHour);
        const saData = manualFacultyAssignments[sa] || currentAuto;
        onFacultyAssignmentsChange({
            ...manualFacultyAssignments,
            [sa]: { ...saData, [schedule]: { ...saData[schedule], [sessionId]: newFac } },
        });
    };

    // ── Toggle expand row ───────────────────────────────────────────────────

    const toggleRow = (key: string) => {
        setExpandedRows(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // ── Build export payload ────────────────────────────────────────────────

    const buildExportPayload = (): SummaryExport => ({
        generated_at: new Date().toISOString(),
        source: {
            sme_last_updated_at: smeStatus?.lastUpdatedAt ?? null,
            sme_source: smeStatus?.source ?? 'unknown',
        },
        config: { startHour, endHour },
        sessions: sessionRows.map(row => ({
            solution_area: row.sa,
            schedule: formatEffectiveSchedule(row.schedule, sessionTimeOverrides),
            session_topic: row.sessionDef.title,
            utc_hour: row.utcHour,
            attendees_count: row.attendees.length,
            attendees: row.attendees.map(a => ({
                name: a['Full Name'] ?? '',
                email: a.Email ?? '',
                country: a.Country ?? '',
                office: a.Office ?? '',
                specialization: a['(AA) Secondary Specialization'] ?? '',
                utc_offset: a._utcOffset,
            })),
            sme: row.assignedSME
                ? {
                    name: row.assignedSME.name,
                    lob: row.assignedSME.lob,
                    office_location: row.assignedSME.office_location,
                    office: row.assignedSME.office_location,
                    email: row.assignedSME.email ?? '',
                }
                : null,
            faculty: row.assignedFaculty
                ? { name: row.assignedFaculty.name, office: row.assignedFaculty.office }
                : null,
            warnings: row.warnings.map(w => ({ code: w.type, label: w.label })),
            warning_codes: row.warnings.map(w => w.type),
        })),
    });


    // ── Export handlers ─────────────────────────────────────────────────────

    const handleExportJSON = () => {
        const payload = buildExportPayload();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `summary_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportCSV = () => {
        const header = [
            t('exportColSolutionArea'), t('exportColSchedule'), t('exportColSession'),
            t('exportColUtcHour'), t('exportColAttendeesCount'),
            t('exportColSmeName'), t('exportColSmeLob'), t('exportColSmeOffice'), t('exportColSmeEmail'),
            t('exportColFacultyName'), t('exportColFacultyOffice'), t('exportColWarnings'),
        ];
        const rows = sessionRows.map(row => [
            row.sa,
            formatEffectiveSchedule(row.schedule, sessionTimeOverrides),
            row.sessionDef.title,
            row.utcHour,
            row.attendees.length,
            row.assignedSME?.name ?? '',
            row.assignedSME?.lob ?? '',
            row.assignedSME?.office_location ?? '',
            row.assignedSME?.email ?? '',
            row.assignedFaculty?.name ?? '',
            row.assignedFaculty?.office ?? '',
            row.warnings.map(w => w.label).join('; '),
        ]);

        const csvContent = [header, ...rows]
            .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `summary_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportExcel = () => {
        const enrichedRecords = records.map(r => {
            return {
                ...r,
                'Asignacion de SMEs': buildAssignmentSummary(getAssignedSA(r), r.Schedule || '', 'sme'),
                'Asignacion de Faculty': buildAssignmentSummary(getAssignedSA(r), r.Schedule || '', 'faculty')
            };
        });

        generateExcel(enrichedRecords, buildExportPayload().config);
    };

    const handleExportKP = () => {
        const header = [
            'Session Name',
            'Calendar Start',
            'Calendar End',
            'Facilitator',
            'Producer',
            'Num of Participants',
            'Participants',
        ];

        const rows = sessionRows.map(row => {
            const startUtc = buildUtcDateForSession(row.sessionDef.date, row.utcHour);
            const endUtc = new Date(startUtc.getTime() + (120 * 60 * 1000));
            const participants = row.attendees
                .map(attendee => attendee['Full Name'] ?? '')
                .filter(Boolean)
                .join(',');

            return [
                buildKpSessionName(row.sessionDef.id, row.schedule),
                toKpDateTime(startUtc),
                toKpDateTime(endUtc),
                row.assignedSME?.name ?? '',
                row.assignedFaculty?.name ?? '',
                row.attendees.length,
                participants,
            ];
        });

        const csvContent = [header, ...rows]
            .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `summary_kp_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // ── Publish to local API ────────────────────────────────────────────────

    const handlePublishAPI = async () => {
        setPublishing(true);
        try {
            const payload = buildExportPayload();
            const res = await fetch(`${API_BASE}/api/public/summary`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            setPublishedUrl(`${API_BASE}/api/public/summary`);
        } catch (err) {
            setPublishedUrl(null);
            alert(t('publishFailed').replace('{err}', String(err)));
        } finally {
            setPublishing(false);
        }
    };


    // ─── Render ──────────────────────────────────────────────────────────────

    const warningColor = (type: SessionWarning['type']) => {
        if (type === 'noSME' || type === 'noFaculty') return '#dc2626';
        return '#f59e0b';
    };

    return (
        <div className="animated-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            {/* ── Header ── */}
            <div className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>{t('summaryTitle')}</h3>
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{t('summaryDesc')}</p>
                    </div>

                    {/* SME source badge */}
                    {smeStatus && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.35rem 0.85rem', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 500,
                            background: smeStatus.source === 'api' ? 'rgba(16,185,129,0.1)' : smeStatus.error ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)',
                            color: smeStatus.source === 'api' ? '#059669' : smeStatus.error ? '#dc2626' : '#6366f1',
                            border: '1px solid',
                            borderColor: smeStatus.source === 'api' ? 'rgba(16,185,129,0.3)' : smeStatus.error ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)',
                        }}>
                            <Globe size={12} />
                            {t('smeSource')}: {smeStatus.source === 'api' ? t('liveData') : smeStatus.error ? t('offlineCache') : t('cachedData')}
                            {smeStatus.fetchedAt && <span style={{ opacity: 0.7 }}>&nbsp;· {new Date(smeStatus.fetchedAt).toLocaleDateString()}</span>}
                        </div>
                    )}
                </div>

                {/* Error warning */}
                {smeStatus?.error && (
                    <div style={{ marginTop: '0.75rem', padding: '0.6rem 1rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#dc2626', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <AlertTriangle size={14} /> {smeStatus.error}
                    </div>
                )}

                {/* Export + Publish buttons */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem' }}>
                    <button
                        onClick={handleExportExcel}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
                    >
                        <FileSpreadsheet size={16} /> {t('exportExcel')}
                    </button>
                    <button
                        onClick={handleExportCSV}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
                    >
                        <FileText size={16} /> {t('exportCSV')}
                    </button>
                    <button
                        onClick={handleExportJSON}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
                    >
                        <FileJson size={16} /> {t('exportJSON')}
                    </button>
                    <button
                        onClick={handleExportKP}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}
                    >
                        <FileText size={16} /> {t('exportKP')}
                    </button>
                    <button
                        onClick={handlePublishAPI}
                        disabled={publishing}
                        className="btn"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', background: 'var(--primary-color)', color: 'white', border: 'none', opacity: publishing ? 0.7 : 1 }}
                    >
                        <Send size={16} /> {publishing ? '...' : t('publishAPI')}
                    </button>
                    {publishedUrl && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', padding: '0.4rem 0.9rem', borderRadius: '9999px', background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#059669' }}>
                            <CheckCircle size={13} />
                            {t('publicURL')}:&nbsp;
                            <a href={publishedUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', fontWeight: 600 }}>{publishedUrl}</a>
                        </div>
                    )}
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '0.9rem 1.2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    {t('warningSessionsCount')}: <strong style={{ color: warningsCount > 0 ? '#dc2626' : '#059669' }}>{warningsCount}</strong>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowOnlyWarnings(false)}
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem', background: !showOnlyWarnings ? '#e2e8f0' : 'white' }}
                    >
                        {t('warningFilterAll')}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => setShowOnlyWarnings(true)}
                        style={{ fontSize: '0.82rem', padding: '0.35rem 0.75rem', background: showOnlyWarnings ? '#fee2e2' : 'white', borderColor: showOnlyWarnings ? '#fecaca' : '#e2e8f0' }}
                    >
                        {t('warningFilterOnly')}
                    </button>
                </div>
            </div>

            {/* ── Main table ── */}
            {visibleRows.length === 0 ? (
                <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    {t('noSessions')}
                </div>
            ) : (
                <div className="glass-panel" style={{ overflowX: 'auto', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem', minWidth: 1300 }}>
                        <thead>
                            <tr style={{ background: 'rgba(248,250,252,0.95)', borderBottom: '2px solid #e2e8f0' }}>
                                <th style={thStyle}>{t('solutionArea')}</th>
                                <th style={thStyle}>{t('scheduleLabel')}</th>
                                <th style={thStyle}>{t('sessionTopic')}</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>{t('utcHour')}</th>
                                <th style={{ ...thStyle, textAlign: 'center' }}>{t('attendeesCount')}</th>
                                <th style={{ ...thStyle, minWidth: 200 }}>{t('assignedSMECol')}</th>
                                <th style={{ ...thStyle, minWidth: 180 }}>{t('assignedFacultyCol')}</th>
                                <th style={thStyle}>{t('warnings')}</th>
                                <th style={{ ...thStyle, width: 110 }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleRows.map((row, idx) => {
                                const rowKey = `${row.sa}__${row.schedule}__${row.sessionDef.id}`;
                                const isExpanded = expandedRows.has(rowKey);
                                const hasWarning = row.warnings.length > 0;

                                return (
                                    <Fragment key={rowKey}>
                                        <tr
                                            style={{
                                                borderBottom: isExpanded ? 'none' : '1px solid #f0f4f8',
                                                background: idx % 2 === 0 ? 'rgba(255,255,255,0.7)' : 'rgba(248,250,252,0.5)',
                                                transition: 'background 0.15s',
                                            }}
                                        >
                                            {/* Solution Area */}
                                            <td style={tdStyle}>
                                                <span style={{ padding: '0.2rem 0.55rem', borderRadius: '12px', background: '#e0f2fe', color: '#0369a1', fontSize: '0.78rem', fontWeight: 600 }}>
                                                    {row.sa}
                                                </span>
                                            </td>

                                            {/* Schedule */}
                                            <td style={tdStyle}>
                                                <div style={{ fontWeight: 500, fontSize: '0.82rem' }}>
                                                    {formatEffectiveSchedule(row.schedule, sessionTimeOverrides).replace(`${row.sa} `, '')}
                                                </div>
                                            </td>

                                            {/* Session topic */}
                                            <td style={tdStyle}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                                    <span style={{ fontWeight: 500 }}>{row.sessionDef.title}</span>
                                                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{row.sessionDef.onlineSessionDay}</span>
                                                    <span style={{ fontSize: '0.72rem', color: '#0369a1' }}>{row.sessionDef.date}</span>
                                                </div>
                                            </td>

                                            {/* UTC Hour */}
                                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                <span style={{ fontWeight: 600, color: 'var(--primary-color)' }}>{row.utcHour}:00</span>
                                            </td>

                                            {/* Attendees count */}
                                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
                                                    <span style={{ fontWeight: 600 }}>{row.attendees.length}</span>
                                                    {row.attendees.length > 0 && (
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                                            {row.attendees.slice(0, 2).map(a => a['Full Name']).join(', ')}
                                                            {row.attendees.length > 2 ? '…' : ''}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* SME dropdown */}
                                            <td style={{ ...tdStyle, minWidth: 200 }}>
                                                {row.eligibleSMEs.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                            <UserCircle2 size={14} style={{ position: 'absolute', left: '0.5rem', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                                                            <select
                                                                value={row.assignedSME?.name || ''}
                                                                onChange={e => handleSMEChange(row.sa, row.schedule, row.sessionDef.id, e.target.value)}
                                                                style={{ ...selectStyle, paddingLeft: '1.8rem', border: row.assignedSME ? '1px solid #cbd5e1' : '1px solid #fecaca', background: row.assignedSME ? '#fff' : '#fef2f2' }}
                                                            >
                                                                <option value="" disabled>{t('selectSMEPlaceholder')}</option>
                                                                {row.eligibleSMEs.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                                                            </select>
                                                        </div>
                                                        {row.assignedSME && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0.4rem', paddingLeft: '0.2rem' }}>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><Building2 size={11} />{row.assignedSME.lob}</span>
                                                                <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><MapPin size={11} />{row.assignedSME.office_location}</span>
                                                                {row.assignedSME.email && (
                                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}><Mail size={11} />{row.assignedSME.email}</span>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                        <AlertTriangle size={13} /> {t('warnNoSME')}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Faculty dropdown */}
                                            <td style={{ ...tdStyle, minWidth: 180 }}>
                                                {row.eligibleFaculty.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                            <Presentation size={14} style={{ position: 'absolute', left: '0.5rem', color: '#ce9600', pointerEvents: 'none' }} />
                                                            <select
                                                                value={row.assignedFaculty?.name || ''}
                                                                onChange={e => handleFacultyChange(row.sa, row.schedule, row.sessionDef.id, e.target.value)}
                                                                style={{ ...selectStyle, paddingLeft: '1.8rem', border: row.assignedFaculty ? '1px solid #cbd5e1' : '1px solid #fecaca', background: row.assignedFaculty ? '#fff' : '#fef2f2' }}
                                                            >
                                                                <option value="" disabled>{t('selectFacultyPlaceholder')}</option>
                                                                {row.eligibleFaculty.map(f => <option key={f.name} value={f.name}>{f.name}</option>)}
                                                            </select>
                                                        </div>
                                                        {row.assignedFaculty && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.4rem', paddingLeft: '0.2rem' }}>
                                                                <MapPin size={11} />{row.assignedFaculty.office}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '0.8rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                        <AlertTriangle size={13} /> {t('warnNoFaculty')}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Warnings */}
                                            <td style={tdStyle}>
                                                {hasWarning ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                        {row.warnings.map((w, wi) => (
                                                            <span key={wi} style={{ fontSize: '0.75rem', fontWeight: 500, color: warningColor(w.type), display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                                <AlertTriangle size={12} /> {w.label}
                                                            </span>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <span style={{ fontSize: '0.78rem', color: '#059669', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                        <CheckCircle size={13} /> {t('statusOK')}
                                                    </span>
                                                )}
                                            </td>

                                            {/* Expand/collapse toggle */}
                                            <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                {row.attendees.length > 0 && (
                                                    <button
                                                        onClick={() => toggleRow(rowKey)}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                                                            padding: '0.3rem 0.7rem', borderRadius: '6px', border: '1px solid var(--glass-border)',
                                                            background: isExpanded ? 'var(--primary-color)' : 'rgba(255,255,255,0.7)',
                                                            color: isExpanded ? 'white' : 'var(--text-secondary)',
                                                            fontSize: '0.78rem', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                                                        }}
                                                    >
                                                        {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                        {isExpanded ? t('collapse') : t('details')}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>

                                        {/* Expanded attendees sub-table */}
                                        {isExpanded && (
                                            <tr style={{ background: 'rgba(241,245,249,0.9)' }}>
                                                <td colSpan={9} style={{ padding: '0 0 0.5rem 2rem', borderBottom: '2px solid #e2e8f0' }}>
                                                    <div style={{ padding: '1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.7)', border: '1px solid #e2e8f0' }}>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                                            <thead>
                                                                <tr style={{ borderBottom: '1px solid #e2e8f0', color: 'var(--text-secondary)', fontWeight: 600 }}>
                                                                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left' }}>{t('associateName')}</th>
                                                                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left' }}>{t('associateCountry')}</th>
                                                                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left' }}>{t('associateOffice')}</th>
                                                                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'left' }}>{t('associateRole')}</th>
                                                                    <th style={{ padding: '0.4rem 0.75rem', textAlign: 'center' }}>{t('associateUTC')}</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {row.attendees.map((a, ai) => (
                                                                    <tr key={ai} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                                                        <td style={{ padding: '0.4rem 0.75rem', fontWeight: 500 }}>{a['Full Name']}</td>
                                                                        <td style={{ padding: '0.4rem 0.75rem' }}>{a.Country}</td>
                                                                        <td style={{ padding: '0.4rem 0.75rem' }}>{a.Office}</td>
                                                                        <td style={{ padding: '0.4rem 0.75rem' }}>{a['(AA) Secondary Specialization'] || '-'}</td>
                                                                        <td style={{ padding: '0.4rem 0.75rem', textAlign: 'center', fontWeight: 600, color: 'var(--primary-color)' }}>
                                                                            {a._utcOffset !== undefined ? `UTC${a._utcOffset >= 0 ? '+' : ''}${a._utcOffset}` : 'N/A'}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Style helpers ─────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
    padding: '0.85rem 1rem',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    textAlign: 'left',
    whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
    padding: '0.75rem 1rem',
    verticalAlign: 'middle',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
};

const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.4rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.82rem',
    cursor: 'pointer',
    appearance: 'none',
    boxShadow: '0 1px 2px 0 rgba(0,0,0,0.04)',
    outline: 'none',
};
