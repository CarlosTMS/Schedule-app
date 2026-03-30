import { useMemo, useState } from 'react';
import type { StudentRecord } from '../lib/excelParser';
import { useI18n } from '../i18n';
import { getKnownUtcOffset, getEffectiveSessionUtcHour, formatUtcHourLabel, makeSessionInstanceOverrideKey, wrapUtcHour } from '../lib/timezones';
import { activePlanningSessions } from '../lib/sessionCatalog';
import { Minus, Plus, Users } from 'lucide-react';
import type { SessionId } from '../lib/smeMatcher';

interface SessionBreakdownProps {
    records: StudentRecord[];
    sessionTimeOverrides?: Record<string, number>; // scheduleKey (e.g. "Cloud ERP Session 1") -> UTC hour
    onSessionTimeChange?: (scheduleKey: string, newUtcHour: number) => void;
    onMoveToSession?: (recordIndices: number[], targetSchedule: string) => void;
    maxSessionSize?: number;
    schedulesBySA?: Record<string, Set<string>>;
    sessionInstanceTimeOverrides?: Record<string, number>;
    onSessionInstanceTimeOverridesChange?: (next: Record<string, number>) => void;
}

// Extract the session key (without time part) from a full schedule string
const extractScheduleKey = (scheduleName: string): string => {
    return scheduleName.replace(/ \(\d{1,2}:\d{2} UTC\)/, '').trim();
};

// Extract UTC hour from a schedule string
const extractUtcHour = (scheduleName: string): number => {
    const match = scheduleName.match(/(\d{1,2}):(\d{2}) UTC/);
    if (match) {
        const h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        return h + (m / 60);
    }
    return 0;
};

