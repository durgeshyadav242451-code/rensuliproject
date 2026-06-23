import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const email = `test-owner-${Date.now()}@test.com`;
  const password = 'Password123!';

  console.log('1. Signing up test owner...');
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name: 'Test Owner', phone: '9999999999', role: 'owner' }
    }
  });

  if (signUpErr) {
    console.error('Sign up failed:', signUpErr);
    return;
  }

  const ownerId = signUpData.user.id;
  console.log('Owner signed up successfully. ID:', ownerId);

  // Sign in as owner
  console.log('2. Signing in as owner...');
  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (signInErr) {
    console.error('Sign in failed:', signInErr);
    return;
  }
  const token = signInData.session.access_token;
  console.log('Owner signed in successfully.');

  // Create owner profile in database
  console.log('3. Creating owner profile...');
  const { error: profileErr } = await supabase.from('owners').insert({
    id: ownerId,
    name: 'Test Owner',
    phone: '9999999999',
    email,
    owner_key: `TST${Date.now().toString().slice(-5)}`,
    subscription_status: 'active',
    subscription_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    allowed_buildings: 5,
    created_at: new Date().toISOString()
  });
  if (profileErr) {
    console.error('Profile creation failed:', profileErr);
    return;
  }
  console.log('Owner profile created in DB.');

  // Create building
  console.log('4. Creating building...');
  const { data: building, error: bldErr } = await supabase.from('buildings').insert({
    owner_id: ownerId,
    name: 'Test Building',
    location: 'Test Location',
    type: 'pg',
    electricity_rate: 10,
    advance_amount: 5000,
    maintenance_charge: 500,
    electricity_included: false
  }).select().single();
  if (bldErr) {
    console.error('Building creation failed:', bldErr);
    return;
  }
  console.log('Building created ID:', building.id);

  // Create floor
  console.log('5. Creating floor...');
  const { data: floor, error: floorErr } = await supabase.from('floors').insert({
    building_id: building.id,
    floor_number: '1'
  }).select().single();
  if (floorErr) {
    console.error('Floor creation failed:', floorErr);
    return;
  }
  console.log('Floor created ID:', floor.id);

  // Create room
  console.log('6. Creating room...');
  const { data: room, error: roomErr } = await supabase.from('rooms').insert({
    floor_id: floor.id,
    building_id: building.id,
    room_number: '101',
    rent: 8000,
    advance_amount: 5000,
    electricity_included: false,
    electricity_rate: 10,
    beds_count: 1,
    beds_occupied: 0,
    status: 'vacant'
  }).select().single();
  if (roomErr) {
    console.error('Room creation failed:', roomErr);
    return;
  }
  console.log('Room created ID:', room.id);

  // Create tenant (active directly)
  console.log('7. Creating tenant...');
  const { data: tenant, error: tenErr } = await supabase.from('tenants').insert({
    owner_id: ownerId,
    building_id: building.id,
    room_id: room.id,
    status: 'active',
    name: 'Test Tenant',
    phone: '8888888888',
    email: `tenant-${Date.now()}@test.com`,
    aadhaar_number: '111122223333',
    living_type: 'alone',
    advance_paid: 5000,
    initial_meter_reading: 100,
    current_meter_reading: 100,
    join_date: '2026-06-20'
  }).select().single();
  if (tenErr) {
    console.error('Tenant creation failed:', tenErr);
    return;
  }
  console.log('Tenant created ID:', tenant.id);

  // Submit first month payment (June 2026)
  console.log('8. Submitting June payment...');
  const { data: p1, error: p1Err } = await supabase.from('payments').insert({
    tenant_id: tenant.id,
    building_id: building.id,
    room_id: room.id,
    owner_id: ownerId,
    tenant_name: tenant.name,
    room_number: room.room_number,
    building_name: building.name,
    month_year: '2026-06',
    rent_amount: 8000,
    electricity_amount: 0,
    maintenance_amount: 500,
    advance_amount: 5000,
    total_amount: 13500,
    prev_reading: 100,
    curr_reading: 100,
    units_consumed: 0,
    payment_method: 'GPay',
    transaction_id: '123456789012',
    status: 'pending'
  }).select().single();
  if (p1Err) {
    console.error('June payment failed:', p1Err);
    return;
  }
  console.log('June payment submitted ID:', p1.id);

  // Approve June payment
  console.log('9. Approving June payment...');
  const { error: app1Err } = await supabase.from('payments').update({ status: 'approved' }).eq('id', p1.id);
  if (app1Err) {
    console.error('June approval failed:', app1Err);
    return;
  }
  console.log('June payment approved.');

  // Submit second month payment (July 2026)
  console.log('10. Submitting July payment...');
  const { data: p2, error: p2Err } = await supabase.from('payments').insert({
    tenant_id: tenant.id,
    building_id: building.id,
    room_id: room.id,
    owner_id: ownerId,
    tenant_name: tenant.name,
    room_number: room.room_number,
    building_name: building.name,
    month_year: '2026-07',
    rent_amount: 8000,
    electricity_amount: 500,
    maintenance_amount: 500,
    advance_amount: 0,
    total_amount: 9000,
    prev_reading: 100,
    curr_reading: 150,
    units_consumed: 50,
    payment_method: 'GPay',
    transaction_id: '123456789013',
    status: 'pending'
  }).select().single();
  if (p2Err) {
    console.error('July payment failed:', p2Err);
    return;
  }
  console.log('July payment submitted ID:', p2.id);

  // Approve July payment
  console.log('11. Approving July payment...');
  const { error: app2Err } = await supabase.from('payments').update({ status: 'approved' }).eq('id', p2.id);
  if (app2Err) {
    console.error('July approval failed:', app2Err);
    return;
  }
  console.log('July payment approved.');

  // Clean up test owner and auth
  console.log('Test completed successfully.');
}

run();
