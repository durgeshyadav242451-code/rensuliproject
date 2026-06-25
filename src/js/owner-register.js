/* ═══════════════════════════════════════════════════
   PG Builders — Owner Registration Logic
   ═══════════════════════════════════════════════════ */
import { isConfigured, signUpOwner, verifyOTP, createOwnerProfile, generateOwnerKey, supabase, getSession, getOwnerByUserId, signInWithGoogle } from './supabase-config.js';
import { showToast, showConfigErrorOverlay, getReadableErrorMessage, validateName, validatePhone, attachNameInput, attachPhoneInput } from './utils.js';
import html2canvas from 'html2canvas';
import { ICONS } from './icons.js';

let regData = {};

// ── Step 1: Handle Registration ──
window.handleRegister = async function () {
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm = document.getElementById('reg-confirm').value;

  if (!name || !phone || !email || !password) {
    showToast('Missing Fields', 'Please fill all fields', 'warning');
    return;
  }

  if (password.length < 6) {
    showToast('Weak Password', 'Password must be at least 6 characters', 'warning');
    return;
  }

  if (password !== confirm) {
    showToast('Password Mismatch', 'Passwords do not match', 'error');
    return;
  }

  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  btn.textContent = 'Sending OTP...';

  regData = { name, phone, email, password };

  try {
    // Real Supabase signup
    const data = await signUpOwner(email, password, name, phone);

    // Support auto-confirm setup (where session is returned immediately)
    if (data.session) {
      const ownerKey = await generateOwnerKey();
      regData.ownerKey = ownerKey;

      // Save owner profile in Supabase
      await createOwnerProfile(data.user.id, name, phone, email, ownerKey);

      localStorage.setItem('pgb_user_role', 'owner');
      localStorage.setItem('pgb_owner_key', ownerKey);
      localStorage.setItem('pgb_owner_name', name);

      // Show success screen directly (skip OTP)
      window.showRegistrationSuccess(ownerKey, name);
      showToast('Registration Complete!', 'Your account has been created and auto-confirmed.', 'success');
    } else {
      // Standard flow: Needs email OTP confirmation
      document.getElementById('otp-email-display').textContent = email;
      document.getElementById('step-register').classList.add('hidden');
      document.getElementById('step-otp').classList.remove('hidden');
      showToast('OTP Sent!', 'Check your email for the verification code', 'success');
    }

  } catch (err) {
    showToast('Registration Failed', getReadableErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send OTP to Email →';
  }
};

// ── Step 2: Verify OTP ──
window.handleVerifyOTP = async function () {
  const otpInputs = document.querySelectorAll('.otp-input');
  let otp = '';
  otpInputs.forEach(input => otp += input.value);

  if (otp.length < 6) {
    showToast('Incomplete OTP', 'Please enter all 6 digits', 'warning');
    return;
  }

  const btn = document.getElementById('btn-verify');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const data = await verifyOTP(regData.email, otp);

    // Generate owner key
    const ownerKey = await generateOwnerKey();
    regData.ownerKey = ownerKey;

    // Save owner profile
    await createOwnerProfile(data.user.id, regData.name, regData.phone, regData.email, ownerKey);

    localStorage.setItem('pgb_user_role', 'owner');
    localStorage.setItem('pgb_owner_key', ownerKey);
    localStorage.setItem('pgb_owner_name', regData.name);

    // Show success
    window.showRegistrationSuccess(ownerKey, regData.name);
    showToast('Verified!', 'Your Owner Key has been generated', 'success');

  } catch (err) {
    showToast('Verification Failed', getReadableErrorMessage(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify OTP';
  }
};

// ── Resend OTP ──
window.handleResendOTP = async function () {
  try {
    await signUpOwner(regData.email, regData.password, regData.name, regData.phone);
    showToast('OTP Resent', 'Check your email again', 'success');
  } catch (err) {
    showToast('Resend Failed', getReadableErrorMessage(err), 'error');
  }
};

// ── Copy Owner Key ──
window.copyOwnerKey = function () {
  const key = document.getElementById('generated-key').textContent;
  navigator.clipboard.writeText(key).then(() => {
    showToast('Copied!', 'Owner key copied to clipboard', 'success');
  }).catch(() => {
    // Fallback
    const input = document.createElement('input');
    input.value = key;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Copied!', 'Owner key copied to clipboard', 'success');
  });
};

// ── OTP Input Auto-Focus ──
document.addEventListener('DOMContentLoaded', () => {
  if (!isConfigured()) {
    showConfigErrorOverlay();
    return;
  }

  const otpInputs = document.querySelectorAll('.otp-input');
  otpInputs.forEach((input, i) => {
    input.addEventListener('input', (e) => {
      if (e.target.value.length === 1 && i < otpInputs.length - 1) {
        otpInputs[i + 1].focus();
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && i > 0) {
        otpInputs[i - 1].focus();
      }
    });
  });

  const utrInput = document.getElementById('pay-txn-id');
  if (utrInput) {
    utrInput.addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '').slice(0, 12);
    });
  }

  // Live input filters: name=only letters, phone=only 10 digits
  attachNameInput(document.getElementById('reg-name'));
  attachPhoneInput(document.getElementById('reg-phone'));

  checkGoogleSession();
});

// ── Google Register ──
window.handleGoogleRegisterOwner = async function () {
  try {
    await signInWithGoogle('owner');
  } catch (err) {
    showToast('Google Login Failed', getReadableErrorMessage(err), 'error');
  }
};

