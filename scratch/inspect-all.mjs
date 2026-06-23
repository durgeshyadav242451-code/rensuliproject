import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  // Query tenants to find any tenant with a room 201 or similar name/details
  const { data: tenants, error: tErr } = await supabase
    .from('tenants')
    .select('*, rooms(room_number), buildings(name)');
  
  if (tErr) {
    console.error('Error fetching tenants:', tErr);
    return;
  }

  console.log('--- ALL TENANTS IN DB ---');
  console.log(tenants.map(t => ({
    id: t.id,
    name: t.name,
    status: t.status,
    room_number: t.rooms?.room_number,
    building_name: t.buildings?.name,
    initial_meter_reading: t.initial_meter_reading,
    current_meter_reading: t.current_meter_reading
  })));
}

run();
