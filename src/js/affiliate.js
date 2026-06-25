/* ═══════════════════════════════════════════════════
   PG Builders — Affiliate Landing Page Logic
   ═══════════════════════════════════════════════════ */
import { signInWithGoogle, getSession, isConfigured, supabase } from './supabase-config.js';
import { showToast, showConfigErrorOverlay } from './utils.js';

// ── Google Authentication ──
window.handleAffiliateGoogleAuth = async function() {
  const btn = document.getElementById('btn-google-login');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Redirecting to Google...';
  }
  try {
    // Set OAuth role to 'affiliate' so redirect routing is correct
    await signInWithGoogle('affiliate');
  } catch (err) {
    console.error('Google Sign In failed:', err);
    showToast('Authentication Failed', 'Could not initiate Google Login. Please try again.', 'error');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `
        <img class="google-logo" src="https://lh3.googleusercontent.com/COxitfg29M3rYZ5VjpHgiH13dK0T7cZCO101_EP3GzU7frkvpCOAH0S9SR6zQxO6B28" alt="Google Logo" />
        Continue with Google
      `;
    }
  }
};

// ── Mobile Drawer Menu ──
window.toggleMobileMenu = function() {
  const drawer = document.getElementById('mobile-nav-drawer');
  const overlay = document.getElementById('mobile-nav-overlay');
  const isOpen = drawer.classList.contains('open');
  if (isOpen) {
    drawer.classList.remove('open');
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  } else {
    drawer.classList.add('open');
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
};

window.closeMobileMenu = function() {
  document.getElementById('mobile-nav-drawer')?.classList.remove('open');
  document.getElementById('mobile-nav-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
};

// ── Init ──
document.addEventListener('DOMContentLoaded', async () => {
  if (!isConfigured()) {
    showConfigErrorOverlay();
    return;
  }
  
  // If user is already logged in as affiliate, redirect them directly to the dashboard
  try {
    const session = await getSession();
    if (session) {
      const userRole = localStorage.getItem('pgb_user_role');
      if (userRole === 'affiliate') {
        const userId = session.user.id;
        const onboarded = localStorage.getItem(`pgb_aff_onboarded_${userId}`) === 'true';
        
        if (onboarded) {
          window.location.href = '/affiliate-dashboard.html';
          return;
        }
        
        // If not onboarded locally, check DB to be absolutely sure
        let dbOnboarded = false;
        const { data, error } = await supabase
          .from('affiliates')
          .select('phone, is_onboarded')
          .eq('id', userId)
          .maybeSingle();
          
        if (!error && data) {
          const hasPhone = !!(data.phone && data.phone.trim());
          dbOnboarded = data.is_onboarded === true || hasPhone;
        }
        
        if (dbOnboarded) {
          localStorage.setItem(`pgb_aff_onboarded_${userId}`, 'true');
          window.location.href = '/affiliate-dashboard.html';
          return;
        }

        // If logged in but not onboarded, transform the Google sign-in button
        const btn = document.getElementById('btn-google-login');
        if (btn) {
          btn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px; vertical-align:middle; display:inline-block;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>
            Go to Dashboard
          `;
          btn.onclick = () => {
            localStorage.setItem('pgb_oauth_role', 'affiliate');
            window.location.href = '/affiliate-dashboard.html';
          };
        }
      }
    }
  } catch (e) {
    console.error('Session check failed:', e);
  }
});
