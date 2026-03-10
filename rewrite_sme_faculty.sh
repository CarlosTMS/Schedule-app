node -e "
const fs = require('fs');
let facultyMatcher = fs.readFileSync('src/lib/facultyMatcher.ts', 'utf8');
facultyMatcher = facultyMatcher.replace('export const autoAssignFaculty', 'import { getKnownUtcOffset } from \'./timezones\';\n\nexport const autoAssignFaculty');
facultyMatcher = facultyMatcher.replace('autoAssignFaculty = (solutionArea: string, schedules: string[])', 'autoAssignFaculty = (solutionArea: string, schedules: string[], startHour: number = 0, endHour: number = 24)');
facultyMatcher = facultyMatcher.replace('const sortedSchedules = [...schedules].sort((a, b) => a.localeCompare(b));', 'const sortedSchedules = [...schedules].sort((a, b) => a.localeCompare(b));');
let replacement1 = \`        if (eligibleFaculty.length > 0) {
            const match = schedule.match(/(\\d+):00 UTC/);
            const utcHour = match ? parseInt(match[1], 10) : 0;
            
            const sortedEligible = [...eligibleFaculty].sort((a,b) => {
                const aLocal = (utcHour + getKnownUtcOffset(a.office) + 24) % 24;
                const bLocal = (utcHour + getKnownUtcOffset(b.office) + 24) % 24;
                const aIn = (aLocal >= startHour && aLocal < endHour) ? 1 : 0;
                const bIn = (bLocal >= startHour && bLocal < endHour) ? 1 : 0;
                return bIn - aIn;
            });
            
            const bestIn = ( (utcHour + getKnownUtcOffset(sortedEligible[0].office) + 24) % 24 >= startHour && (utcHour + getKnownUtcOffset(sortedEligible[0].office) + 24) % 24 < endHour ) ? 1 : 0;
            const topTier = sortedEligible.filter(f => {
                const l = (utcHour + getKnownUtcOffset(f.office) + 24) % 24;
                const lIn = (l >= startHour && l < endHour) ? 1 : 0;
                return lIn === bestIn;
            });
            
            const assignedFaculty = topTier[facultyIndex % topTier.length];\`;
facultyMatcher = facultyMatcher.replace(/if \\(eligibleFaculty\\.length > 0\\) \\{[\\s\\S]*?const assignedFaculty = eligibleFaculty\\[facultyIndex % eligibleFaculty.length\\];/, replacement1);
fs.writeFileSync('src/lib/facultyMatcher.ts', facultyMatcher);

let smeMatcher = fs.readFileSync('src/lib/smeMatcher.ts', 'utf8');
smeMatcher = smeMatcher.replace('export const autoAssignSMEs', 'import { getKnownUtcOffset } from \'./timezones\';\n\nexport const autoAssignSMEs');
smeMatcher = smeMatcher.replace('autoAssignSMEs = (solutionArea: string, schedules: string[])', 'autoAssignSMEs = (solutionArea: string, schedules: string[], startHour: number = 0, endHour: number = 24)');
let replacement2 = \`            if (eligible.length > 0) {
                const match = schedule.match(/(\\d+):00 UTC/);
                const utcHour = match ? parseInt(match[1], 10) : 0;

                const sortedEligible = [...eligible].sort((a,b) => {
                    const aLocal = (utcHour + getKnownUtcOffset(a.office_location) + 24) % 24;
                    const bLocal = (utcHour + getKnownUtcOffset(b.office_location) + 24) % 24;
                    const aIn = (aLocal >= startHour && aLocal < endHour) ? 1 : 0;
                    const bIn = (bLocal >= startHour && bLocal < endHour) ? 1 : 0;
                    if (aIn !== bIn) return bIn - aIn; // 1 preferred over 0
                    
                    const aUnassigned = !assignedNames.has(a.name) ? 1 : 0;
                    const bUnassigned = !assignedNames.has(b.name) ? 1 : 0;
                    return bUnassigned - aUnassigned;
                });
                
                const chosen = sortedEligible[0];
                assignments[schedule][session.id] = chosen;
                assignedNames.add(chosen.name);
            }\`;
smeMatcher = smeMatcher.replace(/if \\(eligible\\.length > 0\\) \\{[\\s\\S]*?assignments\\[schedule\\]\\[session\\.id\\] = eligible\\[0\\];\\n                \\}\\n            \\}/, replacement2);
fs.writeFileSync('src/lib/smeMatcher.ts', smeMatcher);
"