async function checkGoogleSession() {
  try {
    const session = await getSession();
    if (session) {
      // Check if owner profile already exists in DB
      const profile = await getOwnerByUserId(session.user.id);
      if (profile) {
        localStorage.setItem('pgb_user_role', 'owner');
        localStorage.setItem('pgb_owner_key', profile.owner_key);
        localStorage.setItem('pgb_owner_name', profile.name);

        if (profile.plan_type === 'Enterprise') {
          window.location.href = '/owner-dashboard.html';
          return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        
        // Check if user has an active subscription
        const isActiveSub = (profile.subscription_status === 'active' || profile.subscription_status === 'trial') && 
                             profile.subscription_expiry && 
                             new Date(profile.subscription_expiry) >= new Date();
        if (urlParams.get('upgrade') === 'true' && isActiveSub) {
          localStorage.setItem('pgb_owner_active_tab', 'plan');
          window.location.href = '/owner-dashboard.html';
          return;
        }
        window.isUpgradeMode = false; // Always false since active upgrades are disabled

        if (urlParams.get('upgrade') === 'true') {
          window.currentOwnerData = {
            owner_key: profile.owner_key,
            name: profile.name
          };
          
          // Query created buildings to enforce minimum allowed buildings count
          let createdCount = 0;
          try {
            const { data: userBlds } = await supabase
              .from('buildings')
              .select('id')
              .eq('owner_id', profile.id);
            createdCount = userBlds ? userBlds.length : 0;
          } catch (e) {
            console.error('Error fetching buildings count for upgrade minimum limit:', e);
          }
          
          const currentLimit = profile.allowed_buildings || 0;
          const minLimit = Math.max(currentLimit, createdCount);
          
          window.checkoutState.currentLimit = minLimit;
          window.checkoutState.extraBuildings = 0;
          window.checkoutState.buildings = minLimit;
          
          const buildingCountEl = document.getElementById('building-count');
          if (buildingCountEl) {
            buildingCountEl.value = minLimit;
            buildingCountEl.min = minLimit === 0 ? 1 : minLimit;
          }
          
          window.goToPaymentStep();
        } else {
          const isExpired = profile.plan_type !== 'Enterprise' && 
                            (profile.subscription_status === 'expired' ||
                             (profile.subscription_status !== 'active' && profile.subscription_status !== 'trial') || 
                             (profile.subscription_expiry && new Date(profile.subscription_expiry) < new Date()));
          if (!isExpired) {
            window.location.href = '/owner-dashboard.html';
          } else {
            if (!profile.subscription_expiry) {
              // First time user, never paid -> direct to payment step
              window.isUpgradeMode = false;
              window.checkoutState.currentLimit = 0;
              window.checkoutState.extraBuildings = 1;
              window.checkoutState.buildings = 1;
              window.goToPaymentStep();
            } else {
              // Expired user -> redirect to expired screen
              window.location.href = '/subscription-expired.html';
            }
          }
        }
        return;
      }

      // Prefill Name and Email from Google
      const googleName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';
      const googleEmail = session.user.email || '';

      document.getElementById('reg-name').value = googleName;
      document.getElementById('reg-email').value = googleEmail;
      document.getElementById('reg-email').disabled = true;

      // Prefill referral code if present in localStorage
      const savedRef = localStorage.getItem('pgb_referral_code') || '';
      const refInput = document.getElementById('reg-ref-code');
      if (refInput) {
        refInput.value = savedRef;
      }

      // Toggle containers: hide sign-in button, show details inputs
      document.getElementById('google-init-container').classList.add('hidden');
      document.getElementById('google-details-container').classList.remove('hidden');
    }
  } catch (err) {
    console.error('Error checking Google session:', err);
  }
}

window.handleGoogleRegisterSubmit = async function () {
  const name = document.getElementById('reg-name').value.trim();
  const phone = document.getElementById('reg-phone').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const refCode = document.getElementById('reg-ref-code')?.value.trim().toUpperCase() || '';

  const nameErr = validateName(name);
  if (nameErr) { showToast('Invalid Name', nameErr, 'warning'); return; }

  const phoneErr = validatePhone(phone);
  if (phoneErr) { showToast('Invalid Phone', phoneErr, 'warning'); return; }

  const agreeCheck = document.getElementById('reg-terms-privacy');
  if (agreeCheck && !agreeCheck.checked) {
    showToast('Agreement Required', 'Please agree to Terms & Conditions & Privacy Policy to continue.', 'warning');
    return;
  }

  // Validate referral code if entered
  if (refCode) {
    const refRegex = /^RS[A-Z0-9]{6}$/;
    if (!refRegex.test(refCode)) {
      showToast('Invalid Referral Code', 'Referral code must be in the format RSXXXXXX (e.g. RS123456).', 'warning');
      return;
    }
  }

  const btn = document.getElementById('btn-register-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving Profile...';
  }

  try {
    const session = await getSession();
    if (!session) throw new Error('No active session found.');

    // If referral code is entered, verify it exists in affiliates table
    if (refCode) {
      const { data: aff, error: affErr } = await supabase
        .from('affiliates')
        .select('id')
        .eq('referral_code', refCode)
        .maybeSingle();

      if (affErr || !aff) {
        showToast('Invalid Referral Code', 'The entered referral code does not exist. Please check and try again.', 'warning');
        if (btn) {
          btn.disabled = false;
          btn.textContent = 'Complete Google Registration →';
        }
        return;
      }
      
      // Save valid referral code in localStorage so createOwnerProfile() will retrieve it
      localStorage.setItem('pgb_referral_code', refCode);
    } else {
      // Clear any pre-existing code if they cleared the field
      localStorage.removeItem('pgb_referral_code');
    }

    const ownerKey = await generateOwnerKey();

    // Save owner profile in Supabase
    await createOwnerProfile(session.user.id, name, phone, email, ownerKey);

    localStorage.setItem('pgb_user_role', 'owner');
    localStorage.setItem('pgb_owner_key', ownerKey);
    localStorage.setItem('pgb_owner_name', name);

    // Show success screen
    window.showRegistrationSuccess(ownerKey, name);
    showToast('Registration Complete!', 'Your owner profile has been saved successfully.', 'success');

  } catch (err) {
    showToast('Registration Failed', getReadableErrorMessage(err), 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Complete Google Registration →';
    }
  }
};

// ── Subscription Payment Steps ──
// ── Subscription SaaS Checkout ──
window.checkoutState = {
  cycle: 'monthly',
  buildings: 0,
  extraBuildings: 0,
  pricePerBuilding: 5,
  currentLimit: 0
};

window.goToPaymentStep = function () {
  const stepSuccess = document.getElementById('step-success');
  if (stepSuccess) stepSuccess.classList.add('hidden');

  const authContainer = document.getElementById('auth-container');
  if (authContainer) authContainer.classList.add('hidden');

  const stepPayment = document.getElementById('step-payment');
  if (stepPayment) stepPayment.classList.remove('hidden');

  // If upgrading, show the cancel button
  const backBtn = document.getElementById('checkout-back-btn');
  const urlParams = new URLSearchParams(window.location.search);
  if (backBtn) {
    if (urlParams.get('upgrade') === 'true') {
      backBtn.classList.remove('hidden');
    } else {
      backBtn.classList.add('hidden');
    }
  }

  // Ensure isUpgradeMode is set
  if (window.isUpgradeMode === undefined) {
    window.isUpgradeMode = false;
  }

  // If currentLimit is 0 (new registration/no prior limit), default count to 1 building
  const minLimit = window.checkoutState.currentLimit || 0;
  if (minLimit === 0) {
    window.checkoutState.buildings = Math.max(1, window.checkoutState.buildings);
    window.checkoutState.extraBuildings = window.checkoutState.buildings;
  } else {
    window.checkoutState.buildings = Math.max(minLimit, window.checkoutState.buildings);
    window.checkoutState.extraBuildings = window.checkoutState.buildings - minLimit;
  }

  const buildingCountEl = document.getElementById('building-count');
  if (buildingCountEl) {
    buildingCountEl.min = minLimit === 0 ? 1 : minLimit;
    buildingCountEl.value = window.checkoutState.buildings;
  }

  loadSubscriptionConfigAndRender();
};

async function loadSubscriptionConfigAndRender() {
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('*')
      .eq('key', 'subscription')
      .maybeSingle();
      
    if (!error && data && data.value) {
      window.checkoutState.pricePerBuilding = Number(data.value.price_per_building) || 5;
      window.checkoutState.gstRate = Number(data.value.gst_rate) || 18;
      window.checkoutState.yearlyDiscountMonths = Number(data.value.yearly_discount_months) || 1;
      window.checkoutState.enableYearlyPlan = data.value.enable_yearly_plan !== false;
    }
  } catch (err) {
    console.error('Failed to load subscription configuration from settings:', err);
  }
  window.updateCheckoutSummary();
}

