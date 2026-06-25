import fs from 'fs';
import path from 'path';

const file = process.argv[2];
const query = process.argv[3];

if (!file || !query) {
  console.log('Usage: node find_lines.mjs <file_path> <query>');
  process.exit(1);
}

const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

console.log(`Searching for "${query}" in ${file}...`);
let count = 0;
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes(query.toLowerCase())) {
    console.log(`${idx + 1}: ${line.trim()}`);
    count++;
  }
});
console.log(`Found ${count} matches.`);
