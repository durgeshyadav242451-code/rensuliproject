/* ═══════════════════════════════════════════════════
   PG Builders — Affiliate Dashboard Logic v2
   ═══════════════════════════════════════════════════ */
import { supabase, getSession, signOut } from './supabase-config.js';
import { showToast, attachNameInput, attachPhoneInput, validateName, validatePhone } from './utils.js';

let activeSession = null;
let affiliateProfile = null;
let referredLandlords = [];
let affiliateSettings = {
  commission_percentage: 20,
  withdrawal_start_day: 1,
  withdrawal_end_day: 5,
  withdrawal_window_status: 'auto'
};

// Helper to format Indian Currency without decimals
function fmtINR(val) {
  if (val === undefined || val === null || isNaN(Number(val))) return '0';
  return Math.round(Number(val)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}


// ═══════════════════════════════════════════
// AUTH GATE
// ═══════════════════════════════════════════
async function checkAuth() {
  try {
    activeSession = await getSession();
    if (!activeSession) {
      window.location.href = '/affiliate.html';
      return;
    }
    await initAffiliateProfile();
  } catch (err) {
    console.error('Session error:', err);
    // DO NOT redirect here — it causes an infinite loop with affiliate.html
    showToast('Error', 'Session check failed. Please refresh the page.', 'error');
  }
}

// ═══════════════════════════════════════════
// INIT / FETCH AFFILIATE PROFILE
// ═══════════════════════════════════════════
async function initAffiliateProfile() {
  const userId = activeSession.user.id;
  const googleName = activeSession.user.user_metadata?.full_name ||
                     activeSession.user.user_metadata?.name ||
                     activeSession.user.email?.split('@')[0] || 'Partner';

  try {
    let { data, error } = await supabase
      .from('affiliates')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;

    // New user — register (do NOT include is_onboarded, column may not exist yet)
    let freshlyCreated = false;
    if (!data) {
      freshlyCreated = true;
      const referralCode = generateReferralCode();
      const { data: newProfile, error: insertError } = await supabase
        .from('affiliates')
        .insert({
          id: userId,
          name: googleName,
          email: activeSession.user.email,
          referral_code: referralCode
          // is_onboarded intentionally omitted — may not exist in DB yet
        })
        .select()
        .single();

      if (insertError) throw insertError;
      data = newProfile;
    }

    affiliateProfile = data;
    localStorage.setItem('pgb_user_role', 'affiliate');

    // Update topbar UI
    updateTopbar(affiliateProfile.name);

    // Auto-migrate old referral codes starting with 'AFF-'
    if (affiliateProfile.referral_code && affiliateProfile.referral_code.startsWith('AFF-')) {
      const oldCode = affiliateProfile.referral_code;
      const newCode = oldCode.replace('AFF-', 'RS');
      
      const { error: updateCodeErr } = await supabase
        .from('affiliates')
        .update({ referral_code: newCode })
        .eq('id', userId);
      
      if (!updateCodeErr) {
        // Also update any owners referred by oldCode
        await supabase
          .from('owners')
          .update({ referred_by_code: newCode })
          .eq('referred_by_code', oldCode);
        
        affiliateProfile.referral_code = newCode;
      }
    }

    // Onboarding check:
    // - If record was freshly created (e.g., admin deleted the old one), ALWAYS show onboarding.
    //   Clear any stale localStorage flag so it doesn't bypass the screen.
    // - Otherwise use `is_onboarded` DB column, phone presence, or localStorage as fallback.
    if (freshlyCreated) {
      // Clear stale localStorage flag from a previously deleted account
      localStorage.removeItem(`pgb_aff_onboarded_${userId}`);
      showOnboarding();
    } else {
      const locallyOnboarded = localStorage.getItem(`pgb_aff_onboarded_${userId}`) === 'true';
      const dbOnboarded = affiliateProfile.is_onboarded === true;
      const hasPhone = !!(affiliateProfile.phone && affiliateProfile.phone.trim());
      const isOnboarded = dbOnboarded || hasPhone || locallyOnboarded;

      if (!isOnboarded) {
        showOnboarding();
      } else {
        // Load dashboard data
        await loadAffiliateData();
      }
    }

  } catch (err) {
    console.error('Profile error:', err);
    // Show error but DO NOT redirect to avoid loop
    showToast('Error', 'Failed to load profile. Please refresh the page.', 'error');
  }
}

// ── Update topbar with user info ──
function updateTopbar(name) {
  const initials = getInitials(name);
  setEl('topbar-user-name', name);
  setEl('user-avatar-initials', initials);
  setEl('profile-avatar-initials', initials);
  setEl('welcome-message', `Welcome back, ${name.split(' ')[0]}!`);
}

// ═══════════════════════════════════════════
// ONBOARDING MODAL
// ═══════════════════════════════════════════
function showOnboarding() {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;

  // Pre-fill known data
  setInputVal('ob-name', affiliateProfile.name || '');
  setInputVal('ob-email', affiliateProfile.email || activeSession.user.email || '');
  setInputVal('ob-phone', affiliateProfile.phone || '');

  overlay.classList.remove('hidden');
}

window.saveOnboarding = async function() {
  const name     = document.getElementById('ob-name')?.value.trim();
  const phone    = document.getElementById('ob-phone')?.value.trim();
  const location = document.getElementById('ob-location')?.value.trim();
  const profession = document.getElementById('ob-profession')?.value;
  const agreed   = document.getElementById('ob-policy-check')?.checked;

  const nameErr = validateName(name);
  if (nameErr) return showToast('Invalid Name', nameErr, 'warning');

  const phoneErr = validatePhone(phone);
  if (phoneErr) return showToast('Invalid Phone', phoneErr, 'warning');

  if (!location)   return showToast('Required', 'Please enter your city/location.', 'warning');
  if (!profession) return showToast('Required', 'Please select your profession.', 'warning');
  if (!agreed)     return showToast('Required', 'Please accept the Terms & Privacy Policy.', 'warning');

  const btn = document.getElementById('btn-onboard');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    let updateError = null;

    // Try 1: with all columns (v23 migration run)
    const { error: errWithFlag } = await supabase
      .from('affiliates')
      .update({ name, phone, location, profession, is_onboarded: true })
      .eq('id', affiliateProfile.id);

    if (!errWithFlag) {
      affiliateProfile.is_onboarded = true;
      affiliateProfile.location = location;
      affiliateProfile.profession = profession;
    } else {
      updateError = errWithFlag;
      console.warn('is_onboarded column may not exist, retrying without it:', errWithFlag.message);
      
      // Try 2: without is_onboarded (in case only that column is missing)
      const { error: errWithout } = await supabase
        .from('affiliates')
        .update({ name, phone, location, profession })
        .eq('id', affiliateProfile.id);
        
      if (!errWithout) {
        affiliateProfile.location = location;
        affiliateProfile.profession = profession;
        updateError = null;
      } else {
        updateError = errWithout;
        console.warn('location/profession columns may not exist, retrying with only name/phone:', errWithout.message);
        
        // Try 3: only name and phone
        const { error: errNamePhone } = await supabase
          .from('affiliates')
          .update({ name, phone })
          .eq('id', affiliateProfile.id);
          
        if (!errNamePhone) {
          updateError = null;
        } else {
          throw errNamePhone;
        }
      }
    }

    // Mark onboarded locally as fallback regardless of DB column
    localStorage.setItem(`pgb_aff_onboarded_${affiliateProfile.id}`, 'true');

    // Update local profile
    affiliateProfile = { ...affiliateProfile, name, phone };

    // Hide modal
    document.getElementById('onboarding-overlay').classList.add('hidden');

    // Update topbar name
    updateTopbar(name);

    // Load dashboard
    await loadAffiliateData();

    showToast('Welcome!', 'Your affiliate account is now active. Start sharing your link!', 'success');
  } catch (err) {
    console.error('Onboarding save error:', err);
    showToast('Error', 'Failed to save profile. Please try again.', 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Activate Affiliate Account`;
  }
};

// ═══════════════════════════════════════════
// LOAD AFFILIATE DATA
// ═══════════════════════════════════════════
async function loadAffiliateData() {
  try {
    // Set referral link & code
    const referralUrl = `${window.location.origin}/owner-register.html?ref=${affiliateProfile.referral_code}`;
    setInputVal('referral-link-input', referralUrl);
    setEl('ref-code-display', affiliateProfile.referral_code || '—');

    // Set UPI
    if (affiliateProfile.upi_id) {
      setInputVal('upi-id-input', affiliateProfile.upi_id);
      setInputVal('edit-upi', affiliateProfile.upi_id);
    }

    // Populate profile section
    populateProfile();

    // Fetch referred landlords
    const { data: landlords, error } = await supabase
      .from('owners')
      .select('id, name, email, subscription_status, subscription_expiry, allowed_buildings, created_at')
      .eq('referred_by_code', affiliateProfile.referral_code);

    if (error) throw error;
    referredLandlords = landlords || [];
    // Sort referred landlords by join date descending (latest first)
    referredLandlords.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    // Calculate stats
    const totalReferred = referredLandlords.length;
    let activeCount = 0;
    let inactiveCount = 0;
    let totalBuildings = 0;
    const referredIds = [];

    referredLandlords.forEach(l => {
      referredIds.push(l.id);
      totalBuildings += (l.allowed_buildings || 0);

      const isExpired = l.subscription_status === 'expired' ||
        (l.subscription_status !== 'active' && l.subscription_status !== 'trial') ||
        (l.subscription_expiry && new Date(l.subscription_expiry) < new Date());

      if (isExpired) inactiveCount++;
      else activeCount++;
    });

    // Update KPIs
    setEl('kpi-total-referred', totalReferred);
    setEl('kpi-total-buildings', totalBuildings);
    setEl('kpi-inactive', inactiveCount);
    setEl('referrals-count', `${totalReferred} landlord${totalReferred !== 1 ? 's' : ''} referred`);

    // Render landlords table
    renderLandlordsTable();

    // Fetch payouts
    const { data: payouts, error: payoutErr } = await supabase
      .from('affiliate_payouts')
      .select('amount')
      .eq('affiliate_id', affiliateProfile.id);

    let totalPaid = 0;
    if (!payoutErr && payouts) {
      payouts.forEach(p => { totalPaid += Number(p.amount); });
    }

    // Determine affiliate commission rate
    let defaultCommissionPercentage = 20;
    try {
      const { data: platformSettings, error: settingsError } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'affiliate')
        .maybeSingle();
      if (!settingsError && platformSettings && platformSettings.value) {
        affiliateSettings = {
          commission_percentage: Number(platformSettings.value.commission_percentage) || 20,
          withdrawal_start_day: platformSettings.value.withdrawal_start_day !== undefined ? Number(platformSettings.value.withdrawal_start_day) : 1,
          withdrawal_end_day: platformSettings.value.withdrawal_end_day !== undefined ? Number(platformSettings.value.withdrawal_end_day) : 5,
          withdrawal_window_status: platformSettings.value.withdrawal_window_status || 'auto'
        };
        defaultCommissionPercentage = affiliateSettings.commission_percentage;
      }
    } catch (err) {
      console.warn('Failed to load default commission settings from platform_settings:', err);
    }

    const commissionPercentage = affiliateProfile.commission_percentage !== null && affiliateProfile.commission_percentage !== undefined
      ? Number(affiliateProfile.commission_percentage)
      : defaultCommissionPercentage;

    const commissionRate = commissionPercentage / 100;

    // Update UI elements showing commission rate
    setEl('kpi-comm-rate-display', commissionPercentage);
    setEl('panel-comm-rate-display', commissionPercentage);
    setEl('wallet-comm-rate-display', commissionPercentage);
    setEl('table-comm-rate-display', commissionPercentage);
    setEl('onboard-comm-rate-display', commissionPercentage);

    // Update withdrawal window button and message states
    updateWithdrawalButtonState();

    // Fetch commissions
    if (referredIds.length === 0) {
      setEl('kpi-total-earnings', '₹0');
      const currentEarnings = Math.max(0, 0 - totalPaid);
      setEl('wallet-total-earnings', `₹${fmtINR(currentEarnings)}`);
      renderEmptyEarningsTable();
      // Still load withdrawal history even if no referrals
      await loadWithdrawalHistory();
      return;
    }

    const { data: payments, error: payErr } = await supabase
      .from('payments')
      .select('total_amount, payment_date, payment_method, transaction_id, owner_id, created_at, commission_rate')
      .in('owner_id', referredIds)
      .eq('month_year', 'SaaS Renewal')
      .eq('status', 'approved');

    if (payErr) throw payErr;

    let totalEarnings = 0;
    (payments || []).forEach(p => {
      const baseAmount = Number(p.total_amount) / 1.18;
      const rate = p.commission_rate !== null && p.commission_rate !== undefined
        ? Number(p.commission_rate) / 100
        : commissionRate;
      totalEarnings += Math.round(baseAmount * rate);
    });

    const currentEarnings = Math.max(0, totalEarnings - totalPaid);
    const earningsStr       = `₹${fmtINR(totalEarnings)}`;
    const currentEarningsStr = `₹${fmtINR(currentEarnings)}`;

    // Store available balance for withdrawal modal
    _currentAvailableBalance = currentEarnings;

    setEl('kpi-total-earnings', earningsStr);
    setEl('wallet-total-earnings', currentEarningsStr);
    // Also update the withdrawal modal balance display if open
    const wrBalEl = document.getElementById('wr-available-balance');
    if (wrBalEl) wrBalEl.textContent = currentEarningsStr;

    renderEarningsTable(payments || [], commissionRate);

    // Load withdrawal history
    await loadWithdrawalHistory();

  } catch (err) {
    console.error('Data load error:', err);
    showToast('Error', 'Failed to load referral data.', 'error');
  }
}

// ═══════════════════════════════════════════
// WITHDRAWAL WINDOW CHECKERS
// ═══════════════════════════════════════════
function checkWithdrawalWindowState() {
  const currentDay = new Date().getDate();
  const startDay = affiliateSettings.withdrawal_start_day;
  const endDay = affiliateSettings.withdrawal_end_day;
  const status = affiliateSettings.withdrawal_window_status;

  let isOpen = false;
  let statusText = '';

  if (status === 'force_open') {
    isOpen = true;
    statusText = 'Withdrawal window is currently open (Manual Override).';
  } else if (status === 'force_closed') {
    isOpen = false;
    statusText = 'Withdrawals are temporarily closed by the administrator.';
  } else {
    // Auto: check date range
    if (currentDay >= startDay && currentDay <= endDay) {
      isOpen = true;
      statusText = `Withdrawal window is open from Day ${startDay} to Day ${endDay} of this month.`;
    } else {
      isOpen = false;
      statusText = `Withdrawals are only allowed from Day ${startDay} to Day ${endDay} of the month.`;
    }
  }

  return { isOpen, statusText };
}

function updateWithdrawalButtonState() {
  const btn = document.getElementById('btn-open-wr');
  const msgEl = document.getElementById('withdrawal-window-msg');
  const { isOpen, statusText } = checkWithdrawalWindowState();

  if (btn) {
    btn.disabled = !isOpen;
    if (!isOpen) {
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.title = 'Withdrawal window is currently closed.';
    } else {
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.title = '';
    }
  }

  if (msgEl) {
    if (isOpen) {
      msgEl.innerHTML = `
        <svg style="color: var(--success-light); flex-shrink: 0;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <span style="color: var(--success-light);">${statusText}</span>
      `;
    } else {
      msgEl.innerHTML = `
        <svg style="color: var(--warning-light); flex-shrink: 0;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style="color: var(--warning-light);">${statusText}</span>
      `;
    }
  }
}

// ═══════════════════════════════════════════
// RENDER TABLES
// ═══════════════════════════════════════════
function renderLandlordsTable() {
  const tbody = document.getElementById('landlords-table-body');
  if (!tbody) return;

  if (referredLandlords.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="empty-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>No landlords referred yet.<br/>Share your referral link to get started.</p>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = referredLandlords.map(l => {
    const isExpired = l.subscription_status === 'expired' ||
      (l.subscription_status !== 'active' && l.subscription_status !== 'trial') ||
      (l.subscription_expiry && new Date(l.subscription_expiry) < new Date());

    let badgeClass = 'badge-active', badgeText = 'Active';
    if (isExpired) { badgeClass = 'badge-expired'; badgeText = 'Expired'; }
    else if (l.subscription_status === 'trial') { badgeClass = 'badge-trial'; badgeText = 'Free Trial'; }

    const expiry = l.subscription_expiry ? new Date(l.subscription_expiry).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';
    const joined = l.created_at ? new Date(l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

    return `<tr>
      <td style="font-weight:600;color:#fff;">${esc(l.name)}</td>
      <td>${esc(l.email)}</td>
      <td style="font-weight:600;">${l.allowed_buildings || 0}</td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
      <td>${expiry}</td>
      <td>${joined}</td>
    </tr>`;
  }).join('');
}

function renderEarningsTable(payments, commissionRate) {
  const tbody = document.getElementById('earnings-table-body');
  if (!tbody) return;

  if (!payments.length) { renderEmptyEarningsTable(); return; }

  // Sort payments descending (latest first) stably using created_at
  payments.sort((a, b) => {
    const dateA = new Date(a.created_at || a.payment_date || 0);
    const dateB = new Date(b.created_at || b.payment_date || 0);
    return dateB - dateA;
  });

  tbody.innerHTML = payments.map(pay => {
    const baseAmount = Number(pay.total_amount) / 1.18;
    const rate = pay.commission_rate !== null && pay.commission_rate !== undefined
      ? Number(pay.commission_rate) / 100
      : commissionRate;

    const commission = Math.round(baseAmount * rate);
    const landlord = referredLandlords.find(l => l.id === pay.owner_id);
    const lName = landlord ? landlord.name : 'Unknown Owner';
    const date = pay.payment_date ? new Date(pay.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A';

    return `<tr>
      <td>${date}</td>
      <td style="font-weight:600;color:#fff;">${esc(lName)}</td>
      <td>₹${fmtINR(Math.round(baseAmount))}</td>
      <td style="font-weight:700;color:var(--warning-light);">₹${fmtINR(commission)}</td>
      <td>${esc(pay.payment_method || 'UPI')}</td>
      <td style="font-family:monospace;font-size:11px;color:var(--text-secondary);">${esc(pay.transaction_id || '—')}</td>
    </tr>`;
  }).join('');
}

function renderEmptyEarningsTable() {
  const tbody = document.getElementById('earnings-table-body');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr><td colspan="6" class="empty-state">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <p>No commission logs yet.<br/>Earnings appear once referred landlords subscribe.</p>
    </td></tr>`;
}

// ═══════════════════════════════════════════
// POPULATE PROFILE SECTION
// ═══════════════════════════════════════════
function populateProfile() {
  if (!affiliateProfile) return;
  setEl('profile-display-name', affiliateProfile.name || '—');
  setEl('profile-email', affiliateProfile.email || '—');
  setEl('profile-phone', affiliateProfile.phone || '—');
  setEl('profile-location', affiliateProfile.location || '—');
  setEl('profile-profession', affiliateProfile.profession || '—');
  setEl('profile-code', affiliateProfile.referral_code || '—');
  if (affiliateProfile.created_at) {
    setEl('profile-since', new Date(affiliateProfile.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }));
  }

  // Pre-fill edit form
  setInputVal('edit-name', affiliateProfile.name || '');
  setInputVal('edit-phone', affiliateProfile.phone || '');
  setInputVal('edit-location', affiliateProfile.location || '');
}

// ═══════════════════════════════════════════
// SECTION SWITCHING
// ═══════════════════════════════════════════
window.switchSection = function(sectionId, btn) {
  // Hide all sections
  document.querySelectorAll('.dash-section').forEach(s => s.classList.remove('active'));
  // Show target
  const target = document.getElementById(`section-${sectionId}`);
  if (target) target.classList.add('active');

  // Update sidebar active
  document.querySelectorAll('.sidebar-nav-item').forEach(el => el.classList.remove('active'));
  if (btn) btn.classList.add('active');

  // Update topbar title
  const titles = {
    dashboard: 'Dashboard',
    referrals: 'My Referrals',
    wallet: 'Wallet & Payouts',
    analytics: 'Analytics',
    profile: 'My Profile'
  };
  setEl('topbar-title', titles[sectionId] || 'Dashboard');

  // Close mobile sidebar
  closeSidebar();
};

// ═══════════════════════════════════════════
// SIDEBAR MOBILE
// ═══════════════════════════════════════════
window.openSidebar = function() {
  document.getElementById('sidebar')?.classList.add('open');
  document.getElementById('sidebar-overlay')?.classList.add('open');
  document.body.style.overflow = 'hidden';
};

window.closeSidebar = function() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
  document.body.style.overflow = '';
};

