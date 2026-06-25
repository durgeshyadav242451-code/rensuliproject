/* ═══════════════════════════════════════════════════
   PG Builders — Supabase Configuration
   ═══════════════════════════════════════════════════ */
import { createClient } from '@supabase/supabase-js';

// NOTE: REPLACE these with your actual Supabase project credentials
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,       // Store session in localStorage so it survives app restarts
    autoRefreshToken: true,     // Auto-refresh token before it expires
    detectSessionInUrl: true,   // Handle OAuth/magic link redirects
    storage: window.localStorage, // Explicit storage (helps on some mobile browsers)
  }
});


// ── Auth Helpers ──

/** Sign up owner with email + password */
export async function signUpOwner(email, password, name, phone) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, phone, role: 'owner' }
    }
  });
  if (error) throw error;
  return data;
}

/** Sign in owner with email + password */
export async function signInOwner(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

/** Verify OTP (email confirmation code) */
export async function verifyOTP(email, token) {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'signup'
  });
  if (error) throw error;
  return data;
}

/** Sign in with Google OAuth */
export async function signInWithGoogle(role = 'tenant') {
  localStorage.setItem('pgb_oauth_role', role);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + '/',
      queryParams: {
        prompt: 'select_account'
      }
    }
  });
  if (error) throw error;
  return data;
}

/** Sign in tenant with email link (magic link) */
export async function signInTenantEmail(email) {
  const { data, error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: window.location.origin + '/tenant-dashboard.html'
    }
  });
  if (error) throw error;
  return data;
}

/** Get current session */
export async function getSession() {
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) throw error;
  return session;
}

/** Get current user */
export async function getUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
}

/** Sign out */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Generate unique Owner Key in PG10AU00 style (e.g., PG + 6 alphanumeric characters) */
export async function generateOwnerKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let uniqueKey = '';
  let isUnique = false;
  let retries = 0;
  
  while (!isUnique && retries < 10) {
    retries++;
    let randomPart = '';
    for (let i = 0; i < 6; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    uniqueKey = `PG${randomPart}`;
    
    if (!isConfigured()) {
      isUnique = true;
      break;
    }
    
    try {
      const { data, error } = await supabase
        .from('owners')
        .select('owner_key')
        .eq('owner_key', uniqueKey)
        .maybeSingle();
        
      if (!error && !data) {
        isUnique = true;
      }
    } catch (e) {
      console.error('Error checking owner key uniqueness:', e);
      isUnique = true; // fallback
    }
  }
  return uniqueKey;
}

/** Create owner profile in database */
export async function createOwnerProfile(userId, name, phone, email, ownerKey) {
  const expiryDate = new Date();
  expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month from now (date to date)

  const referredByCode = localStorage.getItem('pgb_referral_code') || null;

  const { data, error } = await supabase
    .from('owners')
    .insert({
      id: userId,
      name,
      phone,
      email,
      owner_key: ownerKey,
      subscription_status: 'trial',
      subscription_expiry: expiryDate.toISOString(),
      allowed_buildings: 1,
      referred_by_code: referredByCode,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  
  // Clean up referral code from localStorage on successful registration
  localStorage.removeItem('pgb_referral_code');
  
  return data;
}

/** Get owner by user ID */
export async function getOwnerByUserId(userId) {
  const { data, error } = await supabase
    .from('owners')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Get owner by owner key */
export async function getOwnerByKey(ownerKey) {
  const { data, error } = await supabase
    .from('owners')
    .select('*')
    .eq('owner_key', ownerKey)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Check if Supabase is configured */
export function isConfigured() {
  return SUPABASE_URL && 
         SUPABASE_ANON_KEY && 
         SUPABASE_URL !== 'https://YOUR_PROJECT.supabase.co' && 
         SUPABASE_ANON_KEY !== 'YOUR_ANON_KEY' &&
         SUPABASE_URL !== '' &&
         SUPABASE_ANON_KEY !== '';
}
