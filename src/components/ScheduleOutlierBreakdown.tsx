import type { StudentRecord } from '../lib/excelParser';

interface ScheduleOutlierBreakdownProps {
    records: StudentRecord[];
}

export function ScheduleOutlierBreakdown({ records }: ScheduleOutlierBreakdownProps) {
    const outliers = records.filter(r => r.Schedule === 'Outlier-Schedule');

    if (outliers.length === 0) return null;

    return (
        <div style={{ marginTop: '3rem', backgroundColor: '#fff', padding: '2rem', borderRadius: 'var(--border-radius-md)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.4rem', color: 'var(--danger-color)' }}>Schedule Outliers Breakdown</h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '2rem' }}>
                The following <strong>{outliers.length}</strong> Associates were not included in any session. This happens when the algorithm cannot find a time slot within their working hours that also meets the minimum session attendance rules alongside their global peers.
            </p>

            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
                    <thead>
                        <tr style={{ borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                            <th style={{ padding: '0.75rem', width: '25%' }}>Name</th>
                            <th style={{ padding: '0.75rem', width: '20%' }}>Solution Area</th>
                            <th style={{ padding: '0.75rem', width: '15%' }}>(AA) Secondary Specialization</th>
                            <th style={{ padding: '0.75rem', width: '15%' }}>Country</th>
                            <th style={{ padding: '0.75rem', width: '25%' }}>Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {outliers.map((outlier, idx) => (
                            <tr key={idx} style={{ borderBottom: idx === outliers.length - 1 ? 'none' : '1px solid #e2e8f0' }}>
                                <td style={{ padding: '1rem 0.75rem', fontWeight: 500, verticalAlign: 'top' }}>
                                    {outlier['Full Name']}
                                </td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top' }}>{outlier['Solution Weeks SA'] || 'Unassigned'}</td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top' }}>{outlier['(AA) Secondary Specialization']}</td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top' }}>{outlier.Country}</td>
                                <td style={{ padding: '1rem 0.75rem', verticalAlign: 'top', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    No timezone convergence or insufficient peers to break minimum attendance threshold.
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
