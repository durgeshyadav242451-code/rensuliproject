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

async function checkLogs() {
  console.log('Fetching audit logs...');
  // Since audit logs are read-only for admin normally, let's see if we can query them anonymously or if it fails
  const { data, error } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(10);
  if (error) {
    console.error('Error fetching audit logs:', error.message);
  } else {
    console.log('Audit logs:', data);
  }
}

checkLogs();
