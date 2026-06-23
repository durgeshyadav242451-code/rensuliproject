import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const { data: shifts, error: sErr } = await supabase.from('room_shift_requests').select('*');
  const { data: history, error: hErr } = await supabase.from('tenant_history').select('*');

  console.log('--- SHIFT REQUESTS ---');
  console.log(shifts);

  console.log('--- TENANT HISTORY ---');
  console.log(history);
}

run();
