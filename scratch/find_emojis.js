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

// Regex for matching emoji range
const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F000}-\u{1F02F}]|[\u{1F0A0}-\u{1F0FF}]|[\u{1F100}-\u{1F1FF}]|[\u{1F200}-\u{1F2FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F700}-\u{1F77F}]|[\u{1F780}-\u{1F7FF}]|[\u{1F800}-\u{1F8FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{2702}-\u{27B0}]|[\u{24C2}-\u{1F251}]/gu;

const rootDir = 'e:/neew pg projected';

filesToScan.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${file}`);
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let matchCount = 0;
  lines.forEach((line, idx) => {
    const matches = line.match(emojiRegex);
    if (matches) {
      matchCount += matches.length;
      console.log(`[${file}:${idx + 1}] Found emoji(s): ${matches.join(', ')} -> Line: ${line.trim().slice(0, 100)}`);
    }
  });
  console.log(`Total emojis in ${file}: ${matchCount}\n----------------------------------`);
});
