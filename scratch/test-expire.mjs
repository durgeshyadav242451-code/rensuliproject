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

async function test() {
  const { data: ownersBefore } = await supabase.from('owners').select('*');
  const targetOwner = ownersBefore[0];
  console.log(`Before update: Expiry = ${targetOwner.subscription_expiry}, Status = ${targetOwner.subscription_status}`);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const expiredAt = yesterday.toISOString();
  
  console.log('Performing update...');
  const { data, error } = await supabase
    .from('owners')
    .update({
      subscription_expiry: expiredAt,
      subscription_status: 'expired'
    })
    .eq('id', targetOwner.id)
    .select();

  if (error) {
    console.error('Update error:', error);
  } else {
    console.log('Update returned data:', data);
  }

  const { data: ownersAfter } = await supabase.from('owners').select('*').eq('id', targetOwner.id);
  const updatedOwner = ownersAfter[0];
  console.log(`After update: Expiry = ${updatedOwner.subscription_expiry}, Status = ${updatedOwner.subscription_status}`);
}

test();
