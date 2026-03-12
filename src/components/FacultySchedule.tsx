import { useState, useMemo } from 'react';
import { Presentation, MapPin, UserCircle2, AlertCircle } from 'lucide-react';
import { sessions, getEligibleFaculty, autoAssignFaculty } from '../lib/facultyMatcher';
import type { Faculty, SessionId } from '../lib/facultyMatcher';
import { useI18n } from '../i18n';
import { getLocalTimeStr, getKnownUtcOffset, getEffectiveScheduleUtcHour, formatEffectiveSchedule } from '../lib/timezones';

// Shared assignment shape used by Dashboard, FacultySchedule, and Summary
export type FacultyAssignments = Record<string, Record<string, Record<SessionId, Faculty | null>>>;

interface FacultyScheduleProps {
    schedulesBySA: Record<string, Set<string>>;
    startHour: number;
    endHour: number;
    facultyStartHour?: number;
    sessionTimeOverrides?: Record<string, number>;
    /** Lifted-state assignments — from Dashboard */
    manualFacultyAssignments: FacultyAssignments;
    onFacultyAssignmentsChange: (next: FacultyAssignments) => void;
}

export function FacultySchedule({
    schedulesBySA,
    startHour,
    endHour,
    facultyStartHour,
    sessionTimeOverrides = {},
    manualFacultyAssignments,
    onFacultyAssignmentsChange,
}: FacultyScheduleProps) {
    const { t } = useI18n();
    const uniqueSAs = Object.keys(schedulesBySA).sort();

    const [selectedSAState, setSelectedSA] = useState<string>('');
    const selectedSA = uniqueSAs.includes(selectedSAState) ? selectedSAState : (uniqueSAs.length > 0 ? uniqueSAs[0] : '');

    const effectiveFacultyStartHour = facultyStartHour ?? startHour;

    // Helper to get all assignments (manual + auto fallback) across all SAs for conflict detection
    const allAssignments = useMemo(() => {
        const all: FacultyAssignments = {};
        const sAs = Object.keys(schedulesBySA).sort();
        for (const sa of sAs) {
            const avail = Array.from(schedulesBySA[sa] || []).sort((a, b) => a.localeCompare(b));
            all[sa] = manualFacultyAssignments[sa] || autoAssignFaculty(sa, avail, effectiveFacultyStartHour, endHour);
        }
        return all;
    }, [schedulesBySA, manualFacultyAssignments, effectiveFacultyStartHour, endHour]);

    if (!selectedSA) {
        return null;
    }

    const availableSchedules = Array.from(schedulesBySA[selectedSA] || []).sort((a, b) => a.localeCompare(b));

    // Use lifted manual assignments if they exist for this SA; otherwise fallback to auto-assignments.
    const currentAssignments = allAssignments[selectedSA] || {};

    const getConflict = (facultyName: string, targetSchedule: string, targetSA: string): string | null => {
        const targetUtcHour = getEffectiveScheduleUtcHour(targetSchedule, sessionTimeOverrides);
        
        for (const sa of Object.keys(allAssignments)) {
            const saAssignments = allAssignments[sa];
            for (const schedule of Object.keys(saAssignments)) {
                const utcHour = getEffectiveScheduleUtcHour(schedule, sessionTimeOverrides);
                if (utcHour !== targetUtcHour) continue;
                
                const sessionAssignments = saAssignments[schedule];
                for (const sessionId of Object.keys(sessionAssignments)) {
                    // Only flag conflicts if they occur in a DIFFERENT Solution Area
                    if (sa === targetSA) continue;
                    
                    const assigned = sessionAssignments[sessionId as SessionId];
                    if (assigned && assigned.name === facultyName) {
                        const topicObj = sessions.find(s => s.id === sessionId);
                        const topicName = topicObj ? topicObj.title : sessionId;
                        return `${sa} - ${topicName}`; 
                    }
                }
            }
        }
        return null;
    };

    const handleFacultyChange = (schedule: string, sessionId: SessionId, facultyName: string) => {
        const eligible = getEligibleFaculty(selectedSA);
        const newFaculty = eligible.find(f => f.name === facultyName) || null;

        const currentAuto = autoAssignFaculty(selectedSA, availableSchedules, effectiveFacultyStartHour, endHour);
        const saData = manualFacultyAssignments[selectedSA] || currentAuto;

        onFacultyAssignmentsChange({
            ...manualFacultyAssignments,
            [selectedSA]: {
                ...saData,
                [schedule]: {
                    ...saData[schedule],
                    [sessionId]: newFaculty,
                },
            },
        });
    };

    return (
        <div className="glass-panel animated-fade-in" style={{ marginTop: '2rem', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(234, 179, 8, 0.1)', padding: '0.5rem', borderRadius: '8px', color: '#ce9600' }}>
                    <Presentation size={24} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{t('facultyAssignment')}</h3>
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
                            borderColor: selectedSA === sa ? '#ce9600' : 'var(--glass-border)',
                            background: selectedSA === sa ? '#ce9600' : 'rgba(255,255,255,0.5)',
                            color: selectedSA === sa ? 'white' : 'var(--text-primary)',
                            fontWeight: selectedSA === sa ? 600 : 400,
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            boxShadow: selectedSA === sa ? '0 4px 6px -1px rgba(234, 179, 8, 0.3)' : 'none'
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
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '20%' }}>{t('sessionTopic')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '25%' }}>{t('scheduleLabel')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '40%' }}>{t('assignedSME').replace('SME', 'Faculty')}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '15%' }}>{t('locationLabel')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sessions.map((session, tIndex) => {
                            const eligibleFaculty = getEligibleFaculty(selectedSA);
                            const topicIsLast = tIndex === sessions.length - 1;

                            return availableSchedules.map((schedule, sIndex) => {
                                const assignedFaculty = currentAssignments[schedule]?.[session.id];
                                const scheduleIsLast = sIndex === availableSchedules.length - 1;
                                const showBorder = scheduleIsLast && !topicIsLast;

                                let isOutOfHours = false;
                                let conflictDetails: string | null = null;
                                
                                if (assignedFaculty) {
                                    const utcHour = getEffectiveScheduleUtcHour(schedule, sessionTimeOverrides);
                                    const localHour = (utcHour + getKnownUtcOffset(assignedFaculty.office) + 24) % 24;
                                    if (localHour < effectiveFacultyStartHour || localHour >= endHour) {
                                        isOutOfHours = true;
                                    }
                                    conflictDetails = getConflict(assignedFaculty.name, schedule, selectedSA);
                                }

                                return (
                                    <tr key={`${session.id}-${schedule}`} style={{ borderBottom: showBorder ? '1px solid #cbd5e1' : (topicIsLast && scheduleIsLast ? 'none' : '1px solid #e2e8f0'), background: isOutOfHours ? 'rgba(239, 68, 68, 0.05)' : 'transparent' }}>
                                        {sIndex === 0 && (
                                            <td rowSpan={availableSchedules.length} style={{ padding: '1rem', fontWeight: 500, verticalAlign: 'top', borderRight: '1px solid #e2e8f0' }}>
                                                {session.title}
                                            </td>
                                        )}
                                        <td style={{ padding: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                            <div style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                                                {formatEffectiveSchedule(schedule, sessionTimeOverrides).replace(`${selectedSA} `, '')}
                                            </div>
                                            {assignedFaculty && (
                                                <div style={{ fontSize: '0.8rem', marginTop: '0.2rem', color: isOutOfHours ? 'var(--danger-color)' : '#ce9600', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                    {isOutOfHours && <AlertCircle size={12} />}
                                                    {getLocalTimeStr(schedule, assignedFaculty.office, sessionTimeOverrides)}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            {eligibleFaculty.length > 0 ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                                        <UserCircle2 size={16} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-secondary)', pointerEvents: 'none' }} />
                                                        <select
                                                            value={assignedFaculty?.name || ''}
                                                            onChange={(e) => handleFacultyChange(schedule, session.id, e.target.value)}
                                                            style={{
                                                                width: '100%',
                                                                padding: '0.5rem 0.5rem 0.5rem 2.5rem',
                                                                borderRadius: '6px',
                                                                border: conflictDetails ? '1px solid var(--danger-color)' : (assignedFaculty ? '1px solid #cbd5e1' : '1px solid #fecaca'),
                                                                background: conflictDetails ? 'rgba(239, 68, 68, 0.02)' : (assignedFaculty ? '#fff' : '#fef2f2'),
                                                                fontSize: '0.9rem',
                                                                cursor: 'pointer',
                                                                appearance: 'none',
                                                                boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
                                                            }}
                                                        >
                                                            <option value="" disabled>Select Faculty...</option>
                                                            {eligibleFaculty.map(fac => (
                                                                <option key={fac.name} value={fac.name}>{fac.name}</option>
                                                            ))}
                                                        </select>
                                                        {/* Custom dropdown arrow */}
                                                        <div style={{ position: 'absolute', right: '0.75rem', pointerEvents: 'none', color: 'var(--text-secondary)' }}>▼</div>
                                                    </div>
                                                    {conflictDetails && (
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'flex-start', gap: '0.25rem', marginTop: '0.25rem', lineHeight: '1.2' }}>
                                                            <AlertCircle size={12} style={{ flexShrink: 0, marginTop: '2px' }} />
                                                            <span>Time conflict - Faculty already assigned to session "{conflictDetails}"</span>
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <span style={{ fontSize: '0.85rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.25rem', padding: '0.5rem' }}>
                                                    No eligible Faculty
                                                </span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {assignedFaculty ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    <MapPin size={14} color="var(--text-secondary)" />
                                                    {assignedFaculty.office}
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
