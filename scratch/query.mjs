import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const { data: tenants } = await supabase.from('tenants').select('*');
  const { data: buildings } = await supabase.from('buildings').select('*');
  const { data: rooms } = await supabase.from('rooms').select('*');
  const { data: payments } = await supabase.from('payments').select('*');

  console.log('--- Buildings ---');
  console.log(buildings.map(b => ({ id: b.id, name: b.name })));

  console.log('--- Rooms ---');
  console.log(rooms.map(r => ({ id: r.id, room_number: r.room_number, building_id: r.building_id })));

  console.log('--- Tenants ---');
  console.log(tenants.map(t => ({
    id: t.id,
    name: t.name,
    building_id: t.building_id,
    room_id: t.room_id,
    initial_meter_reading: t.initial_meter_reading,
    current_meter_reading: t.current_meter_reading,
    status: t.status
  })));

  console.log('--- Payments ---');
  console.log(payments.map(p => ({
    id: p.id,
    tenant_id: p.tenant_id,
    room_id: p.room_id,
    room_number: p.room_number,
    prev_reading: p.prev_reading,
    curr_reading: p.curr_reading,
    status: p.status
  })));
}

run();
