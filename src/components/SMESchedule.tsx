import { useState } from 'react';
import { Users, MapPin, Building2, UserCircle2, AlertCircle, RefreshCw, Minus, Plus } from 'lucide-react';
import { sessions, getEligibleSMEs, autoAssignSMEs } from '../lib/smeMatcher';
import type { SME, SessionId } from '../lib/smeMatcher';
import type { SMECacheStatus } from '../lib/smeDataLoader';
import { getKnownUtcOffset, getEffectiveSessionUtcHour, getLocalTimeForUtcHour, extractScheduleKey, formatUtcHourLabel, makeSessionInstanceOverrideKey, wrapUtcHour } from '../lib/timezones';

// Shared assignment shape used by Dashboard, SMESchedule, FacultySchedule, and Summary
export type SmeAssignments = Record<string, Record<string, Record<SessionId, SME | null>>>;

interface SMEScheduleProps {
    schedulesBySA: Record<string, Set<string>>;
    startHour: number;
    endHour: number;
    sessionTimeOverrides?: Record<string, number>;
    sessionInstanceTimeOverrides?: Record<string, number>;
    onSessionInstanceTimeOverridesChange?: (next: Record<string, number>) => void;
    smeList: SME[];
    smeStatus?: SMECacheStatus | null;
    onRefreshSMEs?: () => void;
    /** Lifted-state assignments — from Dashboard */
    manualSmeAssignments: SmeAssignments;
    onSmeAssignmentsChange: (next: SmeAssignments) => void;
}

