import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  const timestamp = Date.now();
  const ownerEmail = `test-owner-${timestamp}@test.com`;
  const tenantEmail = `test-tenant-${timestamp}@test.com`;
  const password = 'Password123!';

  // 1. Sign up owner
  console.log('1. Signing up owner...');
  const { data: ownerSignUp, error: ownerSignUpErr } = await supabase.auth.signUp({
    email: ownerEmail,
    password,
    options: { data: { role: 'owner' } }
  });
  if (ownerSignUpErr) throw ownerSignUpErr;
  const ownerId = ownerSignUp.user.id;

  // 2. Sign up tenant
  console.log('2. Signing up tenant...');
  const { data: tenantSignUp, error: tenantSignUpErr } = await supabase.auth.signUp({
    email: tenantEmail,
    password,
    options: { data: { role: 'tenant' } }
  });
  if (tenantSignUpErr) throw tenantSignUpErr;
  const tenantAuthId = tenantSignUp.user.id;

  // Sign in as owner to create profiles
  console.log('3. Signing in as owner...');
  const { data: ownerSession, error: ownerSignInErr } = await supabase.auth.signInWithPassword({
    email: ownerEmail,
    password
  });
  if (ownerSignInErr) throw ownerSignInErr;

  // Create owner
  console.log('4. Creating owner profile...');
  const { error: oProfileErr } = await supabase.from('owners').insert({
    id: ownerId,
    name: 'Test Owner',
    phone: '9999999999',
    email: ownerEmail,
    owner_key: `OW${timestamp.toString().slice(-4)}`,
    subscription_status: 'active',
    subscription_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    allowed_buildings: 5
  });
  if (oProfileErr) throw oProfileErr;

  // Create building
  console.log('5. Creating building...');
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
  if (bldErr) throw bldErr;

  // Create floor
  console.log('6. Creating floor...');
  const { data: floor, error: floorErr } = await supabase.from('floors').insert({
    building_id: building.id,
    floor_number: '1'
  }).select().single();
  if (floorErr) throw floorErr;

  // Create room
  console.log('7. Creating room...');
  const { data: room, error: roomErr } = await supabase.from('rooms').insert({
    floor_id: floor.id,
    building_id: building.id,
    room_number: '101',
    rent: 8000,
    advance_amount: 5000,
    beds_count: 1,
    beds_occupied: 0,
    status: 'vacant'
  }).select().single();
  if (roomErr) throw roomErr;

  // Create tenant
  console.log('8. Creating tenant...');
  const { data: tenant, error: tenErr } = await supabase.from('tenants').insert({
    owner_id: ownerId,
    building_id: building.id,
    room_id: room.id,
    status: 'active',
    name: 'Test Tenant',
    phone: '8888888888',
    email: tenantEmail,
    aadhaar_number: '111122223333',
    living_type: 'alone',
    auth_user_id: tenantAuthId
  }).select().single();
  if (tenErr) throw tenErr;

  // Sign out owner
  await supabase.auth.signOut();

  // Sign in as tenant
  console.log('9. Signing in as tenant...');
  const { data: tenantSession, error: tenantSignInErr } = await supabase.auth.signInWithPassword({
    email: tenantEmail,
    password
  });
  if (tenantSignInErr) throw tenantSignInErr;

  // Insert complaint as tenant
  console.log('10. Inserting complaint as tenant...');
  const { data: complaint, error: compErr } = await supabase.from('complaints').insert({
    tenant_id: tenant.id,
    building_id: building.id,
    owner_id: ownerId,
    category: 'Electricity',
    description: 'Power cut in my room',
    status: 'open'
  }).select();

  if (compErr) {
    console.error('Complaint creation failed:', compErr);
  } else {
    console.log('Complaint created successfully:', complaint);
  }
}

run().catch(console.error);
