import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const ownerKey = 'PGO86W24';
  const { data: owner, error: oErr } = await supabase.from('owners').select('*').eq('owner_key', ownerKey).maybeSingle();
  if (oErr) {
    console.error('Error fetching owner:', oErr);
    return;
  }
  if (!owner) {
    console.log(`Owner with key ${ownerKey} not found.`);
    return;
  }
  console.log('=== OWNER ===', owner);

  const { data: tenants, error: tErr } = await supabase.from('tenants').select('*').eq('owner_id', owner.id);
  if (tErr) console.error(tErr);
  else console.log('=== TENANTS ===', tenants);

  const { data: payments, error: pErr } = await supabase.from('payments').select('*').eq('owner_id', owner.id);
  if (pErr) console.error(pErr);
  else console.log('=== PAYMENTS ===', payments);
}

run();