window.goBackToSuccess = function () {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('upgrade') === 'true') {
    window.location.href = '/owner-dashboard.html';
    return;
  }
  const stepPayment = document.getElementById('step-payment');
  if (stepPayment) stepPayment.classList.add('hidden');

  const authContainer = document.getElementById('auth-container');
  if (authContainer) authContainer.classList.remove('hidden');

  const stepSuccess = document.getElementById('step-success');
  if (stepSuccess) stepSuccess.classList.remove('hidden');
};

window.setBillingCycle = function (cycle) {
  if (cycle === 'yearly' && window.checkoutState.enableYearlyPlan === false) {
    return;
  }
  window.checkoutState.cycle = cycle;

  const monthlyCard = document.getElementById('cycle-monthly');
  const yearlyCard = document.getElementById('cycle-yearly');

  if (cycle === 'monthly') {
    monthlyCard.classList.add('selected');
    yearlyCard.classList.remove('selected');
  } else {
    monthlyCard.classList.remove('selected');
    yearlyCard.classList.add('selected');
  }

  window.updateCheckoutSummary();
};

window.adjustBuildings = function (diff) {
  const minBuildings = window.checkoutState.currentLimit || 1;
  const current = window.checkoutState.buildings || minBuildings;
  const target = Math.max(minBuildings, current + diff);
  window.checkoutState.buildings = target;
  window.checkoutState.extraBuildings = Math.max(0, target - (window.checkoutState.currentLimit || 0));

  const buildingCount = document.getElementById('building-count');
  if (buildingCount) {
    buildingCount.value = target;
  }

  window.updateCheckoutSummary();
};

window.onBuildingInput = function(el) {
  let val = parseInt(el.value);
  if (isNaN(val)) {
    return; // Wait until they finish typing
  }
  const minBuildings = window.checkoutState.currentLimit || 1;
  if (val < minBuildings) {
    val = minBuildings;
    el.value = minBuildings;
  }
  window.checkoutState.buildings = val;
  window.checkoutState.extraBuildings = Math.max(0, val - (window.checkoutState.currentLimit || 0));
  window.updateCheckoutSummary();
};

