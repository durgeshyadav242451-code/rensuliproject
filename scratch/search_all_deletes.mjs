import fs from 'fs';
import path from 'path';

const searchDir = 'e:/neew pg projected/src/js';
const files = fs.readdirSync(searchDir).filter(f => f.endsWith('.js'));

files.forEach(file => {
  const content = fs.readFileSync(path.join(searchDir, file), 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (line.includes('.delete()') || line.includes('from(\'tenants\')') && line.includes('delete')) {
      console.log(`${file}:${i+1}: ${line.trim()}`);
    }
  });
});
