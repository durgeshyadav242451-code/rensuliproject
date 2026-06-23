import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function testInsert() {
  const payload = {
    tenant_id: '50e26ab7-3860-4965-bbd4-de52382c40c3', // some valid or random uuid, let's test if RLS allows it
    building_id: '50e26ab7-3860-4965-bbd4-de52382c40c3',
    owner_id: '50e26ab7-3860-4965-bbd4-de52382c40c3',
    category: 'Plumbing',
    description: 'Test description',
    status: 'open'
  };

  const { data, error } = await supabase
    .from('complaints')
    .insert(payload)
    .select();

  console.log('Result:', data);
  console.log('Error:', error);
}

testInsert();