// ═══════════════════════════════════════════
// COPY & SHARE
// ═══════════════════════════════════════════
window.copyCode = function() {
  const code = affiliateProfile?.referral_code;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    showToast('Copied!', `Code ${code} copied to clipboard.`, 'success');
  });
};

window.copyReferralLink = function() {
  const input = document.getElementById('referral-link-input');
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    showToast('Copied!', 'Referral link copied to clipboard.', 'success');
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast('Copied!', 'Referral link copied.', 'success');
  });
};

window.shareReferralLink = function() {
  const url = document.getElementById('referral-link-input')?.value;
  if (!url) return;
  const text = `Join PG Builders — India's best room & apartment management software!\nUse my referral link to get started:\n${url}`;

  if (navigator.share) {
    navigator.share({ title: 'PG Builders Referral', text, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied!', 'Share text copied to clipboard.', 'success');
    });
  }
};

// ═══════════════════════════════════════════
// WITHDRAWAL REQUESTS
// ═══════════════════════════════════════════
let _currentAvailableBalance = 0;

window.openWithdrawalModal = function() {
  if (!affiliateProfile) return;

  // Auto-fill from profile
  const nameEl  = document.getElementById('wr-name');
  const phoneEl = document.getElementById('wr-phone');
  const upiEl   = document.getElementById('wr-upi');
  const amtEl   = document.getElementById('wr-amount');
  const bldEl   = document.getElementById('wr-buildings');

  if (nameEl)  nameEl.value  = affiliateProfile.name  || '';
  if (phoneEl) phoneEl.value = affiliateProfile.phone || '';
  if (upiEl)   upiEl.value   = affiliateProfile.upi_id || document.getElementById('upi-id-input')?.value || '';
  if (amtEl) {
    amtEl.value = _currentAvailableBalance > 0 ? Math.floor(_currentAvailableBalance) : '0';
    amtEl.readOnly = true;
    amtEl.style.opacity = '0.7';
    amtEl.style.cursor = 'not-allowed';
    amtEl.style.background = 'rgba(255, 255, 255, 0.02)';
  }
  if (bldEl)   bldEl.value   = '';

  // Show balance in modal
  const balEl = document.getElementById('wr-available-balance');
  if (balEl) balEl.textContent = `₹${fmtINR(_currentAvailableBalance)}`;

  document.getElementById('wr-modal-overlay')?.classList.add('open');
};

