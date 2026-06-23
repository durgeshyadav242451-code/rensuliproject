/* ═══════════════════════════════════════════════════
   PG Builders — Tenant Dashboard Logic
   ═══════════════════════════════════════════════════ */
import { isConfigured, signOut, getSession, supabase, getOwnerByKey } from './supabase-config.js';
import { showToast, showConfigErrorOverlay, initSidebar, switchTab as utilSwitchTab, formatCurrency, formatDate, formatMonthYear, generateTxnId, generateReceiptPDF, validateName, validatePhone, attachNameInput, attachPhoneInput, getFloorLabel, validateAadhaar, attachAadhaarInput } from './utils.js';
import { initNotifications, initInstallPrompt, showPremiumInstallModal } from './notifications.js';
import { ICONS } from './icons.js';

let tenantData = null;
let tenantPayments = [];
let tenantComplaints = [];
let tenantHistory = [];
let approvalChannel = null; // real-time subscription for owner approval
let statusPollInterval = null; // polling fallback for owner approval
let tenantRealtimeChannel = null; // real-time subscription for live dashboard updates


// ── Init ──
let dashboardInitialized = false;
async function init() {
  if (!isConfigured()) {
    showConfigErrorOverlay();
    return;
  }

  let signedOutTimer = null;

  supabase.auth.onAuthStateChange(async (event, session) => {
    // Handle token refresh — keep alive silently
    if (event === 'TOKEN_REFRESHED') {
      return;
    }

    if (event === 'SIGNED_OUT') {
      // On mobile, brief network drops can fire SIGNED_OUT.
      // Wait 3 seconds and re-check session before redirecting.
      if (signedOutTimer) clearTimeout(signedOutTimer);
      signedOutTimer = setTimeout(async () => {
        try {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (!currentSession) {
            window.location.href = '/';
          }
          // else: session recovered, stay on page
        } catch {
          window.location.href = '/';
        }
      }, 3000);
      return;
    }

    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
      // Cancel any pending logout timer
      if (signedOutTimer) { clearTimeout(signedOutTimer); signedOutTimer = null; }

      if (!session && event === 'SIGNED_IN') {
        window.location.href = '/';
        return;
      }

      if (dashboardInitialized) return;
      dashboardInitialized = true;

      initSidebar();
      initInstallPrompt(); // Show PWA install banner on mobile

      // Scroll event listener to persist scroll position
      let scrollTimeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          localStorage.setItem('pgb_scroll_y_tenant', window.scrollY);
        }, 100);
      });

      // Bind install app handler
      window.handleInstallApp = function () {
        showPremiumInstallModal();
      };

      // Show sidebar install button if not running standalone
      const installBtn = document.getElementById('sidebar-install-btn');
      if (installBtn && !window.matchMedia('(display-mode: standalone)').matches && !window.navigator.standalone) {
        installBtn.style.display = 'block';
      }

      await loadRealData(session);
      checkTenantStatus();

      // Init push notifications after data is loaded (need owner_id for token)
      if (tenantData?.owner_id) {
        initNotifications('tenant', tenantData.owner_id).catch(e => console.warn('Notification init:', e));
      }

      // Live input filters for blocked-screen re-registration form
      attachNameInput(document.getElementById('block-info-name'));
      attachPhoneInput(document.getElementById('block-info-phone'));
      attachPhoneInput(document.getElementById('block-info-alt-phone'));

      // Live input filters for settings profile form
      const settingsNameInput = document.getElementById('settings-tenant-name');
      if (settingsNameInput) {
        attachNameInput(settingsNameInput);
      }
    }
  });
}

function checkTenantStatus() {
  const blockedScreen = document.getElementById('tenant-blocked-screen');
  if (!blockedScreen) return;

  if (!tenantData || (tenantData.status !== 'active' && tenantData.status !== 'vacating')) {
    // Show blocked overlay
    blockedScreen.classList.remove('hidden');

    const iconEl = document.getElementById('block-icon');
    const titleEl = document.getElementById('block-title');
    const descEl = document.getElementById('block-desc');
    const reRegContainer = document.getElementById('re-register-container');

    const status = tenantData?.status || 'inactive';

    if (status === 'pending') {
      iconEl.innerHTML = ICONS.pending('pending-icon-svg', 'color: var(--warning);', '48px');
      titleEl.textContent = 'Verification Pending';
      descEl.textContent = 'Your registration request is pending owner approval. (आपका रजिस्ट्रेशन पेंडिंग है, मालिक के अप्रूवल का इंतज़ार करें)';
      reRegContainer.classList.add('hidden');

      // ── Real-time: watch for owner approval ──
      if (tenantData?.id && !approvalChannel) {
        approvalChannel = supabase
          .channel('tenant-approval-' + tenantData.id)
          .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'tenants',
            filter: `id=eq.${tenantData.id}`
          }, async (payload) => {
            if (payload.new && payload.new.status === 'active') {
              // Owner approved! Clean up subscription and reload dashboard
              if (statusPollInterval) {
                clearInterval(statusPollInterval);
                statusPollInterval = null;
              }
              approvalChannel.unsubscribe();
              approvalChannel = null;
              showToast('Approved!', 'Owner ne approve kar diya! Dashboard khul raha hai...', 'success');
              await loadRealData();
              checkTenantStatus();
            }
          })
          .subscribe();
      }

      // ── Polling Fallback ──
      if (!statusPollInterval) {
        statusPollInterval = setInterval(async () => {
          try {
            const session = await getSession();
            if (!session) return;
            const userId = session.user.id;

            const { data: profiles } = await supabase
              .from('tenants')
              .select('status')
              .eq('auth_user_id', userId)
              .order('created_at', { ascending: false });

            let profile = null;
            if (profiles && profiles.length > 0) {
              profile = profiles.find(p => ['active', 'pending', 'vacating'].includes(p.status)) || profiles[0];
            }

            if (profile && profile.status === 'active') {
              // Owner approved! Clean up polling and subscription
              clearInterval(statusPollInterval);
              statusPollInterval = null;
              if (approvalChannel) {
                approvalChannel.unsubscribe();
                approvalChannel = null;
              }
              showToast('Approved!', 'Owner ne approve kar diya! Dashboard khul raha hai...', 'success');
              await loadRealData();
              checkTenantStatus();
            }
          } catch (err) {
            console.error('Polling error:', err);
          }
        }, 1500);
      }

    } else {
      // Clean up if status changed to rejected/vacated/inactive
      if (statusPollInterval) {
        clearInterval(statusPollInterval);
        statusPollInterval = null;
      }
      if (approvalChannel) {
        approvalChannel.unsubscribe();
        approvalChannel = null;
      }

      if (status === 'rejected') {
        iconEl.innerHTML = ICONS.error('error-icon-svg', 'color: var(--danger);', '48px');
        titleEl.textContent = 'Registration Rejected';
        descEl.textContent = 'Your registration request was declined by the property owner. Please register at another building.';
        reRegContainer.classList.remove('hidden');
      } else {
        // vacated or inactive
        iconEl.innerHTML = ICONS.lock('vacate-icon-svg', 'color: var(--warning-dark);', '48px');
        titleEl.textContent = 'Account Vacated';
        descEl.textContent = 'You have vacated the building. Enter a new Owner Key to register at a new PG/Hostel. (आप रूम खाली कर चुके हैं। नए रूम के लिए नया Owner Key डालें)';
        reRegContainer.classList.remove('hidden');
      }
    }
  } else {
    // Account active: hide blocked screen and render dashboard
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
    if (approvalChannel) {
      approvalChannel.unsubscribe();
      approvalChannel = null;
    }
    blockedScreen.classList.add('hidden');
    renderDashboard();

    // ── Restore last active tab on page refresh ──
    const savedTab = localStorage.getItem('pgb_tenant_active_tab');
    if (savedTab && savedTab !== 'home') {
      const savedBtn = document.querySelector(`.menu-item[data-tab="${savedTab}"]`);
      if (savedBtn) {
        window.switchTab(savedTab, savedBtn);
      }
    }

    // ── Restore scroll position on page refresh ──
    const savedScrollY = localStorage.getItem('pgb_scroll_y_tenant');
    if (savedScrollY !== null) {
      setTimeout(() => {
        window.scrollTo({ top: parseInt(savedScrollY), behavior: 'instant' });
      }, 150);
    }
  }
}

function loadDemoData() {
  // Demo mode deprecated, strictly runs against Supabase database.
}

async function loadRealData(session) {
  try {
    const activeSession = session || await getSession();
    if (!activeSession) { window.location.href = '/'; return; }

    const userId = activeSession.user.id;
    const userEmail = activeSession.user.email;

    // 1. Try by auth_user_id first (most precise — avoids false email matches)
    // Order by status priority: active/pending/vacating first, then vacated/rejected.
    // Within the same status category, order by created_at DESC (latest first) to select the correct stay.
    let { data: profiles } = await supabase
      .from('tenants')
      .select('*')
      .eq('auth_user_id', userId)
      .order('created_at', { ascending: false });

    let profile = null;
    if (profiles && profiles.length > 0) {
      profile = profiles.find(p => ['active', 'pending', 'vacating'].includes(p.status)) || profiles[0];
    }

    // 2. Fallback: match by email ONLY for unlinked records (owner added tenant before they registered)
    if (!profile) {
      const { data: emailProfiles } = await supabase
        .from('tenants')
        .select('*')
        .eq('email', userEmail)
        .is('auth_user_id', null)
        .order('created_at', { ascending: false });

      if (emailProfiles && emailProfiles.length > 0) {
        profile = emailProfiles.find(p => p.status === 'active') ||
          emailProfiles.find(p => p.status === 'pending') ||
          emailProfiles[0];
      }
    }

    if (profile && profile.status === 'vacating' && profile.vacate_date) {
      const todayStr = new Date().toISOString().split('T')[0];
      if (profile.vacate_date <= todayStr) {
        await executeTenantSelfVacate(profile);
        const { data: reloadedProfile } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', profile.id)
          .maybeSingle();
        if (reloadedProfile) {
          profile = reloadedProfile;
        }
      }
    }

    // 3. No record at all → brand-new user, redirect to registration
    if (!profile) {
      localStorage.removeItem('pgb_user_role');
      window.location.href = '/tenant-register.html';
      return;
    }

    // 4. Safety check: if active but building/room was deleted by owner → auto-vacate
    // This prevents the broken "Unknown PG — Room —" dashboard state
    if (profile.status === 'active' && (!profile.building_id || !profile.room_id)) {
      await supabase
        .from('tenants')
        .update({ status: 'vacated' })
        .eq('id', profile.id);
      profile = { ...profile, status: 'vacated' };
    }

    tenantData = profile;

    // Start real-time subscription for this tenant (once per session)
    if (tenantData.id && tenantData.status === 'active' && !tenantRealtimeChannel) {
      subscribeToTenantRealtime(tenantData.id);
    }

    // Auto-link auth_user_id if not set yet
    if (!profile.auth_user_id) {
      const { data: updatedProfile, error: linkErr } = await supabase
        .from('tenants')
        .update({ auth_user_id: userId })
        .eq('id', profile.id)
        .select()
        .maybeSingle();
      if (!linkErr && updatedProfile) {
        tenantData = updatedProfile;
      }
    }

    // Fetch building, room and owner details
    const { data: bld } = await supabase.from('buildings').select('*').eq('id', profile.building_id).maybeSingle();
    const { data: room } = await supabase.from('rooms').select('*').eq('id', profile.room_id).maybeSingle();
    const { data: owner } = await supabase.from('owners').select('*').eq('id', profile.owner_id || bld?.owner_id).maybeSingle();

    let floorNum = '—';
    if (room && room.floor_id) {
      const { data: floor } = await supabase.from('floors').select('floor_number').eq('id', room.floor_id).maybeSingle();
      if (floor) {
        floorNum = floor.floor_number;
      }
    }

    tenantData.building_name = bld ? bld.name : 'Unknown PG';
    tenantData.room_number = room ? room.room_number : '—';
    tenantData.floor_number = floorNum;
    tenantData.rent = room ? room.rent : 8000;
    tenantData.electricity_included = (room && room.electricity_included) || (bld && bld.electricity_included) || false;
    tenantData.electricity_rate = room && room.electricity_rate !== undefined && room.electricity_rate !== null ? room.electricity_rate : (bld ? bld.electricity_rate : 10);
    tenantData.electricity_subsidy_mode = room ? room.electricity_subsidy_mode : false;
    tenantData.electricity_subsidy_units = room ? (room.electricity_subsidy_units !== undefined ? room.electricity_subsidy_units : 1) : 1;
    tenantData.electricity_subsidy_rate = room ? (room.electricity_subsidy_rate !== undefined ? room.electricity_subsidy_rate : 0) : 0;
    tenantData.maintenance_included = (room && room.maintenance_included !== undefined) ? room.maintenance_included : false;
    tenantData.maintenance = tenantData.maintenance_included ? 0 : (room && room.maintenance_charge !== undefined && room.maintenance_charge !== null ? room.maintenance_charge : (bld ? bld.maintenance_charge : 500));
    tenantData.advance_amount = room && room.advance_amount !== undefined && room.advance_amount !== null ? room.advance_amount : (bld && bld.advance_amount !== undefined && bld.advance_amount !== null ? bld.advance_amount : 5000);
    tenantData.owner_upi = owner ? owner.upi_id : '';
    tenantData.owner_name = owner ? owner.name : '';
    tenantData.owner_id = owner ? owner.id : null;
    tenantData.owner_key = owner ? owner.owner_key : '';
    tenantData.beds_count = room ? room.beds_count : 1;
    tenantData.beds_occupied = room ? room.beds_occupied : 1;

    // Fetch roommates for PG/Hostel rooms
    const { data: roommates } = await supabase
      .from('tenants')
      .select('name, phone')
      .eq('room_id', profile.room_id)
      .eq('status', 'active')
      .neq('id', profile.id);

    tenantData.roommates = roommates || [];

    // Load payments (sorted by created_at descending to ensure latest is always first)
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('tenant_id', profile.id)
      .eq('building_id', profile.building_id)
      .order('created_at', { ascending: false });
    tenantPayments = payments || [];

    // Load complaints
    const { data: complaints } = await supabase
      .from('complaints')
      .select('*')
      .eq('tenant_id', profile.id)
      .eq('building_id', profile.building_id)
      .order('created_at', { ascending: false });
    tenantComplaints = complaints || [];

    // Load tenant history (sorted by moved_in descending)
    const { data: history } = await supabase
      .from('tenant_history')
      .select('*')
      .eq('tenant_id', profile.id)
      .order('moved_in', { ascending: false });
    tenantHistory = history || [];

    setDisplayData();
  } catch (err) {
    console.error('Failed to load real tenant data:', err);
    tenantData = { status: 'vacated' };
  }
}

