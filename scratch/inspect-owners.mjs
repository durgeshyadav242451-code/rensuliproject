import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

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

async function inspect() {
  console.log('Querying owners table details...');
  const { data: owners, error: selectErr } = await supabase.from('owners').select('*');
  if (selectErr) {
    console.error('Error:', selectErr);
  } else {
    console.log('Owners:', JSON.stringify(owners, null, 2));
  }
}

inspect();