export function SessionBreakdown({ 
    records, 
    sessionTimeOverrides = {}, 
    onSessionTimeChange, 
    onMoveToSession, 
    maxSessionSize = 40,
    schedulesBySA = {},
    sessionInstanceTimeOverrides = {},
    onSessionInstanceTimeOverridesChange
}: SessionBreakdownProps) {
    const { t } = useI18n();
    const [selectedView, setSelectedView] = useState<string>('Overview');

    const getAssignedSA = (r: StudentRecord): string => {
        const legacy = (r as StudentRecord & { 'Solution Week SA'?: string })['Solution Week SA'];
        return r['Solution Weeks SA'] || legacy || '';
    };

    const uniqueSAs = useMemo(() => {
        const sas = new Set<string>();
        records.forEach(r => {
            const sa = getAssignedSA(r);
            if (sa && sa !== 'Unassigned') sas.add(sa);
        });
        return Array.from(sas).sort();
    }, [records]);

    const data = useMemo(() => {
        const bySA: Record<string, { totalInSA: number, allocated: number, sessions: Record<string, StudentRecord[]> }> = {};

        records.forEach(r => {
            const sa = getAssignedSA(r);
            const schedule = r.Schedule;

            if (!sa || sa === 'Unassigned') return;

            if (!bySA[sa]) {
                bySA[sa] = { totalInSA: 0, allocated: 0, sessions: {} };
            }

            bySA[sa].totalInSA++;

            if (!schedule || schedule === 'Outlier-Schedule') return;

            bySA[sa].allocated++;
            if (!bySA[sa].sessions[schedule]) {
                bySA[sa].sessions[schedule] = [];
            }
            bySA[sa].sessions[schedule].push(r);
        });

        // Convert to array and sort by SA
        return Object.entries(bySA)
            .map(([sa, info]) => ({
                sa,
                totalInSA: info.totalInSA,
                allocated: info.allocated,
                sessions: Object.entries(info.sessions)
                    .map(([name, students]) => {
                        const scheduleKey = extractScheduleKey(name);
                        const originalUtcHour = extractUtcHour(name);
                        const utcHour = scheduleKey in sessionTimeOverrides ? sessionTimeOverrides[scheduleKey] : originalUtcHour;

                        // Per-localTime buckets: both a count map and full record arrays
                        const localTimeBuckets: Record<string, StudentRecord[]> = {};
                        students.forEach((s: StudentRecord) => {
                            const offset = s._utcOffset ?? 0;
                            let localStart = utcHour + offset;
                            while (localStart < 0) localStart += 24;
                            while (localStart >= 24) localStart -= 24;
                            
                            const totalMin = Math.round(localStart * 60);
                            const h = Math.floor(totalMin / 60).toString().padStart(2, '0');
                            const m = (totalMin % 60).toString().padStart(2, '0');
                            const displayStartStr = `${h}:${m} Local`;
                            
                            if (!localTimeBuckets[displayStartStr]) localTimeBuckets[displayStartStr] = [];
                            localTimeBuckets[displayStartStr].push(s);
                        });
                        const localTimes: Record<string, number> = {};
                        Object.entries(localTimeBuckets).forEach(([lt, recs]) => { localTimes[lt] = recs.length; });

                        const formatCityTime = (h: number, offset: number, label: string) => {
                            let curr = h + offset;
                            while (curr < 0) curr += 24;
                            while (curr >= 24) curr -= 24;
                            const totalMin = Math.round(curr * 60);
                            const hh = Math.floor(totalMin / 60).toString().padStart(2, '0');
                            const mm = (totalMin % 60).toString().padStart(2, '0');
                            return `${hh}:${mm} ${label}`;
                        };

                        const sgOffset = getKnownUtcOffset(undefined, undefined, 'Singapore');
                        const berOffset = getKnownUtcOffset(undefined, undefined, 'Germany');
                        const nyOffset = getKnownUtcOffset(undefined, undefined, 'United States');

                        const singaporeTime = formatCityTime(utcHour, sgOffset, 'SG');
                        const berlinTime = formatCityTime(utcHour, berOffset, 'BER');
                        const nyTime = formatCityTime(utcHour, nyOffset, 'NY');

                        return {
                            name,
                            count: students.length,
                            localTimes,
                            localTimeBuckets,
                            globalTimes: `${singaporeTime} | ${berlinTime} | ${nyTime}`
                        };
                    })
                    .sort((a, b) => a.name.localeCompare(b.name))
            }))
            .sort((a, b) => a.sa.localeCompare(b.sa));
    }, [records, sessionTimeOverrides]);

    // Effective UTC hour for a session name (override or original)
    const getEffectiveUtcHour = (sessionName: string): number => {
        const key = extractScheduleKey(sessionName);
        return key in sessionTimeOverrides ? sessionTimeOverrides[key] : extractUtcHour(sessionName);
    };

    const getGlobalTimes = (utcHour: number, referenceDate?: string): string => {
        const formatCityTime = (h: number, offset: number, label: string) => {
            let curr = h + offset;
            while (curr < 0) curr += 24;
            while (curr >= 24) curr -= 24;
            const totalMin = Math.round(curr * 60);
            const hh = Math.floor(totalMin / 60).toString().padStart(2, '0');
            const mm = (totalMin % 60).toString().padStart(2, '0');
            return `${hh}:${mm} ${label}`;
        };
        const sgOffset = getKnownUtcOffset(undefined, referenceDate, 'Singapore');
        const berOffset = getKnownUtcOffset(undefined, referenceDate, 'Germany');
        const nyOffset = getKnownUtcOffset(undefined, referenceDate, 'United States');

        const sgTime = formatCityTime(utcHour, sgOffset, 'SG');
        const berTime = formatCityTime(utcHour, berOffset, 'BER');
        const nyTime = formatCityTime(utcHour, nyOffset, 'NY');
        return `${sgTime} | ${berTime} | ${nyTime}`;
    };

    if (data.length === 0) return null;

    const handleSessionTimeAdjustment = (targetSA: string, schedule: string, sessionId: SessionId, delta: number) => {
        if (!onSessionInstanceTimeOverridesChange) return;
        const key = makeSessionInstanceOverrideKey(targetSA, schedule, sessionId);
        const currentHour = getEffectiveSessionUtcHour(targetSA, schedule, sessionId, sessionInstanceTimeOverrides, sessionTimeOverrides);
        onSessionInstanceTimeOverridesChange({
            ...sessionInstanceTimeOverrides,
            [key]: wrapUtcHour(currentHour + delta),
        });
    };

    const renderOverview = () => (
        <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                        <th style={{ padding: '0.75rem', width: '20%' }}>{t('specialization') || 'Specialization'}</th>
                        <th style={{ padding: '0.75rem', width: '15%' }}>{t('attendees') || 'Attendees'}</th>
                        <th style={{ padding: '0.75rem', width: '32.5%' }}>{t('sessionDetail1') || 'Session 1 Detail'}</th>
                        <th style={{ padding: '0.75rem', width: '32.5%' }}>{t('sessionDetail2') || 'Session 2 Detail'}</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, idx) => {
                        const s1 = row.sessions.length > 0 ? row.sessions[0] : null;
                        const s2 = row.sessions.length > 1 ? row.sessions[1] : null;

                        const renderSession = (s: typeof s1, otherSession: typeof s2) => {
                            if (!s) return <span style={{ color: '#94a3b8' }}>N/A</span>;
                            const effectiveUtcHour = getEffectiveUtcHour(s.name);
                            const effectiveGlobalTimes = getGlobalTimes(effectiveUtcHour);
                            const sessionLabel = s.name.replace(`${row.sa} `, '');
                            const isModified = extractScheduleKey(s.name) in sessionTimeOverrides;
                            const scheduleKey = extractScheduleKey(s.name);
                            const originalHour = extractUtcHour(s.name);
                            const arrowDir = otherSession ? (s.name < otherSession.name ? '→' : '←') : null;

                            return (
                                <>
                                    <div style={{ fontWeight: 600, marginBottom: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ color: s.count > maxSessionSize ? '#ef4444' : 'inherit' }}>
                                            {s.count} {t('people')}:
                                        </span>
                                        {s.count > maxSessionSize && (
                                            <span style={{ 
                                                fontSize: '0.7rem', 
                                                backgroundColor: '#fee2e2', 
                                                color: '#dc2626', 
                                                padding: '2px 6px', 
                                                borderRadius: '4px',
                                                border: '1px solid #fecaca',
                                                fontWeight: 800
                                            }}>
                                                OVER CAPACITY ({maxSessionSize})
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                                        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            {sessionLabel.replace(/ \(\d{1,2}:\d{2} UTC\)/, '')}
                                        </span>
                                        <input
                                            type="time"
                                            value={`${Math.floor(effectiveUtcHour).toString().padStart(2, '0')}:${Math.round((effectiveUtcHour % 1) * 60).toString().padStart(2, '0')}`}
                                            onChange={(e) => {
                                                if (!onSessionTimeChange) return;
                                                const [h, m] = e.target.value.split(':').map(Number);
                                                if (!isNaN(h) && !isNaN(m)) onSessionTimeChange(scheduleKey, h + (m / 60));
                                            }}
                                            title="Adjust UTC start time"
                                            style={{
                                                padding: '2px 4px',
                                                borderRadius: '5px',
                                                border: isModified ? '1.5px solid var(--primary-color)' : '1px solid #cbd5e1',
                                                background: isModified ? 'rgba(59,130,246,0.08)' : '#f8fafc',
                                                fontSize: '0.8rem',
                                                color: isModified ? 'var(--primary-color)' : '#64748b',
                                                fontWeight: isModified ? 700 : 400,
                                                cursor: onSessionTimeChange ? 'pointer' : 'default',
                                                outline: 'none',
                                                width: '88px'
                                            }}
                                            readOnly={!onSessionTimeChange}
                                        />
                                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>UTC</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                            {isModified && onSessionTimeChange && (
                                                <button
                                                    onClick={() => onSessionTimeChange(scheduleKey, originalHour)}
                                                    title="Reset to original"
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        cursor: 'pointer',
                                                        color: '#94a3b8',
                                                        padding: '0',
                                                        fontSize: '0.9rem',
                                                        lineHeight: 1
                                                    }}
                                                >↺</button>
                                            )}
                                        </div>
                                    </div>
                                    <div style={{ color: '#0ea5e9', fontSize: '0.8rem', marginBottom: '0.4rem', fontWeight: 500 }}>
                                        🌎 {effectiveGlobalTimes}
                                    </div>
                                    {Object.keys(s.localTimes).length > 0 && (
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', paddingLeft: '0.5rem', borderLeft: '2px solid #e2e8f0' }}>
                                            {Object.entries(s.localTimes).sort().map(([localTime, count]) => {
                                                const bucket = s.localTimeBuckets?.[localTime] ?? [];
                                                const indices = bucket.map(r => r._originalIndex).filter((i): i is number => i !== undefined);
                                                return (
                                                    <div key={localTime} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                                        <span>- {count} {t('peopleAt')} {localTime}</span>
                                                        {onMoveToSession && otherSession && indices.length > 0 && (
                                                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', marginLeft: 'auto' }}>
                                                                <input 
                                                                    type="number" 
                                                                    min={1} 
                                                                    max={count}
                                                                    defaultValue={count}
                                                                    key={`qty-${scheduleKey}-${localTime}-${count}`} // forced reset on count change
                                                                    id={`qty-${scheduleKey}-${localTime}`}
                                                                    style={{
                                                                        width: '45px',
                                                                        padding: '1px 3px',
                                                                        fontSize: '0.75rem',
                                                                        borderRadius: '3px',
                                                                        border: '1px solid #cbd5e1',
                                                                        background: 'white'
                                                                    }}
                                                                />
                                                                <button
                                                                    onClick={() => {
                                                                        const input = document.getElementById(`qty-${scheduleKey}-${localTime}`) as HTMLInputElement;
                                                                        const qty = parseInt(input?.value || '0');
                                                                        if (qty > 0) {
                                                                            const toMove = indices.slice(0, Math.min(qty, indices.length));
                                                                            onMoveToSession(toMove, otherSession.name);
                                                                        }
                                                                    }}
                                                                    title={`Move people to ${otherSession.name.replace(`${row.sa} `, '')}`}
                                                                    style={{
                                                                        background: 'rgba(99,102,241,0.08)',
                                                                        border: '1px solid rgba(99,102,241,0.25)',
                                                                        borderRadius: '4px',
                                                                        cursor: 'pointer',
                                                                        color: '#6366f1',
                                                                        padding: '0 5px',
                                                                        fontSize: '0.8rem',
                                                                        lineHeight: '1.4',
                                                                        fontWeight: 600,
                                                                        flexShrink: 0
                                                                    }}
                                                                >
                                                                    {arrowDir}
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </>
                            );
                        };

                        return (
                            <tr key={row.sa} style={{ borderBottom: idx === data.length - 1 ? 'none' : '1px solid #e2e8f0' }}>
                                <td style={{ padding: '1rem 0.75rem', fontWeight: 600, verticalAlign: 'top' }}>{row.sa}</td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top' }}>
                                    <div style={{ fontWeight: 600 }}>{row.allocated} {t('of') || 'of'} {row.totalInSA}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('assigned')}</div>
                                </td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top' }}>
                                    {renderSession(s1, s2)}
                                </td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top' }}>
                                    {renderSession(s2, s1)}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );

    const renderDetailSA = (sa: string) => {
        const availableSchedules = Array.from(schedulesBySA[sa] || []).sort((a, b) => a.localeCompare(b));
        const visibleSessions = activePlanningSessions.filter(session => session.facilitatorType !== 'faculty_only');
        
        return (
            <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--glass-border)', marginTop: '1.5rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '30%' }}>Session Topic</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '30%' }}>Schedule</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '40%' }}>Student Detail</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleSessions.map((session, tIndex) => {
                            const topicIsLast = tIndex === visibleSessions.length - 1;

                            return availableSchedules.map((schedule, sIndex) => {
                                const scheduleIsLast = sIndex === availableSchedules.length - 1;
                                const showBorder = scheduleIsLast && !topicIsLast;

                                const utcHour = getEffectiveSessionUtcHour(sa, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
                                
                                // Provide student detail info similar to the overview but specific to this session
                                const matchDetail = data.find(d => d.sa === sa);
                                const currentSessionStudents = matchDetail?.sessions.find(s => s.name === schedule);

                                return (
                                    <tr
                                        key={`${session.id}-${schedule}`}
                                        style={{
                                            borderBottom: showBorder ? '1px solid #cbd5e1' : (topicIsLast && scheduleIsLast ? 'none' : '1px solid #e2e8f0'),
                                        }}
                                    >
                                        {sIndex === 0 && (
                                            <td rowSpan={availableSchedules.length} style={{ padding: '1rem', fontWeight: 500, verticalAlign: 'top', borderRight: '1px solid #e2e8f0' }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                                    <span>{session.title}</span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{session.onlineSessionDay}</span>
                                                    <span style={{ fontSize: '0.75rem', color: '#0369a1' }}>{session.date}</span>
                                                </div>
                                            </td>
                                        )}
                                        <td style={{ padding: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                                                {extractScheduleKey(schedule).replace(`${sa} `, '')}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSessionTimeAdjustment(sa, schedule, session.id, -0.25)}
                                                    style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', padding: '0.2rem', display: 'flex', cursor: 'pointer' }}
                                                    title="Move session 15 mins earlier"
                                                >
                                                    <Minus size={12} />
                                                </button>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary-color)' }}>
                                                    {formatUtcHourLabel(utcHour)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSessionTimeAdjustment(sa, schedule, session.id, 0.25)}
                                                    style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', padding: '0.2rem', display: 'flex', cursor: 'pointer' }}
                                                    title="Move session 15 mins later"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            </div>
                                            <div style={{ color: '#0ea5e9', fontSize: '0.8rem', marginTop: '0.4rem', fontWeight: 500 }}>
                                                🌎 {getGlobalTimes(utcHour, session.date)}
                                            </div>
                                        </td>
                                        <td style={{ padding: '1rem', fontSize: '0.85rem' }}>
                                            {currentSessionStudents ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                                    <span style={{ fontWeight: 600, color: currentSessionStudents.count > maxSessionSize ? 'var(--danger-color)' : 'inherit' }}>
                                                        {currentSessionStudents.count} Attendees {currentSessionStudents.count > maxSessionSize && '(OVER CAPACITY)'}
                                                    </span>
                                                    {Object.entries(currentSessionStudents.localTimes).map(([lt, count]) => (
                                                        <span key={lt} style={{ color: 'var(--text-secondary)' }}>- {count} {t('peopleAt')} {lt}</span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)' }}>No attendees</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            });
                        })}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <div className="animated-fade-in" style={{ marginTop: '0' }}>
            {/* Context Controls */}
            <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.5rem', borderRadius: '8px', color: 'var(--primary-color)' }}>
                            <Users size={24} />
                        </div>
                        <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{t('sessionsBreakdownBySA') || 'Sessions Breakdown by Solution Area'}</h3>
                    </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <button
                        onClick={() => setSelectedView('Overview')}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '9999px',
                            border: '1px solid',
                            borderColor: selectedView === 'Overview' ? 'var(--primary-color)' : 'var(--glass-border)',
                            background: selectedView === 'Overview' ? 'var(--primary-color)' : 'rgba(255,255,255,0.5)',
                            color: selectedView === 'Overview' ? 'white' : 'var(--text-primary)',
                            fontWeight: selectedView === 'Overview' ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: selectedView === 'Overview' ? '0 4px 6px -1px rgba(59, 130, 246, 0.3)' : 'none'
                        }}
                    >
                        Overview
                    </button>
                    {uniqueSAs.map(sa => (
                        <button
                            key={sa}
                            onClick={() => setSelectedView(sa)}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '9999px',
                                border: '1px solid',
                                borderColor: selectedView === sa ? 'var(--primary-color)' : 'var(--glass-border)',
                                background: selectedView === sa ? 'var(--primary-color)' : 'rgba(255,255,255,0.5)',
                                color: selectedView === sa ? 'white' : 'var(--text-primary)',
                                fontWeight: selectedView === sa ? 600 : 400,
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                boxShadow: selectedView === sa ? '0 4px 6px -1px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                        >
                            {sa}
                        </button>
                    ))}
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '1.5rem' }}>
                {selectedView === 'Overview' ? renderOverview() : renderDetailSA(selectedView)}
            </div>
        </div>
    );
}