// ── Tenant Real-time Subscription ──
// Watches for changes on the tenant's own row, payments, shift requests,
// and vacate notices — allowing instant UI updates without manual refresh.
function subscribeToTenantRealtime(tenantId) {
  if (tenantRealtimeChannel) {
    tenantRealtimeChannel.unsubscribe();
    tenantRealtimeChannel = null;
  }

  tenantRealtimeChannel = supabase
    .channel('tenant-realtime-' + tenantId)
    // Watch for status changes on own tenant profile (approval, room shifts, vacating)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'tenants',
      filter: `id=eq.${tenantId}`
    }, async (payload) => {
      console.log('Realtime tenant profile update:', payload);
      await loadRealData();
      renderDashboard();
      checkTenantStatus();
    })
    // Watch for payment status changes (pending → approved / rejected by owner)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'payments',
      filter: `tenant_id=eq.${tenantId}`
    }, async (payload) => {
      console.log('Realtime payment update for tenant:', payload);
      await loadRealData();
      renderDashboard();
      renderPaymentHistory();
    })

    // Watch for vacate notice status changes (submitted → processed)
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'vacate_notices',
      filter: `tenant_id=eq.${tenantId}`
    }, async (payload) => {
      console.log('Realtime vacate notice update for tenant:', payload);
      await loadRealData();
      renderDashboard();
    })
    // Watch for complaint changes — DELETE means owner resolved it
    .on('postgres_changes', {
      event: 'DELETE',
      schema: 'public',
      table: 'complaints',
      filter: `tenant_id=eq.${tenantId}`
    }, (payload) => {
      console.log('Realtime complaint deleted (resolved by owner):', payload);
      // Remove from local array instantly
      tenantComplaints = tenantComplaints.filter(c => c.id !== payload.old?.id);
      renderComplaints();
      showToast('Complaint Resolved!', 'Your complaint has been resolved by the owner.', 'success');
    })
    .on('postgres_changes', {
      event: 'UPDATE',
      schema: 'public',
      table: 'complaints',
      filter: `tenant_id=eq.${tenantId}`
    }, async (payload) => {
      console.log('Realtime complaint updated:', payload);
      await loadRealData();
      renderComplaints();
    })
    .subscribe();
}


function setDisplayData() {
  const tenantNameEl = document.getElementById('tenant-display-name');
  if (tenantNameEl) tenantNameEl.textContent = tenantData.name;

  const tenantRoomInfoEl = document.getElementById('tenant-room-info');
  if (tenantRoomInfoEl) tenantRoomInfoEl.textContent = `Room ${tenantData.room_number}`;

  const tenantAvatarEl = document.getElementById('tenant-avatar');
  if (tenantAvatarEl) tenantAvatarEl.textContent = tenantData.name.split(' ').map(w => w[0]).join('').slice(0, 2);
  document.getElementById('topbar-building').textContent = `${tenantData.building_name} — Room ${tenantData.room_number}`;

  const settingsNameInput = document.getElementById('settings-tenant-name');
  if (settingsNameInput && tenantData) {
    settingsNameInput.value = tenantData.name || '';
  }

  // Show red indicator dot on Notice Board button if owner has posted notices
  checkNoticeBoardIndicator();
}

