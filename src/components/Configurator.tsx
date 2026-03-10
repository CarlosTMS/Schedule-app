import React from 'react';

export interface Assumptions {
    minSessionSize: number;
    maxSessionSize: number;
    maxSessionsPerDay: number;
    allowedVATSizes: number[];
    sessionLength: number; // in minutes (60, 90, 120)
    maxTimezoneDifference: number; // in hours
    allowSingleRoleVat: boolean;
    facultyStartHour?: number; // local start hour for faculty availability checks
}

interface ConfiguratorProps {
    startHour: number;
    endHour: number;
    onTimeChange: (start: number, end: number) => void;
    assumptions: Assumptions;
    onAssumptionsChange: (assumptions: Assumptions) => void;
}

export function Configurator({ startHour, endHour, onTimeChange, assumptions, onAssumptionsChange }: ConfiguratorProps) {
    const handleStartChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newStart = parseInt(e.target.value, 10);
        if (newStart < endHour) onTimeChange(newStart, endHour);
    };

    const handleEndChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newEnd = parseInt(e.target.value, 10);
        if (newEnd > startHour) onTimeChange(startHour, newEnd);
    };

    const toggleVATSize = (size: number) => {
        const newSizes = assumptions.allowedVATSizes.includes(size)
            ? assumptions.allowedVATSizes.filter(s => s !== size)
            : [...assumptions.allowedVATSizes, size].sort();
        // Prevent deselecting all sizes (fallback to 3)
        if (newSizes.length === 0) newSizes.push(3);
        onAssumptionsChange({ ...assumptions, allowedVATSizes: newSizes });
    };

    const hours = Array.from({ length: 24 }, (_, i) => i);

    return (
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginTop: 0 }}>Global Assumptions & Schedule Setup</h3>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                Define the constraints the Allocation Engine must respect when building Sessions and VATs.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '2rem' }}>
                {/* Time Window */}
                <div>
                    <h4 style={{ marginBottom: '0.5rem', marginTop: 0, fontSize: '0.95rem' }}>Local Time Window</h4>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <select className="input-field" value={startHour} onChange={handleStartChange} style={{ appearance: 'auto', flex: 1, minWidth: '80px', padding: '0.5rem' }}>
                            {hours.map(h => <option key={`start-${h}`} value={h}>{h.toString().padStart(2, '0')}:00</option>)}
                        </select>
                        <span style={{ color: 'var(--text-secondary)' }}>to</span>
                        <select className="input-field" value={endHour} onChange={handleEndChange} style={{ appearance: 'auto', flex: 1, minWidth: '80px', padding: '0.5rem' }}>
                            {hours.map(h => <option key={`end-${h}`} value={h}>{h.toString().padStart(2, '0')}:00</option>)}
                        </select>
                    </div>
                </div>

                {/* Session Constraints */}
                <div>
                    <h4 style={{ marginBottom: '0.5rem', marginTop: 0, fontSize: '0.95rem' }}>Session Constraints</h4>
                    <div style={{ display: 'flex', gap: '1rem', flexDirection: 'column' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '0.9rem' }}>Min Attendees / Session</label>
                            <input
                                type="number"
                                className="input-field"
                                style={{ width: '80px', padding: '0.4rem' }}
                                min={5}
                                max={50}
                                value={assumptions.minSessionSize}
                                onChange={e => {
                                    const val = parseInt(e.target.value);
                                    onAssumptionsChange({ ...assumptions, minSessionSize: isNaN(val) ? 5 : Math.max(1, val) });
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '0.9rem' }}>Max Attendees / Session</label>
                            <input
                                type="number"
                                className="input-field"
                                style={{ width: '80px', padding: '0.4rem' }}
                                min={assumptions.minSessionSize}
                                max={200}
                                value={assumptions.maxSessionSize}
                                onChange={e => {
                                    const val = parseInt(e.target.value);
                                    onAssumptionsChange({ ...assumptions, maxSessionSize: isNaN(val) ? 50 : Math.max(assumptions.minSessionSize, val) });
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <label style={{ fontSize: '0.9rem' }}>Max Sessions / Day</label>
                            <input
                                type="number"
                                className="input-field"
                                style={{ width: '80px', padding: '0.4rem' }}
                                min={1}
                                max={5}
                                value={assumptions.maxSessionsPerDay}
                                onChange={e => {
                                    const val = parseInt(e.target.value);
                                    onAssumptionsChange({ ...assumptions, maxSessionsPerDay: isNaN(val) ? 1 : Math.max(1, val) });
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                            <label style={{ fontSize: '0.9rem' }}>Session Length (mins)</label>
                            <select
                                className="input-field"
                                style={{ width: '80px', padding: '0.4rem' }}
                                value={assumptions.sessionLength || 90}
                                onChange={e => {
                                    const val = parseInt(e.target.value);
                                    onAssumptionsChange({ ...assumptions, sessionLength: val });
                                }}
                            >
                                <option value={60}>60</option>
                                <option value={90}>90</option>
                                <option value={120}>120</option>
                            </select>
                        </div>
                    </div>
                </div>

                {/* VAT Size Constraints */}
                <div>
                    <h4 style={{ marginBottom: '0.5rem', marginTop: 0, fontSize: '0.95rem' }}>Allowed VAT Sizes</h4>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {[2, 3, 4].map(size => (
                            <label key={size} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                                <input
                                    type="checkbox"
                                    checked={assumptions.allowedVATSizes.includes(size)}
                                    onChange={() => toggleVATSize(size)}
                                />
                                {size} members
                            </label>
                        ))}
                    </div>
                    {assumptions.allowedVATSizes.length > 0 && (
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.5rem', margin: 0 }}>
                            Algorithm will prioritize {[3, 4, 2].filter(s => assumptions.allowedVATSizes.includes(s)).join(', then ')}.
                        </p>
                    )}

                    <div style={{ marginTop: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                            <input
                                type="checkbox"
                                checked={assumptions.allowSingleRoleVat}
                                onChange={(e) => onAssumptionsChange({ ...assumptions, allowSingleRoleVat: e.target.checked })}
                            />
                            Allow VATs with a single role
                        </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem' }}>
                        <label style={{ fontSize: '0.9rem' }}>Max Timezone Diff (hours)</label>
                        <input
                            type="number"
                            className="input-field"
                            style={{ width: '80px', padding: '0.4rem' }}
                            min={0}
                            max={12}
                            value={assumptions.maxTimezoneDifference || 5}
                            onChange={e => {
                                const val = parseInt(e.target.value);
                                onAssumptionsChange({ ...assumptions, maxTimezoneDifference: isNaN(val) ? 5 : Math.max(0, Math.min(12, val)) });
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                        <label style={{ fontSize: '0.9rem' }}>Faculty Local Start Hour</label>
                        <input
                            type="number"
                            className="input-field"
                            style={{ width: '80px', padding: '0.4rem' }}
                            min={0}
                            max={23}
                            value={assumptions.facultyStartHour ?? 6}
                            onChange={e => {
                                const val = parseInt(e.target.value, 10);
                                onAssumptionsChange({
                                    ...assumptions,
                                    facultyStartHour: isNaN(val) ? 6 : Math.max(0, Math.min(23, val)),
                                });
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
