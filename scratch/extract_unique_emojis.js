import fs from 'fs';
import path from 'path';

const filesToScan = [
  'index.html',
  'owner-dashboard.html',
  'tenant-dashboard.html',
  'superadmin.html',
  'src/js/landing.js',
  'src/js/owner-dashboard.js',
  'src/js/tenant-dashboard.js',
  'src/js/superadmin.js',
  'src/js/notifications.js',
  'src/js/utils.js',
];

const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2702}-\u{27B0}]|[\u{24C2}-\u{1F251}]/gu;

const rootDir = 'e:/neew pg projected';
const allUniqueEmojis = new Map();

filesToScan.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    // Avoid comments if possible (some have comments with emojis)
    const isComment = line.trim().startsWith('//') || line.trim().startsWith('/*') || line.trim().startsWith('*');
    const matches = line.match(emojiRegex);
    if (matches) {
      matches.forEach(emoji => {
        // Skip decorative separators like ═ and ─
        if (emoji === '═' || emoji === '─') return;
        if (!allUniqueEmojis.has(emoji)) {
          allUniqueEmojis.set(emoji, []);
        }
        allUniqueEmojis.get(emoji).push({ file, line: idx + 1, text: line.trim(), isComment });
      });
    }
  });
});

console.log('--- UNIQUE EMOJIS FOUND ---');
for (const [emoji, occurrences] of allUniqueEmojis.entries()) {
  const uncommented = occurrences.filter(o => !o.isComment);
  console.log(`Emoji: ${emoji} (${occurrences.length} occurrences, ${uncommented.length} uncommented)`);
  if (uncommented.length > 0) {
    console.log(`  Example: [${uncommented[0].file}:${uncommented[0].line}] "${uncommented[0].text}"`);
  } else if (occurrences.length > 0) {
    console.log(`  Example (Comment): [${occurrences[0].file}:${occurrences[0].line}] "${occurrences[0].text}"`);
  }
}
