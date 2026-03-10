import { Plus, Trash2 } from 'lucide-react';

export interface AllocationRule {
    id: string;
    field: string;
    value: string;
    targetSA: string;
}

interface RuleBuilderProps {
    uniqueValuesMap: Record<string, string[]>;
    rules: AllocationRule[];
    onChange: (rules: AllocationRule[]) => void;
}

export function RuleBuilder({ uniqueValuesMap, rules, onChange }: RuleBuilderProps) {
    const fields = ['Country', 'Office', 'Solution Area', '(AA) Secondary Specialization'];
    const targetSAs = ['Cloud ERP', 'Data & AI', 'BTP', 'HCM', 'SCM', 'CX'];

    const addRule = () => {
        const newRule: AllocationRule = {
            id: Math.random().toString(36).substr(2, 9),
            field: fields[2], // Default to 'Solution Area'
            value: '',
            targetSA: targetSAs[0]
        };
        onChange([...rules, newRule]);
    };

    const removeRule = (id: string) => {
        onChange(rules.filter(r => r.id !== id));
    };

    const updateRule = (id: string, updates: Partial<AllocationRule>) => {
        onChange(rules.map(r => r.id === id ? { ...r, ...updates } : r));
    };

    return (
        <div className="glass-panel" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <div>
                    <h3 style={{ marginTop: 0, marginBottom: '0.2rem' }}>Allocation Rules</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                        Define conditional overrides for Associates before random distribution.
                    </p>
                </div>
                <button className="btn btn-primary" onClick={addRule}>
                    <Plus size={16} /> Add Rule
                </button>
            </div>

            {rules.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', border: '1px dashed var(--border-color)', borderRadius: 'var(--border-radius-sm)', color: 'var(--text-secondary)' }}>
                    No manual rules defined. Remaining available Associates will be distributed randomly based on the percentages below.
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {rules.map((rule, idx) => (
                        <div key={rule.id} style={{ display: 'flex', gap: '1rem', alignItems: 'center', background: 'rgba(255,255,255,0.4)', padding: '1rem', borderRadius: 'var(--border-radius-sm)' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-secondary)', width: '20px' }}>{idx + 1}.</div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>IF</span>
                                <select
                                    className="input-field"
                                    style={{ padding: '0.4rem', appearance: 'auto' }}
                                    value={rule.field}
                                    onChange={(e) => updateRule(rule.id, { field: e.target.value, value: '' })}
                                >
                                    {fields.map(f => <option key={f} value={f}>{f}</option>)}
                                </select>

                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>EQUALS</span>

                                <select
                                    className="input-field"
                                    style={{ padding: '0.4rem', flex: 1, appearance: 'auto' }}
                                    value={rule.value}
                                    onChange={(e) => updateRule(rule.id, { value: e.target.value })}
                                >
                                    <option value="">-- Select Value --</option>
                                    {(uniqueValuesMap[rule.field] || []).map(val => (
                                        <option key={val} value={val}>{val}</option>
                                    ))}
                                </select>

                                <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--primary-color)' }}>THEN SET ASSIGNMENT TO:</span>

                                <select
                                    className="input-field"
                                    style={{ padding: '0.4rem', flex: 1, appearance: 'auto' }}
                                    value={rule.targetSA}
                                    onChange={(e) => updateRule(rule.id, { targetSA: e.target.value })}
                                >
                                    {targetSAs.map(sa => <option key={sa} value={sa}>{sa}</option>)}
                                </select>
                            </div>

                            <button
                                className="btn btn-secondary"
                                style={{ padding: '0.4rem', color: 'var(--danger-color)', borderColor: 'transparent' }}
                                onClick={() => removeRule(rule.id)}
                                title="Remove Rule"
                            >
                                <Trash2 size={18} />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
