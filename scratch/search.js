import fs from 'fs';
const filepath = process.argv[2];
const query = process.argv[3];
if (!filepath || !query) {
  console.log('Usage: node search.js <filepath> <query>');
  process.exit(1);
}
const content = fs.readFileSync(filepath, 'utf8');
const lines = content.split('\n');
console.log(`Searching in "${filepath}" for "${query}":`);
lines.forEach((line, idx) => {
  if (line.toLowerCase().includes(query.toLowerCase())) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