// ═══════════════ DASHBOARD ═══════════════
function renderDashboard() {
  // KPIs
  document.getElementById('kpi-join').textContent = formatDate(tenantData.join_date);

  // Calculate Next Payment Date (exactly based on Join Date + number of submitted payments)
  const joinDate = tenantData.join_date ? new Date(tenantData.join_date) : new Date();
  const submittedPaymentsCount = tenantPayments.filter(p => p.status === 'approved' || p.status === 'pending').length;

  const nextPaymentDate = new Date(joinDate);
  nextPaymentDate.setMonth(nextPaymentDate.getMonth() + submittedPaymentsCount);

  const nextPaymentEl = document.getElementById('kpi-next-payment');
  if (nextPaymentEl) {
    nextPaymentEl.textContent = formatDate(nextPaymentDate);
  }

  document.getElementById('kpi-rent').textContent = formatCurrency(tenantData.rent);

  // Sum up all approved advance payments from payment history, falling back to profile value
  const totalAdvance = tenantPayments.filter(p => p.status === 'approved').reduce((s, p) => s + (p.advance_amount || 0), 0);
  document.getElementById('kpi-advance').textContent = formatCurrency(totalAdvance || tenantData.advance_paid || 0);

  const totalPaid = tenantPayments.filter(p => p.status === 'approved').reduce((s, p) => s + p.total_amount, 0);
  document.getElementById('kpi-total-paid').textContent = formatCurrency(totalPaid);

  // Calculate and set total electricity paid
  const totalElecPaid = tenantPayments.filter(p => p.status === 'approved').reduce((s, p) => s + (p.electricity_amount || 0), 0);
  const kpiTotalElecEl = document.getElementById('kpi-total-elec');
  if (kpiTotalElecEl) kpiTotalElecEl.textContent = formatCurrency(totalElecPaid);

  // Toggle electricity card based on whether it is included
  const kpiElecCard = document.getElementById('kpi-elec-card');
  if (kpiElecCard) {
    if (tenantData.electricity_included) {
      kpiElecCard.classList.add('hidden');
    } else {
      kpiElecCard.classList.remove('hidden');
    }
  }

  // Calculate and set total maintenance paid
  const totalMaintPaid = tenantPayments.filter(p => p.status === 'approved').reduce((s, p) => s + (p.maintenance_amount || 0), 0);
  const kpiMaintValEl = document.getElementById('kpi-maint-val');
  if (kpiMaintValEl) kpiMaintValEl.textContent = formatCurrency(totalMaintPaid);

  const kpiMaintCard = document.getElementById('kpi-maint-card');
  if (kpiMaintCard) {
    if (tenantData.maintenance_included) {
      kpiMaintCard.classList.add('hidden');
    } else {
      kpiMaintCard.classList.remove('hidden');
    }
  }

  // Current month dues (use next payment target month)
  const targetMonthYearStr = nextPaymentDate.toISOString().slice(0, 7);
  const targetMonthStr = formatMonthYear(targetMonthYearStr + '-01');
  document.getElementById('due-month').textContent = targetMonthStr;

  const needsAdvancePayment = !(
    (tenantData.advance_paid > 0) ||
    tenantPayments.some(p => (p.advance_amount || 0) > 0) ||
    tenantHistory.length > 1
  );
  const paymentsInCurrentRoom = tenantPayments.filter(p =>
    p.room_id === tenantData.room_id &&
    (p.status === 'approved' || p.status === 'pending')
  );
  const isFirstPaymentInCurrentRoom = paymentsInCurrentRoom.length === 0;

  // Use only APPROVED payments for meter reading baseline — same filter as submitPayment() to keep display and validation in sync
  const currentRoomHistory = tenantHistory.find(h => h.room_id === tenantData.room_id);
  const movedInDateStr = currentRoomHistory ? currentRoomHistory.moved_in : (tenantData.join_date || new Date().toISOString().split('T')[0]);
  const movedInMonth = movedInDateStr.slice(0, 7);
  const lastApprovedPayment = tenantPayments.find(p => p.status === 'approved' && p.room_id === tenantData.room_id && p.month_year >= movedInMonth);
  const lastPayment = tenantPayments.find(p => (p.status === 'approved' || p.status === 'pending') && p.room_id === tenantData.room_id && p.month_year >= movedInMonth);
  const currentReading = lastApprovedPayment ? lastApprovedPayment.curr_reading : (tenantData.initial_meter_reading || 0);

  const electricityIncluded = tenantData.electricity_included || false;
  let units = 0;
  let elecBill = 0;

  let totalDue = tenantData.rent + elecBill + tenantData.maintenance;
  if (needsAdvancePayment) {
    totalDue += (tenantData.advance_amount || 0);
  }

  // Update DOM for advance row and electric row visibility
  const dueAdvanceRow = document.getElementById('due-advance-row');
  const dueElecRow = document.getElementById('due-elec-row');
  const payAdvanceRow = document.getElementById('pay-advance-row');
  const payElecRow = document.getElementById('pay-elec-row');

  // Handle visibility based on maintenance_included
  const dueMaintRow = document.getElementById('due-maint-row');
  const payMaintRow = document.getElementById('pay-maint-row');
  if (tenantData.maintenance_included) {
    dueMaintRow?.classList.add('hidden');
    payMaintRow?.classList.add('hidden');
  } else {
    dueMaintRow?.classList.remove('hidden');
    payMaintRow?.classList.remove('hidden');
  }

  // Handle visibility based on electricity_included
  if (electricityIncluded) {
    dueElecRow?.classList.add('hidden');
    payElecRow?.classList.add('hidden');
    document.getElementById('meter-card')?.classList.add('hidden');
  } else {
    document.getElementById('meter-card')?.classList.remove('hidden');
    if (isFirstPaymentInCurrentRoom) {
      dueElecRow?.classList.add('hidden');
      payElecRow?.classList.add('hidden');
    } else {
      dueElecRow?.classList.remove('hidden');
      payElecRow?.classList.remove('hidden');
    }
  }

  if (needsAdvancePayment) {
    dueAdvanceRow?.classList.remove('hidden');
    payAdvanceRow?.classList.remove('hidden');

    if (document.getElementById('due-advance')) {
      document.getElementById('due-advance').textContent = formatCurrency(tenantData.advance_amount || 0);
    }
    if (document.getElementById('pay-advance')) {
      document.getElementById('pay-advance').textContent = formatCurrency(tenantData.advance_amount || 0);
    }
  } else {
    dueAdvanceRow?.classList.add('hidden');
    payAdvanceRow?.classList.add('hidden');
  }

  document.getElementById('due-rent').textContent = formatCurrency(tenantData.rent);
  document.getElementById('due-units').textContent = units;
  document.getElementById('due-rate').textContent = tenantData.electricity_rate;
  document.getElementById('due-elec').textContent = formatCurrency(elecBill);
  document.getElementById('due-maint').textContent = formatCurrency(tenantData.maintenance);
  document.getElementById('due-total').textContent = formatCurrency(totalDue);
  document.getElementById('owner-upi-display').textContent = tenantData.owner_upi;

  // Meter
  document.getElementById('meter-initial').textContent = tenantData.initial_meter_reading;
  document.getElementById('meter-current').textContent = currentReading;
  document.getElementById('meter-units').textContent = currentReading - tenantData.initial_meter_reading;

  // Payment tab
  document.getElementById('pay-rent').textContent = formatCurrency(tenantData.rent);
  document.getElementById('pay-maint').textContent = formatCurrency(tenantData.maintenance);
  document.getElementById('pay-upi-id').textContent = tenantData.owner_upi;

  // Set titles with month
  const detailsTitleEl = document.getElementById('pay-details-title');
  if (detailsTitleEl) {
    detailsTitleEl.textContent = 'Payment Details';
  }

  const payMeterSection = document.getElementById('pay-meter-section');
  if (isFirstPaymentInCurrentRoom || electricityIncluded) {
    payMeterSection?.classList.add('hidden');
    document.getElementById('pay-elec').textContent = formatCurrency(0);
    document.getElementById('pay-total').textContent = formatCurrency(totalDue);
    renderPaymentQRCode(totalDue);
  } else {
    payMeterSection?.classList.remove('hidden');

    // Set meter title with month
    const payMeterTitleEl = document.getElementById('pay-meter-title');
    if (payMeterTitleEl) {
      payMeterTitleEl.innerHTML = `
        <svg class="svg-icon" style="color: var(--warning); width: 14px; height: 14px;" viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
        Electricity Meter Reading
      `;
    }

    const joiningEl = document.getElementById('pay-joining-reading');
    if (joiningEl) {
      joiningEl.value = tenantData.initial_meter_reading || 0;
      const valEl = document.getElementById('pay-joining-reading-val');
      if (valEl) valEl.textContent = tenantData.initial_meter_reading || 0;
    }

    const prevEl = document.getElementById('pay-prev-reading');
    if (prevEl) {
      prevEl.value = currentReading;
      const valEl = document.getElementById('pay-prev-reading-val');
      if (valEl) valEl.textContent = currentReading;

      // Set previous reading month label
      const prevMonthDate = new Date(nextPaymentDate);
      prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
      const prevMonthStr = formatMonthYear(prevMonthDate.toISOString().slice(0, 7) + '-01');
      const prevLabelEl = document.getElementById('pay-prev-reading-label');
      if (prevLabelEl) {
        prevLabelEl.textContent = 'Prev Reading';
      }
    }

    const currEl = document.getElementById('pay-curr-reading');
    if (currEl) {
      // Clear the current reading value so they are forced to type it
      currEl.value = '';
    }

    // Call calculation to set initial electricity amount and total amount
    updatePaymentCalculation();
  }

  renderPaymentHistory();
  renderComplaints();

  // Set building, floor, room, owner key
  document.getElementById('info-bld-name').textContent = tenantData.building_name;
  const floorEl = document.getElementById('info-floor-number');
  if (floorEl) floorEl.textContent = getFloorLabel(tenantData.floor_number);
  document.getElementById('info-room-number').textContent = `Room ${tenantData.room_number}`;
  document.getElementById('info-owner-key').textContent = tenantData.owner_key || '—';

  // Conditional Electricity Rate / Maintenance Charge Details
  const elecRateWrapper = document.getElementById('info-elec-rate-wrapper');
  const elecRateVal = document.getElementById('info-elec-rate');
  if (elecRateWrapper && elecRateVal) {
    if (tenantData.electricity_included) {
      elecRateWrapper.classList.add('hidden');
    } else {
      elecRateWrapper.classList.remove('hidden');
      if (tenantData.electricity_subsidy_mode) {
        elecRateVal.textContent = `₹${tenantData.electricity_rate || 10}/unit (Subsidized: ₹${tenantData.electricity_subsidy_rate !== undefined ? tenantData.electricity_subsidy_rate : 0}/unit up to ${tenantData.electricity_subsidy_units !== undefined ? tenantData.electricity_subsidy_units : 1} units)`;
      } else {
        elecRateVal.textContent = `₹${tenantData.electricity_rate || 10}/unit`;
      }
    }
  }

  const maintChargeWrapper = document.getElementById('info-maint-charge-wrapper');
  const maintChargeVal = document.getElementById('info-maint-charge');
  if (maintChargeWrapper && maintChargeVal) {
    if (tenantData.maintenance_included || !tenantData.maintenance) {
      maintChargeWrapper.classList.add('hidden');
    } else {
      maintChargeWrapper.classList.remove('hidden');
      maintChargeVal.textContent = `₹${tenantData.maintenance}/mo`;
    }
  }

  // Roommates & Vacant beds list (removed)
  const roommatesSec = document.getElementById('roommates-section');
  const roommatesList = document.getElementById('roommates-list');
  const bedStatusEl = document.getElementById('info-bed-status');

  if (bedStatusEl) {
    bedStatusEl.textContent = 'Single Room';
  }
  if (roommatesSec) {
    roommatesSec.classList.add('hidden');
  }



  // Load members
  renderMyMembers();

  // Toggle vacate form vs submitted notice status dynamically
  const vacateForm = document.getElementById('vacate-form');
  const vacateSubmitted = document.getElementById('vacate-submitted');
  const vacateDateDisplay = document.getElementById('vacate-date-display');

  if (vacateForm && vacateSubmitted) {
    if (tenantData.status === 'vacating' && tenantData.vacate_date) {
      vacateForm.classList.add('hidden');
      vacateSubmitted.classList.remove('hidden');
      if (vacateDateDisplay) {
        vacateDateDisplay.textContent = formatDate(tenantData.vacate_date);
      }
    } else {
      vacateForm.classList.remove('hidden');
      vacateSubmitted.classList.add('hidden');
    }
  }
}

// ═══════════════ RENT SPLIT HELPERS ═══════════════
function getRentDisplay() {
  if (tenantData.rent_split_enabled && tenantData.per_bed_rent) {
    return tenantData.per_bed_rent;
  }
  return tenantData.rent;
}

function getElectricityDisplay(units) {
  const effectiveUnits = (tenantData.rent_split_enabled && tenantData.beds_occupied > 0)
    ? Math.round(units / tenantData.beds_occupied)
    : units;

  const normalRate = tenantData.electricity_rate || 10;

  if (tenantData.electricity_subsidy_mode) {
    const subsidyUnits = tenantData.electricity_subsidy_units !== undefined ? tenantData.electricity_subsidy_units : 1;
    const subsidyRate = tenantData.electricity_subsidy_rate !== undefined ? tenantData.electricity_subsidy_rate : 0;

    if (effectiveUnits <= subsidyUnits) {
      return effectiveUnits * subsidyRate;
    } else {
      return effectiveUnits * normalRate;
    }
  }

  return effectiveUnits * normalRate;
}

// ═══════════════ MY MEMBERS ═══════════════
let myMembers = [];

