
const fs = require('fs');
const xlsx = require('./node_modules/xlsx/xlsx.js');

const jsonPath = 'summary_2026-03-18.json';
const excelPath = 'Best Results so far.xlsx';

console.log('Reading JSON...');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

console.log('Reading Excel...');
const workbook = xlsx.readFile(excelPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const excelData = xlsx.utils.sheet_to_json(sheet);

const excelMap = new Map();
excelData.forEach(row => {
    if (row['Full Name']) {
        excelMap.set(row['Full Name'], {
            VAT: row.VAT,
            Program: row.Program,
            Role: row.Role
        });
    }
});

let fixCount = 0;
data.sessions.forEach(session => {
    session.attendees.forEach(att => {
        const info = excelMap.get(att.name);
        if (info) {
             att.vat = info.VAT;
             // Inject program for the new display requirement
             att.program = info.Program;
             fixCount++;
        }
    });
});

console.log(`Updated entries: ${fixCount}`);
fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
console.log(`Updated ${jsonPath}`);
