const xlsx = require('xlsx');
const workbook = xlsx.readFile('Best Results so far.xlsx');
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = xlsx.utils.sheet_to_json(sheet, { defval: "" });
console.log("Headers:");
console.log(Object.keys(data[0] || {}));
console.log("\nFirst row:");
console.log(data[0]);