async function renderMyMembers() {
  if (!tenantData?.id) return;
  const listEl = document.getElementById('my-members-list');
  if (!listEl) return;

  try {
    const { data } = await supabase
      .from('members')
      .select('*')
      .eq('tenant_id', tenantData.id)
      .neq('is_active', false)
      .order('created_at', { ascending: true });

    myMembers = data || [];

    if (myMembers.length === 0) {
      listEl.innerHTML = `<div style="color: var(--text-muted); font-size: var(--font-xs); text-align: center; padding: 16px 0; display: flex; align-items: center; justify-content: center; gap: 6px;">${ICONS.users()} No members added yet.</div>`;
      return;
    }

    listEl.innerHTML = myMembers.map(m => `
      <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: var(--radius-sm); font-size: var(--font-xs);">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--primary-bg); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: var(--primary-light);">${m.name.charAt(0).toUpperCase()}</div>
        <div style="flex: 1;">
          <div style="font-weight: 600;">${m.name}</div>
          <div style="color: var(--text-muted);">${m.relation || '—'} ${m.phone ? '• ' + m.phone : ''}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('Failed to load members:', err);
  }
}

window.openMembersModal = async function () {
  await renderMyMembers();
  const modalList = document.getElementById('modal-members-list');
  if (!modalList) return;

  modalList.innerHTML = '';
  myMembers.forEach(m => addModalMemberRow(m));

  openModal('modal-members');
};

window.addModalMemberRow = function (existingMember = null) {
  const container = document.getElementById('modal-members-list');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'member-modal-row';
  div.dataset.memberId = existingMember?.id || '';
  div.style.cssText = 'background: var(--bg-elevated); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 10px; position: relative;';
  div.innerHTML = `
    <button onclick="this.closest('.member-modal-row').remove()" style="position:absolute;top:8px;right:8px;background:none;border:none;color:var(--text-muted);cursor:pointer;padding:4px 8px;border-radius:4px;display:flex;align-items:center;gap:4px;font-size:12px;" onmouseover="this.style.background='var(--danger)';this.style.color='white'" onmouseout="this.style.background='none';this.style.color='var(--text-muted)'">${ICONS.trash()} Remove</button>
    <div style="font-size:var(--font-xs);font-weight:700;color:var(--text-secondary);margin-bottom:10px;">Member</div>
    <div class="form-group">
      <input class="form-input" type="text" placeholder="Name *" data-field="name" value="${existingMember?.name || ''}" style="font-size:var(--font-sm);" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <input class="form-input" type="tel" placeholder="Phone *" data-field="phone" value="${existingMember?.phone || ''}" style="font-size:var(--font-sm);" />
      </div>
      <div class="form-group">
        <input class="form-input" type="text" placeholder="Relation" data-field="relation" value="${existingMember?.relation || ''}" style="font-size:var(--font-sm);" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom:0;">
      <input class="form-input" type="text" placeholder="Aadhaar *" data-field="aadhaar" value="${existingMember?.aadhaar_number || ''}" maxlength="14" style="font-size:var(--font-sm);" />
    </div>
  `;
  container.appendChild(div);

  const rows = container.querySelectorAll('.member-modal-row');
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    attachNameInput(lastRow.querySelector('[data-field="name"]'));
    attachPhoneInput(lastRow.querySelector('[data-field="phone"]'));
    attachAadhaarInput(lastRow.querySelector('[data-field="aadhaar"]'));
  }
};

window.saveMembers = async function () {
  const btn = document.querySelector('#modal-members .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  try {
    const newMembers = [];
    let memberErrors = [];
    const rows = document.querySelectorAll('.member-modal-row');

    rows.forEach((row, i) => {
      const name = row.querySelector('[data-field="name"]')?.value?.trim() || '';
      const phone = row.querySelector('[data-field="phone"]')?.value?.trim() || '';
      const relation = row.querySelector('[data-field="relation"]')?.value?.trim() || '';
      const aadhaar = row.querySelector('[data-field="aadhaar"]')?.value?.trim() || '';

      // Skip completely empty rows
      if (!name && !phone && !relation && !aadhaar) {
        return;
      }

      const nameErr = validateName(name);
      if (nameErr) memberErrors.push(`Member ${i + 1}: ${nameErr}`);

      const phoneErr = validatePhone(phone, true);
      if (phoneErr) memberErrors.push(`Member ${i + 1}: ${phoneErr}`);

      const aadhaarErr = validateAadhaar(aadhaar, true);
      if (aadhaarErr) memberErrors.push(`Member ${i + 1}: ${aadhaarErr}`);

      newMembers.push({ name, phone, relation, aadhaar_number: aadhaar, is_active: true, tenant_id: tenantData.id });
    });

    if (memberErrors.length > 0) {
      showToast('Validation Error', memberErrors[0], 'warning');
      if (btn) { btn.disabled = false; btn.textContent = 'Save Members'; }
      return;
    }

    // Delete all existing members for this tenant
    const { error: deleteErr } = await supabase.from('members').delete().eq('tenant_id', tenantData.id);
    if (deleteErr) throw deleteErr;

    // Update living_type based on whether new members are added
    const newLivingType = newMembers.length > 0 ? 'family' : 'alone';
    const { error: updateErr } = await supabase.from('tenants').update({ living_type: newLivingType }).eq('id', tenantData.id);
    if (updateErr) throw updateErr;
    tenantData.living_type = newLivingType;

    if (newMembers.length > 0) {
      const { error: insertErr } = await supabase.from('members').insert(newMembers);
      if (insertErr) throw insertErr;
    }

    showToast('Members Saved!', 'Your member list has been updated.', 'success');
    closeModal('modal-members');
    renderMyMembers();
  } catch (err) {
    showToast('Error', 'Failed to save members: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Members'; }
  }
};




function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('hidden');
    void modal.offsetWidth; // Force reflow
    modal.classList.add('active');
  }
}
window.openModal = openModal;

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    setTimeout(() => {
      if (!modal.classList.contains('active')) {
        modal.classList.add('hidden');
      }
    }, 400);
  }
}
window.closeModal = closeModal;

// ═══════════════ UPI PAYMENT QR GENERATION ═══════════════
function renderPaymentQRCode(amount) {
  const qrContainer = document.getElementById('payment-qrcode');
  const qrPlaceholder = document.getElementById('payment-qr-placeholder');
  const qrBox = document.getElementById('payment-qrcode-container');
  const upiBtn = document.getElementById('mobile-upi-pay-btn');

  if (!qrContainer) return;

  if (tenantData && tenantData.owner_upi) {
    qrContainer.innerHTML = '';

    // Generate UPI URI with dynamic transaction note including room number
    const noteText = `PG Rent Room ${tenantData.room_number || ''}`.trim();
    const upiUri = `upi://pay?pa=${tenantData.owner_upi}&pn=${encodeURIComponent(tenantData.owner_name || 'PG Owner')}&am=${amount}&cu=INR&tn=${encodeURIComponent(noteText)}`;

    if (upiBtn) {
      upiBtn.href = upiUri;
      upiBtn.style.display = 'flex';
    }

    try {
      new QRCode(qrContainer, {
        text: upiUri,
        width: 150,
        height: 150,
        colorDark: '#0f0f1a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
      });
      qrBox?.classList.remove('hidden');
      qrPlaceholder?.classList.add('hidden');
    } catch (err) {
      console.error('Failed to generate payment QR code:', err);
      qrBox?.classList.add('hidden');
      qrPlaceholder?.classList.remove('hidden');
    }
  } else {
    qrBox?.classList.add('hidden');
    qrPlaceholder?.classList.remove('hidden');
    if (upiBtn) {
      upiBtn.href = '#';
      upiBtn.style.display = 'none';
    }
  }
}

// Update mobile UPI button display on window resize
window.addEventListener('resize', () => {
  const upiBtn = document.getElementById('mobile-upi-pay-btn');
  if (upiBtn && upiBtn.getAttribute('href') !== '#') {
    upiBtn.style.display = 'flex';
  }
});

// Helper to find the room details the tenant was in during a given month
function getRoomDetailsForMonth(monthYear) {
  // If target month is current or future relative to current room's occupancy, return current details directly
  const currentRoomHistory = tenantHistory.find(h => h.room_id === tenantData.room_id);
  const movedInDateStr = currentRoomHistory ? currentRoomHistory.moved_in : (tenantData.join_date || new Date().toISOString().split('T')[0]);
  const movedInMonth = movedInDateStr.slice(0, 7);

  if (monthYear >= movedInMonth) {
    return {
      room_id: tenantData.room_id,
      room_number: tenantData.room_number,
      building_id: tenantData.building_id,
      building_name: tenantData.building_name
    };
  }

  if (!tenantHistory || tenantHistory.length === 0) {
    return {
      room_id: tenantData.room_id,
      room_number: tenantData.room_number,
      building_id: tenantData.building_id,
      building_name: tenantData.building_name
    };
  }

  const firstDayStr = `${monthYear}-01`;
  const [year, month] = monthYear.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const lastDayStr = `${monthYear}-${String(lastDay).padStart(2, '0')}`;

  const record = tenantHistory.find(h => {
    const movedIn = h.moved_in;
    const movedOut = h.moved_out;
    return movedIn <= lastDayStr && (!movedOut || movedOut >= firstDayStr);
  });

  if (record) {
    return {
      room_id: record.room_id,
      room_number: record.room_number,
      building_id: record.building_id,
      building_name: record.building_name
    };
  }

  return {
    room_id: tenantData.room_id,
    room_number: tenantData.room_number,
    building_id: tenantData.building_id,
    building_name: tenantData.building_name
  };
}

// ═══════════════ PAYMENT CALCULATION ═══════════════
window.updatePaymentCalculation = function () {
  const paymentsInCurrentRoom = tenantPayments.filter(p =>
    p.room_id === tenantData.room_id &&
    (p.status === 'approved' || p.status === 'pending')
  );
  const isFirstPaymentInCurrentRoom = paymentsInCurrentRoom.length === 0;
  const electricityIncluded = tenantData?.electricity_included || false;
  if (isFirstPaymentInCurrentRoom || electricityIncluded) return;

  const prevEl = document.getElementById('pay-prev-reading');
  const currEl = document.getElementById('pay-curr-reading');
  const errorEl = document.getElementById('pay-meter-error');
  const calcUnitsEl = document.getElementById('pay-calc-units');
  const calcSplitInfoEl = document.getElementById('pay-calc-split-info');
  const calcRateEl = document.getElementById('pay-calc-rate');
  const calcElecEl = document.getElementById('pay-calc-elec');
  const payElecEl = document.getElementById('pay-elec');
  const payTotalEl = document.getElementById('pay-total');
  const submitBtn = document.querySelector('#tab-payment button.btn-success');

  if (!currEl || !prevEl) return;

  const prevReading = parseFloat(prevEl.value) || 0;
  const currReading = parseFloat(currEl.value);

  // If blank or invalid, disable payment or handle gracefully
  if (isNaN(currReading)) {
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = 'Please enter a valid current reading.';
    }
    if (submitBtn) submitBtn.disabled = true;
    if (payElecEl) payElecEl.textContent = formatCurrency(0);
    if (calcUnitsEl) calcUnitsEl.textContent = '0';
    if (calcElecEl) calcElecEl.textContent = formatCurrency(0);

    // Recalculate total with 0 electricity
    const rent = tenantData.rent;
    const maint = tenantData.maintenance !== undefined && tenantData.maintenance !== null ? tenantData.maintenance : 500;
    const totalDue = rent + maint;
    if (payTotalEl) payTotalEl.textContent = formatCurrency(totalDue);
    renderPaymentQRCode(totalDue);
    return;
  }

  if (currReading < prevReading) {
    if (errorEl) {
      errorEl.classList.remove('hidden');
      errorEl.textContent = 'Current reading must be greater than or equal to previous reading.';
    }
    if (submitBtn) submitBtn.disabled = true;
    if (payElecEl) payElecEl.textContent = formatCurrency(0);
    if (calcUnitsEl) calcUnitsEl.textContent = '0';
    if (calcElecEl) calcElecEl.textContent = formatCurrency(0);

    // Recalculate total with 0 electricity
    const rent = tenantData.rent;
    const maint = tenantData.maintenance !== undefined && tenantData.maintenance !== null ? tenantData.maintenance : 500;
    const totalDue = rent + maint;
    if (payTotalEl) payTotalEl.textContent = formatCurrency(totalDue);
    renderPaymentQRCode(totalDue);
    return;
  }

  // Clear error, enable submit button
  if (errorEl) errorEl.classList.add('hidden');
  if (submitBtn) submitBtn.disabled = false;

  const units = currReading - prevReading;
  if (calcUnitsEl) calcUnitsEl.textContent = units;

  const elecBill = getElectricityDisplay(units);

  if (calcElecEl) calcElecEl.textContent = formatCurrency(elecBill);
  if (payElecEl) payElecEl.textContent = formatCurrency(elecBill);

  // Split details display
  if (calcSplitInfoEl) {
    if (tenantData.rent_split_enabled && tenantData.beds_occupied > 0) {
      calcSplitInfoEl.textContent = `(Split: /${tenantData.beds_occupied} beds = ${Math.round(units / tenantData.beds_occupied)} units)`;
    } else {
      calcSplitInfoEl.textContent = '';
    }
  }

  if (calcRateEl) {
    if (tenantData.electricity_subsidy_mode) {
      const subsidyUnits = tenantData.electricity_subsidy_units !== undefined ? tenantData.electricity_subsidy_units : 1;
      const subsidyRate = tenantData.electricity_subsidy_rate !== undefined ? tenantData.electricity_subsidy_rate : 0;
      const effectiveUnits = (tenantData.rent_split_enabled && tenantData.beds_occupied > 0)
        ? Math.round(units / tenantData.beds_occupied)
        : units;

      if (effectiveUnits <= subsidyUnits) {
        calcRateEl.textContent = `${subsidyRate} (Subsidized)`;
      } else {
        calcRateEl.textContent = `${tenantData.electricity_rate || 10} (Normal - Limit of ${subsidyUnits} units exceeded)`;
      }
    } else {
      calcRateEl.textContent = tenantData.electricity_rate || 10;
    }
  }

  // Update Grand Total
  const rent = tenantData.rent;
  const maint = tenantData.maintenance !== undefined && tenantData.maintenance !== null ? tenantData.maintenance : 500;
  const total = rent + elecBill + maint;
  if (payTotalEl) payTotalEl.textContent = formatCurrency(total);
  renderPaymentQRCode(total);
};