export function SMESchedule({
    schedulesBySA,
    startHour,
    endHour,
    sessionTimeOverrides = {},
    sessionInstanceTimeOverrides = {},
    onSessionInstanceTimeOverridesChange,
    smeList,
    smeStatus,
    onRefreshSMEs,
    manualSmeAssignments,
    onSmeAssignmentsChange,
}: SMEScheduleProps) {
    const uniqueSAs = Object.keys(schedulesBySA).sort();

    const [selectedSAState, setSelectedSA] = useState<string>('');
    const selectedSA = uniqueSAs.includes(selectedSAState) ? selectedSAState : (uniqueSAs.length > 0 ? uniqueSAs[0] : '');

    if (!selectedSA) {
        return null;
    }

    const availableSchedules = Array.from(schedulesBySA[selectedSA] || []).sort((a, b) => a.localeCompare(b));

    // Use lifted manual assignments if they exist for this SA; otherwise fallback to auto-assignments.
    const currentAssignments = manualSmeAssignments[selectedSA] || autoAssignSMEs(selectedSA, availableSchedules, startHour, endHour, smeList);

    const handleSMEChange = (schedule: string, sessionId: SessionId, smeName: string) => {
        const eligible = getEligibleSMEs(selectedSA, sessionId, smeList);
        const newSME = eligible.find(s => s.name === smeName) || null;

        const currentAuto = autoAssignSMEs(selectedSA, availableSchedules, startHour, endHour, smeList);
        const saData = manualSmeAssignments[selectedSA] || currentAuto;

        onSmeAssignmentsChange({
            ...manualSmeAssignments,
            [selectedSA]: {
                ...saData,
                [schedule]: {
                    ...saData[schedule],
                    [sessionId]: newSME,
                },
            },
        });
    };

    const handleSessionHourChange = (schedule: string, sessionId: SessionId, delta: number) => {
        if (!onSessionInstanceTimeOverridesChange) return;
        const key = makeSessionInstanceOverrideKey(selectedSA, schedule, sessionId);
        const currentHour = getEffectiveSessionUtcHour(selectedSA, schedule, sessionId, sessionInstanceTimeOverrides, sessionTimeOverrides);
        onSessionInstanceTimeOverridesChange({
            ...sessionInstanceTimeOverrides,
            [key]: wrapUtcHour(currentHour + delta),
        });
    };

    return (
        <div className="glass-panel animated-fade-in" style={{ marginTop: '2rem', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.5rem', borderRadius: '8px', color: 'var(--primary-color)' }}>
                        <Users size={24} />
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Subject Matter Experts Assignment</h3>
                </div>
                {/* SME data source badge */}
                {smeStatus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '0.4rem',
                            padding: '0.3rem 0.75rem', borderRadius: '9999px', fontSize: '0.78rem', fontWeight: 500,
                            background: smeStatus.source === 'api' ? 'rgba(16,185,129,0.1)' : smeStatus.error ? 'rgba(239,68,68,0.1)' : 'rgba(99,102,241,0.1)',
                            color: smeStatus.source === 'api' ? '#059669' : smeStatus.error ? '#dc2626' : '#6366f1',
                            border: '1px solid',
                            borderColor: smeStatus.source === 'api' ? 'rgba(16,185,129,0.3)' : smeStatus.error ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)',
                        }}>
                            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />
                            {smeStatus.source === 'api' ? 'Live data' : smeStatus.error ? 'Offline cache' : 'Cached'}
                            {smeStatus.fetchedAt && (
                                <span style={{ opacity: 0.75 }}>
                                    &nbsp;· {new Date(smeStatus.fetchedAt).toLocaleDateString()}
                                </span>
                            )}
                        </div>
                        {onRefreshSMEs && (
                            <button
                                onClick={onRefreshSMEs}
                                title="Force refresh SME data from API"
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    color: 'var(--text-secondary)', padding: '4px', borderRadius: '6px',
                                    display: 'flex', alignItems: 'center',
                                }}
                            >
                                <RefreshCw size={14} />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* SA Radio Buttons / Pills */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '2rem' }}>
                {uniqueSAs.map(sa => (
                    <button
                        key={sa}
                        onClick={() => setSelectedSA(sa)}
                        style={{
                            padding: '0.5rem 1rem',
                            borderRadius: '9999px',
                            border: '1px solid',
                            borderColor: selectedSA === sa ? 'var(--primary-color)' : 'var(--glass-border)',
                            background: selectedSA === sa ? 'var(--primary-color)' : 'rgba(255,255,255,0.5)',
                            color: selectedSA === sa ? 'white' : 'var(--text-primary)',
                            fontWeight: selectedSA === sa ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: selectedSA === sa ? '0 4px 6px -1px rgba(59, 130, 246, 0.3)' : 'none'
                        }}
                    >
                        {sa}
                    </button>
                ))}
            </div>

            {/* Assignment Table */}
            <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--glass-border)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '20%' }}>Session Topic</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '25%' }}>Schedule</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '30%' }}>Assigned SME</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '15%' }}>LoB</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '10%' }}>Location</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.map((session, tIndex) => {
                            const eligibleSMEs = getEligibleSMEs(selectedSA, session.id, smeList);
                            const topicIsLast = tIndex === sessions.length - 1;

                            return availableSchedules.map((schedule, sIndex) => {
                                const assignedSME = currentAssignments[schedule]?.[session.id];
                                const scheduleIsLast = sIndex === availableSchedules.length - 1;
                                const showBorder = scheduleIsLast && !topicIsLast;

                                let isOutOfHours = false;
                                const utcHour = getEffectiveSessionUtcHour(selectedSA, schedule, session.id, sessionInstanceTimeOverrides, sessionTimeOverrides);
                                if (assignedSME) {
                                    const localHour = (utcHour + getKnownUtcOffset(assignedSME.office_location) + 24) % 24;
                                    if (localHour < startHour || localHour >= endHour) {
                                        isOutOfHours = true;
                                    }
                                }

                                return (
                                    <tr key={`${session.id}-${schedule}`} style={{ borderBottom: showBorder ? '1px solid #cbd5e1' : (topicIsLast && scheduleIsLast ? 'none' : '1px solid #e2e8f0'), background: isOutOfHours ? 'rgba(239, 68, 68, 0.05)' : 'transparent' }}>
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
                                                {extractScheduleKey(schedule).replace(`${selectedSA} `, '')}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', marginTop: '0.35rem', flexWrap: 'wrap' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSessionHourChange(schedule, session.id, -1)}
                                                    style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', padding: '0.2rem', display: 'flex', cursor: 'pointer' }}
                                                    title="Move session 1 hour earlier"
                                                >
                                                    <Minus size={12} />
                                                </button>
                                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--primary-color)' }}>
                                                    {formatUtcHourLabel(utcHour)}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSessionHourChange(schedule, session.id, 1)}
                                                    style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: '6px', padding: '0.2rem', display: 'flex', cursor: 'pointer' }}
                                                    title="Move session 1 hour later"
                                                >
                                                    <Plus size={12} />
                                                </button>
                                            </div>
                                            {assignedSME && (
                                                <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', color: isOutOfHours ? 'var(--danger-color)' : 'var(--primary-color)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    {isOutOfHours && <AlertCircle size={12} />}
                                                    {getLocalTimeForUtcHour(utcHour, assignedSME.office_location)}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {eligibleSMEs.length > 0 ? (
                                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                    <UserCircle2 size={16} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                                                    <select
                                                        value={assignedSME?.name || ''}
                                                        onChange={(e) => handleSMEChange(schedule, session.id, e.target.value)}
                                                        style={{
                                                            width: '100%',
                                                            padding: '0.5rem 0.5rem 0.5rem 2.5rem',
                                                            borderRadius: '6px',
                                                            border: assignedSME ? '1px solid #cbd5e1' : '1px solid #fecaca',
                                                            background: assignedSME ? '#fff' : '#fef2f2',
                                                            fontSize: '0.9rem',
                                                            cursor: 'pointer',
                                                            appearance: 'none',
                                                            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                                                        }}
                                                    >
                                                        <option value="" disabled>Select SME...</option>
                                                        {eligibleSMEs.map(sme => (
                                                            <option key={sme.name} value={sme.name}>{sme.name}</option>
                                                        ))}
                                                    </select>
                                                    {/* Custom dropdown arrow */}
                                                    <div style={{ position: 'absolute', right: '0.75rem', pointerEvents: 'none', color: 'var(--text-secondary)' }}>▼</div>
                                                </div>
                                            ) : (
                                                <span style={{ fontSize: '0.85rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem' }}>
                                                    No eligible SMEs
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {assignedSME ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    <Building2 size={14} color="var(--text-secondary)" />
                                                    {assignedSME.lob}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>-</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {assignedSME ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    <MapPin size={14} color="var(--text-secondary)" />
                                                    {assignedSME.office_location}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>-</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            });
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
