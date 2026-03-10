import type { ReactNode } from 'react';
import { createContext, useContext, useState } from 'react';

type Language = 'en' | 'es';

const translations = {
    en: {
        appTitle: 'SAP Associate Enablement Scheduler',
        appSubtitle: 'Automated "What-If" allocation for Specializations, Schedules, and VATs.',
        processingData: 'Processing Data...',
        processingAlgorithm: 'Algorithm is crunching the optimal session placements.',
        dataLoaded: 'Data Loaded Successfully',
        studentsFound: 'students found in dataset.',
        uploadDifferent: 'Upload Different File',
        missingAssignments: 'Missing Assignments Detected',
        missingAssignmentsDesc: 'Associates are missing a "Solution Week SA" assignment. Here is the breakdown by Solution Area and Specialization:',
        runAllocation: 'Run Allocation Engine',
        downloadResults: 'Download Results',
        totalStudents: 'Total Students',
        assignedSuccess: 'Assigned Success',
        successRate: 'success rate',
        totalOutliers: 'Total Outliers',
        vatsFormed: 'VATs Formed',
        scheduleConflicts: 'Schedule Conflicts',
        scheduleConflictsDesc: 'Couldn\'t form minimum session',
        vatSizeMismatch: 'VAT Size Mismatch',
        vatSizeMismatchDesc: 'Leftovers from VAT formation',
        duplicatedVatRoles: 'Warning: VATs lack perfect diversity',
        changeParameters: 'Change Parameters',
        allocationDashboard: 'Allocation Dashboard',
        dataTableFilter: 'Data Table Filter',
        switchLang: 'Switch to Spanish',
        navSessions: 'Sessions Breakdown',
        navSMEs: 'SME Assignment',
        navFaculty: 'Faculty Assignment',
        navVATs: 'VAT Explorer',
        navData: 'Data Explorer',
        sessionTopic: 'Session Topic',
        scheduleLabel: 'Schedule',
        locationLabel: 'Location',
        assignedSME: 'Assigned SME',
        facultyAssignment: 'Faculty Assignment',
        navDebrief: 'Faculty Debrief',
        facultyDebrief: 'Faculty Debrief Schedule',
        noDebriefsFound: 'No scheduled sessions available for Faculty Debriefs.',
        baseSession: 'Base Session',
        debriefTime: 'Debrief Time',
        assignedFaculty: 'Assigned Faculty',
        batchAssociates: 'Associates in Batch (Max 20)',
        saveSimulation: 'Save',
        savedHistory: 'Saved Simulations History',
        restore: 'Restore',
        delete: 'Delete',
        sessionsBreakdownBySA: 'Sessions Breakdown by Solution Area',
        specialization: 'Specialization',
        attendees: 'Attendees',
        sessionDetail1: 'Session 1 Detail',
        sessionDetail2: 'Session 2 Detail',
        assigned: 'assigned',
        people: 'people',
        peopleAt: 'people at',
        of: 'of'
    },
    es: {
        appTitle: 'Programador de Habilitación de SAP Associates',
        appSubtitle: 'Asignación automática "What-If" para Especializaciones, Horarios y VATs.',
        processingData: 'Procesando Datos...',
        processingAlgorithm: 'El algoritmo está calculando las ubicaciones óptimas de sesiones.',
        dataLoaded: 'Datos Cargados Exitosamente',
        studentsFound: 'estudiantes encontrados en el dataset.',
        uploadDifferent: 'Subir Archivo Diferente',
        missingAssignments: 'Asignaciones Faltantes Detectadas',
        missingAssignmentsDesc: 'Associates no tienen una asignación "Solution Week SA". Aquí el desglose por Solution Area y Especialización:',
        runAllocation: 'Ejecutar Motor de Asignación',
        downloadResults: 'Descargar Resultados',
        totalStudents: 'Total Estudiantes',
        assignedSuccess: 'Asignación Exitosa',
        successRate: 'tasa de éxito',
        totalOutliers: 'Total Excepciones',
        vatsFormed: 'VATs Formados',
        scheduleConflicts: 'Conflictos de Horario',
        scheduleConflictsDesc: 'No se pudo formar sesión mínima',
        vatSizeMismatch: 'Discrepancia Tamaño VAT',
        vatSizeMismatchDesc: 'Sobrantes de formación VAT',
        duplicatedVatRoles: 'Advertencia: VATs carecen de diversidad perfecta',
        changeParameters: 'Cambiar Parámetros',
        allocationDashboard: 'Panel de Asignaciones',
        dataTableFilter: 'Filtro de Tabla de Datos',
        switchLang: 'Cambiar a Inglés',
        navSessions: 'Desglose de Sesiones',
        navSMEs: 'Asignación de SMEs',
        navFaculty: 'Asignación de Faculty',
        navVATs: 'Explorador de VATs',
        navData: 'Explorador de Datos',
        sessionTopic: 'Tema de la Sesión',
        scheduleLabel: 'Horario',
        locationLabel: 'Ubicación',
        assignedSME: 'SME Asignado',
        facultyAssignment: 'Asignación de Faculty',
        navDebrief: 'Faculty Debrief',
        facultyDebrief: 'Horario de Faculty Debrief',
        noDebriefsFound: 'No hay sesiones programadas disponibles para Faculty Debriefs.',
        baseSession: 'Sesión Base',
        debriefTime: 'Hora del Debrief',
        assignedFaculty: 'Faculty Asignado',
        batchAssociates: 'Asociados en el Lote (Máx 20)',
        saveSimulation: 'Guardar',
        savedHistory: 'Historial de Simulaciones',
        restore: 'Restaurar',
        delete: 'Eliminar',
        sessionsBreakdownBySA: 'Desglose de Sesiones por Solution Area',
        specialization: 'Especialización',
        attendees: 'Asistentes',
        sessionDetail1: 'Detalle de la Sesión 1',
        sessionDetail2: 'Detalle de la Sesión 2',
        assigned: 'asignados',
        people: 'personas',
        peopleAt: 'personas a las',
        of: 'de'
    }
};

type I18nContextType = {
    lang: Language;
    toggleLang: () => void;
    t: (key: keyof typeof translations['en']) => string;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
    const [lang, setLang] = useState<Language>('es');

    const toggleLang = () => setLang(l => l === 'en' ? 'es' : 'en');
    const t = (key: keyof typeof translations['en']) => translations[lang][key];

    return <I18nContext.Provider value={{ lang, toggleLang, t }}>{children}</I18nContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useI18n = () => {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useI18n must be used within I18nProvider');
    return ctx;
};