window.closeWithdrawalModal = function(e) {
  if (e && e.target !== document.getElementById('wr-modal-overlay')) return;
  document.getElementById('wr-modal-overlay')?.classList.remove('open');
};

window.submitWithdrawalRequest = async function(event) {
  if (event) event.preventDefault();

  const name      = document.getElementById('wr-name')?.value.trim();
  const phone     = document.getElementById('wr-phone')?.value.trim();
  const upiId     = document.getElementById('wr-upi')?.value.trim();
  const amount    = parseFloat(document.getElementById('wr-amount')?.value);
  const buildings = document.getElementById('wr-buildings')?.value.trim() || null;

  // Validate
  if (!name)                             return showToast('Required', 'Please enter your full name.', 'warning');
  if (!phone || phone.length < 10)       return showToast('Required', 'Please enter a valid 10-digit phone number.', 'warning');
  if (!upiId || !upiId.includes('@'))    return showToast('Invalid UPI', 'Please enter a valid UPI ID (e.g. name@bank).', 'warning');
  if (!amount || amount <= 0)            return showToast('Required', 'Please enter a valid withdrawal amount.', 'warning');
  const expectedAmount = _currentAvailableBalance > 0 ? Math.floor(_currentAvailableBalance) : 0;
  if (amount !== expectedAmount) {
    return showToast('Invalid Amount', `You must withdraw your exact available balance of ₹${expectedAmount}.`, 'warning');
  }

  const btn = document.getElementById('btn-submit-wr');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }

  try {
    const { error } = await supabase.from('withdrawal_requests').insert({
      affiliate_id:    affiliateProfile.id,
      affiliate_name:  name,
      phone:           phone,
      upi_id:          upiId,
      amount:          amount,
      buildings_info:  buildings,
      status:          'pending'
    });

    if (error) throw error;

    // Update UPI in profile silently
    if (upiId !== affiliateProfile.upi_id) {
      await supabase.from('affiliates').update({ upi_id: upiId }).eq('id', affiliateProfile.id);
      affiliateProfile.upi_id = upiId;
      const upiInput = document.getElementById('upi-id-input');
      if (upiInput) upiInput.value = upiId;
    }

    showToast('Request Sent!', `Your withdrawal request of ₹${Math.round(amount)} has been submitted. Admin will verify and process it.`, 'success');
    document.getElementById('wr-modal-overlay')?.classList.remove('open');

    // Reload withdrawal history
    await loadWithdrawalHistory();
  } catch (err) {
    console.error('Withdrawal request error:', err);
    showToast('Failed', err.message || 'Could not submit request. Please try again.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg style="display:inline-block;vertical-align:middle;margin-right:6px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="12 2 12 14"/><polyline points="7 9 12 14 17 9"/><rect x="3" y="16" width="18" height="5" rx="1"/></svg>Submit Withdrawal Request`;
    }
  }
};