// ═══════════════ PAYMENT SUBMISSION ═══════════════
window.submitPayment = async function () {
  const method = document.getElementById('pay-method').value;
  const txnInput = document.getElementById('pay-txn').value.trim();

  if (!txnInput) {
    showToast('UTR/Transaction ID Required', 'Please enter the 12-digit UPI UTR / Ref No. first.', 'error');
    return;
  }

  const utrPattern = /^\d{12}$/;
  if (!utrPattern.test(txnInput)) {
    showToast('Invalid UTR', 'Transaction ID / UTR must be exactly 12 digits (numeric only).', 'error');
    return;
  }

  const txnId = txnInput;

  const needsAdvancePayment = !(
    (tenantData.advance_paid > 0) ||
    tenantPayments.some(p => (p.advance_amount || 0) > 0) ||
    tenantHistory.length > 1
  );
  const paymentsInCurrentRoom = tenantPayments.filter(p =>
    p.room_id === tenantData.room_id &&
    (p.status === 'approved' || p.status === 'pending')
  );
  const isFirstPaymentInCurrentRoom = paymentsInCurrentRoom.length === 0;

  const electricityIncluded = tenantData.electricity_included || false;
  // Use ONLY approved payments for the meter reading baseline — pending payments may have stale/zero readings
  const currentRoomHistory = tenantHistory.find(h => h.room_id === tenantData.room_id);
  const movedInDateStr = currentRoomHistory ? currentRoomHistory.moved_in : (tenantData.join_date || new Date().toISOString().split('T')[0]);
  const movedInMonth = movedInDateStr.slice(0, 7);
  const lastApprovedPayment = tenantPayments.find(p => p.status === 'approved' && p.room_id === tenantData.room_id && p.month_year >= movedInMonth);
  const currentReading = lastApprovedPayment ? lastApprovedPayment.curr_reading : (tenantData.initial_meter_reading || 0);

  let units = 0;
  let elecBill = 0;
  let newReading = currentReading;
  if (!isFirstPaymentInCurrentRoom && !electricityIncluded) {
    const currInput = document.getElementById('pay-curr-reading');
    newReading = currInput ? parseFloat(currInput.value) : currentReading;
    if (isNaN(newReading) || newReading < currentReading) {
      showToast('Invalid Reading', 'Please enter a valid current meter reading that is greater than the previous reading (' + currentReading + ').', 'error');
      return;
    }
    units = newReading - currentReading;
    elecBill = getElectricityDisplay(units);
  }

  let total = tenantData.rent + elecBill + (tenantData.maintenance !== undefined && tenantData.maintenance !== null ? tenantData.maintenance : 500);
  let advanceAmount = 0;
  if (needsAdvancePayment) {
    advanceAmount = tenantData.advance_amount !== undefined && tenantData.advance_amount !== null ? tenantData.advance_amount : 5000;
    total += advanceAmount;
  }

  const btn = document.querySelector('#tab-payment button.btn-success');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting Payment...';

  let success = false;
  try {
    const targetMonth = (() => {
      const joinDate = tenantData.join_date ? new Date(tenantData.join_date) : new Date();
      const submittedPaymentsCount = tenantPayments.filter(p => p.status === 'approved' || p.status === 'pending').length;
      const targetDate = new Date(joinDate);
      targetDate.setMonth(targetDate.getMonth() + submittedPaymentsCount);
      return targetDate.toISOString().slice(0, 7);
    })();

    const targetRoomDetails = getRoomDetailsForMonth(targetMonth);

    const localDateStr = (() => {
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    })();

    const { error } = await supabase
      .from('payments')
      .insert({
        tenant_id: tenantData.id,
        building_id: targetRoomDetails.building_id,
        room_id: targetRoomDetails.room_id,
        owner_id: tenantData.owner_id,
        tenant_name: tenantData.name,
        room_number: targetRoomDetails.room_number,
        building_name: targetRoomDetails.building_name,
        month_year: targetMonth,
        rent_amount: tenantData.rent,
        electricity_amount: elecBill,
        maintenance_amount: tenantData.maintenance !== undefined && tenantData.maintenance !== null ? tenantData.maintenance : 500,
        advance_amount: advanceAmount,
        total_amount: total,
        prev_reading: currentReading,
        curr_reading: newReading,
        units_consumed: units,
        payment_method: method,
        transaction_id: txnId,
        status: 'pending',
        payment_date: localDateStr
      });

    if (error) throw error;

    success = true;

    await loadRealData();
    renderPaymentHistory();
    renderDashboard();

    showToast('Payment Submitted!', `${formatCurrency(total)} via ${method}. Pending owner approval.`, 'payment');

    // Save active tab as history so it loads the history tab on refresh
    localStorage.setItem('pgb_tenant_active_tab', 'history');

    // Reload the page after a short delay so user can see toast, and UI locks completely
    setTimeout(() => {
      location.reload();
    }, 1500);
  } catch (err) {
    console.error('Error submitting payment:', err);
    showToast('Error', 'Failed to submit payment: ' + err.message, 'error');
  } finally {
    if (!success) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

function renderPaymentHistory() {
  const tbody = document.getElementById('history-table-body');

  if (tenantPayments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted" style="padding: 24px;">No payments yet</td></tr>';
    return;
  }

  // Stats
  const approved = tenantPayments.filter(p => p.status === 'approved');
  const totalPaid = approved.reduce((s, p) => s + p.total_amount, 0);
  document.getElementById('hist-total').textContent = formatCurrency(totalPaid);
  document.getElementById('hist-months').textContent = approved.length;
  document.getElementById('hist-count').textContent = tenantPayments.length;

  tbody.innerHTML = tenantPayments.map(p => {
    let badge = 'badge-warning';
    if (p.status === 'approved') badge = 'badge-success';
    if (p.status === 'rejected') badge = 'badge-danger';

    const receiptBtn = p.status === 'approved'
      ? `<button class="btn btn-ghost btn-sm" onclick="window.downloadReceipt('${p.id}')" style="display:inline-flex; align-items:center; gap:4px;">${ICONS.fileText()} PDF</button>`
      : `<span class="text-muted" style="font-size: var(--font-xs);">${p.status === 'rejected' ? 'Rejected' : 'Pending'}</span>`;

    // Resolve Floor Number
    let floorNum = '—';
    if (p.room_id === tenantData.room_id) {
      floorNum = tenantData.floor_number || '—';
    }

    const breakdown = `Rent: ${formatCurrency(p.rent_amount || 0)} • Elec: ${formatCurrency(p.electricity_amount || 0)} • Maint: ${formatCurrency(p.maintenance_amount || 0)}${p.advance_amount ? ` • Adv: ${formatCurrency(p.advance_amount)}` : ''}`;

    return `<tr>
      <td>${p.tenant_name || tenantData.name || 'Tenant'}</td>
      <td>${p.building_name || tenantData.building_name || '—'}</td>
      <td>${floorNum}</td>
      <td>${p.room_number || tenantData.room_number || '—'}</td>
      <td>${formatDate(p.payment_date || p.created_at)}</td>
      <td><strong>${formatCurrency(p.total_amount)}</strong></td>
      <td style="font-size: 11px; color: var(--text-secondary); white-space: nowrap;">${breakdown}</td>
      <td>${p.payment_method}</td>
      <td><code style="font-size: var(--font-xs);">${p.transaction_id}</code></td>
      <td><span class="badge ${badge}">${p.status.toUpperCase()}</span></td>
      <td>${receiptBtn}</td>
    </tr>`;
  }).join('');
}

window.downloadReceipt = function (paymentId) {
  const payment = tenantPayments.find(p => p.id === paymentId);
  if (!payment) return;

  generateReceiptPDF({
    tenantName: tenantData.name,
    roomNumber: tenantData.room_number,
    buildingName: tenantData.building_name,
    month: formatMonthYear(payment.month_year + '-01'),
    rent: payment.rent_amount,
    advance: payment.advance_amount,
    electricity: payment.electricity_amount,
    maintenance: payment.maintenance_amount,
    total: payment.total_amount,
    txnId: payment.transaction_id,
    date: formatDate(payment.payment_date || payment.created_at || new Date()),
    method: payment.payment_method
  });

  showToast('Receipt Downloaded!', `PDF receipt for ${formatMonthYear(payment.month_year + '-01')}`, 'success');
};

// ═══════════════ COMPLAINTS ═══════════════
window.submitComplaint = async function () {
  const category = document.getElementById('comp-category').value;
  const desc = document.getElementById('comp-desc').value.trim();

  if (!desc) {
    showToast('Missing Details', 'Please describe the issue', 'warning');
    return;
  }

  if (!tenantData?.owner_id) {
    showToast('Error', 'Owner info not loaded. Please refresh and try again.', 'error');
    return;
  }

  try {
    const insertPayload = {
      tenant_id: tenantData.id,
      building_id: tenantData.building_id,
      owner_id: tenantData.owner_id,
      category,
      description: desc,
      status: 'open'
    };
    console.log('[Complaint] Submitting:', insertPayload);

    const { data: inserted, error } = await supabase
      .from('complaints')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      console.error('[Complaint] Insert error:', error.message, error.details, error.hint, error.code);
      throw error;
    }

    console.log('[Complaint] Submitted successfully:', inserted);
    document.getElementById('comp-desc').value = '';
    await loadRealData();
    renderComplaints();
    showToast('Complaint Filed!', `${category} complaint sent to owner`, 'success');
  } catch (err) {
    console.error('Error submitting complaint:', err);
    showToast('Error', 'Failed to file complaint: ' + (err.message || 'Unknown error'), 'error');
  }
};

function renderComplaints() {
  const container = document.getElementById('complaints-list');

  if (tenantComplaints.length === 0) {
    container.innerHTML = `<div class="empty-state" style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 24px;">
      <div class="empty-state-icon" style="margin-bottom:8px; color: var(--text-muted);">${ICONS.info('', '', '36px')}</div>
      <div class="empty-state-desc">No complaints filed yet</div>
    </div>`;
    return;
  }

  container.innerHTML = tenantComplaints.map(c => {
    const badgeMap = { open: 'badge-danger', in_progress: 'badge-warning', resolved: 'badge-success' };
    return `
      <div style="padding: 14px; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
          <strong style="font-size: var(--font-sm);">${c.category}</strong>
          <span class="badge ${badgeMap[c.status] || 'badge-neutral'}">${c.status.replace('_', ' ').toUpperCase()}</span>
        </div>
        <p style="font-size: var(--font-xs); color: var(--text-muted); margin-bottom: 4px;">${c.description}</p>
        <span style="font-size: var(--font-xs); color: var(--text-muted);">${formatDate(c.created_at)}</span>
      </div>`;
  }).join('');
}

// ═══════════════ VACATE NOTICE ═══════════════
// ── Vacate Notice ──
window.submitVacateNotice = async function () {
  const reason = document.getElementById('vacate-reason').value.trim();
  const date = document.getElementById('vacate-date').value;

  if (!reason || !date) {
    showToast('Missing Fields', 'Please fill reason and checkout date', 'warning');
    return;
  }

  try {
    // 1. Insert notice in vacate_notices
    const { error: noticeErr } = await supabase
      .from('vacate_notices')
      .insert({
        tenant_id: tenantData.id,
        building_id: tenantData.building_id,
        owner_id: tenantData.owner_id,
        reason,
        preferred_date: date,
        deposit_amount: tenantData.advance_paid || 0,
        status: 'submitted'
      });

    if (noticeErr) throw noticeErr;

    // 2. Update status of tenant to 'vacating'
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        status: 'vacating',
        vacate_date: date
      })
      .eq('id', tenantData.id);

    if (tenantErr) throw tenantErr;

    document.getElementById('vacate-date-display').textContent = formatDate(date);
    document.getElementById('vacate-form').classList.add('hidden');
    document.getElementById('vacate-submitted').classList.remove('hidden');

    showToast('Vacate Notice Sent!', 'Owner has been notified. Your deposit will be processed.', 'success');

    await loadRealData();
  } catch (err) {
    console.error('Error submitting vacate notice:', err);
    showToast('Error', 'Failed to send vacate notice: ' + err.message, 'error');
  }
};

