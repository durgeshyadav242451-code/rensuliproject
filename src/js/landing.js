/* ═══════════════════════════════════════════════════
   PG Builders — Landing Page Logic
   ═══════════════════════════════════════════════════ */
import { isConfigured, signInOwner, signInTenantEmail, signInWithGoogle, getSession, signOut, supabase } from './supabase-config.js';
import { showToast, showConfigErrorOverlay, getReadableErrorMessage } from './utils.js';
import { initInstallPrompt, showPremiumInstallModal } from './notifications.js';

// ── Scroll To Section ──
window.scrollToSection = function(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

// ── Mobile Nav Toggle ──
window.toggleNav = function() {
  document.getElementById('nav-links')?.classList.toggle('active');
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

// ── Login Tab Switcher ──
window.switchLoginTab = function(tab) {
  document.getElementById('tab-owner').classList.toggle('active', tab === 'owner');
  document.getElementById('tab-tenant').classList.toggle('active', tab === 'tenant');
  document.getElementById('card-owner').classList.toggle('active', tab === 'owner');
  document.getElementById('card-tenant').classList.toggle('active', tab === 'tenant');
};

// ── Owner Login Handler ──
window.handleOwnerLogin = async function() {
  const email = document.getElementById('owner-email').value.trim();
  const password = document.getElementById('owner-password').value;

  if (!email || !password) {
    showToast('Missing Fields', 'Please enter email and password', 'warning');
    return;
  }

  const btn = document.getElementById('owner-login-btn');
  btn.disabled = true;
  btn.textContent = 'Logging in...';

  try {
    const { data: authData } = await signInOwner(email, password);
    const userId = authData?.user?.id;

    if (!userId) {
      throw new Error('Failed to retrieve user ID.');
    }

    const { data: ownerProfile } = await supabase
      .from('owners')
      .select('id, status, subscription_status, subscription_expiry, plan_type')
      .eq('id', userId)
      .maybeSingle();

    showToast('Login Successful', 'Redirecting...', 'success');

    setTimeout(() => {
      if (ownerProfile) {
        localStorage.setItem('pgb_user_role', 'owner');
        localStorage.removeItem('pgb_oauth_role');

        if (ownerProfile.status === 'Locked') {
          window.location.href = '/account-locked.html';
          return;
        }

        const isExpired = ownerProfile.plan_type !== 'Enterprise' && 
                          (ownerProfile.subscription_status === 'expired' || 
                           (ownerProfile.subscription_status !== 'active' && ownerProfile.subscription_status !== 'trial') || 
                           (ownerProfile.subscription_expiry && new Date(ownerProfile.subscription_expiry) < new Date()));

        if (isExpired) {
          if (!ownerProfile.subscription_expiry) {
            window.location.href = '/owner-register.html?upgrade=true';
          } else {
            window.location.href = '/subscription-expired.html';
          }
          return;
        }

        window.location.href = '/owner-dashboard.html';
      } else {
        window.location.href = '/owner-dashboard.html';
      }
    }, 800);
  } catch (err) {
    showToast('Login Failed', getReadableErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Login to Owner Portal →';
  }
};

// ── Tenant Login Handler ──
window.handleTenantLogin = async function() {
  const email = document.getElementById('tenant-email').value.trim();
  const ownerKey = document.getElementById('tenant-owner-key').value.trim();

  if (!email) {
    showToast('Missing Email', 'Please enter your email', 'warning');
    return;
  }

  try {
    await signInTenantEmail(email);
    if (ownerKey) localStorage.setItem('pgb_owner_key', ownerKey);
    showToast('Check Email', 'A login link has been sent to your email', 'success');
  } catch (err) {
    showToast('Login Failed', getReadableErrorMessage(err), 'error');
  }
};

// ── Google Login ──
window.handleGoogleLogin = async function() {
  try {
    await signInWithGoogle('tenant');
  } catch (err) {
    showToast('Google Login Failed', getReadableErrorMessage(err), 'error');
  }
};

window.handleGoogleLoginOwner = async function() {
  try {
    await signInWithGoogle('owner');
  } catch (err) {
    showToast('Google Login Failed', getReadableErrorMessage(err), 'error');
  }
};

// ── Check if already logged in ──
async function checkSession() {
  try {
    const session = await getSession();
    if (!session) return; // No session → stay on landing page

    const userId = session.user.id;

    // A. Check oauthRole first (just after callback redirect)
    const oauthRole = localStorage.getItem('pgb_oauth_role');
    if (oauthRole) {
      localStorage.removeItem('pgb_oauth_role');
      if (oauthRole === 'owner') {
        const { data: ownerProfile } = await supabase
          .from('owners')
          .select('id, status, subscription_status, subscription_expiry, plan_type')
          .eq('id', userId)
          .maybeSingle();
        if (ownerProfile) {
          localStorage.setItem('pgb_user_role', 'owner');
          
          if (ownerProfile.status === 'Locked') {
            window.location.href = '/account-locked.html';
            return;
          }
          
          const isExpired = ownerProfile.plan_type !== 'Enterprise' && 
                            (ownerProfile.subscription_status === 'expired' || 
                             (ownerProfile.subscription_status !== 'active' && ownerProfile.subscription_status !== 'trial') || 
                             (ownerProfile.subscription_expiry && new Date(ownerProfile.subscription_expiry) < new Date()));
                            
          if (isExpired) {
            if (!ownerProfile.subscription_expiry) {
              window.location.href = '/owner-register.html?upgrade=true';
            } else {
              window.location.href = '/subscription-expired.html';
            }
            return;
          }
          window.location.href = '/owner-dashboard.html';
        } else {
          window.location.href = '/owner-register.html';
        }
      } else if (oauthRole === 'affiliate') {
        localStorage.setItem('pgb_user_role', 'affiliate');
        window.location.href = '/affiliate-dashboard.html';
      } else {
        window.location.href = '/tenant-register.html';
      }
      return;
    }

    // B. Check userRole next (if navigating back to homepage while logged in)
    const userRole = localStorage.getItem('pgb_user_role');
    if (userRole) {
      if (userRole === 'owner') {
        const { data: ownerProfile } = await supabase
          .from('owners')
          .select('id, status, subscription_status, subscription_expiry, plan_type')
          .eq('id', userId)
          .maybeSingle();
        if (ownerProfile) {
          if (ownerProfile.status === 'Locked') {
            window.location.href = '/account-locked.html';
            return;
          }
          const isExpired = ownerProfile.plan_type !== 'Enterprise' && 
                            (ownerProfile.subscription_status === 'expired' || 
                             (ownerProfile.subscription_status !== 'active' && ownerProfile.subscription_status !== 'trial') || 
                             (ownerProfile.subscription_expiry && new Date(ownerProfile.subscription_expiry) < new Date()));
          if (isExpired) {
            if (!ownerProfile.subscription_expiry) {
              window.location.href = '/owner-register.html?upgrade=true';
            } else {
              window.location.href = '/subscription-expired.html';
            }
            return;
          }
          window.location.href = '/owner-dashboard.html';
        } else {
          window.location.href = '/owner-dashboard.html';
        }
        return;
      } else if (userRole === 'tenant') {
        window.location.href = '/tenant-dashboard.html';
        return;
      } else if (userRole === 'affiliate') {
        const onboarded = localStorage.getItem(`pgb_aff_onboarded_${userId}`) === 'true';
        if (onboarded) {
          window.location.href = '/affiliate-dashboard.html';
          return;
        }
      }
    }

    // C. Fallback: check tables sequentially if no role is stored
    // 1. Check owners table by auth user ID
    const { data: ownerProfile } = await supabase
      .from('owners')
      .select('id, status, subscription_status, subscription_expiry, plan_type')
      .eq('id', userId)
      .maybeSingle();

    if (ownerProfile) {
      localStorage.setItem('pgb_user_role', 'owner');
      localStorage.removeItem('pgb_oauth_role');
      
      // Perform security gating redirects
      if (ownerProfile.status === 'Locked') {
        window.location.href = '/account-locked.html';
        return;
      }
      
      const isExpired = ownerProfile.plan_type !== 'Enterprise' && 
                        (ownerProfile.subscription_status === 'expired' || 
                         (ownerProfile.subscription_status !== 'active' && ownerProfile.subscription_status !== 'trial') || 
                         (ownerProfile.subscription_expiry && new Date(ownerProfile.subscription_expiry) < new Date()));
                        
      if (isExpired) {
        if (!ownerProfile.subscription_expiry) {
          // Brand new user, never paid -> payment screen
          window.location.href = '/owner-register.html?upgrade=true';
        } else {
          // Previously paid, but now expired -> subscription expired screen
          window.location.href = '/subscription-expired.html';
        }
        return;
      }

      window.location.href = '/owner-dashboard.html';
      return;
    }

    // 2. Check tenants table by auth_user_id
    let { data: tenantProfile } = await supabase
      .from('tenants')
      .select('id, status, auth_user_id')
      .eq('auth_user_id', userId)
      .maybeSingle();

    if (!tenantProfile && session.user.email) {
      // Fallback: match by email for unlinked profiles
      const { data: emailProfiles } = await supabase
        .from('tenants')
        .select('id, status, auth_user_id')
        .eq('email', session.user.email)
        .is('auth_user_id', null)
        .order('created_at', { ascending: false });

      if (emailProfiles && emailProfiles.length > 0) {
        tenantProfile = emailProfiles[0];
        // Auto-link right here!
        await supabase
          .from('tenants')
          .update({ auth_user_id: userId })
          .eq('id', tenantProfile.id);
        tenantProfile.auth_user_id = userId;
      }
    }

    if (tenantProfile) {
      localStorage.setItem('pgb_user_role', 'tenant');
      localStorage.removeItem('pgb_oauth_role');
      window.location.href = '/tenant-dashboard.html';
      return;
    }

    // 3. Check affiliates table by auth user ID
    const { data: affiliateProfile } = await supabase
      .from('affiliates')
      .select('id, phone, is_onboarded')
      .eq('id', userId)
      .maybeSingle();

    if (affiliateProfile) {
      const hasPhone = !!(affiliateProfile.phone && affiliateProfile.phone.trim());
      const onboarded = affiliateProfile.is_onboarded === true || hasPhone;
      
      if (onboarded) {
        localStorage.setItem(`pgb_aff_onboarded_${userId}`, 'true');
        localStorage.setItem('pgb_user_role', 'affiliate');
        localStorage.removeItem('pgb_oauth_role');
        window.location.href = '/affiliate-dashboard.html';
        return;
      }
    }

    // Otherwise, this is an orphaned auth session (e.g. deleted user profile).
    // Sign them out of Supabase Auth to clear the active session, and stay on the landing page!
    await signOut();
    localStorage.removeItem('pgb_user_role');

  } catch (err) {
    console.error('Session validation error:', err);
  }
}

// ── Nav Scroll Effect ──
function initScrollEffects() {
  const nav = document.getElementById('main-nav');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
      nav.style.background = 'rgba(15, 15, 26, 0.95)';
    } else {
      nav.style.background = 'rgba(15, 15, 26, 0.8)';
    }
  });
}

// ── Premium Scroll Reveal Animation ──
function initScrollReveal() {
  const revealElements = document.querySelectorAll('.scroll-reveal');
  
  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.05,
    rootMargin: '0px 0px -40px 0px'
  });

  revealElements.forEach(el => observer.observe(el));
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  if (!isConfigured()) {
    showConfigErrorOverlay();
    return;
  }
  checkSession();
  initScrollEffects();
  initScrollReveal();
  
  // Initialize PWA install prompts & listeners
  initInstallPrompt();
});

// ── FAQ Accordion Toggle ──
window.toggleFaq = function(element) {
  const item = element.closest('.faq-item');
  const allItems = document.querySelectorAll('.faq-item');
  const answerWrapper = item.querySelector('.faq-answer-wrapper');
  
  const isActive = item.classList.contains('active');
  
  // Close all other items
  allItems.forEach(i => {
    i.classList.remove('active');
    const wrapper = i.querySelector('.faq-answer-wrapper');
    if (wrapper) wrapper.style.maxHeight = null;
  });
  
  if (!isActive) {
    item.classList.add('active');
    answerWrapper.style.maxHeight = answerWrapper.scrollHeight + "px";
  }
};