window.onBuildingBlur = function(el) {
  let val = parseInt(el.value);
  const minBuildings = window.checkoutState.currentLimit || 1;
  if (isNaN(val) || val < minBuildings) {
    val = minBuildings;
  }
  el.value = val;
  window.checkoutState.buildings = val;
  window.checkoutState.extraBuildings = Math.max(0, val - (window.checkoutState.currentLimit || 0));
  window.updateCheckoutSummary();
};

window.updateCheckoutSummary = function () {
  const state = window.checkoutState;
  const isYearlyPlanEnabled = state.enableYearlyPlan !== false;

  const yearlyCard = document.getElementById('cycle-yearly');
  const savingsCard = document.getElementById('savings-card');
  const billingCardsContainer = document.querySelector('.billing-cards');

  if (yearlyCard) {
    if (!isYearlyPlanEnabled) {
      yearlyCard.style.display = 'none';
      if (state.cycle === 'yearly') {
        state.cycle = 'monthly';
        const monthlyCard = document.getElementById('cycle-monthly');
        if (monthlyCard) monthlyCard.classList.add('selected');
        yearlyCard.classList.remove('selected');
      }
    } else {
      yearlyCard.style.display = '';
    }
  }

  if (savingsCard) {
    if (!isYearlyPlanEnabled) {
      savingsCard.style.display = 'none';
    } else {
      savingsCard.style.display = 'flex';
    }
  }

  if (billingCardsContainer) {
    if (!isYearlyPlanEnabled) {
      billingCardsContainer.style.gridTemplateColumns = '1fr';
    } else {
      billingCardsContainer.style.gridTemplateColumns = '';
    }
  }

  const isYearly = state.cycle === 'yearly';
  const price = state.pricePerBuilding || 5;
  const gstRate = state.gstRate !== undefined ? state.gstRate : 18;
  const discountMonths = state.yearlyDiscountMonths !== undefined ? state.yearlyDiscountMonths : 1;
  const billingMonths = isYearly ? Math.max(0, 12 - discountMonths) : 1;
  const count = state.buildings || (state.currentLimit || 1);

  // Check if upgrading active subscription vs renewing/new subscription
  const isUpgrade = window.isUpgradeMode === true;
  
  // Calculate billable count
  const billableCount = isUpgrade ? Math.max(0, count - (state.currentLimit || 0)) : count;

  // Calculations:
  const subtotal = billableCount * price * billingMonths;
  const gst = Math.round(subtotal * (gstRate / 100));
  const total = subtotal + gst;

  // Yearly savings amount
  const yearlySavings = billableCount * price * discountMonths;

  // Format numbers nicely:
  const fmtSubtotal = `₹${subtotal.toLocaleString('en-IN')}`;
  const fmtGst = `₹${gst.toLocaleString('en-IN')}`;
  const fmtTotal = `₹${total.toLocaleString('en-IN')}`;
  const fmtSavings = `₹${yearlySavings.toLocaleString('en-IN')}`;

  // Update DOM elements:
  const domBuildings = document.getElementById('summary-buildings');
  const domCycle = document.getElementById('summary-cycle');
  const domSubtotal = document.getElementById('summary-subtotal');
  const domGst = document.getElementById('summary-gst');
  const domTotalLabel = document.getElementById('summary-total-label');
  const domTotal = document.getElementById('summary-total');
  const domSavingsCard = document.getElementById('savings-card');
  const domSavingsTitle = document.getElementById('savings-title');
  const domPricePerBuilding = document.getElementById('summary-price-per-building');

  const buildingCountEl = document.getElementById('building-count');
  if (buildingCountEl) {
    const minBuildings = state.currentLimit || 1;
    buildingCountEl.min = minBuildings;
    if (buildingCountEl.value != count) {
      buildingCountEl.value = count;
    }
  }

  const domUpgradeRow = document.getElementById('summary-upgrade-row');
  const domExtraBuildings = document.getElementById('summary-extra-buildings');

  if (domBuildings) domBuildings.textContent = count;
  if (domCycle) domCycle.textContent = isYearly ? 'Yearly' : 'Monthly';
  if (domSubtotal) domSubtotal.textContent = fmtSubtotal;
  const domGstLabel = document.getElementById('summary-gst-label');
  if (domGstLabel) domGstLabel.textContent = `GST (${gstRate}%)`;
  if (domGst) domGst.textContent = fmtGst;
  if (domTotalLabel) domTotalLabel.textContent = isYearly ? 'Total (Yearly)' : 'Total (Monthly)';
  if (domTotal) domTotal.textContent = fmtTotal;
  if (domPricePerBuilding) domPricePerBuilding.textContent = `₹${price}`;

  // Update upgrade rows if upgrading
  if (isUpgrade && (state.currentLimit || 0) > 0) {
    if (domUpgradeRow) domUpgradeRow.classList.remove('hidden');
    if (domExtraBuildings) domExtraBuildings.textContent = billableCount;
  } else {
    if (domUpgradeRow) domUpgradeRow.classList.add('hidden');
  }

  // Disable checkouts if billableCount is 0
  const proceedBtn = document.querySelector('.btn-checkout');
  if (proceedBtn) {
    if (billableCount === 0) {
      proceedBtn.disabled = true;
      proceedBtn.textContent = 'No Additional Buildings Selected';
      proceedBtn.style.opacity = '0.5';
      proceedBtn.style.pointerEvents = 'none';
    } else {
      proceedBtn.disabled = false;
      proceedBtn.textContent = 'Proceed to Payment →';
      proceedBtn.style.opacity = '1';
      proceedBtn.style.pointerEvents = 'auto';
    }
  }

  // Update savings card:
  if (domSavingsCard && domSavingsTitle) {
    if (isYearly) {
      domSavingsCard.style.borderColor = 'var(--success-border)';
      domSavingsCard.style.background = 'var(--success-bg)';
      domSavingsCard.style.color = 'var(--success)';
      domSavingsTitle.textContent = `Yearly Plan Selected: Saved ${fmtSavings}!`;
    } else {
      domSavingsCard.style.borderColor = 'var(--warning-border)';
      domSavingsCard.style.background = 'var(--warning-bg)';
      domSavingsCard.style.color = 'var(--warning)';
      domSavingsTitle.textContent = `Switch to Yearly and save ${fmtSavings}`;
    }
  }

  // Update yearly card badge and savings subtitle dynamically based on discountMonths
  const yearlyBadge = document.querySelector('#cycle-yearly .card-badge');
  if (yearlyBadge) {
    const savingsPercent = Math.round((discountMonths / 12) * 100);
    yearlyBadge.textContent = discountMonths > 0 
      ? `${discountMonths} Month${discountMonths !== 1 ? 's' : ''} Free (Save ${savingsPercent}%)` 
      : 'No discount';
  }

  const savingsSub = document.querySelector('#savings-card .savings-text span');
  if (savingsSub) {
    if (discountMonths > 0) {
      savingsSub.textContent = `Pay only for ${12 - discountMonths} months and get ${discountMonths} month${discountMonths !== 1 ? 's' : ''} free!`;
    } else {
      savingsSub.textContent = 'Standard yearly subscription billing applies.';
    }
  }
};

