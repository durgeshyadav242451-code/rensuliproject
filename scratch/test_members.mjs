import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://gofpiauazjclgeoygipl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZnBpYXVhempjbGdlb3lnaXBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2OTk4NTUsImV4cCI6MjA5NjI3NTg1NX0.w1l43JMv2QmVfu9t_BbJrYPy_7wNGRrzs22PbNfSVRk'
);

async function run() {
  try {
    const email = `test-tenant-${Date.now()}@test.com`;
    const password = 'Password123!';

    console.log('1. Signing up test tenant auth...');
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name: 'Test Tenant', phone: '9999999988', role: 'tenant' }
      }
    });
    if (signUpErr) throw signUpErr;
    const tenantAuthId = signUpData.user.id;
    console.log('Tenant Auth ID:', tenantAuthId);

    console.log('2. Signing in as tenant...');
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (signInErr) throw signInErr;
    console.log('Tenant signed in successfully.');

    // We need to insert a tenant record first, but wait!
    // Can a tenant insert their own record? Let's check tenants_self_insert policy: WITH CHECK (true).
    // Yes, a tenant can insert their own record.
    console.log('3. Inserting tenant profile...');
    const { data: tenant, error: tenErr } = await supabase.from('tenants').insert({
      auth_user_id: tenantAuthId,
      name: 'Test Tenant',
      phone: '9999999988',
      email: email,
      status: 'active'
    }).select().single();
    if (tenErr) throw tenErr;
    console.log('Tenant Profile ID:', tenant.id);

    console.log('4. Trying to insert a family member...');
    const { data: member, error: memErr } = await supabase.from('members').insert({
      tenant_id: tenant.id,
      name: 'Family Member 1',
      phone: '8888888888',
      relation: 'Brother',
      aadhaar_number: '111122223333'
    }).select();
    if (memErr) {
      console.error('Member insert failed:', memErr);
    } else {
      console.log('Member inserted successfully:', member);
    }

    console.log('5. Trying to read members...');
    const { data: members, error: getErr } = await supabase.from('members').select('*').eq('tenant_id', tenant.id);
    if (getErr) {
      console.error('Member read failed:', getErr);
    } else {
      console.log('Members read successfully:', members);
    }

    console.log('6. Trying to delete members...');
    const { error: delErr } = await supabase.from('members').delete().eq('tenant_id', tenant.id);
    if (delErr) {
      console.error('Member delete failed:', delErr);
    } else {
      console.log('Members deleted successfully.');
    }

  } catch (err) {
    console.error('Failure in flow:', err);
  }
}

run();
