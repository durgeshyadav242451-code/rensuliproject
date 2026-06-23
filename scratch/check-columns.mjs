import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const { data, error } = await supabase.rpc('get_payments_columns');
  if (error) {
    // If RPC doesn't exist, let's query a dummy record or postgrest schema
    console.log('RPC error:', error);
    const { data: selectData, error: sErr } = await supabase.from('payments').select('*').limit(1);
    if (sErr) {
      console.log('Select error:', sErr);
    } else {
      console.log('Payments columns:', Object.keys(selectData[0] || {}));
    }
  } else {
    console.log('Columns:', data);
  }
}

run();
