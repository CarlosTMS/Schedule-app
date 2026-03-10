const xlsx = require('xlsx');
const workbook = xlsx.readFile('Associates 2026_4D.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, { defval: '' });

const withoutRole = data.filter(d => !d['Solution Weeks SA'] || d['Solution Weeks SA'].trim() === '');
console.log('UNASSIGNED COUNT:', withoutRole.length);
console.log(JSON.stringify(withoutRole, null, 2));
