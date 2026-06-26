import fs from 'fs';
import path from 'path';

const filePath = 'e:/neew pg projected/src/js/owner-dashboard.js';
const content = fs.readFileSync(filePath, 'utf8');

const searchTerms = [
  'renderTenantsTable',
  'renderTenants',
  'tenants-archived-table-body'
];

searchTerms.forEach(term => {
  const index = content.indexOf(term);
  if (index !== -1) {
    console.log(`Found "${term}" at index ${index}. Matching lines:`);
    // Find line number
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (line.includes(term)) {
        console.log(`  Line ${i + 1}: ${line.trim()}`);
      }
    });
  } else {
    console.log(`"${term}" NOT found.`);
  }
});