window.cancelVacateNotice = async function () {
  if (!confirm('Are you sure you want to cancel your vacate notice? (क्या आप वाकई खाली करने का नोटिस रद्द करना चाहते हैं?)')) {
    return;
  }

  const btn = document.getElementById('btn-cancel-vacate');
  let originalText = '';
  if (btn) {
    originalText = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Cancelling...';
  }

  try {
    // 1. Delete from vacate_notices where status is submitted
    const { error: noticeErr } = await supabase
      .from('vacate_notices')
      .delete()
      .eq('tenant_id', tenantData.id)
      .eq('status', 'submitted');

    if (noticeErr) throw noticeErr;

    // 2. Revert tenant status to 'active' and vacate_date to null
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        status: 'active',
        vacate_date: null
      })
      .eq('id', tenantData.id);

    if (tenantErr) throw tenantErr;

    // Clear form fields
    const reasonInput = document.getElementById('vacate-reason');
    const dateInput = document.getElementById('vacate-date');
    if (reasonInput) reasonInput.value = '';
    if (dateInput) dateInput.value = '';

    showToast('Notice Cancelled', 'Your vacate notice has been cancelled.', 'success');

    // Reload data and UI
    await loadRealData();
    renderDashboard();
  } catch (err) {
    console.error('Error cancelling vacate notice:', err);
    showToast('Error', 'Failed to cancel vacate notice: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
};

// ── Re-registration Block Screen Handlers ──
let blockSelectedOwner = null;
let blockSelectedBuilding = null;
let blockSelectedRoom = null;

// Reusable demo buildings for block flow lookup
const blockDemoBuildings = [
  {
    id: 'b1', name: 'Oxford Heights PG', location: 'Sector 15, Noida', type: 'pg',
    electricity_rate: 10, advance_amount: 5000, maintenance_charge: 500, electricity_included: false,
    floors: [
      {
        id: 'f1', floor_number: 1, rooms: [
          { id: 'r1', room_number: '101', rent: 8000, beds_count: 3, beds_occupied: 2, status: 'partial' },
          { id: 'r2', room_number: '102', rent: 8000, beds_count: 3, beds_occupied: 3, status: 'occupied' },
          { id: 'r3', room_number: '103', rent: 8000, beds_count: 3, beds_occupied: 0, status: 'vacant' },
          { id: 'r4', room_number: '104', rent: 8500, beds_count: 2, beds_occupied: 1, status: 'partial' },
          { id: 'r5', room_number: '105', rent: 8000, beds_count: 3, beds_occupied: 3, status: 'occupied' },
        ]
      },
      {
        id: 'f2', floor_number: 2, rooms: [
          { id: 'r6', room_number: '201', rent: 9000, beds_count: 2, beds_occupied: 0, status: 'vacant' },
          { id: 'r7', room_number: '202', rent: 9000, beds_count: 2, beds_occupied: 2, status: 'occupied' },
          { id: 'r8', room_number: '203', rent: 9000, beds_count: 2, beds_occupied: 1, status: 'partial' },
        ]
      }
    ]
  },
  {
    id: 'b2', name: 'Skyline Apartment', location: 'MG Road, Gurgaon', type: 'apartment',
    electricity_rate: 12, advance_amount: 10000, maintenance_charge: 800, electricity_included: false,
    floors: [
      {
        id: 'f3', floor_number: 1, rooms: [
          { id: 'r9', room_number: 'A101', rent: 12000, beds_count: 1, beds_occupied: 1, status: 'occupied' },
          { id: 'r10', room_number: 'A102', rent: 12000, beds_count: 1, beds_occupied: 0, status: 'vacant' },
        ]
      },
      {
        id: 'f4', floor_number: 2, rooms: [
          { id: 'r11', room_number: 'A201', rent: 13000, beds_count: 1, beds_occupied: 1, status: 'occupied' },
          { id: 'r12', room_number: 'A202', rent: 13000, beds_count: 1, beds_occupied: 0, status: 'vacant' },
        ]
      }
    ]
  }
];

window.handleBlockFindOwner = async function () {
  const key = document.getElementById('block-tenant-key').value.trim().toUpperCase();

  if (!key) {
    showToast('Enter Key', 'Please enter the Owner Key', 'warning');
    return;
  }

  try {
    // Real Supabase query
    const { data: owner, error } = await supabase.from('owners').select('*').eq('owner_key', key).maybeSingle();
    if (error || !owner) throw new Error('Not found');
    blockSelectedOwner = owner;

    const { data: buildings } = await supabase
      .from('buildings')
      .select('*, floors(*, rooms(*))')
      .eq('owner_id', owner.id)
      .order('created_at', { ascending: true });

    blockSelectedOwner.buildings = buildings || [];
    populateBlockBuildings(blockSelectedOwner.buildings);
    document.getElementById('block-owner-name').textContent = owner.name;
    document.getElementById('block-step-key').classList.add('hidden');
    document.getElementById('block-step-select').classList.remove('hidden');
    showToast('Owner Found!', `${owner.name}`, 'success');

  } catch (err) {
    showToast('Not Found', 'No owner found with this key. Please check and try again.', 'error');
  }
};

function populateBlockBuildings(buildingsList) {
  const sel = document.getElementById('block-sel-building');
  sel.innerHTML = '<option value="">— Choose Building —</option>';

  buildingsList.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.name} (${b.type.toUpperCase()}) — ${b.location}`;
    sel.appendChild(opt);
  });
}

window.onBlockBuildingChange = function () {
  const buildingId = document.getElementById('block-sel-building').value;
  const floorGroup = document.getElementById('block-floor-group');
  const roomGroup = document.getElementById('block-room-group');
  const roomDetails = document.getElementById('block-room-details');

  floorGroup.classList.add('hidden');
  roomGroup.classList.add('hidden');
  roomDetails.classList.add('hidden');

  if (!buildingId) return;

  blockSelectedBuilding = blockSelectedOwner.buildings.find(b => b.id === buildingId);
  if (!blockSelectedBuilding) return;

  const floors = blockSelectedBuilding.floors || [];
  const floorSel = document.getElementById('block-sel-floor');
  floorSel.innerHTML = '<option value="">— Choose Floor —</option>';

  floors.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = getFloorLabel(f.floor_number);
    floorSel.appendChild(opt);
  });

  floorGroup.classList.remove('hidden');
};

window.onBlockFloorChange = function () {
  const floorId = document.getElementById('block-sel-floor').value;
  const roomGroup = document.getElementById('block-room-group');
  const roomDetails = document.getElementById('block-room-details');

  roomGroup.classList.add('hidden');
  roomDetails.classList.add('hidden');

  if (!floorId || !blockSelectedBuilding) return;

  const floor = blockSelectedBuilding.floors.find(f => f.id === floorId);
  if (!floor) return;

  const roomSel = document.getElementById('block-sel-room');
  roomSel.innerHTML = '<option value="">— Choose Room —</option>';

  const floorRooms = (floor.rooms || []).concat(
    (blockSelectedBuilding.rooms || []).filter(r => r.floor_id === floorId)
  );
  const uniqueRoomsMap = new Map();
  floorRooms.forEach(r => uniqueRoomsMap.set(r.id, r));
  const rooms = Array.from(uniqueRoomsMap.values());

  rooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    const isPG = ['pg', 'hostel'].includes(blockSelectedBuilding.type);
    let label = `Room ${r.room_number} — ${formatCurrency(r.rent)}/mo`;

    if (isPG) {
      const bedsAvail = r.beds_count - r.beds_occupied;
      if (bedsAvail <= 0) {
        label += ' (FULL)';
        opt.disabled = true;
      } else {
        label += ` (${bedsAvail} bed${bedsAvail > 1 ? 's' : ''} available)`;
      }
    } else {
      if (r.status === 'occupied') {
        label += ' (OCCUPIED)';
        opt.disabled = true;
      }
    }

    opt.textContent = label;
    roomSel.appendChild(opt);
  });

  roomGroup.classList.remove('hidden');
};

window.onBlockRoomChange = function () {
  const roomId = document.getElementById('block-sel-room').value;
  const roomDetails = document.getElementById('block-room-details');

  if (!roomId) {
    roomDetails.classList.add('hidden');
    return;
  }

  let room = (blockSelectedBuilding.rooms || []).find(r => r.id === roomId);
  if (!room) {
    for (const floor of blockSelectedBuilding.floors) {
      room = (floor.rooms || []).find(r => r.id === roomId);
      if (room) break;
    }
  }

  if (!room) return;
  blockSelectedRoom = room;

  document.getElementById('block-room-rent').textContent = formatCurrency(room.rent);

  const blockAdvanceAmount = room.advance_amount !== undefined && room.advance_amount !== null ? room.advance_amount : (blockSelectedBuilding.advance_amount !== undefined && blockSelectedBuilding.advance_amount !== null ? blockSelectedBuilding.advance_amount : (blockSelectedOwner.default_advance !== undefined && blockSelectedOwner.default_advance !== null ? blockSelectedOwner.default_advance : 5000));
  document.getElementById('block-room-advance').textContent = formatCurrency(blockAdvanceAmount);

  const maintIncluded = room.maintenance_included !== undefined ? room.maintenance_included : (blockSelectedBuilding.maintenance_included || false);
  const maintCharge = room.maintenance_charge !== undefined && room.maintenance_charge !== null ? room.maintenance_charge : (blockSelectedBuilding.maintenance_charge !== undefined && blockSelectedBuilding.maintenance_charge !== null ? blockSelectedBuilding.maintenance_charge : (blockSelectedOwner.default_maintenance !== undefined && blockSelectedOwner.default_maintenance !== null ? blockSelectedOwner.default_maintenance : 500));
  const blockMaintEl = document.getElementById('block-room-maint');
  if (blockMaintEl) {
    blockMaintEl.textContent = maintIncluded ? 'Included' : formatCurrency(maintCharge);
  }

  document.getElementById('block-room-type').textContent = blockSelectedBuilding.type.toUpperCase();
  roomDetails.classList.remove('hidden');

  // Hide or show initial meter reading field based on electricity_included
  const meterGroup = document.getElementById('block-info-meter-group');
  if (meterGroup) {
    const elecIncluded = room.electricity_included || blockSelectedBuilding.electricity_included || false;
    if (elecIncluded) {
      meterGroup.classList.add('hidden');
      const input = document.getElementById('block-info-meter');
      if (input) input.value = '';
    } else {
      meterGroup.classList.remove('hidden');
    }
  }
};

window.goBackToBlockKey = function () {
  document.getElementById('block-step-select').classList.add('hidden');
  document.getElementById('block-step-key').classList.remove('hidden');
};

let blockMembers = [];

window.goToBlockInfoStep = async function () {
  if (!blockSelectedRoom) {
    showToast('Select Room', 'Please choose building and room', 'warning');
    return;
  }

  // Hide select step, show info step
  document.getElementById('block-step-select').classList.add('hidden');
  document.getElementById('block-step-info').classList.remove('hidden');

  // Prefill details
  const nameInput = document.getElementById('block-info-name');
  const phoneInput = document.getElementById('block-info-phone');
  const altPhoneInput = document.getElementById('block-info-alt-phone');
  const aadhaarInput = document.getElementById('block-info-aadhaar');

  if (tenantData) {
    if (nameInput) nameInput.value = tenantData.name || '';
    if (phoneInput) phoneInput.value = tenantData.phone || '';
    if (altPhoneInput) altPhoneInput.value = tenantData.alt_phone || '';
    if (aadhaarInput) aadhaarInput.value = tenantData.aadhaar_number || '';
  } else {
    const session = await getSession();
    if (session && nameInput) {
      nameInput.value = session.user.user_metadata?.name || '';
    }
  }

  // Attach input formatting filters
  attachNameInput(nameInput);
  attachPhoneInput(phoneInput);
  attachPhoneInput(altPhoneInput);
  attachAadhaarInput(aadhaarInput);
};

window.goBackToBlockSelect = function () {
  document.getElementById('block-step-info').classList.add('hidden');
  document.getElementById('block-step-select').classList.remove('hidden');
};

window.toggleBlockMembersSection = function () {
  const livingType = document.querySelector('input[name="block-living-type"]:checked').value;
  const section = document.getElementById('block-members-section');
  if (livingType === 'family') {
    section.classList.remove('hidden');
    if (blockMembers.length === 0) addBlockMemberRow();
  } else {
    section.classList.add('hidden');
  }
};

window.addBlockMemberRow = function () {
  const idx = blockMembers.length;
  blockMembers.push({ name: '', phone: '', aadhaar: '', relation: '' });

  const container = document.getElementById('block-members-list');
  const div = document.createElement('div');
  div.className = 'member-row';
  div.style.cssText = 'background: var(--bg-input); border: 1px solid var(--border-input); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px;';
  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-size: var(--font-xs); font-weight: 600; color: var(--text-secondary);">Member ${idx + 1}</span>
      <button class="btn btn-sm btn-ghost" onclick="window.removeBlockMember(this, ${idx})" style="color: var(--danger); font-size: 12px; padding: 2px 6px; display: flex; align-items: center; gap: 4px;">${ICONS.trash()} Remove</button>
    </div>
    <div class="form-group" style="margin-bottom: 8px;">
      <input class="form-input" type="text" placeholder="Member Name *" data-block-member="${idx}" data-field="name" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
    </div>
    <div class="form-row" style="gap: 8px; margin-bottom: 8px;">
      <div class="form-group" style="margin-bottom: 0;">
        <input class="form-input" type="tel" placeholder="Phone *" data-block-member="${idx}" data-field="phone" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <input class="form-input" type="text" placeholder="Relation" data-block-member="${idx}" data-field="relation" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom: 0;">
      <input class="form-input" type="text" placeholder="Aadhaar Number *" data-block-member="${idx}" data-field="aadhaar" maxlength="14" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
    </div>
  `;
  container.appendChild(div);

  // Attach formatting
  const rows = container.querySelectorAll('.member-row');
  const lastRow = rows[rows.length - 1];
  if (lastRow) {
    attachNameInput(lastRow.querySelector('[data-field="name"]'));
    attachPhoneInput(lastRow.querySelector('[data-field="phone"]'));
    attachAadhaarInput(lastRow.querySelector('[data-field="aadhaar"]'));
  }
};

