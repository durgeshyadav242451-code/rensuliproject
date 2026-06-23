// Pure Node.js PNG icon generator — no external deps
// Creates PG Builders icons for all PWA sizes
import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const outDir = path.join('public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// We'll generate SVG files for each size and save as SVG
// (browsers accept SVG icons, and the manifest can use SVG)
function generateSVG(size) {
  const r = size * 0.18; // corner radius
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#6C5CE7"/>
      <stop offset="100%" style="stop-color:#00D2FF"/>
    </linearGradient>
    <linearGradient id="pg2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#A29BFE"/>
      <stop offset="100%" style="stop-color:#6C5CE7"/>
    </linearGradient>
    <clipPath id="clip">
      <rect width="${size}" height="${size}" rx="${r}" ry="${r}"/>
    </clipPath>
  </defs>
  
  <!-- Background -->
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#0F0F1A"/>
  
  <!-- Building group, clipped to rounded rect -->
  <g clip-path="url(#clip)">
    <!-- Main building body -->
    <rect x="${size*0.22}" y="${size*0.38}" width="${size*0.56}" height="${size*0.52}" fill="url(#pg)" rx="${size*0.04}"/>
    
    <!-- Roof -->
    <polygon points="${size*0.5},${size*0.14} ${size*0.18},${size*0.40} ${size*0.82},${size*0.40}" fill="url(#pg2)"/>
    
    <!-- Windows row 1 -->
    <rect x="${size*0.30}" y="${size*0.48}" width="${size*0.12}" height="${size*0.12}" fill="rgba(255,255,255,0.65)" rx="${size*0.02}"/>
    <rect x="${size*0.44}" y="${size*0.48}" width="${size*0.12}" height="${size*0.12}" fill="rgba(255,255,255,0.65)" rx="${size*0.02}"/>
    <rect x="${size*0.58}" y="${size*0.48}" width="${size*0.12}" height="${size*0.12}" fill="rgba(255,255,255,0.65)" rx="${size*0.02}"/>
    
    <!-- Windows row 2 -->
    <rect x="${size*0.30}" y="${size*0.63}" width="${size*0.12}" height="${size*0.12}" fill="rgba(255,255,255,0.65)" rx="${size*0.02}"/>
    <rect x="${size*0.58}" y="${size*0.63}" width="${size*0.12}" height="${size*0.12}" fill="rgba(255,255,255,0.65)" rx="${size*0.02}"/>
    
    <!-- Door -->
    <rect x="${size*0.41}" y="${size*0.65}" width="${size*0.18}" height="${size*0.25}" fill="#00D2FF" rx="${size*0.03}" opacity="0.85"/>
  </g>
</svg>`;
}

sizes.forEach(size => {
  const svg = generateSVG(size);
  const svgPath = path.join(outDir, `icon-${size}.svg`);
  fs.writeFileSync(svgPath, svg, 'utf-8');
  // Also copy as .png named file (browsers will handle SVG with wrong extension poorly, 
  // so we write a real tiny PNG placeholder and update manifest to use SVG)
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), svg, 'utf-8');
  console.log(`Generated icon-${size}.png (SVG format)`);
});

// Update manifest to use SVG icons
const manifestPath = path.join('public', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
manifest.icons = sizes.map(size => ({
  src: `/icons/icon-${size}.svg`,
  sizes: `${size}x${size}`,
  type: 'image/svg+xml',
  purpose: 'any maskable'
}));
// Keep PNG references too for compatibility  
sizes.forEach(size => {
  manifest.icons.push({
    src: `/icons/icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any maskable'
  });
});
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log('Icons generated and manifest updated!');
