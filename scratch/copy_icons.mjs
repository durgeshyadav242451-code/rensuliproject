import fs from 'fs';
import path from 'path';

const srcPngPath = 'E:/neew pg projected/android-app/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png';
const publicDir = 'public';
const iconsDir = path.join(publicDir, 'icons');

// Read launcher PNG
if (!fs.existsSync(srcPngPath)) {
  console.error(`Source icon not found at: ${srcPngPath}`);
  process.exit(1);
}

const pngBuffer = fs.readFileSync(srcPngPath);
const pngBase64 = pngBuffer.toString('base64');

// SVG template with base64 image href
function makeSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <image href="data:image/png;base64,${pngBase64}" x="0" y="0" width="${size}" height="${size}"/>
</svg>`;
}

// Ensure directories exist
fs.mkdirSync(iconsDir, { recursive: true });

// Copy PNG files
const pngDestinations = [
  path.join(publicDir, 'favicon.ico'),
  path.join(publicDir, 'favicon.png'),
  path.join(iconsDir, 'icon-72.png'),
  path.join(iconsDir, 'icon-96.png'),
  path.join(iconsDir, 'icon-128.png'),
  path.join(iconsDir, 'icon-144.png'),
  path.join(iconsDir, 'icon-152.png'),
  path.join(iconsDir, 'icon-192.png'),
  path.join(iconsDir, 'icon-384.png'),
  path.join(iconsDir, 'icon-512.png')
];

pngDestinations.forEach(dest => {
  fs.writeFileSync(dest, pngBuffer);
  console.log(`Copied PNG to: ${dest}`);
});

// Copy SVG files
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
fs.writeFileSync(path.join(publicDir, 'favicon.svg'), makeSvg(32));
console.log(`Created SVG favicon: ${path.join(publicDir, 'favicon.svg')}`);

sizes.forEach(size => {
  const dest = path.join(iconsDir, `icon-${size}.svg`);
  fs.writeFileSync(dest, makeSvg(size));
  console.log(`Created SVG icon to: ${dest}`);
});

console.log('Successfully updated all web app and favicon icons with the new launch icon!');
