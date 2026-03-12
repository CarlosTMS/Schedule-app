import { useMemo } from 'react';
import type { StudentRecord } from '../lib/excelParser';
import { useI18n } from '../i18n';
import { Clock } from 'lucide-react';

interface SessionBreakdownProps {
    records: StudentRecord[];
    sessionTimeOverrides?: Record<string, number>; // scheduleKey (e.g. "Cloud ERP Session 1") -> UTC hour
    onSessionTimeChange?: (scheduleKey: string, newUtcHour: number) => void;
    onMoveToSession?: (recordIndices: number[], targetSchedule: string) => void;
}

// Extract the session key (without time part) from a full schedule string
const extractScheduleKey = (scheduleName: string): string => {
    const withoutTime = scheduleName.replace(/ \(\d+:00 UTC\)/, '').trim();
    // Return just 'Session X' to apply globally across all SAs
    const parts = withoutTime.split(' ');
    if (parts.length >= 2) return parts.slice(-2).join(' ');
    return withoutTime;
};

// Extract UTC hour from a schedule string
const extractUtcHour = (scheduleName: string): number => {
    const match = scheduleName.match(/(\d+):00 UTC/);
    return match ? parseInt(match[1]) : 0;
};

export function SessionBreakdown({ records, sessionTimeOverrides = {}, onSessionTimeChange, onMoveToSession }: SessionBreakdownProps) {
    const { t } = useI18n();

    const data = useMemo(() => {
        const bySA: Record<string, { totalInSA: number, allocated: number, sessions: Record<string, StudentRecord[]> }> = {};

        records.forEach(r => {
            const sa = r['Solution Week SA'];
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
                        const match = name.match(/(\d+):00 UTC/);
                        const originalUtcHour = match ? parseInt(match[1]) : 0;
                        const scheduleKey = extractScheduleKey(name);
                        const utcHour = scheduleKey in sessionTimeOverrides ? sessionTimeOverrides[scheduleKey] : originalUtcHour;

                        // Per-localTime buckets: both a count map and full record arrays
                        const localTimeBuckets: Record<string, StudentRecord[]> = {};
                        students.forEach((s: StudentRecord) => {
                            const localStart = utcHour + (s._utcOffset ?? 0);
                            const displayStart = localStart < 0 ? localStart + 24 : (localStart >= 24 ? localStart - 24 : localStart);
                            const displayStartStr = `${Math.floor(displayStart).toString().padStart(2, '0')}:00 Local`;
                            if (!localTimeBuckets[displayStartStr]) localTimeBuckets[displayStartStr] = [];
                            localTimeBuckets[displayStartStr].push(s);
                        });
                        const localTimes: Record<string, number> = {};
                        Object.entries(localTimeBuckets).forEach(([lt, recs]) => { localTimes[lt] = recs.length; });

                        const singaporeTime = `${Math.floor((utcHour + 8) % 24).toString().padStart(2, '0')}:00 SG`;
                        const berlinTime = `${Math.floor((utcHour + 1) % 24).toString().padStart(2, '0')}:00 BER`;
                        const nyTime = `${Math.floor((utcHour - 5 + 24) % 24).toString().padStart(2, '0')}:00 NY`;

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

    // Collect all unique session keys across all SAs to build the time editor
    const uniqueSessionSlots = useMemo(() => {
        const slots = new Map<string, number>(); // scheduleKey -> original UTC hour
        data.forEach(row => {
            row.sessions.forEach(session => {
                const key = extractScheduleKey(session.name);
                if (!slots.has(key)) {
                    slots.set(key, extractUtcHour(session.name));
                }
            });
        });
        return Array.from(slots.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [data]);

    // Effective UTC hour for a session name (override or original)
    const getEffectiveUtcHour = (sessionName: string): number => {
        const key = extractScheduleKey(sessionName);
        return key in sessionTimeOverrides ? sessionTimeOverrides[key] : extractUtcHour(sessionName);
    };

    const getGlobalTimes = (utcHour: number): string => {
        const sgTime = `${Math.floor((utcHour + 8) % 24).toString().padStart(2, '0')}:00 SG`;
        const berTime = `${Math.floor((utcHour + 1) % 24).toString().padStart(2, '0')}:00 BER`;
        const nyTime = `${Math.floor((utcHour - 5 + 24) % 24).toString().padStart(2, '0')}:00 NY`;
        return `${sgTime} | ${berTime} | ${nyTime}`;
    };

    if (data.length === 0) return null;

    return (
        <div className="glass-panel" style={{ marginTop: '2rem', overflowX: 'auto' }}>
            <h3 style={{ marginBottom: '1rem', marginTop: 0 }}>{t('sessionsBreakdownBySA') || 'Sessions Breakdown by Solution Area'}</h3>

            {/* Session Time Editor */}
            {uniqueSessionSlots.length > 0 && onSessionTimeChange && (
                <div style={{
                    marginBottom: '1.5rem',
                    padding: '1rem 1.25rem',
                    background: 'rgba(59, 130, 246, 0.05)',
                    border: '1px solid rgba(59, 130, 246, 0.15)',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '1.25rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--primary-color)', fontWeight: 600, fontSize: '0.9rem' }}>
                        <Clock size={16} />
                        Adjust Session Start Times (UTC)
                    </div>
                    {uniqueSessionSlots.map(([key, originalHour]) => {
                        const currentHour = key in sessionTimeOverrides ? sessionTimeOverrides[key] : originalHour;
                        const isModified = key in sessionTimeOverrides && sessionTimeOverrides[key] !== originalHour;
                        return (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <label style={{
                                    fontSize: '0.85rem',
                                    fontWeight: 500,
                                    color: isModified ? 'var(--primary-color)' : 'var(--text-secondary)',
                                    whiteSpace: 'nowrap'
                                }}>
                                    {key.split(' ').slice(-2).join(' ')}:
                                    {isModified && <span style={{ fontSize: '0.75rem', marginLeft: '0.35rem', color: 'var(--primary-color)', fontWeight: 700 }}>✎</span>}
                                </label>
                                <input
                                    type="time"
                                    value={`${currentHour.toString().padStart(2, '0')}:00`}
                                    onChange={(e) => {
                                        const [h] = e.target.value.split(':').map(Number);
                                        if (!isNaN(h)) onSessionTimeChange(key, h);
                                    }}
                                    style={{
                                        padding: '0.35rem 0.5rem',
                                        borderRadius: '6px',
                                        border: isModified ? '1px solid var(--primary-color)' : '1px solid #cbd5e1',
                                        background: isModified ? 'rgba(59, 130, 246, 0.08)' : '#fff',
                                        fontSize: '0.9rem',
                                        color: 'var(--text-primary)',
                                        fontWeight: isModified ? 600 : 400,
                                        cursor: 'pointer',
                                        outline: 'none'
                                    }}
                                />
                                {isModified && (
                                    <button
                                        onClick={() => onSessionTimeChange(key, originalHour)}
                                        title="Reset to original"
                                        style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            color: '#94a3b8',
                                            padding: '0.2rem',
                                            fontSize: '0.8rem',
                                            borderRadius: '4px'
                                        }}
                                    >
                                        ↺
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
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
                                    <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>{s.count} {t('people')}:</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                                        <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
                                            {sessionLabel.replace(/ \(\d+:00 UTC\)/, '')}
                                        </span>
                                        <input
                                            type="time"
                                            value={`${effectiveUtcHour.toString().padStart(2, '0')}:00`}
                                            onChange={(e) => {
                                                if (!onSessionTimeChange) return;
                                                const [h] = e.target.value.split(':').map(Number);
                                                if (!isNaN(h)) onSessionTimeChange(scheduleKey, h);
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
                                                            <button
                                                                onClick={() => onMoveToSession(indices, otherSession.name)}
                                                                title={`Move ${count} people to ${otherSession.name.replace(`${row.sa} `, '')}`}
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
}
