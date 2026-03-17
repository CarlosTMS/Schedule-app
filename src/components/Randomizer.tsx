import { useEffect } from 'react';

export interface DistributionTarget {
    sa: string;
    percentage: number;
}

interface RandomizerProps {
    title: string;
    description: string;
    distributions: DistributionTarget[];
    onChange: (dists: DistributionTarget[]) => void;
    targetSAs: string[];
}

export function Randomizer({ title, description, distributions, onChange, targetSAs }: RandomizerProps) {
    useEffect(() => {
        // Reconcile distributions with targetSAs (add missing, remove obsolete)
        const currentSAs = distributions.map(d => d.sa);
        const missingSAs = targetSAs.filter(sa => !currentSAs.includes(sa));
        const hasObsolete = distributions.some(d => !targetSAs.includes(d.sa));

        if (missingSAs.length > 0 || hasObsolete) {
            const newDistributions = distributions
                .filter(d => targetSAs.includes(d.sa)) // remove obsolete
                .concat(missingSAs.map(sa => ({ sa, percentage: 0 }))); // add missing
            
            // If it was empty or we just added something and total isn't 100, we could prioritize,
            // but for simple reconciliation we just add them at 0%.
            // If it was completely empty (initial load with no draft), set first to 100%.
            if (distributions.length === 0 && newDistributions.length > 0) {
                newDistributions[0].percentage = 100;
            }
            
            onChange(newDistributions);
        }
    }, [targetSAs, distributions, onChange]);

    const updatePercentage = (sa: string, newPercentage: number) => {
        // Prevent NaN
        const safeVal = isNaN(newPercentage) ? 0 : newPercentage;
        onChange(distributions.map(d => d.sa === sa ? { ...d, percentage: safeVal } : d));
    };

    const total = distributions.reduce((sum, d) => sum + (d.percentage || 0), 0);
    const isValid = total === 100;

    return (
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
            <div style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginTop: 0, marginBottom: '0.2rem' }}>{title}</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                    {description}
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                {distributions.map(dist => (
                    <div key={dist.sa} className="input-group" style={{ marginBottom: 0 }}>
                        <label className="input-label">{dist.sa}</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                                type="number"
                                className="input-field"
                                style={{ flex: 1 }}
                                min="0" max="100"
                                value={dist.percentage.toString()}
                                onChange={(e) => updatePercentage(dist.sa, parseInt(e.target.value, 10))}
                            />
                            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>%</span>
                        </div>
                    </div>
                ))}
            </div>

            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '1rem',
                borderRadius: 'var(--border-radius-sm)',
                background: isValid ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: `1px solid ${isValid ? 'var(--success-color)' : 'var(--danger-color)'}`
            }}>
                <div style={{ fontWeight: 600 }}>Total Allocated Percentage:</div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: isValid ? 'var(--success-color)' : 'var(--danger-color)' }}>
                    {total}% {isValid ? '✓ Valid' : '✗ (Must equal 100%)'}
                </div>
            </div>
        </div>
    );
}
