import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  console.log("=== TENANTS ===");
  const { data: tenants, error: tErr } = await supabase.from('tenants').select('*');
  if (tErr) console.error(tErr);
  else console.log(JSON.stringify(tenants, null, 2));

  console.log("\n=== PAYMENTS ===");
  const { data: payments, error: pErr } = await supabase.from('payments').select('*');
  if (pErr) console.error(pErr);
  else console.log(JSON.stringify(payments, null, 2));
}

run();