async function getRazorpayConfig() {
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'gateways')
      .maybeSingle();
    if (error) throw error;
    if (data && data.value && data.value.razorpay) {
      return data.value.razorpay;
    }
  } catch (err) {
    console.error('Failed to load Razorpay settings:', err);
  }
  return null;
}

async function handlePaymentSuccess(paymentId, totalAmount, userId) {
  try {
    const isYearly = window.checkoutState.cycle === 'yearly';
    const durationDays = isYearly ? 365 : 30;
    const expiryDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);

    // 1. Update owners table (with resilient fallback if billing_cycle column is missing in DB)
    const updatePayload = {
      subscription_status: 'active',
      subscription_expiry: expiryDate.toISOString(),
      allowed_buildings: window.checkoutState.buildings
    };

    let { error: updateErr } = await supabase
      .from('owners')
      .update({
        ...updatePayload,
        billing_cycle: window.checkoutState.cycle
      })
      .eq('id', userId);

    if (updateErr) {
      console.warn('Failed to update with billing_cycle, retrying without it:', updateErr);
      const { error: retryErr } = await supabase
        .from('owners')
        .update(updatePayload)
        .eq('id', userId);
      if (retryErr) throw retryErr;
    }

    // Fetch referring affiliate's commission rate if any
    let referralCommissionPercentage = null;
    try {
      const { data: ownerData } = await supabase
        .from('owners')
        .select('referred_by_code')
        .eq('id', userId)
        .maybeSingle();
      
      if (ownerData && ownerData.referred_by_code) {
        const { data: affData } = await supabase
          .from('affiliates')
          .select('commission_percentage')
          .eq('referral_code', ownerData.referred_by_code)
          .maybeSingle();
        
        if (affData) {
          if (affData.commission_percentage !== null && affData.commission_percentage !== undefined) {
            referralCommissionPercentage = Number(affData.commission_percentage);
          } else {
            // Get default from settings
            const { data: platformSettings } = await supabase
              .from('platform_settings')
              .select('value')
              .eq('key', 'affiliate')
              .maybeSingle();
            if (platformSettings && platformSettings.value) {
              referralCommissionPercentage = Number(platformSettings.value.commission_percentage) || 20;
            } else {
              referralCommissionPercentage = 20;
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to fetch referred affiliate commission percentage:', e);
    }

    // 2. Insert transaction record in payments table
    const { error: paymentErr } = await supabase
      .from('payments')
      .insert({
        owner_id: userId,
        tenant_id: null,
        month_year: 'SaaS Renewal',
        total_amount: totalAmount,
        payment_method: 'Razorpay',
        transaction_id: paymentId,
        status: 'approved',
        payment_date: new Date().toISOString().slice(0, 10),
        created_at: new Date().toISOString(),
        commission_rate: referralCommissionPercentage
      });

    if (paymentErr) {
      console.warn('Failed to insert payments record (Audit log only):', paymentErr);
    }

    // 3. Save locally
    localStorage.setItem('pgb_subscription_status', 'active');
    localStorage.setItem('pgb_subscription_expiry', expiryDate.toISOString());
    localStorage.setItem('pgb_allowed_buildings', window.checkoutState.buildings);

    // Set Step 2 as completed, Step 3 as active
    const step2 = document.getElementById('pstep-2');
    const step3 = document.getElementById('pstep-3');
    if (step2) {
      step2.classList.remove('active');
      step2.classList.add('completed');
    }
    if (step3) {
      step3.classList.add('active');
    }

    showToast('Payment Successful!', 'Subscription plan activated successfully.', 'success');

    // Close mock modal if open
    const modal = document.getElementById('payment-simulation-modal');
    if (modal) modal.classList.add('hidden');

    // Redirect after 1.5s
    setTimeout(() => {
      window.location.href = '/owner-dashboard.html';
    }, 1500);

  } catch (err) {
    showToast('Activation Failed', 'Error: ' + getReadableErrorMessage(err), 'error');
  }
}

window.checkoutProceedToPayment = async function () {
  const step1 = document.getElementById('pstep-1');
  const step2 = document.getElementById('pstep-2');

  if (step1) {
    step1.classList.remove('active');
    step1.classList.add('completed');
  }
  if (step2) {
    step2.classList.add('active');
  }

  const state = window.checkoutState;
  const isYearly = state.cycle === 'yearly';
  const currentLimit = state.currentLimit || 0;
  
  const isUpgrade = window.isUpgradeMode === true;
  const billableCount = isUpgrade ? Math.max(0, state.buildings - currentLimit) : state.buildings;
  
  const gstRate = state.gstRate !== undefined ? state.gstRate : 18;
  const discountMonths = state.yearlyDiscountMonths !== undefined ? state.yearlyDiscountMonths : 1;
  const billingMonths = isYearly ? Math.max(0, 12 - discountMonths) : 1;

  const subtotal = billableCount * state.pricePerBuilding * billingMonths;
  const total = subtotal + Math.round(subtotal * (gstRate / 100));

  const proceedBtn = document.querySelector('.btn-checkout');
  const originalBtnText = proceedBtn ? proceedBtn.textContent : 'Proceed to Payment →';
  if (proceedBtn) {
    proceedBtn.disabled = true;
    proceedBtn.textContent = 'Preparing Payment...';
  }

  const rzpConfig = await getRazorpayConfig();
  
  if (proceedBtn) {
    proceedBtn.disabled = false;
    proceedBtn.textContent = originalBtnText;
  }

  if (rzpConfig && rzpConfig.enabled && rzpConfig.key_id && rzpConfig.key_id !== 'rzp_test_example') {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        showToast('Session Expired', 'Please log in again to subscribe.', 'error');
        return;
      }

      let userProfile = null;
      try {
        const { data } = await supabase.from('owners').select('*').eq('id', user.id).maybeSingle();
        userProfile = data;
      } catch (e) {
        console.warn('Could not fetch owner profile for prefill:', e);
      }

      const options = {
        key: rzpConfig.key_id,
        amount: total * 100, // paise
        currency: "INR",
        name: "Pgbuilderss",
        description: `Plan: ${state.buildings} Buildings (${state.cycle === 'yearly' ? 'Yearly' : 'Monthly'})`,
        image: "/icons/icon-128.png",
        handler: async function (response) {
          if (proceedBtn) {
            proceedBtn.disabled = true;
            proceedBtn.textContent = 'Verifying Transaction...';
          }
          await handlePaymentSuccess(response.razorpay_payment_id, total, user.id);
        },
        prefill: {
          name: regData.name || userProfile?.name || "",
          email: regData.email || userProfile?.email || user.email || "",
          contact: regData.phone || userProfile?.phone || ""
        },
        notes: {
          owner_id: user.id,
          buildings: state.buildings,
          cycle: state.cycle
        },
        theme: {
          color: "#6C5CE7"
        },
        modal: {
          ondismiss: function () {
            showToast('Payment Cancelled', 'You cancelled the checkout process.', 'warning');
            window.closePaymentModal();
          }
        }
      };

      const rzp = new Razorpay(options);
      rzp.open();
    } catch (err) {
      showToast('Razorpay Error', 'Failed to initialize payment gateway: ' + err.message, 'error');
    }
  } else {
    showToast('Demo Mode', 'Razorpay key not configured. Launching test simulation...', 'info');
    
    const modalPayAmount = document.getElementById('modal-pay-amount');
    const modalPayCycle = document.getElementById('modal-pay-cycle');
    const modal = document.getElementById('payment-simulation-modal');

    if (modalPayAmount) modalPayAmount.textContent = `₹${total.toLocaleString('en-IN')}`;
    if (modalPayCycle) modalPayCycle.textContent = isYearly ? 'Yearly' : 'Monthly';
    if (modal) modal.classList.remove('hidden');
  }
};

window.closePaymentModal = function () {
  const modal = document.getElementById('payment-simulation-modal');
  if (modal) modal.classList.add('hidden');

  const step1 = document.getElementById('pstep-1');
  const step2 = document.getElementById('pstep-2');
  if (step1) {
    step1.classList.add('active');
    step1.classList.remove('completed');
  }
  if (step2) {
    step2.classList.remove('active');
  }
};

window.onPaymentMethodChange = function () {
  const method = document.getElementById('modal-pay-method').value;
  const upiDiv = document.getElementById('method-input-upi');
  const cardDiv = document.getElementById('method-input-card');
  const netbankingDiv = document.getElementById('method-input-netbanking');

  if (method === 'upi') {
    upiDiv.classList.remove('hidden');
    cardDiv.classList.add('hidden');
    netbankingDiv.classList.add('hidden');
  } else if (method === 'card') {
    upiDiv.classList.add('hidden');
    cardDiv.classList.remove('hidden');
    netbankingDiv.classList.add('hidden');
  } else if (method === 'netbanking') {
    upiDiv.classList.add('hidden');
    cardDiv.classList.add('hidden');
    netbankingDiv.classList.remove('hidden');
  }
};

window.simulatePaymentActivation = async function () {
  const btn = document.getElementById('btn-pay-submit');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Processing Payment...';
  }

  try {
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User session not found.');

    const state = window.checkoutState;
    const isYearly = state.cycle === 'yearly';
    const currentLimit = state.currentLimit || 0;
    
    const isUpgrade = window.isUpgradeMode === true;
    const billableCount = isUpgrade ? Math.max(0, state.buildings - currentLimit) : state.buildings;
    
    const gstRate = state.gstRate !== undefined ? state.gstRate : 18;
    const discountMonths = state.yearlyDiscountMonths !== undefined ? state.yearlyDiscountMonths : 1;
    const billingMonths = isYearly ? Math.max(0, 12 - discountMonths) : 1;

    const subtotal = billableCount * state.pricePerBuilding * billingMonths;
    const total = subtotal + Math.round(subtotal * (gstRate / 100));

    const mockTxnId = 'MOCK_TXN_' + Math.random().toString(36).substring(2, 12).toUpperCase();
    await handlePaymentSuccess(mockTxnId, total, user.id);

  } catch (err) {
    showToast('Payment Failed', 'Error: ' + getReadableErrorMessage(err), 'error');
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Pay Securely Now';
    }
  }
};

