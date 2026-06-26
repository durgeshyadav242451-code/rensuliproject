import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env', 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const value = parts.slice(1).join('=').trim();
    env[key] = value;
  }
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);

async function run() {
  // Query triggers and trigger functions from postgres catalog via postgrest if possible,
  // or check schema files.
  // Wait, let's search the migrations folder directly first!
  const migrationFiles = fs.readdirSync('.').filter(f => f.startsWith('supabase-migration') || f === 'supabase-schema.sql');
  console.log('Searching migration files for triggers or cascading deletes...');
  
  migrationFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes('trigger') || line.toLowerCase().includes('delete') || line.toLowerCase().includes('cascade')) {
        if (line.includes('tenants') || line.includes('vacate_notices')) {
          console.log(`${file}:${i+1}: ${line.trim()}`);
        }
      }
    });
  });
}

run();
