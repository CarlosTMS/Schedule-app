import { useCallback, useState, useMemo, useEffect, useRef } from 'react';

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
import { parseSummaryJson, parseEnrichedExcel } from './lib/jsonParser';
import type { StudentRecord } from './lib/excelParser';
import { runAllocation } from './lib/allocationEngine';
import type { AllocationResult } from './lib/allocationEngine';
import { repository, type SyncStatus } from './lib/runHistoryRepository';
import { type RunProject, type RunVersion, type RunSnapshot, persistDraft, readDraft } from './lib/runHistoryStorage';
import type { SmeAssignments } from './components/SMESchedule';
import type { FacultyAssignments } from './components/FacultySchedule';
import { useI18n } from './i18n';
import { Globe, Clock, Trash2, RotateCcw, Pencil, CheckCircle2, Plus, History, Save, Copy, Loader2, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react';


// ─── App ──────────────────────────────────────────────────────────────────────

function App() {
  const { t, lang, toggleLang } = useI18n();
  const SIDEBAR_COLLAPSED_KEY = 'scheduler_sidebar_collapsed_v1';

  // ── Core data state (Current Working Draft) ────────────────────────────────
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
    facultyStartHour: 6,
  });
  const [rules, setRules] = useState<AllocationRule[]>([]);
  const [fsDistributions, setFsDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 50 },
    { sa: 'oCFO', percentage: 50 },
  ]);
  const [aeDistributions, setAeDistributions] = useState<DistributionTarget[]>([
    { sa: 'Cloud ERP', percentage: 25 },
    { sa: 'Data & AI', percentage: 25 },
    { sa: 'BTP', percentage: 25 },
    { sa: 'oCFO', percentage: 25 },
  ]);

  // ── Dashboard live editing state ──────────────────────────────────────────
  const [dashboardRecords, setDashboardRecords] = useState<StudentRecord[]>([]);
  const [dashboardMetrics, setDashboardMetrics] = useState<AllocationResult['metrics'] | null>(null);
  const [sessionTimeOverrides, setSessionTimeOverrides] = useState<Record<string, number>>({});
  const [manualSmeAssignments, setManualSmeAssignments] = useState<SmeAssignments>({});
  const [manualFacultyAssignments, setManualFacultyAssignments] = useState<FacultyAssignments>({});

  // ── Persistence / Versioning state ─────────────────────────────────────────
  const [projects, setProjects] = useState<RunProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectVersions, setProjectVersions] = useState<RunVersion[]>([]);
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [autosaveStatus, setAutosaveStatus] = useState<SyncStatus>('idle');

  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectsRef = useRef<RunProject[]>(projects);
  const projectRevisionRef = useRef<Record<string, number>>({});
  const errorRef = useRef<string | null>(error);
  const lastSyncedSnapshotRef = useRef<string>('');

  // Sync refs with state
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => {
    projectRevisionRef.current = projects.reduce<Record<string, number>>((acc, project) => {
      if (project.revision !== undefined) acc[project.id] = project.revision;
      return acc;
    }, {});
  }, [projects]);
  useEffect(() => { errorRef.current = error; }, [error]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, isSidebarCollapsed ? '1' : '0');
    } catch {
      // Ignore storage write errors.
    }
  }, [isSidebarCollapsed, SIDEBAR_COLLAPSED_KEY]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const currentSnapshot = useMemo((): RunSnapshot => ({
    records, assumptions, rules, fsDistributions, aeDistributions, startHour, endHour,
    result: (result && dashboardMetrics) ? { ...result, records: dashboardRecords, metrics: dashboardMetrics } : result as AllocationResult,
    sessionTimeOverrides, manualSmeAssignments, manualFacultyAssignments
  }), [records, assumptions, rules, fsDistributions, aeDistributions, startHour, endHour, result, dashboardRecords, dashboardMetrics, sessionTimeOverrides, manualSmeAssignments, manualFacultyAssignments]);

  const applySnapshot = useCallback((s: RunSnapshot) => {
    setRecords(s.records);
    setDashboardRecords(s.records);
    setAssumptions(s.assumptions);
    setRules(s.rules);
    setFsDistributions(s.fsDistributions);
    setAeDistributions(s.aeDistributions);
    setStartHour(s.startHour);
    setEndHour(s.endHour);
    setResult(s.result);
    setDashboardMetrics(s.result?.metrics || null);
    setSessionTimeOverrides(s.sessionTimeOverrides);
    setManualSmeAssignments(s.manualSmeAssignments);
    setManualFacultyAssignments(s.manualFacultyAssignments);
    setPreviousMetrics(null);
  }, []);

  // ── Initial load ───────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const { projects: projs, activeProjectId: lastPid } = await repository.getSyncData();
      setProjects(projs);

      const draft = readDraft();
      if (draft) {
        applySnapshot(draft.snapshot);
        setActiveProjectId(draft.projectId);
      } else if (lastPid) {
        const p = projs.find(x => x.id === lastPid);
        if (p && p.activeVersionId) {
          const v = await repository.getVersion(p.activeVersionId);
          if (v) {
            applySnapshot(v.snapshot);
            setActiveProjectId(p.id);
            setLoadedVersionId(v.id);
          }
        }
      }
    };
    init();
  }, [applySnapshot]);

  // Update versions when active project changes
  useEffect(() => {
    if (activeProjectId) {
      repository.getVersions(activeProjectId).then(setProjectVersions);
    } else {
      setProjectVersions([]);
    }
  }, [activeProjectId]);

  // ── Autosave Draft (Local & Remote Sync) ───────────────────────────────────
  useEffect(() => {
    if (!records.length) return;

    // Always persist to local storage first
    persistDraft({
      projectId: activeProjectId,
      snapshot: currentSnapshot,
      updatedAt: new Date().toISOString()
    });

    // Remote sync if we have an active project
    if (activeProjectId) {
      const snapshotStr = JSON.stringify(currentSnapshot);
      if (snapshotStr !== lastSyncedSnapshotRef.current) {
        setAutosaveStatus('saving');
        const expectedRevision = projectRevisionRef.current[activeProjectId]
          ?? projectsRef.current.find(p => p.id === activeProjectId)?.revision
          ?? 1;
        repository.syncDraft(activeProjectId, currentSnapshot, expectedRevision)
          .then((res) => {
            if (res.status === 'conflict') {
              setAutosaveStatus('conflict');
              setError(`[Conflict] Someone else updated this project. Please refresh or reload version.`);
            } else {
              setAutosaveStatus(res.status);
              if (res.status === 'saved' && errorRef.current?.startsWith('[Conflict]')) {
                setError(null);
              }
              if (res.status === 'saved') {
                lastSyncedSnapshotRef.current = snapshotStr;
              }
              if (res.project) {
                if (res.project.revision !== undefined) {
                  projectRevisionRef.current[res.project.id] = res.project.revision;
                }
                setProjects(prev => prev.map(p => p.id === res.project!.id ? res.project! : p));
              }
            }
          });
      } else {
        setAutosaveStatus('saved');
      }
    } else {
      setAutosaveStatus('saved');
    }


    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setAutosaveStatus('idle'), 3000);
  }, [currentSnapshot, activeProjectId, records.length]);



  const handleCreateProject = async () => {
    if (!result) return;
    const name = window.prompt(t('projectName'), `Project ${new Date().toLocaleDateString()}`);
    if (!name) return;

    setLoading(true);
    const { project, version } = await repository.createProject(name, currentSnapshot);
    setProjects(prev => [project, ...prev]);
    setActiveProjectId(project.id);
    setProjectVersions([version]);
    setLoadedVersionId(version.id);
    setLoading(false);
  };

  const handleSaveVersion = async () => {
    if (!activeProjectId || !result) return;
    const label = window.prompt(t('versionLabel')) || undefined;

    setLoading(true);
    const { version } = await repository.saveAsNewVersion(activeProjectId, currentSnapshot, label);
    setProjectVersions(prev => [version, ...prev]);
    setLoadedVersionId(version.id);

    const { projects: updatedProjs } = await repository.getSyncData();
    setProjects(updatedProjs);
    setLoading(false);
  };

  const handleLoadVersion = async (v: RunVersion) => {
    applySnapshot(v.snapshot);
    setLoadedVersionId(v.id);
  };

  const handleDuplicateAsDraft = (v: RunVersion) => {
    applySnapshot(v.snapshot);
    setLoadedVersionId(null);
  };

  const handleDeleteVersion = async (version: RunVersion) => {
    if (!activeProjectId) return;
    if (!window.confirm(t('versionDeleteConfirm'))) return;

    const ok = await repository.deleteVersion(activeProjectId, version.id);
    if (!ok) {
      setError(t('versionDeleteFailed'));
      return;
    }

    const updatedVersions = await repository.getVersions(activeProjectId);
    setProjectVersions(updatedVersions);

    if (loadedVersionId === version.id) {
      setLoadedVersionId(null);
    }

    const { projects: updatedProjs } = await repository.getSyncData();
    setProjects(updatedProjs);
  };

  const handleDeleteProject = async (id: string) => {
    if (!window.confirm(t('historyConfirmDelete'))) return;
    const ok = await repository.deleteProject(id);
    if (ok) {
      setProjects(prev => prev.filter(p => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
        setProjectVersions([]);
        setLoadedVersionId(null);
      }
    } else {
      setError("Failed to delete project on server. Keep in mind that deletion is only supported while online.");
    }
  };

  const handleRenameProject = async (id: string) => {
    const p = projects.find(x => x.id === id);
    if (!p) return;
    const newName = window.prompt(t('historyNewName'), p.name);
    if (newName) {
      const status = await repository.renameProject(id, newName);
      if (status === 'saved') {
        setProjects(prev => prev.map(x => x.id === id ? { ...x, name: newName } : x));
      } else {
        setError("Failed to rename project on server. Keep in mind that rename is only supported while online.");
      }
    }
  };

  const handleRun = () => {
    setLoading(true);
    setTimeout(async () => {
      try {
        const res = runAllocation(records, startHour, endHour, rules, fsDistributions, aeDistributions, assumptions);
        const mets = res.metrics;
        setResult(res);
        setDashboardRecords(res.records);
        setDashboardMetrics(mets);
        setSessionTimeOverrides({});
        setManualSmeAssignments({});
        setManualFacultyAssignments({});
        setLoadedVersionId(null);
      } catch (e) {
        setError("Error during allocation engine execution.");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }, 100);
  };

  const handleFileSelect = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      if (file.name.endsWith('.json')) {
        const parsed = await parseSummaryJson(file);
        setRecords(parsed.records);
        setDashboardRecords(parsed.records);
        setManualSmeAssignments(parsed.manualSmeAssignments);
        setManualFacultyAssignments(parsed.manualFacultyAssignments);
        setSessionTimeOverrides(parsed.sessionTimeOverrides);
        
        // Ensure result is set to bypass configurator
        setResult(parsed.fakeResult);
        setDashboardMetrics(parsed.fakeResult.metrics);
        
        setPreviousMetrics(null);
        setActiveProjectId(null);
        setLoadedVersionId(null);
      } else {
        const parsedEx = await parseExcel(file);
        
        // If the parsed Excel already has Schedule, treat it as an explicitly enriched return
        if (parsedEx.length > 0 && parsedEx.some(r => r.Schedule)) {
            const parsed = parseEnrichedExcel(parsedEx);
            setRecords(parsed.records);
            setDashboardRecords(parsed.records);
            setManualSmeAssignments(parsed.manualSmeAssignments);
            setManualFacultyAssignments(parsed.manualFacultyAssignments);
            setSessionTimeOverrides(parsed.sessionTimeOverrides);
            
            // Bypass configurator
            setResult(parsed.fakeResult);
            setDashboardMetrics(parsed.fakeResult.metrics);
            
            setPreviousMetrics(null);
            setActiveProjectId(null);
            setLoadedVersionId(null);
        } else {
            setRecords(parsedEx);
            setDashboardRecords([]);
            setResult(null);
            setPreviousMetrics(null);
            setActiveProjectId(null);
            setLoadedVersionId(null);
        }
      }
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Failed to parse ${file.name.endsWith('.json') ? 'JSON' : 'Excel'} file. ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const uniqueValuesMap = useMemo(() => {
    const map: Record<string, string[]> = {
      'Country': [], 'Office': [], 'Solution Weeks SA': [], '(AA) Secondary Specialization': []
    };
    records.forEach(r => {
      if (r.Country && !map['Country'].includes(r.Country)) map['Country'].push(r.Country);
      if (r.Office && !map['Office'].includes(r.Office)) map['Office'].push(r.Office);
      if (r['Solution Weeks SA'] && !map['Solution Weeks SA'].includes(r['Solution Weeks SA'])) map['Solution Weeks SA'].push(r['Solution Weeks SA']);
      if (r['(AA) Secondary Specialization'] && !map['(AA) Secondary Specialization'].includes(r['(AA) Secondary Specialization'])) map['(AA) Secondary Specialization'].push(r['(AA) Secondary Specialization']);
    });
    return map;
  }, [records]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      <aside className={`sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Globe className="logo-icon" size={24} />
            {!isSidebarCollapsed && <h1 className="logo-text">Antigravity</h1>}
          </div>
          <div className="sidebar-header-actions">
            {!isSidebarCollapsed && (
              <button onClick={toggleLang} className="btn-lang">{lang === 'en' ? 'ES' : 'EN'}</button>
            )}
            <button
              onClick={() => setIsSidebarCollapsed(prev => !prev)}
              className="btn-subtle sidebar-toggle-btn"
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            </button>
          </div>
        </div>

        {!isSidebarCollapsed && (
          <>
            <nav className="sidebar-nav">
              <div className="nav-group">
                <div className="nav-group-header">
                  <span>{t('projectsTitle')}</span>
                  <button onClick={() => { if (window.confirm('Clear current draft?')) { setRecords([]); setResult(null); setActiveProjectId(null); setProjectVersions([]); setLoadedVersionId(null); } }} className="btn-icon-alt" title={t('projectNew')}>
                    <Plus size={16} />
                  </button>
                </div>
                <div className="project-list">
                  {projects.length === 0 && <p className="empty-text">{t('historyEmpty')}</p>}
                  {projects.map(p => (
                    <div key={p.id} className={`project-item ${activeProjectId === p.id ? 'active' : ''}`} onClick={() => setActiveProjectId(p.id)}>
                      <div className="project-info">
                        <span className="project-name">{p.name}</span>
                        <span className="project-date">{new Date(p.updatedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="project-actions">
                        <button onClick={(e) => { e.stopPropagation(); handleRenameProject(p.id); }} className="btn-subtle"><Pencil size={12} /></button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteProject(p.id); }} className="btn-subtle danger"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {activeProjectId && (
                <div className="nav-group" style={{ marginTop: '1.5rem' }}>
                  <div className="nav-group-header"><span>{t('versionsTitle')}</span><History size={16} /></div>
                <div className="version-list">
                  {projectVersions.map(v => (
                    <div key={v.id} className={`version-item ${loadedVersionId === v.id ? 'active' : ''}`} onClick={() => handleLoadVersion(v)}>
                      <span className="version-num">v{v.versionNumber}</span>
                      <span className="version-label">{v.label}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        {loadedVersionId === v.id && <CheckCircle2 size={12} className="active-icon" />}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteVersion(v); }}
                          className="btn-subtle danger"
                          title={t('versionDelete')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              )}
            </nav>
            <div className="sidebar-footer">
              <div className={`sync-badge ${repository.runtimeAvailable ? 'online' : 'offline'}`}>
                {repository.runtimeAvailable ? 'Runtime Online' : 'Runtime Offline'}
              </div>
            </div>
          </>
        )}
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            {activeProjectId ? (
              <div className="active-project-tag">
                <span className="tag-label">PROJECT:</span>
                <span className="tag-value">{projects.find(p => p.id === activeProjectId)?.name}</span>
                {loadedVersionId ? <span className="tag-version">v{projectVersions.find(v => v.id === loadedVersionId)?.versionNumber}</span> : <span className="tag-draft">({t('statusDraft')})</span>}
              </div>
            ) : <h2 className="page-title">{t('appTitle')}</h2>}
          </div>
          <div className="top-bar-right">
            {autosaveStatus !== 'idle' && (
              <div className={`autosave-indicator status-${autosaveStatus}`}>
                {autosaveStatus === 'saving' ? <Loader2 className="animate-spin" size={14} /> :
                  autosaveStatus === 'conflict' ? <ShieldAlert size={14} /> :
                    <CheckCircle2 size={14} />}

                {autosaveStatus === 'saving' ? t('autosaveSaving') :
                  autosaveStatus === 'conflict' ? 'Conflict' :
                    t('autosaveSaved')}
              </div>
            )}

            {result && (
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {!activeProjectId ? (
                  <button onClick={handleCreateProject} className="btn btn-primary" style={{ gap: '0.5rem' }}><Save size={16} /> {t('projectNew')}</button>
                ) : (
                  <button onClick={handleSaveVersion} className="btn btn-primary" style={{ gap: '0.5rem' }}><Save size={16} /> {t('versionSave')}</button>
                )}
              </div>
            )}
          </div>
        </header>

        {error && (
          <div className="error-banner" style={{ margin: '1rem 1.5rem 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{error}</span>
            <button onClick={() => setError(null)} className="btn-subtle" style={{ color: 'inherit' }}><Plus size={16} style={{ transform: 'rotate(45deg)' }} /></button>
          </div>
        )}

        {!records.length ? (
          <FileUpload onFileSelect={handleFileSelect} />
        ) : !result ? (
          <div className="fade-in" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>{t('setupConfig')}</h2>
              <button 
                onClick={() => { if (window.confirm(t('historyConfirmDelete'))) setRecords([]); }} 
                className="btn btn-secondary"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <RotateCcw size={16} /> {t('uploadDifferent')}
              </button>
            </div>
            <Configurator assumptions={assumptions} onAssumptionsChange={setAssumptions} startHour={startHour} endHour={endHour} onTimeChange={(s, e) => { setStartHour(s); setEndHour(e); }} />
            <div className="grid-2-cols" style={{ marginTop: '1.5rem' }}>
              <RuleBuilder rules={rules} onChange={setRules} uniqueValuesMap={uniqueValuesMap} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <Randomizer title="F&S Assignment Targets" description="Distribute 'F&S' associates without manual rules." distributions={fsDistributions} onChange={setFsDistributions} targetSAs={['Cloud ERP', 'oCFO']} />
                <Randomizer title="IAE Assignment Targets" description="Distribute 'IAE' associates without manual rules." distributions={aeDistributions} onChange={setAeDistributions} targetSAs={['Cloud ERP', 'Data & AI', 'BTP', 'oCFO']} />
              </div>
            </div>
            <div className="action-footer">
              <button onClick={handleRun} className="btn btn-large btn-primary" disabled={loading}>
                {loading ? <Loader2 className="animate-spin" /> : t('runAllocation')}
              </button>
            </div>
          </div>
        ) : (
          <Dashboard
            localRecords={dashboardRecords}
            localMetrics={dashboardMetrics || (result.metrics as AllocationResult['metrics'])}
            result={result}
            onReset={() => { setResult(null); setLoadedVersionId(null); }}
            previousMetrics={previousMetrics}
            sessionLength={assumptions.sessionLength}
            facultyStartHour={assumptions.facultyStartHour ?? 6}
            sessionTimeOverrides={sessionTimeOverrides}
            onSessionTimeOverridesChange={setSessionTimeOverrides}
            manualSmeAssignments={manualSmeAssignments}
            onManualSmeAssignmentsChange={setManualSmeAssignments}
            manualFacultyAssignments={manualFacultyAssignments}
            onManualFacultyAssignmentsChange={setManualFacultyAssignments}
            onLocalMetricsChange={setDashboardMetrics}
            onLocalRecordsChange={setDashboardRecords}
            versionInfo={
              loadedVersionId ? (
                <div className="version-status-box" style={{ padding: '0.5rem', marginTop: '0.5rem' }}>
                  <div className="version-tag"><Clock size={14} /> v{projectVersions.find(v => v.id === loadedVersionId)?.versionNumber}</div>
                  <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                    <button onClick={() => { if (window.confirm('Discard draft and reload version?')) applySnapshot(projectVersions.find(v => v.id === loadedVersionId)!.snapshot); }} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}><RotateCcw size={12} /> {t('historyRestore')}</button>
                    <button onClick={() => handleDuplicateAsDraft(projectVersions.find(v => v.id === loadedVersionId)!)} className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}><Copy size={12} /> {t('duplicateDraft')}</button>
                  </div>
                </div>
              ) : null
            }
          />
        )}

      </main>

      <style>{`
        .app-container { display: flex; height: 100vh; overflow: hidden; background: #f8fafc; }
        .sidebar { width: 280px; background: #fff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; transition: width 0.2s ease; }
        .sidebar.collapsed { width: 78px; }
        .sidebar-header { padding: 1.5rem; border-bottom: 1px solid #f1f5f9; display: flex; justify-content: space-between; align-items: center; }
        .sidebar.collapsed .sidebar-header { padding: 1rem 0.75rem; }
        .sidebar-header-actions { display: flex; align-items: center; gap: 0.5rem; }
        .logo-text { font-size: 1.25rem; font-weight: 800; color: #1e293b; letter-spacing: -0.025em; }
        .logo-icon { color: #3b82f6; }
        .sidebar-toggle-btn { border: 1px solid #cbd5e1; color: #64748b; }
        .sidebar-nav { flex: 1; overflow-y: auto; padding: 1.5rem; }
        .nav-group-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; color: #64748b; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .project-list, .version-list { display: flex; flex-direction: column; gap: 0.25rem; }
        .project-item, .version-item { padding: 0.75rem; border-radius: 0.5rem; cursor: pointer; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; border: 1px solid transparent; }
        .project-item:hover, .version-item:hover { background: #f1f5f9; }
        .project-item.active { background: #eff6ff; border-color: #bfdbfe; }
        .project-name { display: block; font-weight: 600; color: #1e293b; font-size: 0.9rem; }
        .project-date { font-size: 0.7rem; color: #94a3b8; }
        .version-item.active { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
        .version-num { font-weight: 800; font-size: 0.8rem; margin-right: 0.5rem; }
        .version-label { font-size: 0.85rem; flex: 1; }
        .btn-subtle { background: none; border: none; padding: 0.25rem; cursor: pointer; color: #94a3b8; border-radius: 0.25rem; }
        .btn-subtle:hover { background: #e2e8f0; color: #475569; }
        .btn-subtle.danger:hover { background: #fee2e2; color: #dc2626; }
        .main-content { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
        .top-bar { height: 64px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; padding: 0 1.5rem; flex-shrink: 0; }
        .active-project-tag { display: flex; align-items: center; gap: 0.5rem; background: #f8fafc; padding: 0.35rem 0.75rem; border-radius: 9999px; border: 1px solid #e2e8f0; }
        .tag-label { font-size: 0.65rem; font-weight: 800; color: #64748b; }
        .tag-value { font-size: 0.85rem; font-weight: 600; color: #1e293b; }
        .tag-version { background: #3b82f6; color: #fff; font-size: 0.7rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 4px; }
        .tag-draft { font-size: 0.75rem; color: #f59e0b; font-style: italic; font-weight: 500; }
        .autosave-indicator { display: flex; align-items: center; gap: 0.4rem; font-size: 0.75rem; color: #64748b; margin-right: 1rem; }
        .sync-badge { padding: 0.25rem 0.5rem; font-size: 0.65rem; font-weight: 700; border-radius: 4px; text-transform: uppercase; }
        .sync-badge.online { background: #dcfce7; color: #166534; }
        .sync-badge.offline { background: #fee2e2; color: #991b1b; }
        .sidebar-footer { padding: 1rem; border-top: 1px solid #f1f5f9; text-align: center; }
        .version-status-box { display: flex; flex-direction: column; background: #f1f5f9; padding: 0.5rem; border-radius: 6px; }
        .version-tag { font-size: 0.75rem; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 0.25rem; }
      `}</style>
    </div>
  );
}

export default App;
