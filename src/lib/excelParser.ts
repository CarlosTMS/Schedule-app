import * as xlsx from 'xlsx';
import type { AllocationRule } from '../components/RuleBuilder';
import type { RunSnapshot } from './runHistoryStorage';




export interface StudentRecord {
    'Full Name': string;
    'Country': string;
    'Office': string;
    'Email'?: string;
    '(AA) Secondary Specialization': string;
    'Solution Weeks SA': string;
    'First Name'?: string;
    'Last Name'?: string;
    'Role'?: string;
    'Program'?: string;
    '(AA) Business Group'?: string;

    // Internal fields appended during processing
    _originalIndex: number;
    _utcOffset?: number;
    _availInfo?: number[];
    _assignedSchedule?: string;
    _isManual?: boolean;
    _isDiscrepancy?: boolean;
    _discrepancyReason?: string;

    // Output fields
    'Schedule'?: string;
    'VAT'?: string;
    'Asignacion de SMEs'?: string;
    'Asignacion de Faculty'?: string;
    'SME'?: string;
    'Faculty'?: string;
}

export const parseExcel = async (file: File): Promise<StudentRecord[]> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = xlsx.read(data, { type: 'array' });

                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];

                // Convert to JSON
                const rawData = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });

                // Normalize and attach internal index
                const records: StudentRecord[] = rawData.map((row, index) => {
                    const keys = Object.keys(row);
                    const getVal = (opts: string[]) => {
                        for (const opt of opts) {
                            const match = keys.find(k => k.trim().toLowerCase() === opt.trim().toLowerCase());
                            if (match && row[match]) return String(row[match]);
                        }
                        return '';
                    };

                    const bgValue = getVal(['(AA) Business Group', 'Business Group']);
                    const swsSA = getVal(['Solution Weeks SA', 'Solution Week SA']);

                    const rawSA = swsSA || 'Unassigned';

                    return {
                        'Full Name': getVal(['Full Name', 'Name']),
                        'Country': getVal(['Country']),
                        'Office': getVal(['Office', 'Location']),
                        'Email': getVal(['Email', 'E-mail', 'Email Address', 'Mail']),
                        '(AA) Secondary Specialization': getVal(['(AA) Secondary Specialization', 'Secondary Specialization', 'Specialization', 'Role', 'Program']),
                        'Solution Weeks SA': rawSA,
                        '(AA) Business Group': bgValue,
                        Role: getVal(['Role']),
                        Program: getVal(['Program']),
                        Schedule: getVal(['Schedule', 'Horario']),
                        VAT: getVal(['VAT']),
                        'Asignacion de SMEs': getVal(['Asignacion de SMEs', 'Assigned SME']),
                        'Asignacion de Faculty': getVal(['Asignacion de Faculty', 'Assigned Faculty']),
                        'SME': getVal(['SME']),
                        'Faculty': getVal(['Faculty']),
                        _originalIndex: index,
                    };
                });

                resolve(records);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = (err) => reject(err);
        reader.readAsArrayBuffer(file);
    });
};

export const generateExcel = (data: StudentRecord[], config?: Partial<RunSnapshot>, filename: string = 'Scheduler_Results.xlsx') => {
    // Strip internal fields starting with '_'
    const exportData = data.map(record => {
        const cleanRecord: Record<string, unknown> = {};
        Object.keys(record).forEach(key => {
            if (!key.startsWith('_')) {
                cleanRecord[key] = record[key as keyof StudentRecord];
            }
        });
        return cleanRecord;
    });

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(exportData);
    xlsx.utils.book_append_sheet(workbook, worksheet, "Results");

    if (config) {
        // If we have full snapshot context (from Summary), we can enrich the results with SME/Faculty
        // However, the records in 'data' might already have been enriched by Summary's buildExportPayload logic
        // if we pass them correctly. To be safe and robust, let's keep the config sheet logic.
        const configData: { Parameter: string; Value: string | number | undefined }[] = [
            { Parameter: "Working Hours Start (UTC)", Value: config.startHour },
            { Parameter: "Working Hours End (UTC)", Value: config.endHour },
            { Parameter: "Min Session Size", Value: config.assumptions?.minSessionSize },
            { Parameter: "Max Session Size", Value: config.assumptions?.maxSessionSize },
            { Parameter: "Max Sessions Per Day", Value: config.assumptions?.maxSessionsPerDay },
            { Parameter: "Allowed VAT Sizes", Value: config.assumptions?.allowedVATSizes?.join(', ') },
            { Parameter: "Session Length (min)", Value: config.assumptions?.sessionLength },
            { Parameter: "Max Timezone Diff (hours)", Value: config.assumptions?.maxTimezoneDifference },
        ];

        configData.push({ Parameter: "", Value: "" }); // Blank row
        configData.push({ Parameter: "MANUAL ALLOCATION RULES", Value: "" });
        if (config.rules && config.rules.length > 0) {
            config.rules.forEach((rule: AllocationRule) => {
                configData.push({ Parameter: `IF ${rule.field} EQUALS ${rule.value}`, Value: `SET TO: ${rule.targetSA}` });
            });
        } else {
            configData.push({ Parameter: "Rules applied", Value: "None" });
        }

        configData.push({ Parameter: "", Value: "" }); // Blank row
        configData.push({ Parameter: "RANDOM DISTRIBUTION ENGINE (%) - F&S", Value: "" });
        if (config.fsDistributions) {
            config.fsDistributions.forEach((dist) => {
                configData.push({ Parameter: dist.sa, Value: `${dist.percentage}%` });
            });
        }

        configData.push({ Parameter: "", Value: "" }); // Blank row
        configData.push({ Parameter: "RANDOM DISTRIBUTION ENGINE (%) - IAE", Value: "" });
        if (config.aeDistributions) {
            config.aeDistributions.forEach((dist) => {
                configData.push({ Parameter: dist.sa, Value: `${dist.percentage}%` });
            });
        }

        if (config.sessionInstanceTimeOverrides && Object.keys(config.sessionInstanceTimeOverrides).length > 0) {
            configData.push({ Parameter: "", Value: "" });
            configData.push({ Parameter: "SESSION-LEVEL TIME OVERRIDES (UTC)", Value: "" });
            Object.entries(config.sessionInstanceTimeOverrides)
                .sort(([a], [b]) => a.localeCompare(b))
                .forEach(([key, hour]) => {
                    configData.push({ Parameter: key, Value: `${hour}:00 UTC` });
                });
        }


        const configSheet = xlsx.utils.json_to_sheet(configData);
        xlsx.utils.book_append_sheet(workbook, configSheet, "Configuration");
    }

    xlsx.writeFile(workbook, filename);
};
