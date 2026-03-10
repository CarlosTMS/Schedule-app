const xlsx = require('xlsx');
try {
  const workbook = xlsx.readFile('Faculty Assignments.xlsx');
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  console.log(JSON.stringify(data, null, 2));
} catch (e) {
  console.log("Error reading file:", e.message);
}
