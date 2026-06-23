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

async function checkTriggers() {
  console.log('Querying triggers...');
  // PostgREST doesn't expose system catalog tables directly, but let's check if we can query them or if there's an error.
  // Actually, we can check if there's any RPC function we can call. 
  // Let's see if we can do a request to the database via standard select on some system tables.
  const { data, error } = await supabase.from('owners').select('*').limit(1);
  console.log('Owner row fetch:', error ? error.message : 'Success');
}

checkTriggers();
