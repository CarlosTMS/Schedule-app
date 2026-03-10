import * as xlsx from 'xlsx';

export interface StudentRecord {
    'Full Name': string;
    'Country': string;
    'Office': string;
    'Solution Area': string;
    '(AA) Secondary Specialization': string;
    'Solution Week SA': string;
    'First Name'?: string;
    'Last Name'?: string;
    'Program'?: string;
    'Region'?: string;
    'Role'?: string;
    'Solution Weeks SA'?: string;

    // Internal fields appended during processing
    _originalIndex: number;
    _utcOffset?: number;

    // Output fields
    'Schedule'?: string;
    'VAT'?: string;
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
                const rawData: any[] = xlsx.utils.sheet_to_json(worksheet, { defval: "" });

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

                    let rawSA = getVal(['Solution Area', 'Solution Areas', '(AA) Business Group', 'Business Group']);
                    const rawSALower = rawSA.trim().toLowerCase();
                    if (rawSALower === 'iae' || rawSALower === 'industry account executive' || rawSALower === 'ae - generalist') {
                        rawSA = 'AE - Generalist';
                    }

                    return {
                        'Full Name': getVal(['Full Name', 'Name']),
                        'Country': getVal(['Country']),
                        'Office': getVal(['Office', 'Location']),
                        'Solution Area': rawSA,
                        '(AA) Secondary Specialization': getVal(['(AA) Secondary Specialization', 'Secondary Specialization', 'Specialization', 'Role', 'Program']),
                        'Solution Week SA': getVal(['Solution Week SA', 'Solution Weeks SA']),
                        Role: getVal(['Role']),
                        Program: getVal(['Program']),
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

export const generateExcel = (data: StudentRecord[], config?: any, filename: string = 'Scheduler_Results.xlsx') => {
    // Strip internal fields starting with '_'
    const exportData = data.map(record => {
        const cleanRecord: any = {};
        Object.keys(record).forEach(key => {
            if (!key.startsWith('_')) {
                cleanRecord[key] = (record as any)[key];
            }
        });
        return cleanRecord;
    });

    const worksheet = xlsx.utils.json_to_sheet(exportData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, "Results");

    if (config) {
        const configData = [
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
            config.rules.forEach((rule: any) => {
                configData.push({ Parameter: `IF ${rule.field} EQUALS ${rule.value}`, Value: `SET TO: ${rule.targetSA}` });
            });
        } else {
            configData.push({ Parameter: "Rules applied", Value: "None" });
        }

        configData.push({ Parameter: "", Value: "" }); // Blank row
        configData.push({ Parameter: "RANDOM DISTRIBUTION ENGINE (%) - F&S", Value: "" });
        if (config.fsDistributions) {
            config.fsDistributions.forEach((dist: any) => {
                configData.push({ Parameter: dist.sa, Value: `${dist.percentage}%` });
            });
        }

        configData.push({ Parameter: "", Value: "" }); // Blank row
        configData.push({ Parameter: "RANDOM DISTRIBUTION ENGINE (%) - ACCOUNT EXECUTIVE", Value: "" });
        if (config.aeDistributions) {
            config.aeDistributions.forEach((dist: any) => {
                configData.push({ Parameter: dist.sa, Value: `${dist.percentage}%` });
            });
        }

        const configSheet = xlsx.utils.json_to_sheet(configData);
        xlsx.utils.book_append_sheet(workbook, configSheet, "Configuration");
    }

    xlsx.writeFile(workbook, filename);
};
