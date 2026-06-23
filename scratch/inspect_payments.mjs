import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const { data, error } = await supabase.from('payments').select('*');
  if (error) {
    console.error('Error fetching payments:', error);
    return;
  }
  console.log(`Total payments in database: ${data.length}`);
  console.log(data.map(p => ({
    id: p.id,
    tenant_name: p.tenant_name,
    month_year: p.month_year,
    status: p.status,
    total_amount: p.total_amount,
    payment_method: p.payment_method,
    transaction_id: p.transaction_id
  })));
}

run();
