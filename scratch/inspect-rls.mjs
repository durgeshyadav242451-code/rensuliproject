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
  console.log('Inspecting owners table policies...');
  // We can query pg_policies using supabase.rpc or direct SQL if allowed, 
  // but since we are client-side we can try to perform anonymous updates/selects.
  
  // Let's check if we can select owners anonymously
  const { data: selectAnon, error: selectErr } = await supabase.from('owners').select('id, name');
  console.log('Anon select error:', selectErr ? selectErr.message : 'None');
  console.log('Anon select data count:', selectAnon ? selectAnon.length : 0);
}

inspect();