window.removeBlockMember = function (btn, idx) {
  btn.closest('.member-row').remove();
  blockMembers.splice(idx, 1);
};

window.submitBlockReRegistration = async function () {
  if (!blockSelectedRoom) {
    showToast('Select Room', 'Please choose building and room', 'warning');
    return;
  }

  const name = document.getElementById('block-info-name').value.trim();
  const phone = document.getElementById('block-info-phone').value.trim();
  const altPhone = document.getElementById('block-info-alt-phone').value.trim();
  const aadhaar = document.getElementById('block-info-aadhaar').value.trim();
  const meterReading = document.getElementById('block-info-meter').value;
  const livingType = document.querySelector('input[name="block-living-type"]:checked').value;

  const nameErr = validateName(name);
  if (nameErr) { showToast('Invalid Name', nameErr, 'warning'); return; }

  const phoneErr = validatePhone(phone);
  if (phoneErr) { showToast('Invalid Phone', phoneErr, 'warning'); return; }

  if (altPhone) {
    const altPhoneErr = validatePhone(altPhone, false);
    if (altPhoneErr) { showToast('Invalid Another Number', altPhoneErr, 'warning'); return; }
  }

  const aadhaarErr = validateAadhaar(aadhaar, true);
  if (aadhaarErr) { showToast('Invalid Aadhaar', aadhaarErr, 'warning'); return; }

  // ── Electricity meter reading is MANDATORY if electricity is not included ──
  const elecIncluded = blockSelectedRoom.electricity_included || blockSelectedBuilding.electricity_included || false;
  if (!elecIncluded) {
    const meterInput = document.getElementById('block-info-meter');
    const meterVal = meterInput ? meterInput.value.trim() : '';
    if (meterVal === '' || isNaN(parseFloat(meterVal)) || parseFloat(meterVal) < 0) {
      if (meterInput) {
        meterInput.style.borderColor = 'var(--danger, #ef4444)';
        meterInput.style.boxShadow = '0 0 0 2px rgba(239,68,68,0.25)';
        meterInput.focus();
        meterInput.addEventListener('input', () => {
          meterInput.style.borderColor = '';
          meterInput.style.boxShadow = '';
        }, { once: true });
      }
      showToast('Meter Reading Required', 'Please enter the current electricity meter reading before proceeding.', 'warning');
      return;
    }
  }

  // Collect and validate member data
  const memberData = [];
  if (livingType === 'family') {
    const rows = document.querySelectorAll('#block-members-list .member-row');
    if (rows.length === 0) {
      showToast('Validation Error', 'Please add at least one member or select "Alone"', 'warning');
      return;
    }

    let memberErrors = [];
    rows.forEach((row, i) => {
      const mName = row.querySelector('[data-field="name"]')?.value?.trim() || '';
      const mPhone = row.querySelector('[data-field="phone"]')?.value?.trim() || '';
      const mRelation = row.querySelector('[data-field="relation"]')?.value?.trim() || '';
      const mAadhaar = row.querySelector('[data-field="aadhaar"]')?.value?.trim() || '';

      const mNameErr = validateName(mName);
      if (mNameErr) memberErrors.push(`Member ${i + 1}: ${mNameErr}`);

      const mPhoneErr = validatePhone(mPhone, false);
      if (mPhoneErr) memberErrors.push(`Member ${i + 1}: ${mPhoneErr}`);

      const mAadhaarErr = validateAadhaar(mAadhaar, false);
      if (mAadhaarErr) memberErrors.push(`Member ${i + 1}: ${mAadhaarErr}`);

      if (mName) memberData.push({ name: mName, phone: mPhone, relation: mRelation, aadhaar_number: mAadhaar });
    });

    if (memberErrors.length > 0) {
      showToast('Validation Error', memberErrors[0], 'warning');
      return;
    }
  }


  const btn = document.querySelector('button[onclick="submitBlockReRegistration()"]');
  const originalText = btn ? btn.textContent : 'Submit Request';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }

  try {
    const session = await getSession();
    if (!session) throw new Error('No active session. Please log in again.');

    const query = supabase
      .from('tenants')
      .insert({
        owner_id: blockSelectedOwner.id,
        building_id: blockSelectedBuilding.id,
        room_id: blockSelectedRoom.id,
        status: 'pending',
        email: session.user.email,
        name,
        phone,
        alt_phone: altPhone,
        aadhaar_number: aadhaar,
        living_type: livingType,
        initial_meter_reading: parseFloat(meterReading) || 0,
        join_date: new Date().toISOString().split('T')[0],
        auth_user_id: session.user.id,
        vacate_date: null
      });

    const { data: updated, error } = await query.select();

    if (error) throw error;

    if (!updated || updated.length === 0) {
      throw new Error('Could not update/insert tenant profile. Please check database configuration.');
    }

    const newTenant = updated[0];

    // Insert family members
    if (memberData.length > 0) {
      await supabase.from('members').insert(
        memberData.map(m => ({ ...m, tenant_id: newTenant.id }))
      );
    }

    showToast('Submitted Successfully!', 'Your request has been sent for approval.', 'success');
    tenantData = newTenant;
    checkTenantStatus();

  } catch (err) {
    showToast('Submission Failed', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

// ═══════════════ NOTICE BOARD ═══════════════
let noticeBoardOpen = false;

function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function checkNoticeBoardIndicator() {
  if (!tenantData || !tenantData.owner_id) return;
  try {
    const { data: owner } = await supabase
      .from('owners')
      .select('notice_board')
      .eq('id', tenantData.owner_id)
      .maybeSingle();

    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    // Check if there are any broadcast announcements in the last 5 days
    const { data: announcements } = await supabase
      .from('broadcast_announcements')
      .select('id')
      .eq('owner_id', tenantData.owner_id)
      .gte('created_at', fiveDaysAgo.toISOString());

    const hasNotice = owner && owner.notice_board && owner.notice_board.trim();
    
    // Filter announcements by seen count
    const seenMap = JSON.parse(localStorage.getItem('pgb_seen_announcements') || '{}');
    const unseenAnnouncements = (announcements || []).filter(ann => (seenMap[ann.id] || 0) < 2);
    const hasAnnouncements = unseenAnnouncements.length > 0;

    const dot = document.getElementById('notice-board-dot');
    if (dot) {
      if (hasNotice || hasAnnouncements) {
        dot.classList.remove('hidden');
      } else {
        dot.classList.add('hidden');
      }
    }
  } catch (err) {
    // Silent fail
  }
}

window.openNoticeBoard = async function () {
  const panel = document.getElementById('notice-board-panel');
  const drawer = document.getElementById('notice-board-drawer');
  const backdrop = document.getElementById('notice-board-backdrop');
  if (!panel || !drawer) return;

  // Enable pointer events
  panel.style.pointerEvents = 'all';
  backdrop.style.pointerEvents = 'all';

  // Animate in
  requestAnimationFrame(() => {
    backdrop.style.opacity = '1';
    drawer.style.transform = 'translateX(0)';
  });

  noticeBoardOpen = true;

  // Load notice board content from owner
  if (tenantData && tenantData.owner_id) {
    const contentEl = document.getElementById('notice-board-content');
    const ownerInfoEl = document.getElementById('notice-owner-info');
    const ownerNameEl = document.getElementById('notice-owner-name');

    try {
      const { data: owner } = await supabase
        .from('owners')
        .select('name, notice_board')
        .eq('id', tenantData.owner_id)
        .maybeSingle();

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

      const { data: announcements } = await supabase
        .from('broadcast_announcements')
        .select('*')
        .eq('owner_id', tenantData.owner_id)
        .gte('created_at', fiveDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      if (owner) {
        if (ownerNameEl) ownerNameEl.textContent = owner.name || '—';
        if (ownerInfoEl) ownerInfoEl.classList.remove('hidden');

        let html = '';

        // 1. Render static rules notice
        if (owner.notice_board && owner.notice_board.trim()) {
          html += `
            <div style="background: var(--bg-elevated); border: 1px solid var(--border-color); border-left: 3px solid var(--primary-light); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 16px;">
              <h4 style="margin: 0 0 6px 0; color: var(--primary-light); font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                <svg class="svg-icon" style="width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 2.5;" viewBox="0 0 24 24">
                  <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"></path>
                </svg> PG Rules & General Notice
              </h4>
              <p style="margin: 0; font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; line-height: 1.5;">${owner.notice_board}</p>
            </div>
          `;
        }

        // Get seen map from localStorage
        const seenMap = JSON.parse(localStorage.getItem('pgb_seen_announcements') || '{}');
        const activeAnnouncements = (announcements || []).filter(ann => (seenMap[ann.id] || 0) < 2);

        // 2. Render broadcast announcements (last 5 days)
        if (activeAnnouncements && activeAnnouncements.length > 0) {
          html += `<h4 style="margin: 0 0 8px 0; color: var(--text-muted); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
            <svg class="svg-icon" style="width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.5;" viewBox="0 0 24 24">
              <path d="M11 5L6 9H2v6h4l5 4V5z"></path>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
            </svg> Announcements (Last 5 Days)
          </h4>`;
          activeAnnouncements.forEach(ann => {
            const timeAgo = formatTimeAgo(new Date(ann.created_at));
            html += `
              <div style="background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; color: var(--text-muted); background: rgba(255,255,255,0.03); border: 1px solid var(--border-color); padding: 1px 5px; border-radius: 4px;">Broadcast</span>
                  <span style="font-size: 10px; color: var(--text-muted);">${timeAgo}</span>
                </div>
                <p style="margin: 0; font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; line-height: 1.5;">${ann.message}</p>
              </div>
            `;
            // Increment seen count for this announcement
            seenMap[ann.id] = (seenMap[ann.id] || 0) + 1;
          });
          localStorage.setItem('pgb_seen_announcements', JSON.stringify(seenMap));
          // Re-check notice board indicator so the red dot disappears after viewing
          setTimeout(checkNoticeBoardIndicator, 500);
        }

        if (!owner.notice_board && activeAnnouncements.length === 0) {
          html = `
            <div style="color: var(--text-muted); font-size: 12px; text-align: center; padding: 32px 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.4;">
              <div style="color: var(--text-muted); opacity: 0.7; margin-bottom: 10px;">
                <svg class="svg-icon" style="width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 2;" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="16" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12.01" y2="8"></line>
                </svg>
              </div>
              No rules or announcements active right now.<br>
              <span style="font-size: 10px; opacity: 0.8; margin-top: 4px;">(कोई सूचना सक्रिय नहीं है)</span>
            </div>`;
        }

        contentEl.innerHTML = html;

        // Hide red dot when notice board is opened
        const dot = document.getElementById('notice-board-dot');
        if (dot) dot.classList.add('hidden');
      }
    } catch (err) {
      console.error('Failed to load notice board:', err);
    }
  }
};

window.closeNoticeBoard = function () {
  const panel = document.getElementById('notice-board-panel');
  const drawer = document.getElementById('notice-board-drawer');
  const backdrop = document.getElementById('notice-board-backdrop');
  if (!panel || !drawer) return;

  drawer.style.transform = 'translateX(100%)';
  backdrop.style.opacity = '0';
  backdrop.style.pointerEvents = 'none';

  setTimeout(() => {
    panel.style.pointerEvents = 'none';
    noticeBoardOpen = false;
  }, 350);
};

window.toggleAccordion = function (headerEl) {
  const card = headerEl.closest('.card-accordion');
  if (!card) return;
  const wrapper = card.querySelector('.accordion-wrapper');
  const chevron = card.querySelector('.accordion-chevron');
  if (wrapper && chevron) {
    const isExpanded = wrapper.classList.contains('expanded');
    if (isExpanded) {
      wrapper.classList.remove('expanded');
      chevron.classList.remove('rotate-chevron');
    } else {
      wrapper.classList.add('expanded');
      chevron.classList.add('rotate-chevron');
    }
  }
};


// ═══════════════ GLOBAL ═══════════════

window.switchTab = function (tabName, el) {
  utilSwitchTab(tabName, el);
  // Save active tab so it survives page refresh
  localStorage.setItem('pgb_tenant_active_tab', tabName);

  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
  const nbDrawer = document.getElementById('notice-board-drawer');
  if (nbDrawer) nbDrawer.style.transform = 'translateX(100%)';
  const nbBackdrop = document.getElementById('notice-board-backdrop');
  if (nbBackdrop) {
    nbBackdrop.style.opacity = '0';
    nbBackdrop.style.pointerEvents = 'none';
  }
  const map = { home: 'mn-home', payment: 'mn-payment', history: 'mn-history', complaints: 'mn-complaints', vacate: 'mn-vacate' };
  if (map[tabName]) setMobileNav(map[tabName]);
  if (tabName === 'settings') {
    window.initSettingsMembers();
  }
};

window.handleLogout = async function () {
  const confirmLogout = confirm("Are you sure you want to logout? / क्या आप लॉगआउट करना चाहते हैं?");
  if (!confirmLogout) return;
  try {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
    if (approvalChannel) {
      approvalChannel.unsubscribe();
      approvalChannel = null;
    }
    if (tenantRealtimeChannel) {
      tenantRealtimeChannel.unsubscribe();
      tenantRealtimeChannel = null;
    }
    if (isConfigured()) await signOut();
    localStorage.removeItem('pgb_demo_mode');
    localStorage.removeItem('pgb_user_role');
    window.location.href = '/';
  } catch {
    window.location.href = '/';
  }
};

document.addEventListener('DOMContentLoaded', () => {
  init();
});

async function executeTenantSelfVacate(profile) {
  try {
    // 1. Update vacate notices
    await supabase
      .from('vacate_notices')
      .update({ status: 'processed', deposit_refunded: true })
      .eq('tenant_id', profile.id)
      .eq('status', 'submitted');

    // 2. Update tenant status to vacated and unlink them
    await supabase
      .from('tenants')
      .update({
        status: 'vacated',
        vacate_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', profile.id);

    // Delete family members when vacating
    await supabase
      .from('members')
      .delete()
      .eq('tenant_id', profile.id);

    // 3. Decrement room occupancy
    if (profile.room_id) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', profile.room_id)
        .maybeSingle();

      if (!roomGetErr && roomData) {
        const nextBedsOccupied = Math.max(0, roomData.beds_occupied - 1);
        const nextStatus = nextBedsOccupied === 0 ? 'vacant' : (nextBedsOccupied < roomData.beds_count ? 'partial' : 'occupied');

        await supabase
          .from('rooms')
          .update({
            beds_occupied: nextBedsOccupied,
            status: nextStatus
          })
          .eq('id', profile.room_id);
      }
    }
    console.log(`Self-vacated tenant profile ${profile.id}`);
  } catch (err) {
    console.error('Error in executeTenantSelfVacate:', err);
  }
}

// ── Mobile Bottom Nav sync ──
window.setMobileNav = function (activeId) {
  document.querySelectorAll('.mobile-nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.id === activeId);
  });
};

// ── Settings Members management ──
let settingsMembers = [];

window.initSettingsMembers = function () {
  // Load current members from global myMembers list
  settingsMembers = [...myMembers];
  window.renderSettingsMembersList();
};

window.addSettingsMemberRow = function (member = null) {
  const idx = member?.id || Date.now() + Math.random().toString(36).substr(2, 9);

  if (!member && !settingsMembers.some(m => String(m.id || m.key) === String(idx))) {
    settingsMembers.push({ key: idx, name: '', phone: '', relation: '', aadhaar_number: '' });
  }

  const container = document.getElementById('settings-members-list');
  if (!container) return;

  const div = document.createElement('div');
  div.className = 'member-card';
  div.dataset.memberKey = member?.id || idx;
  div.innerHTML = `
    <button class="remove-btn" onclick="window.removeSettingsMember(this)" style="display:flex;align-items:center;justify-content:center;padding:4px 8px;font-size:12px;gap:4px;">${ICONS.trash()} Remove</button>
    <div style="font-size: var(--font-xs); font-weight: 700; color: var(--text-secondary); margin-bottom: 10px;">Member</div>
    <div class="form-group">
      <input class="form-input" type="text" placeholder="Member Name *" data-field="name" value="${member?.name || ''}" style="font-size: var(--font-sm);" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <input class="form-input" type="tel" placeholder="Phone *" data-field="phone" value="${member?.phone || ''}" style="font-size: var(--font-sm);" />
      </div>
      <div class="form-group">
        <input class="form-input" type="text" placeholder="Relation" data-field="relation" value="${member?.relation || ''}" style="font-size: var(--font-sm);" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom: 0;">
      <input class="form-input" type="text" placeholder="Aadhaar *" data-field="aadhaar" value="${member?.aadhaar_number || ''}" maxlength="14" style="font-size: var(--font-sm);" />
    </div>
  `;
  container.appendChild(div);

  const card = container.querySelector(`[data-member-key="${member?.id || idx}"]`);
  if (card) {
    attachNameInput(card.querySelector('[data-field="name"]'));
    attachPhoneInput(card.querySelector('[data-field="phone"]'));
    attachAadhaarInput(card.querySelector('[data-field="aadhaar"]'));
  }
};

window.removeSettingsMember = function (btn) {
  const card = btn.closest('.member-card');
  const key = card?.dataset.memberKey;
  settingsMembers = settingsMembers.filter(m => String(m.id || m.key) !== String(key));
  card?.remove();
};

window.renderSettingsMembersList = function () {
  const container = document.getElementById('settings-members-list');
  if (!container) return;
  container.innerHTML = '';
  settingsMembers.forEach(m => window.addSettingsMemberRow(m));
};

// ── Save Tenant Profile Settings ──
window.saveTenantProfile = async function () {
  const nameInput = document.getElementById('settings-tenant-name');
  if (!nameInput) return;

  const newName = nameInput.value.trim();
  const cards = document.querySelectorAll('#settings-members-list .member-card');
  const livingType = cards.length > 0 ? 'family' : 'alone';

  // Validate name
  if (!newName) {
    showToast('Error', 'Name is required (नाम आवश्यक है)', 'error');
    return;
  }

  const newNameErr = validateName(newName);
  if (newNameErr) {
    showToast('Error', newNameErr, 'error');
    return;
  }

  // Validate members if any exist
  let validationErrors = [];
  cards.forEach((card, n) => {
    const mName = card.querySelector('[data-field="name"]')?.value?.trim() || '';
    const mPhone = card.querySelector('[data-field="phone"]')?.value?.trim() || '';
    const mAadhaar = card.querySelector('[data-field="aadhaar"]')?.value?.trim() || '';

    const nameErr = validateName(mName);
    if (nameErr) validationErrors.push(`Member ${n + 1}: ${nameErr}`);

    const phoneErr = validatePhone(mPhone);
    if (phoneErr) validationErrors.push(`Member ${n + 1}: ${phoneErr}`);

    const aadhaarErr = validateAadhaar(mAadhaar, true);
    if (aadhaarErr) validationErrors.push(`Member ${n + 1}: ${aadhaarErr}`);
  });

  if (validationErrors.length > 0) {
    showToast('Validation Error', validationErrors[0], 'warning');
    return;
  }

  try {
    showToast('Saving...', 'Saving profile details...', 'info');

    // 1. Update tenants table
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({ name: newName, living_type: livingType })
      .eq('id', tenantData.id);

    if (tenantErr) throw tenantErr;

    // 2. Delete existing members for this tenant
    const { error: deleteErr } = await supabase
      .from('members')
      .delete()
      .eq('tenant_id', tenantData.id);

    if (deleteErr) throw deleteErr;

    // 3. Insert new members if any
    if (livingType === 'family') {
      const membersToInsert = [];
      cards.forEach(card => {
        const mName = card.querySelector('[data-field="name"]')?.value?.trim() || '';
        const mPhone = card.querySelector('[data-field="phone"]')?.value?.trim() || '';
        const mRelation = card.querySelector('[data-field="relation"]')?.value?.trim() || '';
        const mAadhaar = card.querySelector('[data-field="aadhaar"]')?.value?.trim() || '';

        if (mName) {
          membersToInsert.push({
            tenant_id: tenantData.id,
            name: mName,
            phone: mPhone,
            relation: mRelation,
            aadhaar_number: mAadhaar,
            is_active: true
          });
        }
      });

      if (membersToInsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('members')
          .insert(membersToInsert);

        if (insertErr) throw insertErr;
      }
    }

    // Refresh local structures
    tenantData.name = newName;
    tenantData.living_type = livingType;

    // Reload all data (which refreshes KPIs, frontend members cards, etc.)
    await loadRealData();
    setDisplayData();
    await renderMyMembers();
    renderDashboard();
    window.initSettingsMembers();

    showToast('Success', 'Profile updated successfully! (प्रोफ़ाइल सफलतापूर्वक अपडेट हो गई)', 'success');
  } catch (err) {
    console.error('Error saving profile:', err);
    showToast('Error', 'Failed to update profile details: ' + err.message, 'error');
  }
};
