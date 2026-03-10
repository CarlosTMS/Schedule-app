import { useMemo } from 'react';
import { Users, Clock, MapPin, UserCircle2, AlertCircle, Globe2, Briefcase } from 'lucide-react';
import { useI18n } from '../i18n';
import type { StudentRecord } from '../lib/excelParser';
import { autoAssignDebriefs } from '../lib/debriefMatcher';
import { getKnownUtcOffset } from '../lib/timezones';

const formatLocalTime = (utcDecimal: number, durationHours: number, city: string | undefined): string => {
    if (!city) return '';
    const localStart = (utcDecimal + getKnownUtcOffset(city) + 24) % 24;
    const localEnd = (localStart + durationHours) % 24;

    const formatHour = (d: number) => {
        const h = Math.floor(d).toString().padStart(2, '0');
        const m = Math.round((d - Math.floor(d)) * 60).toString().padStart(2, '0');
        return `${h}:${m}`;
    };

    return `${formatHour(localStart)} - ${formatHour(localEnd)} Local`;
};

interface FacultyDebriefScheduleProps {
    records: StudentRecord[];
    startHour: number;
    endHour: number;
    sessionLength?: number;
    sessionTimeOverrides?: Record<string, number>;
}

export function FacultyDebriefSchedule({ records, startHour, endHour, sessionLength = 90, sessionTimeOverrides = {} }: FacultyDebriefScheduleProps) {
    const { t } = useI18n();

    // Memoize the matches so we don't recalculate on every render unless records change
    const batches = useMemo(() => {
        return autoAssignDebriefs(records, startHour, endHour, sessionLength, sessionTimeOverrides);
    }, [records, startHour, endHour, sessionLength, sessionTimeOverrides]);

    if (batches.length === 0) {
        return (
            <div className="glass-panel animated-fade-in" style={{ marginTop: '2rem', padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                {t('noDebriefsFound') || 'No scheduled sessions available for Faculty Debriefs.'}
            </div>
        );
    }

    return (
        <div className="glass-panel animated-fade-in" style={{ marginTop: '2rem', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.5rem', borderRadius: '8px', color: 'var(--primary-color)' }}>
                    <Users size={24} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>{t('facultyDebrief') || 'Faculty Debrief Schedule'}</h3>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.6)', borderRadius: '12px', overflowX: 'auto', border: '1px solid var(--glass-border)' }}>
                <table style={{ width: '100%', minWidth: '1000px', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ background: 'rgba(248, 250, 252, 0.8)', borderBottom: '1px solid #e2e8f0' }}>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('baseSession') || 'Base Session'}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('debriefTime') || 'Debrief Time'}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('assignedFaculty') || 'Assigned Faculty'}</th>
                            <th style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-secondary)', width: '50%' }}>{t('batchAssociates') || 'Associates in Batch (Max 20)'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {batches.map((batch, index) => {
                            const isLast = index === batches.length - 1;
                            const hasFaculty = !!batch.assignedFaculty;

                            return (
                                <tr key={batch.batchId} style={{ borderBottom: isLast ? 'none' : '1px solid #e2e8f0', background: hasFaculty ? 'transparent' : 'rgba(239, 68, 68, 0.05)' }}>
                                    <td style={{ padding: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.05rem', marginBottom: '0.5rem' }}>
                                            Sesión {index + 1}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                            {batch.baseSchedules.map(bs => (
                                                <span key={bs} style={{
                                                    background: 'rgba(59, 130, 246, 0.05)',
                                                    padding: '3px 8px',
                                                    borderRadius: '4px',
                                                    border: '1px solid rgba(59, 130, 246, 0.2)',
                                                    color: 'var(--primary-color)',
                                                    display: 'inline-block',
                                                    width: 'max-content'
                                                }}>
                                                    {bs}
                                                </span>
                                            ))}
                                        </div>
                                    </td>

                                    <td style={{ padding: '1rem', fontSize: '0.9rem', color: 'var(--text-secondary)', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--primary-color)', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.95rem', marginBottom: '0.5rem' }}>
                                            <Clock size={15} />
                                            {batch.debriefStartUtcTime.replace(' UTC', '')} - {batch.debriefEndUtcTime}
                                        </div>
                                        {hasFaculty && batch.assignedFaculty && (
                                            <div style={{ fontSize: '1.05rem', color: '#ce9600', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                {formatLocalTime(batch.debriefStartUtcDecimal, 0.5, batch.assignedFaculty.city)}
                                            </div>
                                        )}
                                    </td>

                                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                                        {hasFaculty ? (
                                            <div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                                    <UserCircle2 size={16} color="var(--text-secondary)" />
                                                    {batch.assignedFaculty?.name}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                                                    <MapPin size={12} />
                                                    {batch.assignedFaculty?.city}, {batch.assignedFaculty?.country}
                                                </div>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.85rem', color: 'var(--danger-color)', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <AlertCircle size={14} />
                                                No faculty within working hours
                                            </span>
                                        )}
                                    </td>

                                    <td style={{ padding: '1rem', verticalAlign: 'top' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                                                    Batch Size: <span style={{ color: 'var(--primary-color)' }}>{batch.associates.length}</span>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                {/* Detailed Associate List */}
                                                <div style={{
                                                    flex: '1 1 300px',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '0.3rem',
                                                    maxHeight: '180px',
                                                    overflowY: 'auto',
                                                    paddingRight: '0.5rem'
                                                }}>
                                                    {batch.associates.map((a, i) => (
                                                        <div key={i} style={{
                                                            background: 'rgba(241, 245, 249, 0.4)',
                                                            border: '1px solid #e2e8f0',
                                                            borderRadius: '6px',
                                                            padding: '0.4rem 0.6rem',
                                                            fontSize: '0.8rem',
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center'
                                                        }}>
                                                            <div>
                                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a['Full Name']}</div>
                                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                                                    {a['Solution Week SA']} | {a.Program || a['(AA) Secondary Specialization'] || 'Unknown Program'}
                                                                </div>
                                                            </div>
                                                            <div style={{ textAlign: 'right', fontSize: '0.7rem', color: '#64748b' }}>
                                                                <div>{a.Country}</div>
                                                                <div>UTC{a._utcOffset && a._utcOffset > 0 ? `+${a._utcOffset}` : a._utcOffset}</div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>

                                                {/* Demographics Metrics */}
                                                <div style={{
                                                    flex: '0 0 160px',
                                                    background: 'rgba(248, 250, 252, 0.5)',
                                                    border: '1px solid #f1f5f9',
                                                    borderRadius: '8px',
                                                    padding: '0.5rem',
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: '0.7rem',
                                                    fontSize: '0.75rem'
                                                }}>
                                                    {(() => {
                                                        const reqSA = batch.associates.map(a => a['Solution Week SA']);
                                                        const saCounts = reqSA.reduce((acc, curr) => { acc[curr || 'Unknown'] = (acc[curr || 'Unknown'] || 0) + 1; return acc; }, {} as Record<string, number>);

                                                        const reqGeo = batch.associates.map(a => a.Country);
                                                        const geoCounts = reqGeo.reduce((acc, curr) => { acc[curr || 'Unknown'] = (acc[curr || 'Unknown'] || 0) + 1; return acc; }, {} as Record<string, number>);

                                                        return (
                                                            <>
                                                                <div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.2rem' }}>
                                                                        <Globe2 size={12} /> Geographies
                                                                    </div>
                                                                    {Object.entries(geoCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([geo, count]) => (
                                                                        <div key={geo} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100px' }}>{geo}</span>
                                                                            <span style={{ fontWeight: 600 }}>{count}</span>
                                                                        </div>
                                                                    ))}
                                                                    {Object.keys(geoCounts).length > 3 && <div style={{ color: '#94a3b8', fontSize: '0.7rem' }}>+ others</div>}
                                                                </div>

                                                                <div>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)', fontWeight: 600, marginBottom: '0.2rem' }}>
                                                                        <Briefcase size={12} /> Solution Areas
                                                                    </div>
                                                                    {Object.entries(saCounts).sort((a, b) => b[1] - a[1]).map(([sa, count]) => (
                                                                        <div key={sa} style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100px' }}>{sa}</span>
                                                                            <span style={{ fontWeight: 600 }}>{count}</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
