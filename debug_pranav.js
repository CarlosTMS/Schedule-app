const xlsx = require('xlsx');
const workbook = xlsx.readFile('Associates 2026_4D.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

const pranav = data.find(d => d['Full Name'] === 'Pranav Priyanshu');
console.log(JSON.stringify(pranav, null, 2));
