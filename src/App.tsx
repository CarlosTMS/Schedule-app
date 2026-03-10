import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
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
import { debounce } from './lib/utils';
import { repository, type StoredRunV2 } from './lib/runHistoryRepository';
import type { SyncStatus } from './lib/runHistoryRepository';
import type { SmeAssignments } from './components/SMESchedule';
import type { FacultyAssignments } from './components/FacultySchedule';
import { useI18n } from './i18n';
import { Globe, Clock, Trash2, RotateCcw, Pencil, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Loader2 } from 'lucide-react';

// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const { t, lang, toggleLang } = useI18n();

  // ── Core data state ────────────────────────────────────────────────────────
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [previousMetrics, setPreviousMetrics] = useState<AllocationResult['metrics'] | null>(null);

  // ── Config state ───────────────────────────────────────────────────────────
  const [startHour, setStartHour] = useState<number>(8);
  const [endHour, setEndHour] = useState<number>(18);
  const [assumptions, setAssumptions] = useState<Assumptions>({
    minSessionSize: 10,
    maxSessionSize: 40,
    maxSessionsPerDay: 2,
    allowedVATSizes: [3, 4],
    sessionLength: 90,
    maxTimezoneDifference: 5,
    allowSingleRoleVat: false,
  });
  const [rules, setRules] = useState<AllocationRule[]>([]);
  const [fsDistributions, setFsDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 50 },
    { sa: 'Procurement', percentage: 0 },
    { sa: 'oCFO', percentage: 50 },
  ]);
  const [aeDistributions, setAeDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 40 },
    { sa: 'Data & AI', percentage: 30 },
    { sa: 'BTP', percentage: 30 },
  ]);

  // ── Dashboard live editing state (lifted from Dashboard) ──────────────────
  const [dashboardRecords, setDashboardRecords] = useState<StudentRecord[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<AllocationResult['metrics'] | null>(null);
  const [sessionTimeOverrides, setSessionTimeOverrides] = useState<Record<string, number>>({});
  const [manualSmeAssignments, setManualSmeAssignments] = useState<SmeAssignments>({});
  const [manualFacultyAssignments, setManualFacultyAssignments] = useState<FacultyAssignments>({});

  // ── Persistence state ──────────────────────────────────────────────────────
  const [history, setHistory] = useState<StoredRunV2[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [restoredBanner, setRestoredBanner] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<SyncStatus>('idle');
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ref to access activeRunId inside debounced callback without stale closure
  const activeRunIdRef = useRef<string | null>(null);
  activeRunIdRef.current = activeRunId;

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { runs, activeId, status } = await repository.getSyncData();
      setHistory(runs);
      setAutosaveStatus(status);

      if (activeId) {
        const last = runs.find(r => r.id === activeId);
        if (last) {
          applyStoredRun(last);
          setActiveRunId(activeId);
        }
      }
      // After a moment, clear the initial sync status if it was just 'saved'
      setTimeout(() => setAutosaveStatus('idle'), 3000);
    };
    init();
  }, []); // intentional: mount-only

  // ── Debounced autosave helpers ─────────────────────────────────────────────

  /** Signals UI: saving started (shows indicator immediately on each keystroke). */
  const markSaving = useCallback(() => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    setAutosaveStatus('saving');
  }, []);

  /** Signals UI: persist complete. */
  const markSaved = useCallback((status: SyncStatus) => {
    setAutosaveStatus(status);
    savedTimerRef.current = setTimeout(() => setAutosaveStatus('idle'), 3000);
  }, []);

  const debouncedPatch = useMemo(
    () => debounce(async (
      id: string,
      overrides: Record<string, number>,
      sme: SmeAssignments,
      faculty: FacultyAssignments,
    ) => {
      const status = await repository.patchDashboard(id, {
        sessionTimeOverrides: overrides,
        manualSmeAssignments: sme,
        manualFacultyAssignments: faculty,
      });
      const { runs } = await repository.getSyncData();
      setHistory(runs);
      markSaved(status);
    }, 650),
    [markSaved],
  );

  const debouncedPatchCore = useMemo(
    () => debounce(async (
      id: string,
      patch: Parameters<typeof repository.patchCore>[1],
    ) => {
      const status = await repository.patchCore(id, patch);
      const { runs } = await repository.getSyncData();
      setHistory(runs);
      markSaved(status);
    }, 650),
    [markSaved],
  );

  // Autosave dashboard editable state
  useEffect(() => {
    if (!activeRunIdRef.current) return;
    markSaving();
    debouncedPatch(
      activeRunIdRef.current,
      sessionTimeOverrides,
      manualSmeAssignments,
      manualFacultyAssignments,
    );
  }, [sessionTimeOverrides, manualSmeAssignments, manualFacultyAssignments, debouncedPatch, markSaving]);

  // Autosave core config state
  useEffect(() => {
    if (!activeRunIdRef.current) return;
    markSaving();
    debouncedPatchCore(activeRunIdRef.current, {
      assumptions,
      rules,
      fsDistributions,
      aeDistributions,
      startHour,
      endHour,
      records: dashboardRecords.length > 0 ? dashboardRecords : records,
      result: (result && dashboardMetrics) ? { ...result, records: dashboardRecords, metrics: dashboardMetrics } : result as AllocationResult,
    });
  }, [assumptions, rules, fsDistributions, aeDistributions, startHour, endHour, records, dashboardRecords, dashboardMetrics, result, debouncedPatchCore, markSaving]);

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const applyStoredRun = (run: StoredRunV2, showBanner = false) => {
    setRecords(run.records);
    setDashboardRecords(run.records);
    setDashboardMetrics(run.result.metrics);
    setAssumptions(run.assumptions);
    setRules(run.rules ?? []);
    setFsDistributions(run.fsDistributions);
    setAeDistributions(run.aeDistributions);
    setStartHour(run.startHour);
    setEndHour(run.endHour);
    setResult(run.result);
    setSessionTimeOverrides(run.sessionTimeOverrides ?? {});
    setManualSmeAssignments(run.manualSmeAssignments ?? {});
    setManualFacultyAssignments(run.manualFacultyAssignments ?? {});
    setPreviousMetrics(null);
    setActiveRunId(run.id);
    repository.setActiveRun(run.id);
    if (showBanner) {
      setRestoredBanner(true);
      setTimeout(() => setRestoredBanner(false), 4000);
    }
  };

  // ─── Event handlers ─────────────────────────────────────────────────────────

  const handleFileSelect = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await parseExcel(file);
      setRecords(parsed);
      setPreviousMetrics(null);
    } catch {
      setError("Failed to parse Excel file. Ensure it's a valid tabular dataset.");
    } finally {
      setLoading(false);
    }
  };

  const handleRun = () => {
    setLoading(true);
    setTimeout(async () => {
      try {
        const res = runAllocation(records, startHour, endHour, rules, fsDistributions, aeDistributions, assumptions);
        setResult(res);
        setDashboardRecords(res.records);
        setDashboardMetrics(res.metrics);
        setSessionTimeOverrides({});
        setManualSmeAssignments({});
        setManualFacultyAssignments({});

        // Autosave: create a new run entry
        const runName = `Run ${new Date().toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US')} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        const { run, status } = await repository.createRun(
          runName,
          res.records,
          assumptions,
          rules,
          fsDistributions,
          aeDistributions,
          startHour,
          endHour,
          res,
        );
        setActiveRunId(run.id);
        const { runs } = await repository.getSyncData();
        setHistory(runs);
        setAutosaveStatus(status);
        setTimeout(() => setAutosaveStatus('idle'), 3000);
      } catch {
        setError("Error during allocation engine execution.");
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const handleReset = () => {
    if (result) setPreviousMetrics(result.metrics);
    setResult(null);
    setDashboardRecords([]);
    setDashboardMetrics(null);
    setActiveRunId(null);
  };

  const handleRestoreRun = (run: StoredRunV2) => {
    applyStoredRun(run, false);
  };

  const handleRenameRun = async (run: StoredRunV2) => {
    const newName = window.prompt(t('historyNewName'), run.name);
    if (!newName || newName.trim() === '' || newName.trim() === run.name) return;
    await repository.renameRun(run.id, newName.trim());
    const { runs } = await repository.getSyncData();
    setHistory(runs);
  };

  const handleDeleteRun = async (id: string) => {
    if (!window.confirm(t('historyConfirmDelete'))) return;
    await repository.deleteRun(id);
    const { runs } = await repository.getSyncData();
    setHistory(runs);
    if (activeRunId === id) {
      // If we deleted the active run, clear the dashboard
      setResult(null);
      setRecords([]);
      setActiveRunId(null);
    }
  };

  // ─── Derived values ─────────────────────────────────────────────────────────

  const uniqueValuesMap = useMemo(() => {
    if (records.length === 0) return { Country: [], Office: [], 'Solution Area': [], '(AA) Secondary Specialization': [] };
    const map: Record<string, Set<string>> = {
      Country: new Set(),
      Office: new Set(),
      'Solution Area': new Set(),
      '(AA) Secondary Specialization': new Set(),
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
      breakdown[`${sa} - ${spec}`] = (breakdown[`${sa} - ${spec}`] || 0) + 1;
    });
    return {
      total: missing.length,
      breakdown: Object.entries(breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([key, count]) => ({ key, count })),
    };
  }, [records]);

  const isValidPercentage =
    fsDistributions.reduce((a, d) => a + (d.percentage || 0), 0) === 100 &&
    aeDistributions.reduce((a, d) => a + (d.percentage || 0), 0) === 100;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="container" style={{ width: '95%', maxWidth: '1600px', margin: '0 auto', padding: '2rem' }}>

      {/* ── App Header ── */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.5rem' }}>{t('appTitle')}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>{t('appSubtitle')}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {/* Autosave status indicator — only visible during save cycle */}
          {activeRunId && autosaveStatus !== 'idle' && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '0.4rem',
              fontSize: '0.78rem', fontWeight: 500,
              color: autosaveStatus === 'saving' ? 'var(--text-secondary)' :
                autosaveStatus === 'saved-local' ? '#d97706' : '#059669',
              transition: 'all 0.3s ease',
            }}>
              {autosaveStatus === 'saving' && <Loader2 size={13} className="spin" />}
              {autosaveStatus === 'saved' && <CheckCircle2 size={13} />}
              {autosaveStatus === 'saved-local' && <AlertTriangle size={13} />}

              {autosaveStatus === 'saving' && t('autosaveSaving')}
              {autosaveStatus === 'saved' && t('autosaveSaved')}
              {autosaveStatus === 'saved-local' && t('autosaveSavedLocal')}
            </div>
          )}
          <button className="btn btn-secondary" onClick={toggleLang} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Globe size={18} /> {lang === 'es' ? 'EN' : 'ES'}
          </button>
        </div>
      </header>

      <main>

        {/* ── Restore banner ── */}
        {restoredBanner && (
          <div className="animated-fade-in" style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem',
            padding: '0.75rem 1.25rem', marginBottom: '1.5rem',
            background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)',
            borderRadius: '8px', color: '#059669', fontSize: '0.9rem', fontWeight: 500,
          }}>
            <CheckCircle2 size={16} /> {t('restoredBanner')}
          </div>
        )}

        {/* ── Error banner ── */}
        {error && (
          <div className="animated-fade-in" style={{ padding: '1rem', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', borderRadius: 'var(--border-radius-sm)', marginBottom: '2rem' }}>
            {error}
          </div>
        )}

        {/* ── No file yet → show upload + history ── */}
        {records.length === 0 && !loading && (
          <div className="animated-fade-in">
            <FileUpload onFileSelect={handleFileSelect} />

            {/* History panel */}
            {history.length > 0 && (
              <div className="glass-panel animated-fade-in" style={{ marginTop: '3rem', padding: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: 'rgba(59,130,246,0.1)', padding: '0.5rem', borderRadius: '8px', color: 'var(--primary-color)' }}>
                    <Clock size={24} />
                  </div>
                  <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{t('historyTitle')}</h2>
                  <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {history.length} / 20
                  </span>
                </div>
                <HistoryList
                  runs={history}
                  activeId={activeRunId}
                  onRestore={handleRestoreRun}
                  onRename={handleRenameRun}
                  onDelete={handleDeleteRun}
                  t={t}
                />
              </div>
            )}
          </div>
        )}

        {/* ── Loading spinner ── */}
        {loading && (
          <div className="glass-panel animated-fade-in" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '4rem' }}>
            <Loader2 className="spin" size={48} color="var(--primary-color)" />
            <h3 style={{ marginTop: '1.5rem', marginBottom: 0 }}>{t('processingData')}</h3>
            <p style={{ color: 'var(--text-secondary)' }}>{t('processingAlgorithm')}</p>
          </div>
        )}

        {/* ── File loaded, not yet run ── */}
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
              <div className="glass-panel animated-fade-in" style={{ marginBottom: '2rem', borderLeft: '4px solid #f59e0b', background: 'rgba(245,158,11,0.05)' }}>
                <h4 style={{ margin: 0, color: '#d97706', marginBottom: '0.5rem', fontSize: '1.1rem' }}>{t('missingAssignments')}</h4>
                <p style={{ margin: 0, color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.95rem' }}>
                  <strong>{missingAssignmentsInfo.total}</strong> {t('missingAssignmentsDesc')}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.5rem' }}>
                  {missingAssignmentsInfo.breakdown.map(({ key, count }) => (
                    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.7)', padding: '0.5rem 1rem', borderRadius: 'var(--border-radius-sm)', fontSize: '0.9rem', border: '1px solid rgba(245,158,11,0.2)' }}>
                      <span style={{ fontWeight: 500 }}>{key}</span>
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
            <RuleBuilder uniqueValuesMap={uniqueValuesMap} rules={rules} onChange={setRules} />
            <Randomizer title="Random Distribution Engine (%) - F&S" description="Allocate remaining unassigned Associates with Role 'F&S' across the targeted Specializations." distributions={fsDistributions} onChange={setFsDistributions} targetSAs={['Cloud ERP', 'Procurement', 'oCFO']} />
            <Randomizer title="Random Distribution Engine (%) - Account Executive" description="Allocate remaining unassigned Associates with Role 'Account Executive' across the targeted Specializations." distributions={aeDistributions} onChange={setAeDistributions} targetSAs={['Cloud ERP', 'Data & AI', 'BTP']} />

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
        )}

        {/* ── Dashboard (active result) ── */}
        {result && !loading && (
          <Dashboard
            result={result}
            onReset={handleReset}
            previousMetrics={previousMetrics}
            sessionLength={assumptions.sessionLength}
            sessionTimeOverrides={sessionTimeOverrides}
            onSessionTimeOverridesChange={setSessionTimeOverrides}
            manualSmeAssignments={manualSmeAssignments}
            onManualSmeAssignmentsChange={setManualSmeAssignments}
            manualFacultyAssignments={manualFacultyAssignments}
            onManualFacultyAssignmentsChange={setManualFacultyAssignments}
            localRecords={dashboardRecords}
            onLocalRecordsChange={setDashboardRecords}
            localMetrics={dashboardMetrics || result.metrics}
            onLocalMetricsChange={setDashboardMetrics}
            historyPanel={
              history.length > 0 ? (
                <HistoryList
                  runs={history}
                  activeId={activeRunId}
                  onRestore={handleRestoreRun}
                  onRename={handleRenameRun}
                  onDelete={handleDeleteRun}
                  t={t}
                  compact
                />
              ) : null
            }
          />
        )}

      </main>
    </div>
  );
}

// ─── HistoryList sub-component ────────────────────────────────────────────────

interface HistoryListProps {
  runs: StoredRunV2[];
  activeId: string | null;
  onRestore: (run: StoredRunV2) => void;
  onRename: (run: StoredRunV2) => void;
  onDelete: (id: string) => void;
  t: (key: Parameters<ReturnType<typeof useI18n>['t']>[0]) => string;
  compact?: boolean;
}

function HistoryList({ runs, activeId, onRestore, onRename, onDelete, t, compact = false }: HistoryListProps) {
  if (runs.length === 0) {
    return <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{t('historyEmpty')}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
      {runs.map(run => {
        const isActive = run.id === activeId;
        return (
          <div
            key={run.id}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem',
              padding: compact ? '0.75rem 1rem' : '1rem 1.25rem',
              background: isActive ? 'rgba(37,99,235,0.07)' : 'rgba(255,255,255,0.6)',
              borderRadius: '8px',
              border: isActive ? '1.5px solid rgba(37,99,235,0.4)' : '1px solid var(--glass-border)',
              transition: 'border 0.15s',
            }}
          >
            {/* Info */}
            <div style={{ flex: '1 1 200px', minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: compact ? '0.9rem' : '1rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.4rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isActive && <span style={{ fontSize: '0.65rem', background: 'var(--primary-color)', color: 'white', padding: '0.1rem 0.45rem', borderRadius: '9999px', flexShrink: 0 }}>ACTIVE</span>}
                {run.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                {t('historyCreated')}: {new Date(run.createdAt).toLocaleString()}
                {' · '}
                {run.result.metrics.totalStudents} {t('historyStudents')}
                {' · '}
                {run.result.metrics.assignedSuccess}/{run.result.metrics.totalStudents} {t('assignedSuccess')}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
              {!isActive && (
                <button
                  title={t('historyRestore')}
                  onClick={() => onRestore(run)}
                  className="btn btn-secondary"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                >
                  <RotateCcw size={13} /> {compact ? '' : t('historyRestore')}
                </button>
              )}
              <button
                title={t('historyRename')}
                onClick={() => onRename(run)}
                style={{ padding: '0.4rem 0.6rem', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', color: '#6366f1', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <Pencil size={13} />
              </button>
              <button
                title={t('historyDelete')}
                onClick={() => onDelete(run.id)}
                style={{ padding: '0.4rem 0.6rem', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '6px', color: 'var(--danger-color)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default App;
