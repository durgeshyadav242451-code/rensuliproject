import fs from 'fs';
import path from 'path';

const apkPath = 'E:\\neew pg projected\\android-app\\app\\build\\outputs\\apk\\debug\\app-debug.apk';
const publicDir = 'E:\\neew pg projected\\public';
const distDir = 'E:\\neew pg projected\\dist';

async function run() {
  try {
    console.log('Reading APK file...');
    const apkBuffer = fs.readFileSync(apkPath);
    console.log(`Read success. Size: ${apkBuffer.length} bytes.`);

    console.log('Converting to base64...');
    const base64Data = apkBuffer.toString('base64');
    console.log(`Conversion success. Base64 length: ${base64Data.length} characters.`);

    // Write to public folder
    const publicTxtPath = path.join(publicDir, 'pg-builders-app.txt');
    fs.writeFileSync(publicTxtPath, base64Data);
    console.log(`Wrote base64 to ${publicTxtPath}`);

    // Clean up forbidden executable/apk files from public folder
    const filesToDeletePublic = [
      path.join(publicDir, 'pg-builders-app'),
      path.join(publicDir, 'pg-builders-app.apk')
    ];
    for (const file of filesToDeletePublic) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Deleted forbidden file from public: ${file}`);
      }
    }

    // Clean up from dist folder as well (so npm run build doesn't run with old dist files)
    const filesToDeleteDist = [
      path.join(distDir, 'pg-builders-app'),
      path.join(distDir, 'pg-builders-app.apk'),
      path.join(distDir, 'pg-builders-app.txt') // delete this so build copies the new one
    ];
    for (const file of filesToDeleteDist) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Deleted file from dist: ${file}`);
      }
    }

    console.log('Encoding and cleanup complete!');
  } catch (error) {
    console.error('Error during encoding/cleanup:', error);
  }
}

run();
