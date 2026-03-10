import { useState, useMemo, useEffect } from 'react';
import './index.css';
import { FileUpload } from './components/FileUpload';
import { Configurator } from './components/Configurator';
import type { Assumptions } from './components/Configurator';
import { RuleBuilder } from './components/RuleBuilder';
import type { AllocationRule } from './components/RuleBuilder';
import { Randomizer } from './components/Randomizer';
import type { DistributionTarget } from './components/Randomizer';
import { Dashboard } from './components/Dashboard';
import { parseExcel } from './lib/excelParser';
import type { StudentRecord } from './lib/excelParser';
import { runAllocation } from './lib/allocationEngine';
import type { AllocationResult } from './lib/allocationEngine';
import { Loader2, Globe, Clock, Trash2 } from 'lucide-react';

export interface SavedSimulation {
  id: string;
  timestamp: string;
  name: string;
  records: StudentRecord[];
  assumptions: Assumptions;
  rules: AllocationRule[];
  fsDistributions: DistributionTarget[];
  aeDistributions: DistributionTarget[];
  startHour: number;
  endHour: number;
  result: AllocationResult;
}
import { useI18n } from './i18n';

function App() {
  const { t, lang, toggleLang } = useI18n();
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startHour, setStartHour] = useState<number>(8);
  const [endHour, setEndHour] = useState<number>(18);

  const [assumptions, setAssumptions] = useState<Assumptions>({
    minSessionSize: 10,
    maxSessionSize: 40,
    maxSessionsPerDay: 2,
    allowedVATSizes: [3, 4],
    sessionLength: 90,
    maxTimezoneDifference: 4,
    allowSingleRoleVat: false
  });

  const [rules, setRules] = useState<AllocationRule[]>([]);

  const [fsDistributions, setFsDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 20 },
    { sa: 'Procurement', percentage: 60 },
    { sa: 'oCFO', percentage: 20 },
  ]);

  const [aeDistributions, setAeDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 40 },
    { sa: 'Data & AI', percentage: 30 },
    { sa: 'BTP', percentage: 30 },
  ]);

  const [result, setResult] = useState<AllocationResult | null>(null);
  const [previousMetrics, setPreviousMetrics] = useState<AllocationResult['metrics'] | null>(null);

  const [history, setHistory] = useState<SavedSimulation[]>([]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('scheduler_history');
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load history', e);
    }
  }, []);

  const handleSaveSimulation = () => {
    if (!result || records.length === 0) return;

    const newSim: SavedSimulation = {
      id: Date.now().toString(36) + Math.random().toString(36).substring(2),
      timestamp: new Date().toISOString(),
      name: `Simulation ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
      records,
      assumptions,
      rules,
      fsDistributions,
      aeDistributions,
      startHour,
      endHour,
      result
    };

    setHistory(prev => {
      const updated = [newSim, ...prev].slice(0, 5);
      localStorage.setItem('scheduler_history', JSON.stringify(updated));
      return updated;
    });
  };

  const handleRestoreSimulation = (sim: SavedSimulation) => {
    setRecords(sim.records);
    setAssumptions(sim.assumptions);
    setRules(sim.rules || []);
    setFsDistributions(sim.fsDistributions);
    setAeDistributions(sim.aeDistributions);
    setStartHour(sim.startHour);
    setEndHour(sim.endHour);
    setResult(sim.result);
    setPreviousMetrics(null);
  };

  const handleDeleteSimulation = (id: string) => {
    setHistory(prev => {
      const updated = prev.filter(s => s.id !== id);
      localStorage.setItem('scheduler_history', JSON.stringify(updated));
      return updated;
    });
  };

  const handleFileSelect = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseExcel(file);
      setRecords(parsed);
      setPreviousMetrics(null); // Clear previous metrics on new file upload
    } catch {
      setError("Failed to parse Excel file. Ensure it's a valid tabular dataset.");
    } finally {
      setLoading(false);
    }
  };

  const handleRun = () => {
    setLoading(true);
    setTimeout(() => {
      try {
        const res = runAllocation(records, startHour, endHour, rules, fsDistributions, aeDistributions, assumptions);
        setResult(res);
      } catch {
        setError("Error during allocation engine execution.");
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const handleReset = () => {
    if (result) {
      setPreviousMetrics(result.metrics);
    }
    setResult(null);
  };

  const uniqueValuesMap = useMemo(() => {
    if (records.length === 0) return { Country: [], Office: [], 'Solution Area': [], '(AA) Secondary Specialization': [] };
    const map: Record<string, Set<string>> = {
      Country: new Set(),
      Office: new Set(),
      'Solution Area': new Set(),
      '(AA) Secondary Specialization': new Set()
    };

    records.forEach(r => {
      if (r.Country) map.Country.add(r.Country);
      if (r.Office) map.Office.add(r.Office);
      if (r['Solution Area']) map['Solution Area'].add(r['Solution Area']);
      if (r['(AA) Secondary Specialization']) map['(AA) Secondary Specialization'].add(r['(AA) Secondary Specialization']);
    });

    return {
      Country: Array.from(map.Country).sort(),
      Office: Array.from(map.Office).sort(),
      'Solution Area': Array.from(map['Solution Area']).sort(),
      '(AA) Secondary Specialization': Array.from(map['(AA) Secondary Specialization']).sort(),
    };
  }, [records]);

  const missingAssignmentsInfo = useMemo(() => {
    if (records.length === 0) return null;

    const missing = records.filter(r => !r['Solution Week SA'] || r['Solution Week SA'].trim() === '');
    if (missing.length === 0) return null;

    const breakdown: Record<string, number> = {};
    missing.forEach(r => {
      const sa = r['Solution Area'] || 'Unknown SA';
      const spec = r['(AA) Secondary Specialization'] || 'Unknown Spec';
      const key = `${sa} - ${spec}`;
      breakdown[key] = (breakdown[key] || 0) + 1;
    });

    return {
      total: missing.length,
      breakdown: Object.entries(breakdown)
        .sort((a, b) => b[1] - a[1]) // Sort by count descending
        .map(([key, count]) => ({ key, count }))
    };
  }, [records]);

  const isValidFsPercentage = fsDistributions.reduce((acc, d) => acc + (d.percentage || 0), 0) === 100;
  const isValidAePercentage = aeDistributions.reduce((acc, d) => acc + (d.percentage || 0), 0) === 100;
  const isValidPercentage = isValidFsPercentage && isValidAePercentage;

  return (
    <div className="container" style={{ width: '95%', maxWidth: '1600px', margin: '0 auto', padding: '2rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>{t('appTitle')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
            {t('appSubtitle')}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={toggleLang} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Globe size={18} /> {lang === 'es' ? 'EN' : 'ES'}
        </button>
      </header>

      <main>
        {error && (
          <div className="animated-fade-in" style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: 'var(--border-radius-sm)', marginBottom: '2rem' }}>
            {error}
          </div>
        )}

        {records.length === 0 && !loading && (
          <div className="animated-fade-in">
            <FileUpload onFileSelect={handleFileSelect} />

            {history.length > 0 && (
              <div className="glass-panel animated-fade-in" style={{ marginTop: '3rem', padding: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: 'rgba(59, 130, 246, 0.1)', padding: '0.5rem', borderRadius: '8px', color: 'var(--primary-color)' }}>
                    <Clock size={24} />
                  </div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{t('savedHistory') || 'Saved Simulations History'}</h2>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {history.map(sim => (
                    <div key={sim.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', background: 'rgba(255,255,255,0.6)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '1.05rem' }}>{sim.name}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                          {new Date(sim.timestamp).toLocaleString()} • {sim.records.length} {t('studentsFound')}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" onClick={() => handleRestoreSimulation(sim)}>
                          {t('restore') || 'Restore'}
                        </button>
                        <button onClick={() => handleDeleteSimulation(sim.id)} style={{ padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', border: 'none', borderRadius: '6px', color: 'var(--danger-color)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading && (
          <div className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
            <Loader2 className="spinner" size={48} color="var(--primary-color)" />
            <h3 style={{ marginTop: '1.5rem', marginBottom: 0 }}>{t('processingData')}</h3>
            <p style={{ color: 'var(--text-secondary)' }}>{t('processingAlgorithm')}</p>
          </div>
        )}

        {records.length > 0 && !result && !loading && (
          <div className="animated-fade-in">
            <div className="glass-panel" style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '4px solid var(--success-color)' }}>
              <div>
                <h3 style={{ margin: 0, color: 'var(--success-color)' }}>{t('dataLoaded')}</h3>
                <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{records.length} {t('studentsFound')}</p>
              </div>
              <button className="btn btn-secondary" onClick={() => { setRecords([]); setResult(null); }}>
                {t('uploadDifferent')}
              </button>
            </div>

            {missingAssignmentsInfo && (
              <div className="glass-panel animated-fade-in" style={{ marginBottom: '2rem', borderLeft: '4px solid #f59e0b', background: 'rgba(245, 158, 11, 0.05)' }}>
                <h4 style={{ margin: 0, color: '#d97706', marginBottom: '0.5rem', fontSize: '1.1rem' }}>{t('missingAssignments')}</h4>
                <p style={{ margin: 0, color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.95rem' }}>
                  <strong>{missingAssignmentsInfo.total}</strong> {t('missingAssignmentsDesc')}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.5rem' }}>
                  {missingAssignmentsInfo.breakdown.map(({ key, count }) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.7)', padding: '0.5rem 1rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.9rem', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{key}</span>
                      <span style={{ fontWeight: 700, color: '#d97706' }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Configurator
              startHour={startHour}
              endHour={endHour}
              onTimeChange={(s, e) => { setStartHour(s); setEndHour(e); }}
              assumptions={assumptions}
              onAssumptionsChange={setAssumptions}
            />

            <RuleBuilder
              uniqueValuesMap={uniqueValuesMap}
              rules={rules}
              onChange={setRules}
            />

            <Randomizer
              title="Random Distribution Engine (%) - F&S"
              description="Allocate remaining unassigned Associates with Role 'F&S' across the targeted Specializations."
              distributions={fsDistributions}
              onChange={setFsDistributions}
              targetSAs={['Cloud ERP', 'Procurement', 'oCFO']}
            />
            <Randomizer
              title="Random Distribution Engine (%) - Account Executive"
              description="Allocate remaining unassigned Associates with Role 'Account Executive' across the targeted Specializations."
              distributions={aeDistributions}
              onChange={setAeDistributions}
              targetSAs={['Cloud ERP', 'Data & AI', 'BTP']}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2rem', marginBottom: '2rem' }}>
              <button
                className="btn btn-primary"
                style={{ padding: '1rem 2.5rem', fontSize: '1.1rem', borderRadius: 'var(--border-radius-md)' }}
                disabled={!isValidPercentage}
                onClick={handleRun}
              >
                {t('runAllocation')}
              </button>
            </div>
          </div>
        )
        }

        {
          result && !loading && (
            <Dashboard
              result={result}
              onReset={handleReset}
              onSave={handleSaveSimulation}
              previousMetrics={previousMetrics}
              sessionLength={assumptions.sessionLength}
            />
          )
        }
      </main>

      <style>{`
        .spinner {
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animated-fade-in {
          animation: fadeIn 0.5s ease-out forwards;
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div >
  );
}

export default App;
