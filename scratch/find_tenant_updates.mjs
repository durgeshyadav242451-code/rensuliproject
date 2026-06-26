import fs from 'fs';

const content = fs.readFileSync('e:/neew pg projected/src/js/owner-dashboard.js', 'utf8');
const lines = content.split('\n');

lines.forEach((line, index) => {
  if (line.includes("from('tenants')") && lines[index+1] && lines[index+1].includes('update')) {
    console.log(`Line ${index+1}:`);
    for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 10); i++) {
      console.log(`  ${i+1}: ${lines[i]}`);
    }
    console.log('--------------------');
  }
});