// Global owner data for QR code / poster download
window.currentOwnerData = {
  owner_key: '',
  name: ''
};

window.showRegistrationSuccess = function (ownerKey, ownerName) {
  window.currentOwnerData = {
    owner_key: ownerKey,
    name: ownerName || 'Owner'
  };

  document.getElementById('generated-key').textContent = ownerKey;

  // Generate QR Code
  const qrContainer = document.getElementById('qrcode');
  if (qrContainer) {
    qrContainer.innerHTML = '';
    const registerUrl = `${window.location.origin}/tenant-register.html?key=${ownerKey}`;
    try {
      new QRCode(qrContainer, {
        text: registerUrl,
        width: 150,
        height: 150,
        colorDark: '#0f0f1a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (err) {
      console.error('Failed to generate QR code:', err);
    }
  }

  // Switch display
  document.getElementById('step-register').classList.add('hidden');
  const otpStep = document.getElementById('step-otp');
  if (otpStep) {
    otpStep.classList.add('hidden');
  }
  document.getElementById('step-success').classList.remove('hidden');
};

window.requestManualUnlockPlan = async function () {
  try {
    const session = await getSession();
    if (!session) {
      showToast('Session Expired', 'Please log in again to select a plan.', 'error');
      return;
    }

    const userId = session.user.id;

    showToast('Submitting...', 'Requesting manual activation lock...', 'info');

    // Update owner status to 'Locked' and subscription_status to 'expired'
    const { error } = await supabase
      .from('owners')
      .update({
        status: 'Locked',
        subscription_status: 'expired'
      })
      .eq('id', userId);

    if (error) throw error;

    showToast('Request Submitted', 'Your account is locked. Redirecting to manual lock screen...', 'success');

    // Redirect to account locked screen
    setTimeout(() => {
      window.location.href = '/account-locked.html';
    }, 1200);

  } catch (err) {
    showToast('Failed to Request', getReadableErrorMessage(err), 'error');
  }
};


window.downloadQRCode = function () {
  const owner = window.currentOwnerData;
  if (!owner || !owner.owner_key) {
    showToast('Error', 'Owner Key not loaded', 'error');
    return;
  }
  const qrCanvas = document.querySelector('#qrcode canvas');
  if (!qrCanvas) {
    const qrImg = document.querySelector('#qrcode img');
    if (qrImg && qrImg.src) {
      const link = document.createElement('a');
      link.href = qrImg.src;
      link.download = `PG_Builders_QR_${owner.owner_key}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Downloaded!', 'QR Code downloaded successfully', 'success');
      return;
    }
    showToast('Error', 'QR Code not generated yet', 'error');
    return;
  }

  try {
    const url = qrCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = url;
    link.download = `PG_Builders_QR_${owner.owner_key}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Downloaded!', 'QR Code downloaded successfully', 'success');
  } catch (err) {
    console.error('QR download error:', err);
    showToast('Download Failed', 'Could not convert QR code to image', 'error');
  }
};

window.downloadTenantPoster = async function (lang) {
  const owner = window.currentOwnerData;
  if (!owner || !owner.owner_key) {
    showToast('Error', 'Owner Key not loaded', 'error');
    return;
  }

  const qrCanvas = document.querySelector('#qrcode canvas');
  const qrImg = document.querySelector('#qrcode img');
  let qrDataUrl = '';
  if (qrCanvas) {
    qrDataUrl = qrCanvas.toDataURL('image/png');
  } else if (qrImg && qrImg.src) {
    qrDataUrl = qrImg.src;
  }

  if (!qrDataUrl) {
    showToast('Error', 'Please generate QR Code first', 'error');
    return;
  }

  // Create temporary container styled beautifully as an A4 Poster flyer
  const posterContainer = document.createElement('div');
  posterContainer.style.cssText = `
    position: absolute;
    left: -9999px;
    top: -9999px;
    width: 650px;
    height: 950px;
    background: #ffffff;
    color: #0f172a;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    padding: 40px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    border: 12px solid #6366f1;
    border-radius: 24px;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
    text-align: center;
  `;

  const isEn = lang === 'en';

  const titleText = isEn ? 'WELCOME TO' : 'स्वागत है';
  const subtitleText = isEn ? 'EASY TENANT REGISTRATION' : 'आसान किरायेदार रजिस्ट्रेशन गाइड';
  const ownerName = owner.name ? owner.name.toUpperCase() : 'OUR PG/HOSTEL';
  const stepHeader = isEn ? 'Follow these simple steps to register:' : 'रजिस्ट्रेशन करने के आसान स्टेप्स:';

  // English steps
  const enSteps = `
    <div style="width: 100%; display: flex; flex-direction: column; gap: 15px; text-align: left; padding: 0 10px;">
      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">1</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">Scan QR Code</strong>
          <span style="color: #64748b; font-size: 13px;">Open your phone camera or Google Lens and scan the QR code above.</span>
        </div>
      </div>

      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">2</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">One-Tap Google Sign-In</strong>
          <span style="color: #64748b; font-size: 13px;">Log in securely using Google One-Tap. Your Email ID will be automatically verified & linked.</span>
        </div>
      </div>

      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">3</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">Enter Your Details</strong>
          <span style="color: #64748b; font-size: 13px;">Fill in your Name, Mobile, Alt Mobile (optional), Aadhaar, and continue.</span>
        </div>
      </div>

      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">4</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">Select Room & Meter</strong>
          <span style="color: #64748b; font-size: 13px;">Choose your Building, Floor, Room. Input initial electricity meter reading and submit!</span>
        </div>
      </div>
    </div>
  `;

  // Hindi/Hinglish steps
  const hiSteps = `
    <div style="width: 100%; display: flex; flex-direction: column; gap: 15px; text-align: left; padding: 0 10px;">
      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">1</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">QR Code Scan Karein (स्कैन करें)</strong>
          <span style="color: #64748b; font-size: 13px;">Apne phone camera ya Google Lens se upar diye gaye QR code ko scan karein.</span>
        </div>
      </div>

      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">2</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">Google Sign-In Karein (गूगल लॉगिन)</strong>
          <span style="color: #64748b; font-size: 13px;">One-Tap login karein. Aapki Email ID automatically verify ho kar link ho jayegi.</span>
        </div>
      </div>

      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">3</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">Apni Details Bharein (जानकारी भरें)</strong>
          <span style="color: #64748b; font-size: 13px;">Apna Full Name, Mobile, Alt Mobile bharein, aur Aadhaar Number bharein (Owner key apne aap pre-fill ho jayegi).</span>
        </div>
      </div>

      <div style="display: flex; gap: 15px; align-items: flex-start; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border-left: 5px solid #6366f1;">
        <span style="background: #6366f1; color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0; font-size: 14px;">4</span>
        <div>
          <strong style="color: #1e293b; font-size: 15px; display: block;">Room aur Meter select Karein (कमरा चुनें)</strong>
          <span style="color: #64748b; font-size: 13px;">Apna Building, Floor, aur Room select karein. Initial meter reading bharkar submit karein!</span>
        </div>
      </div>
    </div>
  `;

  posterContainer.innerHTML = `
    <!-- Top Branding & Greeting -->
    <div style="width: 100%;">
      <div style="font-size: 14px; font-weight: 800; color: #6366f1; letter-spacing: 3px; text-transform: uppercase; margin-bottom: 8px;">${titleText}</div>
      <div style="font-size: 26px; font-weight: 900; color: #1e1b4b; line-height: 1.2; word-break: break-word;">${ownerName}</div>
      <div style="font-size: 13px; font-weight: 600; color: #64748b; margin-top: 6px; letter-spacing: 1px; text-transform: uppercase;">${subtitleText}</div>
      <div style="width: 60px; height: 4px; background: #6366f1; margin: 15px auto 0; border-radius: 2px;"></div>
    </div>

    <!-- QR Code Section -->
    <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
      <div style="background: #ffffff; padding: 16px; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(99, 102, 241, 0.15); border: 2px solid #e2e8f0; display: inline-block;">
        <img src="${qrDataUrl}" style="width: 220px; height: 220px; display: block;" />
      </div>
      <div>
        <span style="font-size: 11px; text-transform: uppercase; font-weight: 800; color: #94a3b8; letter-spacing: 1px;">Landlord Owner Key</span>
        <div style="background: #f1f5f9; border: 2px dashed #6366f1; padding: 8px 20px; border-radius: 8px; font-size: 20px; font-weight: 800; color: #4f46e5; letter-spacing: 2px; margin-top: 4px; font-family: monospace;">
          ${owner.owner_key}
        </div>
      </div>
    </div>

    <!-- Steps -->
    <div style="width: 100%;">
      <div style="font-size: 13px; font-weight: 700; color: #475569; margin-bottom: 12px; text-align: left; padding-left: 10px;">${stepHeader}</div>
      ${isEn ? enSteps : hiSteps}
    </div>

    <!-- Footer -->
    <div style="width: 100%; font-size: 11px; color: #94a3b8; font-weight: 500; border-top: 1px solid #e2e8f0; padding-top: 15px; display: flex; justify-content: space-between; align-items: center;">
      <span>${ICONS.smartphone()} pgbuilderss.online</span>
      <span>${ICONS.electricity()} Quick & Automated Systems</span>
    </div>
  `;

  document.body.appendChild(posterContainer);
  showToast('Generating Poster...', 'Applying premium styling & layouts...', 'info');

  try {
    const canvas = await html2canvas(posterContainer, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = imgUrl;
    link.download = `PG_Builders_Poster_${isEn ? 'English' : 'Hinglish'}_${owner.owner_key}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Downloaded!', `${isEn ? 'English' : 'Hinglish'} Poster downloaded successfully`, 'success');
  } catch (err) {
    console.error('Poster generation error:', err);
    showToast('Download Failed', 'Could not generate flyer image: ' + err.message, 'error');
  } finally {
    document.body.removeChild(posterContainer);
  }
};
