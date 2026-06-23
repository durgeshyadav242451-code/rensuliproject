import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://gofpiauazjclgeoygipl.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk';

const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  try {
    const { data: payments, error } = await supabase
      .from('payments')
      .select('*');
    if (error) throw error;
    console.log('All payments:', payments.map(p => ({ id: p.id, tenant_name: p.tenant_name, amount: p.total_amount, curr_reading: p.curr_reading, room_number: p.room_number, building_name: p.building_name, status: p.status })));
  } catch (e) {
    console.error(e);
  }
}

test();
