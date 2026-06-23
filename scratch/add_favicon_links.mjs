import fs from 'fs';
import path from 'path';

const rootDir = '.';
const files = fs.readdirSync(rootDir).filter(file => file.endsWith('.html'));

const faviconLinks = `
  <link rel="shortcut icon" href="/favicon.ico" />
  <link rel="icon" type="image/png" href="/favicon.png" />
  <link rel="apple-touch-icon" href="/icons/icon-192.png" />`;

files.forEach(file => {
  const filePath = path.join(rootDir, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Remove any old rel="icon" or rel="apple-touch-icon" tags to prevent duplicates
  content = content.replace(/<link[^>]*rel=["'](icon|shortcut icon|apple-touch-icon)["'][^>]*>/gi, '');

  // Inject the new clean favicon links right after <head>
  if (content.includes('<head>')) {
    content = content.replace('<head>', `<head>${faviconLinks}`);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Injected favicon links to: ${file}`);
  } else {
    console.warn(`Could not find <head> tag in: ${file}`);
  }
});

console.log('Favicon links injection complete!');