async function loadWithdrawalHistory() {
  const tbody = document.getElementById('wr-history-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading...</td></tr>`;

  try {
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .eq('affiliate_id', affiliateProfile.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    renderWithdrawalHistory(data || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Unable to load withdrawal requests. (Run migration v28 in Supabase SQL Editor)</td></tr>`;
    console.warn('Withdrawal history load error:', err);
  }
}

function renderWithdrawalHistory(requests) {
  const tbody = document.getElementById('wr-history-body');
  if (!tbody) return;

  if (!requests.length) {
    tbody.innerHTML = `
      <tr><td colspan="6" class="empty-state">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="12 2 12 14"/><polyline points="7 9 12 14 17 9"/><rect x="3" y="16" width="18" height="5" rx="1"/></svg>
        <p>No withdrawal requests yet.<br/>Click "Request Withdrawal" to submit a payout request.</p>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = requests.map(req => {
    const date = req.created_at
      ? new Date(req.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : 'N/A';
    const status = req.status || 'pending';
    const badgeClass = status === 'verified' ? 'wr-badge-verified'
                     : status === 'rejected' ? 'wr-badge-rejected'
                     : 'wr-badge-pending';
    const statusLabel = status === 'verified' ? '✓ Verified'
                      : status === 'rejected' ? '✗ Rejected'
                      : '⏳ Pending';

    return `<tr>
      <td>${date}</td>
      <td style="font-weight:700;color:var(--warning-light);">&#8377;${fmtINR(req.amount)}</td>
      <td style="font-family:monospace;font-size:12px;">${esc(req.upi_id)}</td>
      <td style="color:var(--text-secondary);font-size:12px;">${esc(req.buildings_info || '—')}</td>
      <td><span class="wr-badge ${badgeClass}">${statusLabel}</span></td>
      <td style="color:var(--text-muted);font-size:12px;font-style:italic;">${esc(req.note || '—')}</td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════
// SAVE UPI
// ═══════════════════════════════════════════
window.saveUpiId = async function() {
  const upiId = document.getElementById('upi-id-input')?.value.trim();
  if (!upiId || !upiId.includes('@')) {
    return showToast('Invalid UPI', 'Please enter a valid UPI ID (e.g. name@bank).', 'warning');
  }

  const btn = document.getElementById('btn-save-upi');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    const { error } = await supabase.from('affiliates').update({ upi_id: upiId }).eq('id', affiliateProfile.id);
    if (error) throw error;
    affiliateProfile.upi_id = upiId;
    showToast('Saved!', 'UPI details updated.', 'success');
  } catch (err) {
    showToast('Error', 'Failed to save UPI details.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save UPI Details';
  }
};

// ═══════════════════════════════════════════
// SAVE PROFILE
// ═══════════════════════════════════════════
window.saveProfile = async function() {
  const name     = document.getElementById('edit-name')?.value.trim();
  const phone    = document.getElementById('edit-phone')?.value.trim();
  const location = document.getElementById('edit-location')?.value.trim();
  const upi      = document.getElementById('edit-upi')?.value.trim();

  const nameErr = validateName(name);
  if (nameErr) return showToast('Invalid Name', nameErr, 'warning');

  if (phone) {
    const phoneErr = validatePhone(phone);
    if (phoneErr) return showToast('Invalid Phone', phoneErr, 'warning');
  }

  const btn = document.getElementById('btn-save-profile');
  btn.disabled = true; btn.textContent = 'Saving...';

  try {
    const updates = { name, phone: phone || null };
    if (upi) updates.upi_id = upi;

    // Try to update with location (v23 schema)
    let { error } = await supabase
      .from('affiliates')
      .update({ ...updates, location: location || null })
      .eq('id', affiliateProfile.id);

    if (error) {
      console.warn('Failed to update profile with location, retrying without it:', error.message);
      // Fallback to updating without location
      const { error: fallbackErr } = await supabase
        .from('affiliates')
        .update(updates)
        .eq('id', affiliateProfile.id);
      if (fallbackErr) throw fallbackErr;
    } else {
      updates.location = location || null;
    }

    affiliateProfile = { ...affiliateProfile, ...updates };
    updateTopbar(name);
    populateProfile();
    showToast('Saved!', 'Profile updated successfully.', 'success');
  } catch (err) {
    console.error('Profile save error:', err);
    showToast('Error', 'Failed to update profile.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
};

// ═══════════════════════════════════════════
// SIGN OUT
// ═══════════════════════════════════════════
window.cancelOnboarding = async function() {
  try {
    await signOut();
    localStorage.removeItem('pgb_user_role');
    localStorage.removeItem('pgb_oauth_role');
    window.location.href = '/affiliate.html';
  } catch {
    window.location.href = '/affiliate.html';
  }
};

window.handleSignOut = async function() {
  if (!confirm('Are you sure you want to log out?')) return;
  try {
    await signOut();
    localStorage.removeItem('pgb_user_role');
    localStorage.removeItem('pgb_oauth_role');
    window.location.href = '/affiliate.html';
  } catch {
    window.location.href = '/affiliate.html';
  }
};

// ═══════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = 'RS';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getInitials(name = '') {
  return name.trim().split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setInputVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => { 
  checkAuth(); 
  
  // Attach live input character filtering
  attachNameInput(document.getElementById('ob-name'));
  attachPhoneInput(document.getElementById('ob-phone'));
  attachNameInput(document.getElementById('edit-name'));
  attachPhoneInput(document.getElementById('edit-phone'));
});
