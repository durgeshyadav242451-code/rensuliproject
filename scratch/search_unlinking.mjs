import fs from 'fs';

const filePath = 'e:/neew pg projected/src/js/owner-dashboard.js';
const content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes('tenants') && (line.includes('update') || line.includes('delete'))) {
    console.log(`Line ${i+1}: ${line.trim()}`);
    // Print 5 lines before and after
    for (let j = Math.max(0, i-5); j <= Math.min(lines.length-1, i+5); j++) {
      console.log(`  [${j+1}]: ${lines[j]}`);
    }
    console.log('-----------------------------');
  }
});
