/* ═══════════════════════════════════════════════════
   PG Builders — Owner Dashboard Logic
   ═══════════════════════════════════════════════════ */
import { isConfigured, supabase, getSession, getOwnerByUserId, signOut, generateOwnerKey, createOwnerProfile } from './supabase-config.js';
import { showToast, showConfigErrorOverlay, initSidebar, switchTab as utilSwitchTab, openModal as utilOpenModal, closeModal as utilCloseModal, formatCurrency, formatDate, formatMonthYear, getCurrentMonthYear, sendWhatsAppReminder, generateMonthlyReportPDF, generateReceiptPDF, validateName, validatePhone, attachNameInput, attachPhoneInput, getFloorLabel, validateAadhaar, attachAadhaarInput } from './utils.js';
import html2canvas from 'html2canvas';
import { initNotifications, initInstallPrompt, sendPushNotification, sendNotificationToAllTenants, showPremiumInstallModal } from './notifications.js';
import { ICONS } from './icons.js';


let ownerData = null;
let buildings = [];
let allTenants = [];
let allPayments = [];
let currentBuildingFilter = 'all';
let activeGridBuildingId = null;
let isSelectMode = false;
let selectedRoomIds = new Set();
let superNotifications = [];
let statusSubscription = null;
let realtimeDataChannel = null;
let allVacateNotices = [];
let staffList = [];
let expensesList = [];
let allComplaints = [];

// Helper to find the floor number of a room using buildings configuration in memory
function getFloorNumberForRoom(roomId) {
  if (!roomId) return null;
  for (const bld of buildings) {
    if (bld.floors) {
      for (const floor of bld.floors) {
        if (floor.rooms) {
          const room = floor.rooms.find(r => r.id === roomId);
          if (room) {
            return floor.floor_number;
          }
        }
      }
    }
  }
  return null;
}

// Helper to calculate bond remaining months
function getBondRemainingMonths(tenant) {
  if (!tenant || !tenant.bond_months || tenant.bond_months <= 0) return 0;
  const joinDate = tenant.join_date ? new Date(tenant.join_date) : new Date();
  const today = new Date();
  
  let elapsed = (today.getFullYear() - joinDate.getFullYear()) * 12 + today.getMonth() - joinDate.getMonth();
  if (today.getDate() < joinDate.getDate()) {
    elapsed = Math.max(0, elapsed - 1);
  }
  return Math.max(0, tenant.bond_months - elapsed);
}

// ── Initialize ──
// ── Initialize ──
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
      setDateDisplay();

      // Scroll event listener to persist scroll position
      let scrollTimeout;
      window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          localStorage.setItem('pgb_scroll_y_owner', window.scrollY);
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

      try {
        const success = await loadRealData(session);
        if (success === false) {
          // Access denied / gated. We stop initialization here to prevent dashboard renders.
          return;
        }
      } catch (err) {
        console.error('Init error:', err);
        showToast('Load Error', 'Failed to load dashboard data: ' + err.message, 'error');
        return;
      }

      renderDashboard();
      renderBuildingsList();
      renderBuildingSelect();


      // ── Restore last active tab on page refresh ──
      const savedTab = localStorage.getItem('pgb_owner_active_tab');
      if (savedTab && savedTab !== 'dashboard') {
        const savedBtn = document.querySelector(`.menu-item[data-tab="${savedTab}"]`);
        if (savedBtn) window.switchTab(savedTab, savedBtn, true);
      }

      // ── Restore scroll position on page refresh ──
      const savedScrollY = localStorage.getItem('pgb_scroll_y_owner');
      if (savedScrollY !== null) {
        setTimeout(() => {
          window.scrollTo({ top: parseInt(savedScrollY), behavior: 'instant' });
        }, 150);
      }

      // Live input filters on Settings tab
      attachNameInput(document.getElementById('sett-name'));
      attachPhoneInput(document.getElementById('sett-phone'));

      // Live input filters for manual add tenant modal
      attachNameInput(document.getElementById('manual-name'));
      attachPhoneInput(document.getElementById('manual-phone'));
      attachPhoneInput(document.getElementById('manual-alt-phone'));

      attachAadhaarInput(document.getElementById('manual-aadhaar'));
    }
  });
}

function setDateDisplay() {
  const el = document.getElementById('dash-date');
  if (el) {
    // Dashboard always shows current month
    el.textContent = formatMonthYear(getCurrentMonthYear() + '-01');
  }
}

// ── Demo Data ──
function loadDemoData() {
  // Demo mode deprecated, connection strictly runs against Supabase.
}

// ── Real Supabase Data ──
function injectImpersonationBar() {
  const impersonateId = localStorage.getItem('impersonate_owner_id');
  if (impersonateId && !document.querySelector('.impersonation-warning-bar')) {
    const bar = document.createElement('div');
    bar.className = 'impersonation-warning-bar';
    bar.innerHTML = `
      <span>${ICONS.alert()} Impersonating Landlord: <strong>${ownerData.name}</strong> (${ownerData.email})</span>
      <button class="impersonation-exit-btn" id="exit-impersonation-btn">Exit Impersonation</button>
    `;
    document.body.prepend(bar);
    document.getElementById('exit-impersonation-btn').addEventListener('click', () => {
      localStorage.removeItem('impersonate_owner_id');
      if (window.location.hostname.includes('localhost') || window.location.hostname.includes('127.0.0.1')) {
        window.location.href = '/superadmin.html';
      } else {
        window.location.href = 'https://admin.pgbuilderss.online';
      }
    });
  }
}

function checkAccessGates(ownerData) {
  // Hide all gates first
  document.getElementById('gate-deleted').classList.add('hidden');
  document.getElementById('gate-suspended').classList.add('hidden');
  document.getElementById('gate-expired').classList.add('hidden');

  if (!ownerData) {
    document.getElementById('gate-deleted').classList.remove('hidden');
    document.getElementById('sidebar')?.classList.add('hidden');
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.style.display = 'none';
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) sidebarToggle.style.display = 'none';

    // Auto sign out from Supabase Auth since account is permanently deleted
    signOut().catch(err => console.error('Sign out error:', err));
    localStorage.removeItem('pgb_user_role');
    return false; // Access denied
  }

  // Check manual activation lock status first
  if (ownerData.status === 'Locked') {
    window.location.href = '/account-locked.html';
    return false;
  }

  if (ownerData.status === 'Suspended') {
    document.getElementById('gate-suspended').classList.remove('hidden');
    document.getElementById('sidebar')?.classList.add('hidden');
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.style.display = 'none';
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) sidebarToggle.style.display = 'none';
    return false; // Access denied
  }

  // Check Subscription expiry
  const isExpired = ownerData.plan_type !== 'Enterprise' &&
    (ownerData.subscription_status === 'expired' ||
      (ownerData.subscription_status !== 'active' && ownerData.subscription_status !== 'trial') ||
      (ownerData.subscription_expiry && new Date(ownerData.subscription_expiry) < new Date()));

  if (isExpired) {
    if (!ownerData.subscription_expiry) {
      // Brand new user, never paid -> redirect to register payment step
      window.location.href = '/owner-register.html?upgrade=true';
    } else {
      // Previously active plan, now expired -> redirect to subscription expired page
      window.location.href = '/subscription-expired.html';
    }
    return false; // Access denied
  }

  // If active, make sure sidebar and main content are visible
  document.getElementById('sidebar')?.classList.remove('hidden');
  const mainContent = document.querySelector('.main-content');
  if (mainContent) mainContent.style.display = '';
  const sidebarToggle = document.getElementById('sidebar-toggle');
  if (sidebarToggle) sidebarToggle.style.display = '';
  return true; // Access granted
}

function subscribeToOwnerStatus(ownerId) {
  if (statusSubscription) {
    statusSubscription.unsubscribe();
  }

  statusSubscription = supabase
    .channel('owner-status-changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'owners',
        filter: `id=eq.${ownerId}`
      },
      async (payload) => {
        console.log('Realtime owner update received:', payload);

        if (payload.eventType === 'DELETE') {
          ownerData = null;
          checkAccessGates(null);
          if (statusSubscription) {
            statusSubscription.unsubscribe();
            statusSubscription = null;
          }
        } else if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
          const updatedOwner = payload.new;
          ownerData = updatedOwner;
          const stillHasAccess = checkAccessGates(ownerData);
          if (stillHasAccess) {
            // Re-render dashboard components if they regained access
            renderDashboard();
            renderBuildingsList();
            renderBuildingSelect();
          }
        }
      }
    )
    .subscribe();
}

function refreshActiveViews() {
  const activeTab = localStorage.getItem('pgb_owner_active_tab') || 'dashboard';

  renderSuperNotifications();
  renderKPIs();
  updateComplaintsBadge();

  if (activeTab === 'dashboard') {
    renderDashboard();
  } else if (activeTab === 'buildings') {
    renderBuildingsList();
  } else if (activeTab === 'tenants') {
    renderTenantsTable();
    const activeBtn = document.querySelector('#tab-tenants .inner-tab-btn.active');
    const innerTabId = activeBtn ? activeBtn.getAttribute('onclick').match(/'([^']+)'/)[1] : 'tenants-active';

  } else if (activeTab === 'rent') {
    renderMonthlyChecklist();
    const activeBtn = document.querySelector('#tab-rent .inner-tab-btn.active');
    const innerTabId = activeBtn ? activeBtn.getAttribute('onclick').match(/'([^']+)'/)[1] : 'rent-overview';
    if (innerTabId === 'rent-overview') {
      renderRentOverview();
    } else if (innerTabId === 'rent-txns') {
      renderTransactionsTable();
    } else if (innerTabId === 'rent-dues') {
      renderRentDues();
    } else if (innerTabId === 'rent-deposits') {
      renderRentDeposits();
    }
  } else if (activeTab === 'broadcast') {
    renderBroadcastHistory();
  } else if (activeTab === 'history') {
    renderHistoryTab();
  } else if (activeTab === 'expenses') {
    renderExpensesTab();
    renderStaffTab();
  } else if (activeTab === 'complaints') {
    renderComplaintsTab();
  } else if (activeTab === 'settings') {
    renderSettingsForm();
    renderSupportTicketsList();
  }
}

function subscribeToRealtimeData(ownerId) {
  if (realtimeDataChannel) {
    realtimeDataChannel.unsubscribe();
  }

  realtimeDataChannel = supabase
    .channel('owner-realtime-data-' + ownerId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tenants',
      filter: `owner_id=eq.${ownerId}`
    }, async (payload) => {
      console.log('Realtime tenant change:', payload);
      await loadRealData();
      refreshActiveViews();
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'payments',
      filter: `owner_id=eq.${ownerId}`
    }, async (payload) => {
      console.log('Realtime payment change:', payload);
      await loadRealData();
      refreshActiveViews();
    })

    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'vacate_notices',
      filter: `owner_id=eq.${ownerId}`
    }, async (payload) => {
      console.log('Realtime vacate notice change:', payload);
      await loadRealData();
      refreshActiveViews();
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'complaints',
      filter: `owner_id=eq.${ownerId}`
    }, async (payload) => {
      console.log('Realtime complaint change:', payload);
      await loadRealData();
      refreshActiveViews();
    })
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'members'
    }, async (payload) => {
      console.log('Realtime member change:', payload);
      await loadRealData();
      refreshActiveViews();
    })
    .subscribe();
}

async function loadRealData(session) {
  const activeSession = session || await getSession();
  if (!activeSession) { window.location.href = '/'; return false; }

  const impersonateId = localStorage.getItem('impersonate_owner_id');
  if (impersonateId && activeSession.user.email === 'admin@pgbuilderss.online') {
    ownerData = await getOwnerByUserId(impersonateId);
    if (ownerData) {
      injectImpersonationBar();
    }
  } else {
    ownerData = await getOwnerByUserId(activeSession.user.id);
  }

  // Check access gates
  const hasAccess = checkAccessGates(ownerData);
  if (!hasAccess) {
    return false;
  }

  // Subscribe to real-time status changes
  if (ownerData && !statusSubscription) {
    subscribeToOwnerStatus(ownerData.id);
  }
  if (ownerData && !realtimeDataChannel) {
    subscribeToRealtimeData(ownerData.id);
  }

  // 🔔 Init push notifications for owner
  if (ownerData) {
    initNotifications('owner', ownerData.id).catch(e => console.warn('Owner notif init:', e));
  }

  // Run auto-vacates first
  await checkAndProcessAutoVacates(ownerData.id);

  const { data: blds } = await supabase.from('buildings').select('*, floors(*, rooms(*))').eq('owner_id', ownerData.id).order('created_at', { ascending: true });
  buildings = blds || [];

  const { data: tenants } = await supabase
    .from('tenants')
    .select('*, buildings(name), rooms(room_number, rent, electricity_included, electricity_rate, maintenance_included, maintenance_charge, floors(floor_number)), members(*)')
    .eq('owner_id', ownerData.id)
    .order('created_at', { ascending: false });

  allTenants = (tenants || []).map(t => {
    let floorNum = '—';
    if (t.rooms && t.rooms.floors) {
      floorNum = t.rooms.floors.floor_number;
    }
    return {
      ...t,
      building_name: t.buildings ? t.buildings.name : (t.building_name || '—'),
      room_number: t.rooms ? t.rooms.room_number : (t.room_number || '—'),
      rent: t.rooms ? t.rooms.rent : 0,
      electricity_included: t.rooms ? t.rooms.electricity_included : false,
      electricity_rate: t.rooms ? t.rooms.electricity_rate : 0,
      maintenance_included: t.rooms ? t.rooms.maintenance_included : false,
      maintenance_charge: t.rooms ? t.rooms.maintenance_charge : 0,
      floor_number: floorNum,
      members_count: t.members ? t.members.length : 0
    };
  });

  // Fetch all vacate notices (for approvals and refunds tracking)
  const { data: vacateNoticesData } = await supabase
    .from('vacate_notices')
    .select('*')
    .eq('owner_id', ownerData.id)
    .order('created_at', { ascending: false });

  allVacateNotices = (vacateNoticesData || []).map(notice => {
    const tenant = allTenants.find(t => t.id === notice.tenant_id);
    return {
      ...notice,
      tenant_name: tenant ? tenant.name : 'Unknown',
      room_number: tenant ? tenant.room_number : '—',
      building_name: tenant ? tenant.building_name : '—'
    };
  });

  // Self-heal and sync room occupancies
  await syncRoomOccupancies(ownerData.id, buildings, allTenants);



  // Fetch only tenant rent payments — exclude Razorpay subscription entries (tenant_id is null)
  const { data: payments } = await supabase
    .from('payments')
    .select('*')
    .eq('owner_id', ownerData.id)
    .not('tenant_id', 'is', null)
    .order('created_at', { ascending: false });
  allPayments = payments || [];

  // Fetch staff and expenses data
  try {
    const { data: staffData } = await supabase
      .from('staff')
      .select('*')
      .eq('owner_id', ownerData.id)
      .order('created_at', { ascending: false });
    staffList = staffData || [];

    const { data: expensesData } = await supabase
      .from('expenses')
      .select('*, buildings(name)')
      .eq('owner_id', ownerData.id)
      .order('created_at', { ascending: false });
    expensesList = (expensesData || []).map(exp => ({
      ...exp,
      building_name: exp.buildings ? exp.buildings.name : 'General (All Properties)'
    }));
  } catch (err) {
    console.error('Failed to load staff/expenses data:', err);
  }

  // Fetch Complaints for this owner (RLS handles auth filtering)
  try {
    const { data: complaintsData, error: compErr } = await supabase
      .from('complaints')
      .select('*')
      .order('created_at', { ascending: false });
    if (compErr) {
      console.error('Complaints fetch error:', compErr.message, compErr.details, compErr.hint);
    }
    allComplaints = (complaintsData || []).map(c => {
      const tenant = allTenants.find(t => t.id === c.tenant_id);
      return {
        ...c,
        tenant_name: tenant ? tenant.name : (c.tenant_name || 'Unknown Tenant'),
        building_name: tenant ? tenant.building_name : '—',
        room_number: tenant ? tenant.room_number : '—'
      };
    });
    console.log(`[Complaints] Loaded ${allComplaints.length} complaints for owner ${ownerData.id}`);
  } catch (err) {
    console.error('Failed to load complaints:', err);
  }

  // Fetch Super Notifications
  try {
    const { data: notices } = await supabase
      .from('system_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);
    superNotifications = notices || [];
  } catch (err) {
    console.error('Failed to load system notices:', err);
  }

  const ownerNameEl = document.getElementById('owner-display-name');
  if (ownerNameEl) ownerNameEl.textContent = ownerData.name;

  const ownerAvatarEl = document.getElementById('owner-avatar');
  if (ownerAvatarEl) {
    const initials = ownerData.name ? ownerData.name.split(' ').map(w => w[0]).join('').slice(0, 2) : 'OW';
    ownerAvatarEl.textContent = initials;
  }

  // Set owner key in topbar and sidebar
  const topbarKeyEl = document.getElementById('topbar-owner-key');
  if (topbarKeyEl) {
    topbarKeyEl.textContent = ownerData.owner_key || '—';
  }
  const sidebarKeyEl = document.getElementById('sidebar-owner-key');
  if (sidebarKeyEl) {
    sidebarKeyEl.textContent = ownerData.owner_key || '—';
  }


  // Keep local storage in sync
  localStorage.setItem('pgb_owner_name', ownerData.name);
  localStorage.setItem('pgb_owner_key', ownerData.owner_key);
  if (ownerData.upi_id) {
    localStorage.setItem('pgb_owner_upi', ownerData.upi_id);
  }

  // Populate dynamic month filters
  populateAllMonthFilters();

  return true;
}

function updatePlanExpiryReminder() {
  const pill = document.getElementById('dashboard-plan-expiry-pill');
  if (!pill) return;

  if (!ownerData) {
    pill.classList.add('hidden');
    pill.style.display = 'none';
    return;
  }

  // Toggles from client-side simulator
  const isMockActive = localStorage.getItem('pgb_mock_expiry_active') === 'true';
  let expiryDate = ownerData.subscription_expiry;
  let isEnterprise = ownerData.plan_type === 'Enterprise';

  if (isMockActive) {
    // If mock is active, we bypass Enterprise check for testing
    isEnterprise = false;
    const mockDays = parseInt(localStorage.getItem('pgb_mock_expiry_days') || '3');
    const mockDate = new Date();
    mockDate.setDate(mockDate.getDate() + mockDays);
    // Add small buffer so it doesn't expire immediately during evaluation
    mockDate.setMinutes(mockDate.getMinutes() + 10);
    expiryDate = mockDate.toISOString();
  }

  if (isEnterprise || !expiryDate) {
    pill.classList.add('hidden');
    pill.style.display = 'none';
    return;
  }

  const diffTime = new Date(expiryDate) - new Date();
  const hoursRemaining = diffTime / (1000 * 60 * 60);

  if (hoursRemaining > 0 && hoursRemaining <= 96) {
    pill.classList.remove('hidden');
    pill.style.display = 'inline-flex'; // Force display style to match layout

    // Labeling
    let timeLabel = '';
    if (hoursRemaining <= 24) {
      timeLabel = 'Expires Today (आज समाप्त)';
    } else if (hoursRemaining <= 48) {
      timeLabel = 'Expires Tomorrow (कल समाप्त)';
    } else if (hoursRemaining <= 72) {
      timeLabel = 'Expires in 2 Days (2 दिन में समाप्त)';
    } else {
      timeLabel = 'Expires in 3 Days (3 दिन में समाप्त)';
    }

    pill.innerHTML = `⚠️ <span style="font-weight:700;">${timeLabel}</span>`;
  } else {
    pill.classList.add('hidden');
    pill.style.display = 'none';
  }
}

// ═══════════════ DASHBOARD RENDER ═══════════════
function renderDashboard() {
  renderSuperNotifications();
  renderKPIs();
  renderApprovals();
  renderRecentPayments();
  renderSettingsForm();
  updatePlanExpiryReminder();
}

function renderKPIs() {
  // Dashboard always shows current month — filter is only used in Revenue/Expenses tabs
  const dashboardMonth = getCurrentMonthYear();

  // Filter active tenants by building if not 'all'
  const filteredTenants = currentBuildingFilter === 'all'
    ? allTenants.filter(t => t.status === 'active' || t.status === 'vacating')
    : allTenants.filter(t => (t.status === 'active' || t.status === 'vacating') && t.building_id === currentBuildingFilter);

  // Filter payments by building and CURRENT month (all tenants incl. vacated)
  const filteredPayments = allPayments.filter(p => {
    const matchesBuilding = currentBuildingFilter === 'all' || p.building_id === currentBuildingFilter;
    const payDateStr = p.payment_date || p.created_at || '';
    const matchesMonth = payDateStr.startsWith(dashboardMonth);
    return matchesBuilding && matchesMonth;
  });

  let totalRentCollected = 0;
  let totalElectricityCollected = 0;
  let totalMaintenanceCollected = 0;
  let dueRent = 0;

  filteredPayments.forEach(p => {
    if (p.status === 'approved') {
      totalRentCollected += (parseFloat(p.rent_amount) || 0);
      totalElectricityCollected += (parseFloat(p.electricity_amount) || 0);
      totalMaintenanceCollected += (parseFloat(p.maintenance_amount) || 0);
    }
    if (p.status === 'pending') dueRent += p.total_amount;
  });

  // Active deposits: sum of advance_paid for all active/vacating tenants in filtered scope
  const filteredActiveTenants = (currentBuildingFilter === 'all'
    ? allTenants
    : allTenants.filter(t => t.building_id === currentBuildingFilter))
    .filter(t => t.status === 'active' || t.status === 'vacating');

  const activeDeposits = filteredActiveTenants.reduce((acc, t) => acc + (parseFloat(t.advance_paid) || 0), 0);
  const totalTenantsCount = filteredActiveTenants.length;

  // Filter buildings if not 'all'
  const filteredBuildings = currentBuildingFilter === 'all'
    ? buildings
    : buildings.filter(b => b.id === currentBuildingFilter);

  let totalRooms = 0, filledRooms = 0, openRooms = 0;
  filteredBuildings.forEach(b => {
    b.floors?.forEach(f => {
      f.rooms?.forEach(r => {
        totalRooms++;
        if (r.status === 'occupied') filledRooms++;
        else if (r.status === 'partial') filledRooms++;
        else openRooms++;
      });
    });
  });

  // Calculate expenses for current month
  const filteredExpenses = expensesList.filter(e => {
    const matchesBuilding = currentBuildingFilter === 'all' || e.building_id === currentBuildingFilter;
    const matchesMonth = e.date && e.date.startsWith(dashboardMonth);
    return matchesBuilding && matchesMonth;
  });

  let totalExpenses = filteredExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);

  // Always add current-month staff salaries (all-building context only)
  if (currentBuildingFilter === 'all') {
    const paidStaffSalary = staffList
      .filter(s => s.payment_status === 'Paid')
      .reduce((acc, curr) => acc + (parseFloat(curr.salary) || 0), 0);
    totalExpenses += paidStaffSalary;
  }

  // Render to DOM
  const kpiRentEl = document.getElementById('kpi-rent-collected');
  if (kpiRentEl) kpiRentEl.textContent = formatCurrency(totalRentCollected);

  const kpiDepositsEl = document.getElementById('kpi-active-deposits');
  if (kpiDepositsEl) kpiDepositsEl.textContent = formatCurrency(activeDeposits);

  const kpiElecEl = document.getElementById('kpi-electricity-collected');
  if (kpiElecEl) kpiElecEl.textContent = formatCurrency(totalElectricityCollected);

  const kpiMaintEl = document.getElementById('kpi-maintenance-collected');
  if (kpiMaintEl) kpiMaintEl.textContent = formatCurrency(totalMaintenanceCollected);

  const kpiTotalExpensesDashEl = document.getElementById('kpi-total-expenses-dash');
  if (kpiTotalExpensesDashEl) kpiTotalExpensesDashEl.textContent = formatCurrency(totalExpenses);

  const kpiFilledEl = document.getElementById('kpi-filled');
  if (kpiFilledEl) kpiFilledEl.textContent = filledRooms;

  const kpiFilledSubEl = document.getElementById('kpi-filled-sub');
  if (kpiFilledSubEl) kpiFilledSubEl.textContent = `${totalRooms} total rooms`;

  const kpiOpenEl = document.getElementById('kpi-open');
  if (kpiOpenEl) kpiOpenEl.textContent = openRooms;

  const kpiDueEl = document.getElementById('kpi-due');
  if (kpiDueEl) kpiDueEl.textContent = formatCurrency(dueRent);

  const kpiTenantsEl = document.getElementById('kpi-total-tenants');
  if (kpiTenantsEl) kpiTenantsEl.textContent = totalTenantsCount;
}

function renderApprovals() {
  const pendingTenants = allTenants.filter(t => t.status === 'pending');
  const pendingPayments = allPayments.filter(p => p.status === 'pending');

  const totalPending = pendingTenants.length + pendingPayments.length;
  const container = document.getElementById('approvals-container');
  const countEl = document.getElementById('pending-count');
  if (countEl) {
    countEl.textContent = `${totalPending} pending`;
  }

  // Auto-expand accordion when there are pending approvals
  const card = document.getElementById('dashboard-approvals-card');
  if (card && totalPending > 0) {
    const wrapper = card.querySelector('.accordion-wrapper');
    const chevron = card.querySelector('.accordion-chevron');
    if (wrapper && !wrapper.classList.contains('expanded')) {
      wrapper.classList.add('expanded');
      if (chevron) chevron.classList.add('rotate-chevron');
    }
  }

  if (totalPending === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 16px 24px;">
        <div class="empty-state-icon" style="margin-bottom: 4px; opacity: 0.7;">${ICONS.mail('', '', '24px')}</div>
        <div style="font-size: var(--font-xs); font-weight: 600; color: var(--text-secondary);">No pending requests (कोई पेंडिंग अनुरोध नहीं है)</div>
      </div>`;
    return;
  }

  let html = '';

  // Render pending tenants
  pendingTenants.forEach(t => {
    html += `
      <div class="approval-payment-card" id="approval-${t.id}">
        <!-- Left Section -->
        <div class="approval-payment-left">
          <div class="approval-payment-avatar" style="display:flex;align-items:center;justify-content:center;">${ICONS.user('', '', '24px')}</div>
          <div class="approval-payment-profile">
            <div class="approval-payment-tenant-name">${t.name}</div>
            <div class="approval-payment-building-room">${ICONS.building()} ${t.building_name || '—'} &nbsp;·&nbsp; ${ICONS.home()} Room ${t.room_number || '—'}</div>
            <span class="approval-payment-badge registration">REGISTRATION</span>
          </div>
        </div>
        <!-- Middle Section -->
        <div class="approval-payment-middle">
          <div class="approval-detail-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.smartphone()} Phone</span>
            <span class="approval-chip-val" title="${t.phone}">${t.phone}</span>
          </div>
          <div class="approval-detail-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.mail()} Email</span>
            <span class="approval-chip-val" title="${t.email || '—'}">${t.email || '—'}</span>
          </div>
        </div>
        <!-- Right Section -->
        <div class="approval-payment-right">
          <div style="width: 90px; flex-shrink: 0;" class="topbar-key-desktop"></div>
          <div class="approval-payment-buttons">
            <button class="btn btn-success" onclick="approveTenant('${t.id}')">${ICONS.successCheck()} Approve</button>
            <button class="btn btn-danger" onclick="rejectTenant('${t.id}')">${ICONS.error()} Reject</button>
          </div>
        </div>
      </div>`;
  });

  // Render pending payments
  pendingPayments.forEach(p => {
    const hasElectricity = (p.electricity_amount || 0) > 0;
    const hasAdvance = (p.advance_amount || 0) > 0;
    const payDate = formatDate(p.payment_date || p.created_at);

    // UTR formatting
    const utrVal = p.transaction_id ? p.transaction_id : '—';
    const utrClass = p.transaction_id ? 'utr-value' : 'utr-empty';

    // Electricity detail formatting
    const elecText = `${formatCurrency(p.electricity_amount)} (${p.units_consumed || 0} units · Prev: ${p.prev_reading || 0} → Curr: ${p.curr_reading || 0})`;

    html += `
      <div class="approval-payment-card" id="approval-payment-${p.id}">
        <!-- Left Section -->
        <div class="approval-payment-left">
          <div class="approval-payment-avatar">${(p.tenant_name || '?')[0].toUpperCase()}</div>
          <div class="approval-payment-profile">
            <div class="approval-payment-tenant-name">${p.tenant_name}</div>
            <div class="approval-payment-building-room">${ICONS.building()} ${p.building_name || '—'} &nbsp;·&nbsp; ${ICONS.home()} Room <strong>${p.room_number || '—'}</strong></div>
            <span class="approval-payment-badge">PENDING</span>
          </div>
        </div>
        <!-- Middle Section -->
        <div class="approval-payment-middle">
          <!-- Rent Chip -->
          <div class="approval-detail-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.home()} Rent</span>
            <span class="approval-chip-val">${formatCurrency(p.rent_amount || 0)}</span>
          </div>
          <!-- Electricity Chip -->
          ${hasElectricity ? `
          <div class="approval-detail-chip highlight">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.electricity()} Electricity</span>
            <span class="approval-chip-val">${elecText}</span>
          </div>` : ''}
          <!-- Maintenance Chip -->
          <div class="approval-detail-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.settings()} Maintenance</span>
            <span class="approval-chip-val">${formatCurrency(p.maintenance_amount || 0)}</span>
          </div>
          <!-- Security Deposit Chip -->
          ${hasAdvance ? `
          <div class="approval-detail-chip advance">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.gem()} Security Deposit</span>
            <span class="approval-chip-val">${formatCurrency(p.advance_amount)}</span>
          </div>` : ''}
          <!-- Payment Date Chip -->
          <div class="approval-detail-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.calendar()} Payment Date</span>
            <span class="approval-chip-val">${payDate}</span>
          </div>
          <!-- Method & Month Chip -->
          <div class="approval-detail-chip method-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.card()} Method · Month</span>
            <span class="approval-chip-val">
              ${ICONS.card()} ${p.payment_method || 'UPI'} · ${ICONS.calendar()} ${formatMonthYear(p.month_year + '-01')}
            </span>
          </div>
          <!-- UTR Chip -->
          <div class="approval-detail-chip">
            <span class="approval-chip-label" style="display:inline-flex;align-items:center;gap:4px;">${ICONS.key()} UTR (Txn ID)</span>
            <span class="${utrClass}" ${p.transaction_id ? `onclick="navigator.clipboard.writeText('${p.transaction_id}');showToast('Copied','UTR copied to clipboard','success');" title="Click to copy UTR"` : ''}>
              ${utrVal}
              ${p.transaction_id ? `<svg style="width:10px;height:10px;opacity:0.6;margin-left:4px;vertical-align:middle;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>` : ''}
            </span>
          </div>
        </div>
        <!-- Right Section -->
        <div class="approval-payment-right">
          <div class="approval-payment-total-box">
            <span class="approval-payment-total-label">Total Due</span>
            <span class="approval-payment-total-amount">${formatCurrency(p.total_amount || 0)}</span>
          </div>
          <div class="approval-payment-buttons">
            <button class="btn btn-success" onclick="approvePayment('${p.id}')">${ICONS.successCheck()} Approve</button>
            <button class="btn btn-danger" onclick="rejectPayment('${p.id}')">${ICONS.error()} Reject</button>
          </div>
        </div>
      </div>`;
  });

  container.innerHTML = html;
}

function renderRecentPayments() {
  const tbody = document.getElementById('recent-payments-body');
  if (!tbody) return;
  const countBadge = document.getElementById('recent-payments-count');
  const paymentsCard = document.getElementById('dashboard-recent-payments-card');

  if (allPayments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No payments yet</td></tr>';
    if (countBadge) countBadge.textContent = '0 payments';
    return;
  }

  const sliced = allPayments.slice(0, 4);
  if (countBadge) countBadge.textContent = `${sliced.length} payment${sliced.length !== 1 ? 's' : ''}`;

  // Auto-expand accordion when there are payments
  if (paymentsCard) {
    const wrapper = paymentsCard.querySelector('.accordion-wrapper');
    const chevron = paymentsCard.querySelector('.accordion-chevron');
    if (wrapper && !wrapper.classList.contains('expanded')) {
      wrapper.classList.add('expanded');
      if (chevron) chevron.classList.add('rotate-chevron');
    }
  }

  tbody.innerHTML = sliced.map(p => {
    const badgeClass = p.status === 'approved' ? 'badge-success' : 'badge-warning';
    const action = p.status === 'pending'
      ? `<button class="btn btn-success btn-sm" onclick="approvePayment('${p.id}')">${ICONS.successCheck()} Approve</button>`
      : `<span class="text-muted" style="font-size: var(--font-xs);">Verified</span>`;

    return `<tr>
      <td><strong>${p.tenant_name}</strong></td>
      <td>Room ${p.room_number}</td>
      <td><strong>${formatCurrency(p.total_amount)}</strong></td>
      <td>${p.payment_method}</td>
      <td><span class="badge ${badgeClass}">${p.status.toUpperCase()}</span></td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

// ═══════════════ BUILDING MANAGEMENT ═══════════════
function renderBuildingSelect() {
  const sel = document.getElementById('building-select');
  if (sel) {
    sel.innerHTML = '<option value="all">All Buildings</option>';
    buildings.forEach(b => {
      sel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
    sel.value = currentBuildingFilter;
  }

  const rentSel = document.getElementById('rent-building-select');
  if (rentSel) {
    rentSel.innerHTML = '<option value="all">All Properties (सभी)</option>';
    buildings.forEach(b => {
      rentSel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
    rentSel.value = currentBuildingFilter;
  }

  // Populate Add Expense building select dropdown
  const expSel = document.getElementById('exp-building-select');
  if (expSel) {
    expSel.innerHTML = '<option value="">General (All Properties)</option>';
    buildings.forEach(b => {
      expSel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
  }
}

function renderBuildingsList() {
  const container = document.getElementById('buildings-list');
  if (buildings.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;">
      <div class="empty-state-icon">${ICONS.building('', '', '24px')}</div>
      <div class="empty-state-title">No buildings yet</div>
      <div class="empty-state-desc">Click "Add Building" to create your first property</div>
    </div>`;
    return;
  }

  container.innerHTML = buildings.map(b => {
    let totalRooms = 0, occupied = 0, vacant = 0;
    b.floors?.forEach(f => f.rooms?.forEach(r => {
      totalRooms++;
      if (r.status === 'occupied') occupied++;
      else if (r.status === 'partial') occupied++;
      else vacant++;
    }));

    const isSelected = b.id === activeGridBuildingId ? 'selected' : '';
    return `
      <div class="building-card ${isSelected}" onclick="showBuildingRooms('${b.id}')">
        <div class="building-card-name">${b.name}</div>
        <div class="building-card-type">${b.type} • ${b.location}</div>
        <div class="building-card-stats">
          <span>${ICONS.home()} ${totalRooms} rooms</span>
          <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--success); margin-right:4px; vertical-align:middle;"></span>${occupied} filled</span>
          <span><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--danger); margin-right:4px; vertical-align:middle;"></span>${vacant} vacant</span>
          <span>${ICONS.coin()} ${formatCurrency(b.floors?.[0]?.rooms?.[0]?.rent || 0)}/mo</span>
        </div>
      </div>`;
  }).join('');
}

window.showBuildingRooms = function (buildingId) {
  const building = buildings.find(b => b.id === buildingId);
  if (!building) return;

  if (activeGridBuildingId !== buildingId) {
    activeGridBuildingId = buildingId;
    if (isSelectMode) {
      toggleSelectMode(); // Reset select mode when switching buildings
    }
    renderBuildingsList(); // Refresh highlighting
  }

  document.getElementById('room-grid-section').classList.remove('hidden');
  document.getElementById('room-grid-title').textContent = `${building.name} — Room Grid`;

  const container = document.getElementById('room-grid-content');
  const isPG = ['pg', 'hostel'].includes(building.type);

  // Sort floors ascending by floor_number
  const sortedFloors = [...(building.floors || [])].sort((a, b) => a.floor_number - b.floor_number);

  // Set default active floor if not set
  if (sortedFloors.length > 0) {
    const floorIds = sortedFloors.map(f => f.id);
    if (!window.activeFloorId || !floorIds.includes(window.activeFloorId)) {
      window.activeFloorId = sortedFloors[0].id;
    }
  } else {
    window.activeFloorId = null;
  }

  // Render floor tabs row
  const floorTabsRow = document.getElementById('floor-tabs-row');
  if (sortedFloors.length > 0) {
    floorTabsRow.innerHTML = sortedFloors.map(floor => {
      const isActive = floor.id === window.activeFloorId;
      return `<button class="floor-tab ${isActive ? 'active' : ''}" onclick="window.switchActiveFloor('${floor.id}')">${getFloorLabel(floor.floor_number)}</button>`;
    }).join('');
    floorTabsRow.style.display = 'flex';
  } else {
    floorTabsRow.innerHTML = '';
    floorTabsRow.style.display = 'none';
  }

  container.innerHTML = sortedFloors.map(floor => {
    const isVisible = floor.id === window.activeFloorId;
    // Sort rooms by room_number using robust natural/numeric sort so 101 < 102 < 110
    const sortedRooms = [...(floor.rooms || [])].sort((a, b) =>
      String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true, sensitivity: 'base' })
    );
    const roomsHTML = sortedRooms.map(room => {
      let statusClass = room.status;
      let statusText = room.status.toUpperCase();
      let tenantInfo = '';

      const tenantsInRoom = allTenants.filter(t => t.room_id === room.id && (t.status === 'active' || t.status === 'vacating'));
      tenantInfo = `<div class="room-tenant-name">${tenantsInRoom.length > 0 ? tenantsInRoom.map(t => t.name).join(', ') : 'Empty'}</div>`;

      const isChecked = selectedRoomIds.has(room.id);
      const isSelectedClass = isChecked ? 'selected' : '';

      return `
        <div class="room-box ${statusClass} ${isSelectedClass}" data-room-id="${room.id}" data-floor-id="${floor.id}" onclick="handleRoomBoxClick(this, '${building.id}', '${floor.id}', '${room.id}', event)">
          <div class="room-select-checkbox-container">
            <input type="checkbox" class="room-select-checkbox" data-room-id="${room.id}" ${isChecked ? 'checked' : ''} onclick="handleRoomCheckboxClick(event)" />
          </div>
          <div class="room-number">${room.room_number}</div>
          <div class="room-status-text">${statusText}</div>
          ${tenantInfo}
        </div>`;
    }).join('');

    return `
      <div class="floor-group ${isVisible ? '' : 'hidden'}" id="floor-group-${floor.id}">
        <div class="floor-label" style="display: flex; align-items: center; justify-content: space-between;">
          <span>${getFloorLabel(floor.floor_number)}</span>
          <button class="btn btn-secondary btn-sm" onclick="window.openEditFloorModal('${building.id}', '${floor.id}')" style="padding: 4px 10px; font-size: 11px; min-height: unset; font-weight: 700; text-transform: none; letter-spacing: normal;">
            ${ICONS.edit()} Edit Floor
          </button>
        </div>
        <div class="room-grid-container">${roomsHTML}</div>
      </div>`;
  }).join('');
};

window.switchActiveFloor = function (floorId) {
  window.activeFloorId = floorId;
  if (activeGridBuildingId) {
    showBuildingRooms(activeGridBuildingId);
  }
};

// ── Save Demo Data Helper ──
function saveDemoData() {
  // Demo mode deprecated.
}


// ── Room Select & Bulk Operations ──
window.toggleSelectMode = function () {
  isSelectMode = !isSelectMode;
  const gridContainer = document.querySelectorAll('.room-grid-container');
  const btnSelect = document.getElementById('btn-select-mode');
  const btnDelete = document.getElementById('btn-delete-selected');

  if (isSelectMode) {
    gridContainer.forEach(el => el.classList.add('select-mode-active'));
    btnSelect.textContent = 'Cancel Select';
    btnSelect.classList.remove('btn-secondary');
    btnSelect.classList.add('btn-primary');
    btnDelete.classList.remove('hidden');
    selectedRoomIds.clear();
    updateDeleteButtonState();
  } else {
    gridContainer.forEach(el => el.classList.remove('select-mode-active'));
    btnSelect.innerHTML = `${ICONS.settings()} Select Rooms`;
    btnSelect.classList.remove('btn-primary');
    btnSelect.classList.add('btn-secondary');
    btnDelete.classList.add('hidden');

    document.querySelectorAll('.room-box.selected').forEach(box => box.classList.remove('selected'));
    document.querySelectorAll('.room-select-checkbox').forEach(cb => cb.checked = false);
    selectedRoomIds.clear();
  }
};

function updateDeleteButtonState() {
  const btnDelete = document.getElementById('btn-delete-selected');
  if (!btnDelete) return;
  if (selectedRoomIds.size > 0) {
    btnDelete.innerHTML = `${ICONS.trash()} Delete Selected (${selectedRoomIds.size})`;
    btnDelete.removeAttribute('disabled');
  } else {
    btnDelete.innerHTML = `${ICONS.trash()} Delete Selected`;
    btnDelete.setAttribute('disabled', 'true');
  }
}

window.handleRoomCheckboxClick = function (event) {
  event.stopPropagation();
  const cb = event.target;
  const roomId = cb.dataset.roomId;
  const box = cb.closest('.room-box');

  if (cb.checked) {
    selectedRoomIds.add(roomId);
    box.classList.add('selected');
  } else {
    selectedRoomIds.delete(roomId);
    box.classList.remove('selected');
  }
  updateDeleteButtonState();
};

window.handleRoomBoxClick = function (box, buildingId, floorId, roomId, event) {
  if (isSelectMode) {
    const cb = box.querySelector('.room-select-checkbox');
    if (cb) {
      cb.checked = !cb.checked;
      if (cb.checked) {
        selectedRoomIds.add(roomId);
        box.classList.add('selected');
      } else {
        selectedRoomIds.delete(roomId);
        box.classList.remove('selected');
      }
      updateDeleteButtonState();
    }
  } else {
    window.openRoomInfoModal(buildingId, floorId, roomId);
  }
};

window.openRoomInfoModal = function (buildingId, floorId, roomId) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;

  const tenants = allTenants.filter(t =>
    (t.status === 'active' || t.status === 'vacating') &&
    t.building_id === buildingId &&
    (t.room_id === roomId || t.room_number === room.room_number)
  );

  const container = document.getElementById('room-info-details');
  if (!container) return;

  let tenantsHTML = '';
  if (tenants.length > 0) {
    tenantsHTML = tenants.map((t, index) => {
      const tPayments = allPayments.filter(p => p.tenant_id === t.id);
      tPayments.sort((a, b) => new Date(b.created_at || b.payment_date) - new Date(a.created_at || a.payment_date));
      
      let paymentsTableHTML = '';
      if (tPayments.length > 0) {
        paymentsTableHTML = `
          <div class="table-wrap" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-light); border-radius: var(--radius-sm); margin-top: 8px;">
            <table class="data-table" style="font-size: 11px; width: 100%;">
              <thead>
                <tr>
                  <th style="padding: 4px 8px;">Date</th>
                  <th style="padding: 4px 8px;">Amount</th>
                  <th style="padding: 4px 8px;">Breakdown</th>
                  <th style="padding: 4px 8px;">Method</th>
                  <th style="padding: 4px 8px;">Txn ID</th>
                  <th style="padding: 4px 8px;">Status</th>
                  <th style="padding: 4px 8px; text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${tPayments.map(p => {
                  let statusClass = 'badge-warning';
                  if (p.status === 'approved') statusClass = 'badge-success';
                  if (p.status === 'rejected') statusClass = 'badge-danger';
                  
                  const breakdown = `Rent: ${formatCurrency(p.rent_amount || 0)} • Elec: ${formatCurrency(p.electricity_amount || 0)} • Maint: ${formatCurrency(p.maintenance_amount || 0)}`;
                  
                  let actionsHTML = '';
                  if (p.status === 'pending') {
                    actionsHTML = `<button class="btn btn-success btn-sm" style="padding: 2px 6px; font-size: 9px; min-height: auto;" onclick="event.stopPropagation(); window.approvePaymentFromRoomModal('${p.id}', '${t.id}', '${buildingId}', '${floorId}', '${roomId}')">Approve</button>`;
                  } else if (p.status === 'approved') {
                    actionsHTML = `<button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 9px; min-height: auto; display: inline-flex; align-items: center; gap: 2px;" onclick="event.stopPropagation(); window.downloadOwnerReceipt('${p.id}')">${ICONS.receipt()} Receipt</button>`;
                  } else {
                    actionsHTML = `<span class="text-muted">—</span>`;
                  }
                  
                  return `
                    <tr>
                      <td style="padding: 4px 8px; white-space: nowrap;">${formatDate(p.payment_date || p.created_at)}</td>
                      <td style="padding: 4px 8px; font-weight: bold;">${formatCurrency(p.total_amount)}</td>
                      <td style="padding: 4px 8px; color: var(--text-muted); font-size: 10px;">${breakdown}</td>
                      <td style="padding: 4px 8px;">${p.payment_method || 'UPI'}</td>
                      <td style="padding: 4px 8px; font-family: monospace; color: var(--text-muted); font-size: 10px;">${p.transaction_id || '—'}</td>
                      <td style="padding: 4px 8px;"><span class="badge ${statusClass}" style="font-size: 9px; padding: 1px 4px;">${p.status.toUpperCase()}</span></td>
                      <td style="padding: 4px 8px; text-align: right;">${actionsHTML}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        `;
      } else {
        paymentsTableHTML = `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; padding: 8px 0;">No payment history found.</div>`;
      }

      return `
      <div style="background: var(--bg-elevated); border: 1px solid var(--border-light); border-radius: var(--radius-sm); padding: var(--space-md); margin-top: 12px; position: relative;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="font-weight: 700; color: var(--text-primary); font-size: var(--font-sm); display: inline-flex; align-items: center; gap: 4px;">${ICONS.users()} Tenant ${tenants.length > 1 ? `#${index + 1}` : ''}: ${t.name}</h4>
          <span class="badge badge-success">Active</span>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: var(--font-xs); color: var(--text-secondary); margin-bottom: var(--space-md);">
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.smartphone()} <strong>Phone:</strong> ${t.phone}</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.idCard()} <strong>Aadhaar:</strong> ${t.aadhaar_number || '—'}</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.mail()} <strong>Email:</strong> ${t.email || '—'}</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.calendar()} <strong>Join Date:</strong> ${formatDate(t.join_date)}</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.coin()} <strong>Rent:</strong> ${formatCurrency(t.rent || room.rent)}/mo</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.bank()} <strong>Advance Paid:</strong> ${formatCurrency(t.advance_paid || 0)}</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.electricity()} <strong>Initial Meter:</strong> ${t.initial_meter_reading || 0} units</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.electricity()} <strong>Current Meter:</strong> ${t.current_meter_reading || t.initial_meter_reading || 0} units</div>
          <div style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.home()} <strong>Living Type:</strong> ${t.living_type?.toUpperCase() || 'ALONE'}</div>
        </div>

        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color);">
          <strong style="color: var(--text-primary); font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">${ICONS.receipt()} Payment History &amp; Transactions:</strong>
          ${paymentsTableHTML}
        </div>
        
        ${t.members && t.members.length > 0 ? `
        <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border-color);">
          <strong style="color: var(--text-primary); font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">${ICONS.users()} Only Members:</strong>
          <ul style="padding-left: 16px; margin: 4px 0 0; color: var(--text-secondary); font-size: 11px;">
            ${t.members.map(m => `<li>${m.name} (${m.relation || 'Member'}) ${m.phone ? `- ${ICONS.phone()} ${m.phone}` : ''} ${m.aadhaar_number ? `- ${ICONS.idCard()} Aadhaar: ${m.aadhaar_number}` : ''}</li>`).join('')}
          </ul>
        </div>
        ` : ''}

        <div style="display: flex; gap: 8px; margin-top: 12px;">
          <a class="btn btn-ghost btn-sm" href="tel:${t.phone}" style="display: flex; align-items: center; justify-content: center; text-decoration: none; gap: 4px;">
            ${ICONS.phone()} Call Tenant
          </a>
          <button class="btn btn-danger btn-sm" style="margin-left: auto;" onclick="removeTenantFromRoom('${t.id}', '${buildingId}')">
            Remove Tenant
          </button>
        </div>
      </div>
    `; }).join('');
  } else {
    tenantsHTML = `
      <div style="background: rgba(255, 255, 255, 0.02); border: 1px dashed var(--border-light); border-radius: var(--radius); padding: var(--space-lg); text-align: center; margin-top: 12px;">
        <div style="margin-bottom: 8px;">${ICONS.mail('', '', '24px')}</div>
        <div style="font-weight: 600; margin-bottom: 4px; color: var(--text-secondary);">Vacant (कमरा खाली है)</div>
        <p style="font-size: var(--font-xs); color: var(--text-muted); margin-bottom: 16px;">This room has no active tenants right now.</p>
        
        <button class="btn btn-primary btn-sm btn-full" onclick="closeModal('modal-room-info'); window.openAddTenantModal('${buildingId}', '${floorId}', '${roomId}');" style="margin-bottom: 12px; background: var(--gradient-primary); border: none; font-weight: 600; width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px;">
          ${ICONS.user()} Add Tenant Manually
        </button>
        
        <div style="background: var(--bg-elevated); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-light); text-align: left;">
          <div style="font-size: var(--font-xs); font-weight: 700; color: var(--text-secondary); margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">${ICONS.link()} Share Registration Link:</div>
          <div style="display: flex; gap: 8px;">
            <input type="text" class="form-input" id="share-reg-link" value="${window.location.origin}/tenant-register.html?key=${ownerData?.owner_key || ''}&bld=${buildingId}&rm=${room.room_number}" readonly style="font-size: var(--font-xs); padding: 6px 10px; background: var(--bg-surface); flex: 1;" />
            <button class="btn btn-secondary btn-sm" onclick="copyRegLink()">Copy</button>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="padding: var(--space-xs) 0;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color);">
        <div>
          <h4 style="font-size: var(--font-lg); font-weight: 800; color: var(--text-primary);">Room ${room.room_number}</h4>
          <span style="font-size: var(--font-xs); color: var(--text-muted);">${building.name} • ${getFloorLabel(floor.floor_number)}</span>
        </div>
        <span class="badge ${room.status === 'occupied' ? 'badge-success' : room.status === 'vacant' ? 'badge-danger' : room.status === 'partial' ? 'badge-warning' : 'badge-primary'}">${room.status.toUpperCase()}</span>
      </div>

      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 16px;">
        <!-- Monthly Rent Card -->
        <div style="background: var(--bg-elevated); padding: 8px 6px; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-light); display: flex; flex-direction: column; justify-content: space-between; min-height: 96px; box-sizing: border-box;">
          <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; white-space: nowrap;">Monthly Rent</div>
          <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 100%; margin-bottom: 6px; height: 28px;">
            <span style="position: absolute; left: 8px; color: var(--primary-light); font-size: 12px; font-family: monospace; pointer-events: none; line-height: 1;">₹</span>
            <input type="number" id="room-details-rent-input" value="${room.rent}" onchange="window.updateRoomRentDirect('${buildingId}', '${floorId}', '${roomId}', this.value)" style="width: 100%; height: 28px; box-sizing: border-box; padding: 0 4px 0 18px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-light); border-radius: 4px; color: var(--primary-light); font-size: 13px; font-family: monospace; text-align: center; -moz-appearance: textfield; font-weight: bold;" />
          </div>
          <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
            <button class="btn btn-secondary btn-sm" onclick="adjustRoomRent('${buildingId}', '${floorId}', '${roomId}', -500)" style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">-</button>
            <button class="btn btn-secondary btn-sm" onclick="adjustRoomRent('${buildingId}', '${floorId}', '${roomId}', 500)" style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">+</button>
          </div>
        </div>

        <!-- Maintenance Card -->
        <div style="background: var(--bg-elevated); padding: 8px 6px; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-light); display: flex; flex-direction: column; justify-content: space-between; min-height: 96px; box-sizing: border-box;">
          <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; white-space: nowrap;">Maintenance</div>
          ${room.maintenance_included ? `
            <div style="height: 28px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px;">
              <strong style="color: var(--success); font-size: 12px; font-family: monospace; white-space: nowrap; line-height: 28px;">Included</strong>
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
              <button class="btn btn-secondary btn-sm" disabled style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">-</button>
              <button class="btn btn-secondary btn-sm" disabled style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">+</button>
            </div>
          ` : `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 100%; margin-bottom: 6px; height: 28px;">
              <span style="position: absolute; left: 8px; color: var(--success); font-size: 12px; font-family: monospace; pointer-events: none; line-height: 1;">₹</span>
              <input type="number" id="room-details-maint-input" value="${room.maintenance_charge !== undefined && room.maintenance_charge !== null ? room.maintenance_charge : 0}" onchange="window.updateRoomMaintDirect('${buildingId}', '${floorId}', '${roomId}', this.value)" style="width: 100%; height: 28px; box-sizing: border-box; padding: 0 4px 0 18px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-light); border-radius: 4px; color: var(--success); font-size: 13px; font-family: monospace; text-align: center; -moz-appearance: textfield; font-weight: bold;" />
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
              <button class="btn btn-secondary btn-sm" onclick="adjustRoomMaint('${buildingId}', '${floorId}', '${roomId}', -100)" style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">-</button>
              <button class="btn btn-secondary btn-sm" onclick="adjustRoomMaint('${buildingId}', '${floorId}', '${roomId}', 100)" style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">+</button>
            </div>
          `}
        </div>

        <!-- Electricity Rate Card -->
        <div style="background: var(--bg-elevated); padding: 8px 6px; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-light); display: flex; flex-direction: column; justify-content: space-between; min-height: 96px; box-sizing: border-box;">
          <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; white-space: nowrap;">Electricity Rate</div>
          ${room.electricity_included ? `
            <div style="height: 28px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px;">
              <strong style="color: var(--accent); font-size: 12px; font-family: monospace; white-space: nowrap; line-height: 28px;">Included</strong>
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
              <button class="btn btn-secondary btn-sm" disabled style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">-</button>
              <button class="btn btn-secondary btn-sm" disabled style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">+</button>
            </div>
          ` : `
            <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 100%; margin-bottom: 6px; height: 28px;">
              <span style="position: absolute; left: 8px; color: var(--accent); font-size: 12px; font-family: monospace; pointer-events: none; line-height: 1;">₹</span>
              <input type="number" id="room-details-elec-input" value="${room.electricity_rate !== undefined && room.electricity_rate !== null ? room.electricity_rate : (building.electricity_rate || 10)}" onchange="window.updateRoomElecRateDirect('${buildingId}', '${floorId}', '${roomId}', this.value)" style="width: 100%; height: 28px; box-sizing: border-box; padding: 0 4px 0 18px; background: rgba(0, 0, 0, 0.2); border: 1px solid var(--border-light); border-radius: 4px; color: var(--accent); font-size: 13px; font-family: monospace; text-align: center; -moz-appearance: textfield; font-weight: bold;" />
            </div>
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%;">
              <button class="btn btn-secondary btn-sm" onclick="adjustRoomElecRate('${buildingId}', '${floorId}', '${roomId}', -1)" style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">-</button>
              <button class="btn btn-secondary btn-sm" onclick="adjustRoomElecRate('${buildingId}', '${floorId}', '${roomId}', 1)" style="flex: 1; height: 24px; display: flex; align-items: center; justify-content: center; padding: 0; min-height: unset; font-size: 14px; font-weight: bold; border-radius: 4px; line-height: 1;">+</button>
            </div>
          `}
        </div>

        <!-- Subsidy Settings Card -->
        <div style="background: var(--bg-elevated); padding: 8px 6px; border-radius: var(--radius-sm); text-align: center; border: 1px solid var(--border-light); display: flex; flex-direction: column; justify-content: space-between; min-height: 96px; box-sizing: border-box;">
          <div style="font-size: 11px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; white-space: nowrap;">Subsidy Settings</div>
          ${room.electricity_included ? `
            <div style="height: 28px; display: flex; align-items: center; justify-content: center; margin-bottom: 6px;">
              <strong style="color: var(--text-muted); font-size: 12px; font-family: monospace; white-space: nowrap; line-height: 28px;">N/A</strong>
            </div>
            <div style="font-size: 10px; color: var(--text-muted);">Included in rent</div>
          ` : `
            <div style="display: flex; align-items: center; justify-content: center; gap: 6px; height: 28px; margin-bottom: 4px;">
              <input type="checkbox" id="room-details-subsidy-checkbox" ${room.electricity_subsidy_mode ? 'checked' : ''} onchange="window.toggleRoomSubsidyDirect('${buildingId}', '${floorId}', '${roomId}', this.checked)" style="width: 15px; height: 15px; cursor: pointer; margin: 0;" />
              <label for="room-details-subsidy-checkbox" style="font-size: 12px; font-weight: bold; color: ${room.electricity_subsidy_mode ? 'var(--success)' : 'var(--text-muted)'}; cursor: pointer; user-select: none;">Subsidy</label>
            </div>
            <div style="display: flex; gap: 4px; align-items: center; justify-content: center; opacity: ${room.electricity_subsidy_mode ? '1' : '0.4'}; pointer-events: ${room.electricity_subsidy_mode ? 'auto' : 'none'}; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 2px;">
                <span style="font-size: 10px; color: var(--text-secondary);">Limit:</span>
                <input type="number" id="room-details-subsidy-units" value="${room.electricity_subsidy_units !== undefined && room.electricity_subsidy_units !== null ? room.electricity_subsidy_units : 1}" min="1" onchange="window.updateRoomSubsidyUnitsDirect('${buildingId}', '${floorId}', '${roomId}', this.value)" style="width: 40px; height: 22px; text-align: center; font-size: 11px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-light); border-radius: 4px; color: var(--primary-light); font-weight: bold; box-sizing: border-box;" title="Subsidy Limit Units" />
              </div>
              <div style="display: flex; align-items: center; gap: 2px;">
                <span style="font-size: 10px; color: var(--text-secondary);">Rate:</span>
                <input type="number" id="room-details-subsidy-rate" value="${room.electricity_subsidy_rate !== undefined && room.electricity_subsidy_rate !== null ? room.electricity_subsidy_rate : 0}" min="0" onchange="window.updateRoomSubsidyRateDirect('${buildingId}', '${floorId}', '${roomId}', this.value)" style="width: 35px; height: 22px; text-align: center; font-size: 11px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-light); border-radius: 4px; color: var(--primary-light); font-weight: bold; box-sizing: border-box;" title="Subsidy Rate" />
              </div>
            </div>
          `}
        </div>
      </div>

      <div class="form-group" style="margin-bottom: 16px;">
        <label class="form-label" style="font-size: var(--font-xs); font-weight: 700; color: var(--text-secondary);">Change Room Status manually:</label>
        <select class="form-input form-select" style="font-size: var(--font-xs); height: 36px; padding: 6px 12px;" onchange="updateRoomStatus('${buildingId}', '${floorId}', '${roomId}', this.value)">
          <option value="vacant" ${room.status === 'vacant' ? 'selected' : ''}>Vacant (खाली है)</option>
          <option value="occupied" ${room.status === 'occupied' ? 'selected' : ''}>Occupied (भरा हुआ है)</option>
          <option value="partial" ${room.status === 'partial' ? 'selected' : ''}>Partial (कुछ बेड खाली हैं)</option>
          <option value="maintenance" ${room.status === 'maintenance' ? 'selected' : ''}>Maintenance (काम चल रहा है)</option>
        </select>
      </div>

      <div>
        <h5 style="font-size: var(--font-xs); font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Tenant Information</h5>
        ${tenantsHTML}
      </div>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end;">
        <button class="btn btn-danger btn-sm" onclick="deleteRoom('${buildingId}', '${floorId}', '${roomId}')">
          ${ICONS.trash()} Delete Room
        </button>
      </div>
    </div>
  `;

  openModal('modal-room-info');
};

window.copyRegLink = function () {
  const linkInput = document.getElementById('share-reg-link');
  if (linkInput) {
    linkInput.select();
    navigator.clipboard.writeText(linkInput.value);
    showToast('Copied!', 'Tenant registration link copied to clipboard', 'success');
  }
};

window.updateRoomStatus = async function (buildingId, floorId, roomId, newStatus) {
  try {
    const { error } = await supabase.from('rooms').update({ status: newStatus }).eq('id', roomId);
    if (error) throw error;

    const building = buildings.find(b => b.id === buildingId);
    const floor = building?.floors.find(f => f.id === floorId);
    const room = floor?.rooms.find(r => r.id === roomId);
    if (room) {
      room.status = newStatus;
    }

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
    showToast('Status Updated', `Room status changed to ${newStatus.toUpperCase()}`, 'success');
  } catch (err) {
    console.error('Error updating room status:', err);
    showToast('Error', 'Failed to update status: ' + err.message, 'error');
  }
};

window.adjustRoomRent = async function (buildingId, floorId, roomId, delta) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const currentRent = parseFloat(room.rent) || 0;
  const newRent = Math.max(0, currentRent + delta);

  if (newRent === currentRent) return;

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ rent: newRent })
      .eq('id', roomId);

    if (error) throw error;

    room.rent = newRent;

    // Update UI value immediately in modal
    const rentEl = document.getElementById('room-details-rent-input');
    if (rentEl) rentEl.value = newRent;

    showToast('Rent Updated', `Room rent set to ${formatCurrency(newRent)}`, 'success');

    // Re-render main dashboard grid to reflect changes
    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update rent:', err);
    showToast('Error', 'Failed to update rent: ' + err.message, 'error');
  }
};

window.adjustRoomBeds = async function (buildingId, floorId, roomId, delta) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const currentBeds = parseInt(room.beds_count) || 1;
  const occupiedBeds = parseInt(room.beds_occupied) || 0;
  const newBeds = Math.max(occupiedBeds, currentBeds + delta); // Cannot set beds less than currently occupied

  if (newBeds === currentBeds) {
    if (currentBeds + delta < occupiedBeds) {
      showToast('Limit Reached', 'Cannot reduce beds below currently occupied count', 'warning');
    }
    return;
  }

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ beds_count: newBeds })
      .eq('id', roomId);

    if (error) throw error;

    room.beds_count = newBeds;

    // Update UI text
    const bedsEl = document.getElementById('room-details-beds-text');
    if (bedsEl) bedsEl.textContent = `${occupiedBeds} / ${newBeds}`;

    showToast('Capacity Updated', `Room capacity set to ${newBeds} beds`, 'success');

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update beds:', err);
    showToast('Error', 'Failed to update capacity: ' + err.message, 'error');
  }
};

window.adjustRoomElecRate = async function (buildingId, floorId, roomId, delta) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;

  // Get current room level rate, fallback to building rate or 10
  const currentRate = room.electricity_rate !== undefined && room.electricity_rate !== null
    ? parseFloat(room.electricity_rate)
    : (parseFloat(building?.electricity_rate) || 10);

  const newRate = Math.max(0, currentRate + delta);

  if (newRate === currentRate) return;

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ electricity_rate: newRate })
      .eq('id', roomId);

    if (error) throw error;

    room.electricity_rate = newRate;

    // Update UI value
    const elecEl = document.getElementById('room-details-elec-input');
    if (elecEl) elecEl.value = newRate;

    showToast('Electricity Rate Updated', `Electricity rate set to ₹${newRate}/unit`, 'success');

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update electricity rate:', err);
    showToast('Error', 'Failed to update rate: ' + err.message, 'error');
  }
};

window.updateRoomRentDirect = async function (buildingId, floorId, roomId, val) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const newRent = Math.max(0, parseInt(val) || 0);

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ rent: newRent })
      .eq('id', roomId);

    if (error) throw error;

    room.rent = newRent;

    showToast('Rent Updated', `Room rent set to ${formatCurrency(newRent)}`, 'success');

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update rent:', err);
    showToast('Error', 'Failed to update rent: ' + err.message, 'error');
  }
};

window.updateRoomElecRateDirect = async function (buildingId, floorId, roomId, val) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const newRate = Math.max(0, parseInt(val) || 0);

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ electricity_rate: newRate })
      .eq('id', roomId);

    if (error) throw error;

    room.electricity_rate = newRate;

    showToast('Electricity Rate Updated', `Electricity rate set to ₹${newRate}/unit`, 'success');

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update electricity rate:', err);
    showToast('Error', 'Failed to update rate: ' + err.message, 'error');
  }
};

window.toggleRoomSubsidyDirect = async function (buildingId, floorId, roomId, isChecked) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ electricity_subsidy_mode: isChecked })
      .eq('id', roomId);

    if (error) throw error;

    room.electricity_subsidy_mode = isChecked;

    showToast('Subsidy Mode Updated', `Electricity subsidy mode set to ${isChecked ? 'ON' : 'OFF'}`, 'success');

    window.openRoomInfoModal(buildingId, floorId, roomId);
    showBuildingRooms(buildingId);
  } catch (err) {
    console.error('Failed to update subsidy mode:', err);
    showToast('Error', 'Failed to update subsidy mode: ' + err.message, 'error');
  }
};

window.updateRoomSubsidyUnitsDirect = async function (buildingId, floorId, roomId, val) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const newUnits = Math.max(1, parseInt(val) || 1);

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ electricity_subsidy_units: newUnits })
      .eq('id', roomId);

    if (error) throw error;

    room.electricity_subsidy_units = newUnits;

    showToast('Subsidy Limit Updated', `Subsidy limit set to ${newUnits} units`, 'success');
    showBuildingRooms(buildingId);
  } catch (err) {
    console.error('Failed to update subsidy units:', err);
    showToast('Error', 'Failed to update subsidy units: ' + err.message, 'error');
  }
};

window.updateRoomSubsidyRateDirect = async function (buildingId, floorId, roomId, val) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const newRate = Math.max(0, parseInt(val) || 0);

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ electricity_subsidy_rate: newRate })
      .eq('id', roomId);

    if (error) throw error;

    room.electricity_subsidy_rate = newRate;

    showToast('Subsidy Rate Updated', `Subsidy rate set to ₹${newRate}/unit`, 'success');
    showBuildingRooms(buildingId);
  } catch (err) {
    console.error('Failed to update subsidy rate:', err);
    showToast('Error', 'Failed to update subsidy rate: ' + err.message, 'error');
  }
};

window.adjustRoomMaint = async function (buildingId, floorId, roomId, delta) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const currentMaint = parseFloat(room.maintenance_charge) || 0;
  const newMaint = Math.max(0, currentMaint + delta);

  if (newMaint === currentMaint) return;

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ maintenance_charge: newMaint })
      .eq('id', roomId);

    if (error) throw error;

    room.maintenance_charge = newMaint;

    // Update UI value immediately
    const maintEl = document.getElementById('room-details-maint-input');
    if (maintEl) maintEl.value = newMaint;

    showToast('Maintenance Updated', `Maintenance charge set to ${formatCurrency(newMaint)}`, 'success');

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update maintenance charge:', err);
    showToast('Error', 'Failed to update maintenance: ' + err.message, 'error');
  }
};

window.updateRoomMaintDirect = async function (buildingId, floorId, roomId, val) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (!room) return;
  const newMaint = Math.max(0, parseInt(val) || 0);

  try {
    const { error } = await supabase
      .from('rooms')
      .update({ maintenance_charge: newMaint })
      .eq('id', roomId);

    if (error) throw error;

    room.maintenance_charge = newMaint;

    showToast('Maintenance Updated', `Maintenance charge set to ${formatCurrency(newMaint)}`, 'success');

    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
  } catch (err) {
    console.error('Failed to update maintenance charge:', err);
    showToast('Error', 'Failed to update maintenance: ' + err.message, 'error');
  }
};

window.removeTenantFromRoom = async function (tenantId, buildingId) {
  if (!confirm('Are you sure? This tenant will be removed.')) return;

  const tenantObj = allTenants.find(t => t.id === tenantId);
  if (!tenantObj) return;

  try {
    const { error: err1 } = await supabase
      .from('tenants')
      .update({
        status: 'vacated',
        vacate_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', tenantId);
    if (err1) throw err1;

    // Delete members when vacating
    await supabase.from('members').delete().eq('tenant_id', tenantId);

    // Create a vacate notice row for tracking deposits/refunds
    await supabase.from('vacate_notices').insert({
      tenant_id: tenantId,
      building_id: tenantObj.building_id,
      owner_id: ownerData.id,
      reason: 'Manual Checkout by Owner',
      preferred_date: new Date().toISOString().split('T')[0],
      deposit_amount: tenantObj.advance_paid || 0,
      deposit_refunded: false,
      status: 'processed'
    });

    const roomUpdate = { beds_occupied: 0, status: 'vacant' };
    let targetRoom = null;
    buildings.forEach(b => {
      b.floors?.forEach(f => {
        f.rooms?.forEach(r => {
          if (r.room_number === tenantObj.room_number && b.id === tenantObj.building_id) {
            targetRoom = r;
          }
        });
      });
    });

    if (targetRoom) {
      roomUpdate.beds_occupied = Math.max(0, targetRoom.beds_occupied - 1);
      if (roomUpdate.beds_occupied > 0) {
        roomUpdate.status = roomUpdate.beds_occupied < targetRoom.beds_count ? 'partial' : 'occupied';
      }
      await supabase.from('rooms').update(roomUpdate).eq('id', targetRoom.id);
    }

    buildings.forEach(b => {
      if (b.id === tenantObj.building_id) {
        b.floors?.forEach(f => {
          f.rooms?.forEach(r => {
            if (r.room_number === tenantObj.room_number) {
              r.beds_occupied = Math.max(0, r.beds_occupied - 1);
              if (r.beds_occupied === 0) {
                r.status = 'vacant';
              } else if (r.beds_occupied < r.beds_count) {
                r.status = 'partial';
              }
            }
          });
        });
      }
    });

    await loadRealData();

    closeModal('modal-room-info');
    showBuildingRooms(buildingId);
    renderTenantsTable();
    renderKPIs();
    showToast('Tenant Removed', 'Room occupant has been removed', 'warning');
  } catch (err) {
    console.error('Error removing tenant:', err);
    showToast('Error', 'Failed to remove tenant: ' + err.message, 'error');
  }
};

window.deleteRoom = async function (buildingId, floorId, roomId) {
  if (!confirm('Are you sure you want to delete this room? This action cannot be undone.')) return;

  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  const room = floor?.rooms.find(r => r.id === roomId);

  if (room && (room.status === 'occupied' || room.status === 'partial' || room.beds_occupied > 0)) {
    if (!confirm('Warning: This room is currently occupied. Deleting it will vacate active tenants. Do you still want to delete?')) {
      return;
    }
  }

  try {
    // Delete members for vacated tenants in this room
    const { data: activeTenants } = await supabase
      .from('tenants')
      .select('id')
      .eq('room_id', roomId)
      .eq('status', 'active');

    if (activeTenants && activeTenants.length > 0) {
      const tenantIds = activeTenants.map(t => t.id);
      await supabase.from('members').delete().in('tenant_id', tenantIds);
    }

    // Vacate all active tenants in this room first
    await supabase
      .from('tenants')
      .update({ status: 'vacated', vacate_date: new Date().toISOString().split('T')[0] })
      .eq('room_id', roomId)
      .eq('status', 'active');

    const { error } = await supabase.from('rooms').delete().eq('id', roomId);
    if (error) throw error;

    if (building && floor) {
      floor.rooms = floor.rooms.filter(r => r.id !== roomId);
    }

    closeModal('modal-room-info');
    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();
    await logOwnerActivity(`Deleted Room ${room?.room_number || '—'} in building "${building?.name || '—'}"`);
    showToast('Room Deleted', 'The room has been removed and tenants vacated.', 'success');
  } catch (err) {
    console.error('Error deleting room:', err);
    showToast('Error', 'Failed to delete room: ' + err.message, 'error');
  }
};

window.deleteSelectedRooms = async function () {
  if (selectedRoomIds.size === 0) return;
  const count = selectedRoomIds.size;

  let hasOccupied = false;
  buildings.forEach(building => {
    building.floors?.forEach(floor => {
      floor.rooms?.forEach(room => {
        if (selectedRoomIds.has(room.id) && (room.status === 'occupied' || room.status === 'partial' || room.beds_occupied > 0)) {
          hasOccupied = true;
        }
      });
    });
  });

  if (hasOccupied) {
    if (!confirm('Warning: One or more selected rooms are currently occupied. Deleting them will remove the rooms and vacate active tenants. Do you still want to proceed?')) {
      return;
    }
  } else {
    if (!confirm(`Are you sure you want to delete the ${count} selected rooms?`)) return;
  }

  try {
    const idsToDelete = Array.from(selectedRoomIds);

    // Delete members for vacated tenants in selected rooms
    const { data: activeTenants } = await supabase
      .from('tenants')
      .select('id')
      .in('room_id', idsToDelete)
      .eq('status', 'active');

    if (activeTenants && activeTenants.length > 0) {
      const tenantIds = activeTenants.map(t => t.id);
      await supabase.from('members').delete().in('tenant_id', tenantIds);
    }

    // Vacate all active tenants in selected rooms first
    await supabase
      .from('tenants')
      .update({ status: 'vacated', vacate_date: new Date().toISOString().split('T')[0] })
      .in('room_id', idsToDelete)
      .eq('status', 'active');

    const { error } = await supabase.from('rooms').delete().in('id', idsToDelete);
    if (error) throw error;

    buildings.forEach(building => {
      building.floors?.forEach(floor => {
        if (floor.rooms) {
          floor.rooms = floor.rooms.filter(room => !selectedRoomIds.has(room.id));
        }
      });
    });

    toggleSelectMode();

    if (activeGridBuildingId) {
      showBuildingRooms(activeGridBuildingId);
    }
    renderBuildingsList();
    renderKPIs();
    showToast('Rooms Deleted', `${count} rooms have been removed successfully.`, 'success');
  } catch (err) {
    console.error('Error deleting rooms:', err);
    showToast('Error', 'Failed to delete rooms: ' + err.message, 'error');
  }
};

// ── Add Building ──
window.onBuildingTypeChange = function () {
  const bedOpts = document.getElementById('bed-options');
  if (bedOpts) bedOpts.style.display = 'none';
  // Also update split preview if toggle is on
  onBldRentSplitChange();
};

window.toggleElecIncluded = function () {
  const checked = document.getElementById('bld-elec-included').checked;
  document.getElementById('elec-rate-group').style.display = checked ? 'none' : 'block';
};

window.toggleFloorElecIncluded = function () {
  const checked = document.getElementById('add-floor-elec-included').checked;
  document.getElementById('add-floor-elec-rate-group').style.display = checked ? 'none' : 'flex';
};

window.toggleFloorMaintIncluded = function () {
  const checked = document.getElementById('add-floor-maint-included').checked;
  const rateGroup = document.getElementById('add-floor-maint-rate-group');
  if (rateGroup) {
    if (checked) {
      rateGroup.style.opacity = '0.5';
      const input = document.getElementById('add-floor-maint-charge');
      if (input) {
        input.value = '0';
        input.setAttribute('disabled', 'true');
      }
    } else {
      rateGroup.style.opacity = '1';
      const input = document.getElementById('add-floor-maint-charge');
      if (input) {
        input.removeAttribute('disabled');
        const building = buildings.find(b => b.id === activeGridBuildingId);
        input.value = building ? (building.maintenance_charge || 500) : 500;
      }
    }
  }
};

window.toggleEditFloorElecIncluded = function () {
  const checked = document.getElementById('edit-floor-elec-included').checked;
  document.getElementById('edit-floor-elec-rate-group').style.display = checked ? 'none' : 'flex';
};

window.toggleEditFloorMaintIncluded = function () {
  const checked = document.getElementById('edit-floor-maint-included').checked;
  const rateGroup = document.getElementById('edit-floor-maint-rate-group');
  if (rateGroup) {
    if (checked) {
      rateGroup.style.opacity = '0.5';
      const input = document.getElementById('edit-floor-room-maint');
      if (input) {
        input.value = '0';
        input.setAttribute('disabled', 'true');
      }
    } else {
      rateGroup.style.opacity = '1';
      const input = document.getElementById('edit-floor-room-maint');
      if (input) {
        input.removeAttribute('disabled');
        const building = buildings.find(b => b.id === activeGridBuildingId);
        input.value = building ? (building.maintenance_charge || 500) : 500;
      }
    }
  }
};

// Live per-bed rent preview in building modal
window.onBldRentSplitChange = function () {
  const preview = document.getElementById('bld-split-preview');
  if (preview) preview.classList.add('hidden');
};

window.toggleFloorSubsidyFields = function (prefix) {
  const checkbox = document.getElementById(`${prefix}-floor-subsidy-mode`);
  const isChecked = checkbox ? checkbox.checked : false;
  const subsidyRow = document.getElementById(`${prefix}-floor-subsidy-row`);
  if (subsidyRow) subsidyRow.style.display = isChecked ? 'flex' : 'none';
};

window.toggleCalcSubsidyFields = function () {
  const checkbox = document.getElementById('calc-subsidy-mode');
  const isChecked = checkbox ? checkbox.checked : false;
  const subsidyRow = document.getElementById('calc-subsidy-row');
  if (subsidyRow) subsidyRow.style.display = isChecked ? 'flex' : 'none';
};

window.saveNewBuilding = async function () {
  const allowed = (ownerData && ownerData.allowed_buildings !== undefined && ownerData.allowed_buildings !== null)
    ? parseInt(ownerData.allowed_buildings)
    : (parseInt(localStorage.getItem('pgb_allowed_buildings')) || 0);
  console.log('saveNewBuilding Limit Check:', { allowed, currentCount: buildings.length, rawAllowed: ownerData?.allowed_buildings });

  const isEnterprise = ownerData && ownerData.plan_type === 'Enterprise';
  if (!isEnterprise && buildings.length >= allowed) {
    showToast('Limit Reached', `You have reached your limit of ${allowed} building(s).`, 'error');
    alert(`Limit Reached: You have reached your limit of ${allowed} building(s). Please upgrade your plan in settings.`);
    return;
  }

  const name = document.getElementById('bld-name').value.trim();
  const location = document.getElementById('bld-location').value.trim();
  const type = document.getElementById('bld-type').value;
  const roomPrefix = document.getElementById('bld-room-prefix').value.trim() || '101';
  const roomsPerFloor = parseInt(document.getElementById('bld-rooms-per-floor').value) || 10;
  const rawFloors = document.getElementById('bld-floors').value;
  // parseInt('0') is falsy → use explicit check so 0 = Ground Floor
  const numFloors = rawFloors === '' ? 2 : Math.max(0, parseInt(rawFloors) || 0);
  const rent = parseInt(document.getElementById('bld-rent').value) || 8000;
  const beds = parseInt(document.getElementById('bld-beds').value) || 3;
  const advance = parseInt(document.getElementById('bld-advance').value) || 5000;
  const maintenance = parseInt(document.getElementById('bld-maintenance').value) || 500;
  const elecIncluded = document.getElementById('bld-elec-included').checked;
  const elecRate = parseInt(document.getElementById('bld-elec-rate').value) || 10;
  const rentSplitEnabled = false; // Rent split feature removed

  if (!name || !location) {
    showToast('Missing Fields', 'Enter building name and location', 'warning');
    return;
  }

  const btn = document.querySelector('#modal-add-building button.btn-primary');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating Building...';

  try {
    const isPG = ['pg', 'hostel'].includes(type);

    // 1. Insert building into Supabase
    const { data: bldData, error: bldErr } = await supabase
      .from('buildings')
      .insert({
        owner_id: ownerData.id,
        name,
        location,
        type,
        electricity_rate: elecIncluded ? null : elecRate,
        advance_amount: advance,
        maintenance_charge: maintenance,
        electricity_included: elecIncluded
      })
      .select()
      .single();

    if (bldErr) throw bldErr;

    // Building created successfully. Floors and rooms will be added manually via "Add Floor".

    // Re-fetch all data to refresh client state
    await loadRealData();

    closeModal('modal-add-building');
    renderBuildingSelect();
    renderBuildingsList();
    renderKPIs();
    await logOwnerActivity(`Created building "${name}" in ${location}`);
    showToast('Building Created!', `${name} created successfully.`, 'building');

    // Clear form
    document.getElementById('bld-name').value = '';
    document.getElementById('bld-location').value = '';
  } catch (err) {
    console.error('Error saving building:', err);
    showToast('Error', 'Failed to create building: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ═══════════════ TENANT MANAGEMENT ═══════════════
window.approveTenant = async function (tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  try {
    // 1. Set status in tenants table
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        status: 'active',
        owner_id: ownerData.id
      })
      .eq('id', tenantId);

    if (tenantErr) throw tenantErr;

    // 2. Increment occupancy on the room in Supabase
    if (tenant.room_id) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', tenant.room_id)
        .maybeSingle();

      if (!roomGetErr && roomData) {
        const nextBedsOccupied = Math.min(roomData.beds_count, roomData.beds_occupied + 1);
        const nextStatus = nextBedsOccupied === roomData.beds_count ? 'occupied' : 'partial';

        await supabase
          .from('rooms')
          .update({
            beds_occupied: nextBedsOccupied,
            status: nextStatus
          })
          .eq('id', tenant.room_id);
      }
    }

    await loadRealData();
    refreshActiveViews();
    if (activeGridBuildingId) showBuildingRooms(activeGridBuildingId);
    await logOwnerActivity(`Approved tenant registration for ${tenant.name} into Room ${tenant.room_number || '—'} in building "${tenant.building_name || '—'}"`);
    showToast('Approved!', `${tenant.name} is now an active tenant`, 'success');
  } catch (err) {
    console.error('Error approving tenant:', err);
    showToast('Error', 'Failed to approve tenant: ' + err.message, 'error');
  }
};

window.rejectTenant = async function (tenantId) {
  try {
    const tenantObj = allTenants.find(t => t.id === tenantId);

    const { error } = await supabase
      .from('tenants')
      .update({
        status: 'rejected'
      })
      .eq('id', tenantId);

    if (error) throw error;

    if (tenantObj && tenantObj.room_id) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', tenantObj.room_id)
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
          .eq('id', tenantObj.room_id);
      }
    }

    await loadRealData();
    refreshActiveViews();
    if (activeGridBuildingId) showBuildingRooms(activeGridBuildingId);
    await logOwnerActivity(`Rejected tenant registration for ${tenantObj?.name || 'Tenant'} for Room ${tenantObj?.room_number || '—'}`);
    showToast('Rejected', 'Tenant request has been declined', 'warning');
  } catch (err) {
    console.error('Error rejecting tenant:', err);
    showToast('Error', 'Failed to reject: ' + err.message, 'error');
  }
};

window.verifyTenantAadhar = async function (tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  try {
    const { error } = await supabase
      .from('tenants')
      .update({ aadhar_verified: true })
      .eq('id', tenantId);

    if (error) throw error;

    await loadRealData();
    refreshActiveViews();
    await logOwnerActivity(`Verified Aadhaar card copy for tenant ${tenant.name}`);
    showToast('Aadhaar Verified', `${tenant.name}'s Aadhaar copy is verified`, 'success');
  } catch (err) {
    console.error('Error verifying Aadhaar:', err);
    showToast('Error', 'Failed to verify Aadhaar: ' + err.message, 'error');
  }
};

window.unverifyTenantAadhar = async function (tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  try {
    const { error } = await supabase
      .from('tenants')
      .update({ aadhar_verified: false })
      .eq('id', tenantId);

    if (error) throw error;

    await loadRealData();
    refreshActiveViews();
    await logOwnerActivity(`Marked Aadhaar card copy for tenant ${tenant.name} as unverified`);
    showToast('Aadhaar Unverified', `${tenant.name} is marked as unverified`, 'info');
  } catch (err) {
    console.error('Error unverifying Aadhaar:', err);
    showToast('Error', 'Failed to unverify Aadhaar: ' + err.message, 'error');
  }
};

window.approvePayment = async function (paymentId) {
  const payment = allPayments.find(p => p.id === paymentId);
  if (!payment) return;

  try {
    const { error } = await supabase
      .from('payments')
      .update({ status: 'approved' })
      .eq('id', paymentId);

    if (error) throw error;

    // Update tenant's advance_paid and current_meter_reading in database if applicable
    if (payment.tenant_id) {
      const tenant = allTenants.find(t => t.id === payment.tenant_id);
      const updates = {};
      if (payment.advance_amount > 0) {
        updates.advance_paid = payment.advance_amount;
      }
      if (payment.curr_reading > 0 && tenant && payment.room_id === tenant.room_id) {
        updates.current_meter_reading = payment.curr_reading;
      }
      if (Object.keys(updates).length > 0) {
        await supabase
          .from('tenants')
          .update(updates)
          .eq('id', payment.tenant_id);
      }

      // 🔔 Push notification to tenant
      if (tenant?.auth_user_id) {
        sendPushNotification({
          toUserId: tenant.auth_user_id,
          title: 'Payment Approved!',
          body: `Your rent of ${formatCurrency(payment.total_amount)} for ${payment.month_year} has been approved by your owner.`,
          url: '/tenant-dashboard.html',
          type: 'success',
          tag: 'payment-approved'
        }).catch(() => { });
      }
    }

    await loadRealData();

    // Auto-switch owner view to approved payment's month to instantly show updated statistics/transactions
    if (payment.month_year) {
      currentSelectedMonth = payment.month_year;
      // Sync select elements
      ['dashboard-month-filter', 'rent-overview-month-filter', 'txn-month-filter', 'expenses-month-filter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = payment.month_year;
      });
      setDateDisplay();
    }

    refreshActiveViews();
    await logOwnerActivity(`Approved payment of ${formatCurrency(payment.total_amount)} for ${payment.month_year} from Room ${payment.room_number} (${payment.tenant_name})`);
    showToast('Payment Approved!', `${formatCurrency(payment.total_amount)} from Room ${payment.room_number}`, 'payment');
  } catch (err) {
    console.error('Error approving payment:', err);
    showToast('Error', 'Failed to approve payment: ' + err.message, 'error');
  }
};

window.approvePaymentFromRoomModal = async function (paymentId, tenantId, buildingId, floorId, roomId) {
  await window.approvePayment(paymentId);
  window.openRoomInfoModal(buildingId, floorId, roomId);
};

window.approvePaymentFromProfileModal = async function (paymentId, tenantId) {
  await window.approvePayment(paymentId);
  window.viewTenantDetails(tenantId);
};


function renderTenantsTable() {
  renderPendingRentPaymentsList();

  const tbody = document.getElementById('tenants-table-body');
  const filtered = currentBuildingFilter === 'all'
    ? allTenants.filter(t => t.status === 'active' || t.status === 'vacating')
    : allTenants.filter(t => (t.status === 'active' || t.status === 'vacating') && t.building_id === currentBuildingFilter);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="text-center text-muted" style="padding: 24px;">No tenants</td></tr>';
  } else {
    const d = new Date();
    const currentMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    tbody.innerHTML = filtered.map(t => {
      const isPaid = allPayments.some(p => p.tenant_id === t.id && p.month_year === currentMonthStr && p.status === 'approved');
      const verifiedBadge = t.aadhar_verified
        ? `<span class="badge badge-success" style="font-size: 9px; padding: 2px 4px; margin-left: 6px; border-radius: 4px; font-weight: 700;">Verified</span>`
        : `<span class="badge badge-neutral" style="font-size: 9px; padding: 2px 4px; margin-left: 6px; border-radius: 4px; font-weight: 700; color: var(--text-muted);">Pending</span>`;

      return `
      <tr onclick="viewTenantDetails('${t.id}')" style="cursor: pointer;" class="hover-row">
        <td><strong>${t.name}</strong></td>
        <td>${t.phone}</td>
        <td>${t.building_name || '—'}</td>
        <td>${t.floor_number || '—'}</td>
        <td>${t.room_number || '—'}</td>
        <td>${formatCurrency(t.rent || 0)}</td>
        <td>${formatCurrency(t.advance_paid || 0)}</td>
        <td>${t.members_count}</td>
        <td>
          ${t.aadhaar_number || '—'}
          ${verifiedBadge}
        </td>
        <td>${formatDate(t.join_date)}</td>
        <td>
          <span class="badge ${isPaid ? 'badge-success' : 'badge-warning'}">${isPaid ? 'Paid' : 'Pending'}</span>
        </td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); removeTenant('${t.id}')">Remove</button>
        </td>
      </tr>`;
    }).join('');
  }

  // Render Aadhaar Verification lists
  const activeTenantsList = filtered;
  const unverifiedTenants = activeTenantsList.filter(t => !t.aadhar_verified);
  const verifiedTenants = activeTenantsList.filter(t => t.aadhar_verified === true);

  const unverifiedBadge = document.getElementById('unverified-count-badge');
  if (unverifiedBadge) {
    unverifiedBadge.textContent = unverifiedTenants.length;
    unverifiedBadge.style.display = unverifiedTenants.length > 0 ? 'inline-block' : 'none';
  }

  const unverifiedTbody = document.getElementById('tenants-unverified-table-body');
  if (unverifiedTbody) {
    document.getElementById('verification-pending-count').textContent = `${unverifiedTenants.length} pending`;
    if (unverifiedTenants.length === 0) {
      unverifiedTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No unverified tenants</td></tr>';
    } else {
      unverifiedTbody.innerHTML = unverifiedTenants.map(t => `
        <tr>
          <td><strong>${t.name}</strong></td>
          <td>${t.phone}</td>
          <td>${t.building_name || '—'}</td>
          <td>Room ${t.room_number || '—'}</td>
          <td>${t.aadhaar_number || '—'}</td>
          <td>${formatDate(t.join_date)}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-success btn-sm" onclick="event.stopPropagation(); verifyTenantAadhar('${t.id}')" style="display:inline-flex; align-items:center; gap:4px;">
              <svg class="svg-icon" style="width:14px; height:14px; stroke: currentColor; fill: none; stroke-width: 2.5;" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
              Verify
            </button>
          </td>
        </tr>`).join('');
    }
  }

  const verifiedTbody = document.getElementById('tenants-verified-table-body');
  if (verifiedTbody) {
    document.getElementById('verification-done-count').textContent = `${verifiedTenants.length} verified`;
    if (verifiedTenants.length === 0) {
      verifiedTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No verified tenants yet</td></tr>';
    } else {
      verifiedTbody.innerHTML = verifiedTenants.map(t => `
        <tr>
          <td><strong>${t.name}</strong></td>
          <td>${t.phone}</td>
          <td>${t.building_name || '—'}</td>
          <td>Room ${t.room_number || '—'}</td>
          <td>${t.aadhaar_number || '—'}</td>
          <td>${formatDate(t.join_date)}</td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); unverifyTenantAadhar('${t.id}')" style="display:inline-flex; align-items:center; gap:4px; color:var(--text-muted);">
              Unverify
            </button>
          </td>
        </tr>`).join('');
    }
  }

  // Render Pending Registration Approvals
  const pendingTbody = document.getElementById('tenants-pending-table-body');
  if (pendingTbody) {
    const pendingFiltered = currentBuildingFilter === 'all'
      ? allTenants.filter(t => t.status === 'pending')
      : allTenants.filter(t => t.status === 'pending' && t.building_id === currentBuildingFilter);

    document.getElementById('tenants-pending-count').textContent = `${pendingFiltered.length} pending`;

    if (pendingFiltered.length === 0) {
      pendingTbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding: 24px;">No pending registration requests</td></tr>';
    } else {
      pendingTbody.innerHTML = pendingFiltered.map(t => `
        <tr>
          <td><strong>${t.name}</strong></td>
          <td>${t.phone}</td>
          <td>${t.building_name || '—'}</td>
          <td>${getFloorLabel(t.floor_number)}</td>
          <td>Room ${t.room_number || '—'}</td>
          <td>${t.aadhaar_number || '—'}</td>
          <td style="text-align: center;"><span class="badge badge-info" style="font-weight: 700; padding: 3px 8px; border-radius: 6px;">${t.members_count || 0}</span></td>
          <td style="text-align: right; white-space: nowrap;">
            <button class="btn btn-success btn-sm" onclick="approveTenant('${t.id}')">${ICONS.successCheck()} Approve</button>
            <button class="btn btn-danger btn-sm" onclick="rejectTenant('${t.id}')" style="margin-left: 4px;">${ICONS.error()} Reject</button>
          </td>
        </tr>`).join('');
    }
  }

  // Render Pending Vacate Requests
  const vacateTbody = document.getElementById('tenants-vacate-table-body');
  if (vacateTbody) {
    const vacateFiltered = currentBuildingFilter === 'all'
      ? allVacateNotices.filter(n => n.status === 'submitted')
      : allVacateNotices.filter(n => n.status === 'submitted' && n.building_id === currentBuildingFilter);

    const vacateCountEl = document.getElementById('tenants-vacate-count');
    if (vacateCountEl) {
      vacateCountEl.textContent = `${vacateFiltered.length} pending`;
    }

    if (vacateFiltered.length === 0) {
      vacateTbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted" style="padding: 24px;">No pending vacate requests</td></tr>';
    } else {
      vacateTbody.innerHTML = vacateFiltered.map(n => {
        const tenant = allTenants.find(t => t.id === n.tenant_id);
        let suggestionHtml = '';
        let bondActive = false;
        if (tenant && tenant.bond_months && tenant.bond_months > 0) {
          const remaining = getBondRemainingMonths(tenant);
          if (remaining > 0) {
            bondActive = true;
            suggestionHtml = `<span class="badge badge-danger" style="font-size:11px; font-weight:700; white-space:nowrap;">No Refund (Bond Active - ${remaining} Mo Left) / रिफंड न करें</span>`;
          } else {
            suggestionHtml = `<span class="badge badge-success" style="font-size:11px; font-weight:700; white-space:nowrap;">Refund Deposit (Bond Completed) / रिफंड करें</span>`;
          }
        } else {
          suggestionHtml = `<span class="badge badge-success" style="font-size:11px; font-weight:700; white-space:nowrap;">Refund Deposit (No Bond) / रिफंड करें</span>`;
        }

        // Show Decline Refund button only when bond is still active
        const declineBtn = bondActive
          ? `<button class="btn btn-danger btn-sm" onclick="declineRefund('${n.id}', '${n.tenant_id}')" style="margin-right:6px; display:inline-flex; align-items:center; gap:4px;">✕ Decline Refund</button>`
          : '';

        return `
        <tr>
          <td><strong>${n.tenant_name}</strong></td>
          <td>Room ${n.room_number || '—'}</td>
          <td>${n.building_name || '—'}</td>
          <td>${formatDate(n.preferred_date)}</td>
          <td><span style="font-size: var(--font-xs); color: var(--text-secondary);">${n.reason || '—'}</span></td>
          <td>${formatCurrency(n.deposit_amount || 0)}</td>
          <td>${suggestionHtml}</td>
          <td style="text-align: right; white-space: nowrap;">
            ${declineBtn}
            <button class="btn btn-success btn-sm" onclick="approveVacate('${n.id}', '${n.tenant_id}')" style="display: inline-flex; align-items: center; gap: 4px;"><svg class="icon-svg" style="width:1.2em; height:1.2em; stroke:currentColor; fill:none; stroke-width:2;" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg> Approve Vacate</button>
          </td>
        </tr>`;
      }).join('');
    }
  }
  // Calculate totals for badge
  const pendingRegCount = (currentBuildingFilter === 'all'
    ? allTenants.filter(t => t.status === 'pending')
    : allTenants.filter(t => t.status === 'pending' && t.building_id === currentBuildingFilter)).length;

  const pendingVacCount = (currentBuildingFilter === 'all'
    ? allVacateNotices.filter(n => n.status === 'submitted')
    : allVacateNotices.filter(n => n.status === 'submitted' && n.building_id === currentBuildingFilter)).length;

  const pendingRentCount = (currentBuildingFilter === 'all'
    ? allPayments.filter(p => p.status === 'pending')
    : allPayments.filter(p => p.status === 'pending' && p.building_id === currentBuildingFilter)).length;

  const totalReq = pendingRegCount + pendingVacCount + pendingRentCount;
  const totalBadge = document.getElementById('total-requests-badge');
  if (totalBadge) {
    totalBadge.textContent = totalReq;
    totalBadge.style.display = totalReq > 0 ? 'inline-block' : 'none';
  }

  // Render Archived Tenants (vacated or rejected)
  const archivedTbody = document.getElementById('tenants-archived-table-body');
  if (archivedTbody) {
    const archivedFiltered = currentBuildingFilter === 'all'
      ? allTenants.filter(t => t.status === 'vacated' || t.status === 'rejected')
      : allTenants.filter(t => (t.status === 'vacated' || t.status === 'rejected') && t.building_id === currentBuildingFilter);

    if (archivedFiltered.length === 0) {
      archivedTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No archived tenants</td></tr>';
    } else {
      archivedTbody.innerHTML = archivedFiltered.map(t => `
        <tr onclick="viewTenantDetails('${t.id}')" style="cursor: pointer;" class="hover-row">
          <td><strong>${t.name}</strong></td>
          <td>Room ${t.room_number || '—'}</td>
          <td>${t.building_name || '—'}</td>
          <td>${t.phone}</td>
          <td>${formatDate(t.join_date)}</td>
          <td>${t.vacate_date ? formatDate(t.vacate_date) : '—'}</td>
          <td><span class="badge ${t.status === 'vacated' ? 'badge-warning' : 'badge-danger'}">${t.status.toUpperCase()}</span></td>
        </tr>`).join('');
    }
  }
}

window.viewTenantDetails = function (tenantId, preserveTab = false) {
  try {
    console.log('viewTenantDetails called with tenantId:', tenantId);
    const t = allTenants.find(x => x.id === tenantId);
    if (!t) {
      console.warn('Tenant not found in allTenants:', tenantId);
      showToast('Error', 'Tenant data not found.', 'error');
      return;
    }

    // Header
    document.getElementById('tp-tenant-name').textContent = t.name + ' (Profile)';

    // Room & Deposit
    document.getElementById('tp-building').textContent = t.building_name || '—';
    document.getElementById('tp-floor').textContent = t.floor_number || '—';
    document.getElementById('tp-room').textContent = t.room_number || '—';
    document.getElementById('tp-rent').textContent = formatCurrency(t.rent || 0);
    document.getElementById('tp-maintenance').textContent = t.maintenance_included ? 'Included in Rent' : `₹${t.maintenance_charge || 0}`;
    document.getElementById('tp-electricity').textContent = t.electricity_included ? 'Included in Rent' : `₹${t.electricity_rate || 0} / unit`;
    document.getElementById('tp-deposit-amount').textContent = formatCurrency(t.advance_paid || 0);
    const tpAadhaarEl = document.getElementById('tp-aadhaar');
    if (tpAadhaarEl) {
      tpAadhaarEl.textContent = t.aadhaar_number || '—';
    }

    const depBadge = document.getElementById('tp-deposit-status');
    if (t.advance_paid > 0) {
      depBadge.textContent = 'Paid';
      depBadge.className = 'badge badge-success';
    } else {
      depBadge.textContent = 'Unpaid';
      depBadge.className = 'badge badge-warning';
    }

    const refundBadge = document.getElementById('tp-refund-status');
    // Check if there's a refund_declined vacate notice for this tenant
    const declinedNotice = allVacateNotices.find(n => n.tenant_id === t.id && n.status === 'refund_declined');
    if (declinedNotice) {
      refundBadge.textContent = 'Refund Declined';
      refundBadge.className = 'badge badge-danger';
    } else if (t.status === 'vacated') {
      refundBadge.textContent = 'Refunded';
      refundBadge.className = 'badge badge-success';
    } else if (t.status === 'vacating') {
      refundBadge.textContent = 'Pending Vacation';
      refundBadge.className = 'badge badge-warning';
    } else if (t.status === 'rejected') {
      refundBadge.textContent = 'N/A (Rejected)';
      refundBadge.className = 'badge badge-danger';
    } else {
      refundBadge.textContent = 'N/A (Active)';
      refundBadge.className = 'badge';
    }

    // Initial Meter
    const initialMeterEl = document.getElementById('tp-initial-meter');
    if (initialMeterEl) {
      initialMeterEl.textContent = t.initial_meter_reading !== undefined && t.initial_meter_reading !== null
        ? t.initial_meter_reading + ' Units'
        : '0 Units';
    }

    // Bond Agreement info
    const bondMonthsEl = document.getElementById('tp-bond-months');
    if (bondMonthsEl) {
      bondMonthsEl.textContent = t.bond_months && t.bond_months > 0
        ? `${t.bond_months} Months`
        : 'No Bond / कोई बांड नहीं';
    }
    const bondRemainingEl = document.getElementById('tp-bond-remaining');
    if (bondRemainingEl) {
      if (t.bond_months && t.bond_months > 0) {
        const remaining = getBondRemainingMonths(t);
        bondRemainingEl.textContent = `${remaining} Months Left / ${remaining} माह शेष`;
      } else {
        bondRemainingEl.textContent = '—';
      }
    }

    // Members
    const membersDiv = document.getElementById('tp-members-list');
    if (t.members && t.members.length > 0) {
      membersDiv.innerHTML = t.members.map(m => `
        <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 8px;">
          <div style="font-weight: bold; color: var(--text-primary);">${m.name || '—'} <span style="font-weight:normal; font-size:12px; color:var(--text-secondary);">(${m.relation || '—'})</span></div>
          <div style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">${ICONS.phone()} ${m.phone || '—'}</div>
          <div style="font-size: 13px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px;">${ICONS.idCard()} ${m.aadhaar_number || '—'}</div>
        </div>
      `).join('');
    } else {
      membersDiv.innerHTML = '<div class="text-muted">No family members listed.</div>';
    }

    // Payments
    const tPayments = allPayments.filter(p => p.tenant_id === t.id);
    // Sort by month_year desc safely
    tPayments.sort((a, b) => {
      const aVal = a.month_year || '';
      const bVal = b.month_year || '';
      return bVal.localeCompare(aVal);
    });

    const d = new Date();
    const currentMonthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const currentMonthPayment = tPayments.find(p => p.month_year === currentMonthStr);
    const currentMonthBadge = document.getElementById('tp-current-month-status');

    if (currentMonthPayment) {
      if (currentMonthPayment.status === 'approved') {
        currentMonthBadge.textContent = 'Paid';
        currentMonthBadge.className = 'badge badge-success';
      } else {
        currentMonthBadge.textContent = 'Pending';
        currentMonthBadge.className = 'badge badge-warning';
      }
    } else {
      if (t.status === 'vacated' || t.status === 'rejected') {
        currentMonthBadge.textContent = 'N/A (Archived)';
        currentMonthBadge.className = 'badge';
      } else {
        currentMonthBadge.textContent = 'Overdue / Not Paid';
        currentMonthBadge.className = 'badge badge-danger';
      }
    }

    // Payment history list table
    const historyTbody = document.getElementById('tp-payment-history-tbody');
    if (historyTbody) {
      if (tPayments.length > 0) {
        historyTbody.innerHTML = tPayments.map(p => {
          let statusClass = 'badge-warning';
          if (p.status === 'approved') statusClass = 'badge-success';
          if (p.status === 'rejected') statusClass = 'badge-danger';
          
          const breakdown = `Rent: ${formatCurrency(p.rent_amount || 0)} • Elec: ${formatCurrency(p.electricity_amount || 0)} • Maint: ${formatCurrency(p.maintenance_amount || 0)}`;
          
          let actionsHTML = '';
          if (p.status === 'pending') {
            actionsHTML = `<button class="btn btn-success btn-sm" style="padding: 2px 6px; font-size: 9px; min-height: auto;" onclick="event.stopPropagation(); window.approvePaymentFromProfileModal('${p.id}', '${t.id}')">Approve</button>`;
          } else if (p.status === 'approved') {
            actionsHTML = `<button class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 9px; min-height: auto; display: inline-flex; align-items: center; gap: 2px;" onclick="event.stopPropagation(); window.downloadOwnerReceipt('${p.id}')">${ICONS.receipt()} Receipt</button>`;
          } else {
            actionsHTML = `<span class="text-muted">—</span>`;
          }
          
          return `
            <tr>
              <td style="white-space: nowrap;">${formatDate(p.payment_date || p.created_at)}</td>
              <td style="font-weight: bold;">${formatCurrency(p.total_amount)}</td>
              <td style="color: var(--text-muted); font-size: 10px; white-space: normal;">${breakdown}</td>
              <td>${p.payment_method || 'UPI'}</td>
              <td style="font-family: monospace; color: var(--text-muted); font-size: 10px;">${p.transaction_id || '—'}</td>
              <td><span class="badge ${statusClass}" style="font-size: 9px; padding: 1px 4px;">${p.status.toUpperCase()}</span></td>
              <td style="text-align: right;">${actionsHTML}</td>
            </tr>
          `;
        }).join('');
      } else {
        historyTbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 16px;">No payment history found.</td></tr>';
      }
    }

    // Fetch and render tenant room history
    const roomHistoryDiv = document.getElementById('tp-room-history-list');
    if (roomHistoryDiv) {
      roomHistoryDiv.innerHTML = '<div class="text-muted">Loading history...</div>';
      supabase
        .from('tenant_history')
        .select('*')
        .eq('tenant_id', t.id)
        .order('moved_in', { ascending: false })
        .then(({ data: histData, error: histErr }) => {
          if (histErr) {
            console.error('Failed to load tenant history:', histErr);
            roomHistoryDiv.innerHTML = '<div class="text-danger">Failed to load room history.</div>';
            return;
          }
          if (histData && histData.length > 0) {
            roomHistoryDiv.innerHTML = histData.map(h => {
              const outDate = h.moved_out ? formatDate(h.moved_out) : 'Current Room (वर्तमान)';
              return `
                <div style="border-bottom: 1px solid var(--border-light); padding-bottom: 8px; margin-bottom: 8px;">
                  <div style="font-weight: bold; color: var(--text-primary); display: flex; align-items: center; gap: 4px;">${ICONS.building()} ${h.building_name || '—'} · Room ${h.room_number || '—'}</div>
                  <div style="font-size: 13px; color: var(--text-secondary); margin-top: 2px; display: flex; align-items: center; gap: 4px;">${ICONS.calendar()} In: ${formatDate(h.moved_in)} · Out: ${outDate}</div>
                  <div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin-top: 2px;">Reason: ${h.reason || '—'}</div>
                </div>
              `;
            }).join('');
          } else {
            roomHistoryDiv.innerHTML = '<div class="text-muted">No room history records found.</div>';
          }
        });
    }

    // Reset profile tab to first tab if not preserving
    if (!preserveTab) {
      const firstTabBtn = document.querySelector('.profile-tab-btn');
      if (firstTabBtn) {
        window.switchProfileTab('room-deposit', firstTabBtn);
      }
    }

    openModal('modal-tenant-profile');
    console.log('viewTenantDetails modal opened successfully.');
  } catch (err) {
    console.error('Error in viewTenantDetails:', err);
    alert('Failed to view tenant details: ' + err.message);
    showToast('Error', 'Failed to load profile: ' + err.message, 'error');
  }
};

window.closeTenantProfileModal = function () {
  closeModal('modal-tenant-profile');
};

window.editTenant = function (tenantId) {
  showToast('Coming Soon', 'Edit Tenant feature is under development.', 'info');
};

window.openCollectRentModal = function (tenantId) {
  showToast('Coming Soon', 'Collect Rent feature is under development.', 'info');
};

window.openShiftRoomModal = function (tenantId) {
  showToast('Coming Soon', 'Shift Room feature is under development.', 'info');
};

window.openVacateModal = function (tenantId) {
  showToast('Coming Soon', 'Vacate Tenant feature is under development.', 'info');
};

window.removeTenant = async function (tenantId) {
  if (!confirm('Are you sure? This tenant will be removed.')) return;
  const tenantObj = allTenants.find(t => t.id === tenantId);
  if (!tenantObj) return;

  try {
    const { error: err1 } = await supabase
      .from('tenants')
      .update({
        status: 'vacated',
        vacate_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', tenantId);
    if (err1) throw err1;

    // Delete members when vacating
    await supabase.from('members').delete().eq('tenant_id', tenantId);

    // Create a vacate notice row for tracking deposits/refunds
    await supabase.from('vacate_notices').insert({
      tenant_id: tenantId,
      building_id: tenantObj.building_id,
      owner_id: ownerData.id,
      reason: 'Manual Checkout by Owner',
      preferred_date: new Date().toISOString().split('T')[0],
      deposit_amount: tenantObj.advance_paid || 0,
      deposit_refunded: false,
      status: 'processed'
    });

    // Update room occupancy
    if (tenantObj.room_id) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', tenantObj.room_id)
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
          .eq('id', tenantObj.room_id);
      }
    }

    await loadRealData();
    renderTenantsTable();
    renderKPIs();
    if (activeGridBuildingId) showBuildingRooms(activeGridBuildingId);
    await logOwnerActivity(`Removed tenant ${tenantObj.name} from Room ${tenantObj.room_number || '—'} in building "${tenantObj.building_name || '—'}"`);
    showToast('Tenant Removed', 'Room occupant has been removed', 'warning');
  } catch (err) {
    console.error('Error removing tenant:', err);
    showToast('Error', 'Failed to remove tenant: ' + err.message, 'error');
  }
};

// ═══════════════ RENT CALCULATOR ═══════════════
// Helper: compute the next billing month for a tenant (same logic as tenant side)
function getTenantTargetMonth(tenant) {
  const joinDate = tenant.join_date ? new Date(tenant.join_date) : new Date();
  const tenantPayments = allPayments.filter(p =>
    p.tenant_id === tenant.id &&
    (p.status === 'approved' || p.status === 'pending')
  );
  const submittedPaymentsCount = tenantPayments.length;
  const targetDate = new Date(joinDate);
  targetDate.setMonth(targetDate.getMonth() + submittedPaymentsCount);
  return targetDate.toISOString().slice(0, 7); // e.g. '2026-06'
}

function initRentCalculator() {
  const sel = document.getElementById('calc-tenant-select');
  const unpaidInfoEl = document.getElementById('calc-unpaid-info');
  const unpaidInfoTextEl = document.getElementById('calc-unpaid-info-text');
  const noUnpaidEl = document.getElementById('calc-no-unpaid');

  // Find all active/vacating tenants who haven't paid their target billing month yet
  const activeTenants = allTenants.filter(t => t.status === 'active' || t.status === 'vacating');
  const unpaidTenants = activeTenants.filter(t => {
    const targetMonth = getTenantTargetMonth(t);
    return !allPayments.some(p =>
      p.tenant_id === t.id &&
      p.month_year === targetMonth &&
      (p.status === 'approved' || p.status === 'pending')
    );
  });

  sel.innerHTML = '<option value="">— Select Tenant —</option>';
  unpaidTenants.forEach(t => {
    const targetMonth = getTenantTargetMonth(t);
    sel.innerHTML += `<option value="${t.id}">Room ${t.room_number} — ${t.name} (${t.building_name || ''}) · ${formatMonthYear(targetMonth + '-01')}</option>`;
  });

  // Show/hide status badge
  if (unpaidTenants.length === 0) {
    if (unpaidInfoEl) unpaidInfoEl.style.display = 'none';
    if (noUnpaidEl) noUnpaidEl.style.display = 'block';
  } else {
    if (noUnpaidEl) noUnpaidEl.style.display = 'none';
    if (unpaidInfoEl) {
      unpaidInfoEl.style.display = 'flex';
      if (unpaidInfoTextEl) unpaidInfoTextEl.textContent = `${unpaidTenants.length} tenant${unpaidTenants.length !== 1 ? 's' : ''} pending cash payment`;
    }
  }
}

window.onCalcTenantChange = function () {
  const tenantId = document.getElementById('calc-tenant-select').value;
  const tenant = allTenants.find(t => t.id === tenantId);

  // Reset form if no tenant selected
  if (!tenant) {
    document.getElementById('calc-billing-month-row').style.display = 'none';
    document.getElementById('inv-room').textContent = '—';
    document.getElementById('inv-tenant').textContent = '—';
    return;
  }

  const building = buildings.find(b => b.id === tenant.building_id);

  // Find room data
  let room = null;
  if (building) {
    for (const floor of (building.floors || [])) {
      room = (floor.rooms || []).find(r => r.id === tenant.room_id);
      if (room) break;
    }
  }

  // Pre-fill rent from room (same as tenant side)
  const rent = room ? room.rent : (tenant.rent || 8000);
  const rate = room && room.electricity_rate !== undefined && room.electricity_rate !== null ? room.electricity_rate : (building?.electricity_rate || 10);
  const maint = (room && room.maintenance_included) ? 0 :
    (room && room.maintenance_charge !== undefined && room.maintenance_charge !== null ? room.maintenance_charge : (building?.maintenance_charge || 500));
  const electricityIncluded = (room && room.electricity_included) || (building && building.electricity_included) || false;

  document.getElementById('calc-rent').value = rent;
  document.getElementById('calc-rate').value = rate;
  document.getElementById('calc-maint').value = maint;

  // Auto-fill subsidy settings from room (hidden inputs)
  const subsidyModeInput = document.getElementById('calc-subsidy-mode');
  const subsidyUnitsInput = document.getElementById('calc-subsidy-units');
  const subsidyRateInput = document.getElementById('calc-subsidy-rate');
  if (subsidyModeInput && subsidyUnitsInput && subsidyRateInput) {
    subsidyModeInput.value = room ? (room.electricity_subsidy_mode ? 'true' : 'false') : 'false';
    subsidyUnitsInput.value = room ? (room.electricity_subsidy_units !== undefined ? room.electricity_subsidy_units : 1) : 1;
    subsidyRateInput.value = room ? (room.electricity_subsidy_rate !== undefined ? room.electricity_subsidy_rate : 0) : 0;
  }

  // Previous reading: use last approved payment curr_reading, fall back to initial_meter_reading
  const approvedPayments = allPayments.filter(p =>
    p.tenant_id === tenant.id &&
    p.room_id === tenant.room_id &&
    p.status === 'approved'
  );
  const lastApproved = approvedPayments.sort((a, b) => new Date(b.payment_date || b.created_at) - new Date(a.payment_date || a.created_at))[0];
  const prevReading = lastApproved ? lastApproved.curr_reading : (tenant.initial_meter_reading || tenant.current_meter_reading || 0);
  document.getElementById('calc-prev').value = prevReading;
  document.getElementById('calc-curr').value = ''; // Force owner to enter current reading

  // Compute & show billing month
  const targetMonth = getTenantTargetMonth(tenant);
  const billingMonthRow = document.getElementById('calc-billing-month-row');
  const billingMonthEl = document.getElementById('calc-billing-month');
  if (billingMonthRow && billingMonthEl) {
    billingMonthRow.style.display = 'block';
    billingMonthEl.textContent = formatMonthYear(targetMonth + '-01');
  }

  // Handle electricity included: hide electricity row and meter reading section
  const meterSection = document.querySelectorAll('#inner-rent-manual .form-row');
  const elecIncludedNotice = document.getElementById('inv-elec-included-notice');
  const elecInvRow = document.getElementById('inv-elec-row');
  // Hide/show prev reading row based on electricity_included
  const prevReadingRow = document.getElementById('calc-prev')?.closest('.form-row');
  if (prevReadingRow) prevReadingRow.style.display = electricityIncluded ? 'none' : '';
  const rateReadingRow = document.getElementById('calc-rate')?.closest('.form-row');
  if (rateReadingRow) rateReadingRow.style.display = electricityIncluded ? 'none' : '';
  if (elecInvRow) elecInvRow.style.display = electricityIncluded ? 'none' : '';
  if (elecIncludedNotice) elecIncludedNotice.style.display = electricityIncluded ? 'block' : 'none';

  document.getElementById('inv-room').textContent = tenant.room_number;
  document.getElementById('inv-tenant').textContent = tenant.name;
  document.getElementById('inv-upi').textContent = ownerData.upi_id || '—';

  calculateBill();
};

window.calculateBill = function () {
  const prev = parseFloat(document.getElementById('calc-prev').value) || 0;
  const curr = parseFloat(document.getElementById('calc-curr').value) || 0;
  const rate = parseFloat(document.getElementById('calc-rate').value) || 0;
  const rent = parseFloat(document.getElementById('calc-rent').value) || 0;
  const maint = parseFloat(document.getElementById('calc-maint').value) || 0;

  const units = Math.max(0, curr - prev);

  let room = null;
  const tenantId = document.getElementById('calc-tenant-select').value;
  const tenant = allTenants.find(t => t.id === tenantId);
  if (tenant) {
    const building = buildings.find(b => b.id === tenant.building_id);
    if (building) {
      for (const floor of (building.floors || [])) {
        room = (floor.rooms || []).find(r => r.id === tenant.room_id);
        if (room) break;
      }
    }
  }

  // Check electricity_included
  const building = tenant ? buildings.find(b => b.id === tenant.building_id) : null;
  const electricityIncluded = (room && room.electricity_included) || (building && building.electricity_included) || false;

  const effectiveUnits = (room && room.rent_split_enabled && room.beds_occupied > 0)
    ? Math.round(units / room.beds_occupied)
    : units;

  let elecBill = 0;
  if (!electricityIncluded) {
    // Read subsidy from hidden inputs (not checkboxes anymore)
    const subsidyModeVal = document.getElementById('calc-subsidy-mode')?.value;
    const subsidyMode = subsidyModeVal === 'true';
    const subsidyUnits = parseFloat(document.getElementById('calc-subsidy-units')?.value) || 1;
    const subsidyRate = parseFloat(document.getElementById('calc-subsidy-rate')?.value) || 0;

    if (subsidyMode) {
      elecBill = effectiveUnits <= subsidyUnits ? effectiveUnits * subsidyRate : effectiveUnits * rate;
    } else {
      elecBill = effectiveUnits * rate;
    }
  }

  const total = rent + elecBill + maint;

  document.getElementById('inv-rent').textContent = formatCurrency(rent);
  document.getElementById('inv-units').textContent = units;
  document.getElementById('inv-rate').textContent = rate;
  document.getElementById('inv-elec').textContent = formatCurrency(elecBill);
  document.getElementById('inv-maint').textContent = formatCurrency(maint);
  document.getElementById('inv-total').textContent = formatCurrency(total);
};

window.togglePaymentCollectionMode = function () {
  const mode = document.querySelector('input[name="payment-method-type"]:checked').value;
  const btn = document.getElementById('btn-collect-payment');
  if (mode === 'Cash') {
    btn.innerHTML = `${ICONS.coin()} Record Direct Cash Payment`;
    btn.className = 'btn btn-success btn-full';
  } else {
    btn.innerHTML = `${ICONS.chat('', 'margin-right:4px;')} Send Invoice on WhatsApp`;
    btn.className = 'btn btn-primary btn-full';
  }
};

window.collectRentPayment = async function () {
  const tenantId = document.getElementById('calc-tenant-select').value;
  const tenant = allTenants.find(t => t.id === tenantId);
  if (!tenant) { showToast('Select Tenant', 'Please select a tenant first', 'warning'); return; }

  // Gather room & building info
  const building = buildings.find(b => b.id === tenant.building_id);
  let room = null;
  if (building) {
    for (const floor of (building.floors || [])) {
      room = (floor.rooms || []).find(r => r.id === tenant.room_id);
      if (room) break;
    }
  }
  const electricityIncluded = (room && room.electricity_included) || (building && building.electricity_included) || false;

  const rent = parseFloat(document.getElementById('calc-rent').value) || 0;
  const prev = parseFloat(document.getElementById('calc-prev').value) || 0;
  const maint = parseFloat(document.getElementById('calc-maint').value) || 0;

  let curr = prev;
  if (!electricityIncluded) {
    curr = parseFloat(document.getElementById('calc-curr').value);
    if (isNaN(curr) || curr < prev) {
      showToast('Invalid Reading', `Current meter reading must be ≥ previous reading (${prev}).`, 'error');
      return;
    }
  }

  const totalStr = document.getElementById('inv-total').textContent;
  const total = parseFloat(totalStr.replace(/[^\d.-]/g, '')) || 0;
  const electricityAmount = parseFloat(document.getElementById('inv-elec').textContent.replace(/[^\d.-]/g, '')) || 0;

  // Compute correct billing month (same logic as tenant side)
  const targetMonth = getTenantTargetMonth(tenant);

  // Check if payment for this month already recorded
  const alreadyPaid = allPayments.some(p =>
    p.tenant_id === tenant.id &&
    p.month_year === targetMonth &&
    (p.status === 'approved' || p.status === 'pending')
  );
  if (alreadyPaid) {
    showToast('Already Recorded', `A payment for ${formatMonthYear(targetMonth + '-01')} already exists for ${tenant.name}.`, 'warning');
    return;
  }

  const btn = document.getElementById('btn-collect-payment');
  const originalBtnText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `${ICONS.pending()} Recording...`;

  const localDateStr = (() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  })();

  try {
    const { error } = await supabase.from('payments').insert({
      owner_id: ownerData.id,
      tenant_id: tenant.id,
      building_id: tenant.building_id,
      room_id: tenant.room_id,
      tenant_name: tenant.name,
      room_number: tenant.room_number,
      building_name: tenant.building_name,
      month_year: targetMonth,
      rent_amount: rent,
      electricity_amount: electricityAmount,
      maintenance_amount: maint,
      total_amount: total,
      prev_reading: prev,
      curr_reading: curr,
      units_consumed: electricityIncluded ? 0 : (curr - prev),
      payment_method: 'Cash',
      status: 'approved',
      payment_date: localDateStr
    });

    if (error) throw error;

    // Update tenant's current meter reading so next payment has correct prev reading
    if (!electricityIncluded) {
      await supabase.from('tenants').update({ current_meter_reading: curr }).eq('id', tenant.id);
    }

    await logOwnerActivity(`Recorded Cash Payment of ${formatCurrency(total)} from ${tenant.name} (Room ${tenant.room_number}) for ${formatMonthYear(targetMonth + '-01')}`);
    showToast('Cash Recorded ✓', `₹${total.toLocaleString('en-IN')} cash payment for ${tenant.name} approved for ${formatMonthYear(targetMonth + '-01')}!`, 'success');

    // Reload data and re-init the calculator to refresh the unpaid list
    await loadRealData();
    refreshActiveViews();
    initRentCalculator();

    // Clear the form
    document.getElementById('calc-tenant-select').value = '';
    document.getElementById('calc-billing-month-row').style.display = 'none';
    document.getElementById('calc-curr').value = '';
    document.getElementById('calc-prev').value = '0';
    document.getElementById('inv-room').textContent = '—';
    document.getElementById('inv-tenant').textContent = '—';
    document.getElementById('inv-total').textContent = '₹0';
    document.getElementById('inv-rent').textContent = '₹0';
    document.getElementById('inv-elec').textContent = '₹0';
    document.getElementById('inv-maint').textContent = '₹0';

  } catch (err) {
    console.error('Error saving cash payment:', err);
    showToast('Error', 'Failed to record payment: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnText;
  }
};

window.sendBulkReminder = async function () {
  const unpaid = allTenants.filter(t => t.status === 'active' || t.status === 'vacating');
  if (unpaid.length === 0) { showToast('No Tenants', 'No active tenants to remind', 'info'); return; }

  try {
    showToast('Bulk Reminders', `Sending cloud reminders to ${unpaid.length} tenants...`, 'info');

    const { data, error } = await supabase.functions.invoke('whatsapp-reminder', {
      body: {
        bulk: true,
        ownerId: ownerData.id
      }
    });

    if (error) throw error;

    if (data && data.success) {
      showToast('Success', `Sent ${data.sent} reminders successfully! (Skipped: ${data.skipped || 0}, Failed: ${data.failed || 0})`, 'success');
    } else {
      throw new Error(data?.error || 'Failed to send bulk reminders via API');
    }
  } catch (err) {
    console.warn('Bulk API sending failed, falling back to manual sending:', err);
    showToast('API Offline', 'Failed to send automatically. Opening manual WhatsApp Web instead.', 'warning');
    
    // Fallback: Open first tenant's manual chat window
    const t = unpaid[0];
    const msg = `Rent Reminder: Your monthly rent is due. Please pay via UPI: ${ownerData.upi_id || 'N/A'}.\n\n— PG Builders`;
    sendWhatsAppReminder(t.phone, msg);
  }
};

// ═══════════════ DEPOSIT / DC SYSTEM ═══════════════
function renderDepositsTable() {
  const tbody = document.getElementById('deposits-table-body');
  if (!tbody) return;
  const active = allTenants.filter(t => t.status === 'active' || t.status === 'vacating');

  if (active.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 24px;">No deposit records</td></tr>';
    return;
  }

  tbody.innerHTML = active.map(t => {
    const building = buildings.find(b => b.id === t.building_id);
    const required = building?.advance_amount || 5000;
    const paid = t.advance_paid || 0;
    const isPaid = paid >= required;

    return `<tr>
      <td><strong>${t.name}</strong></td>
      <td>${t.room_number}</td>
      <td>${t.building_name || '—'}</td>
      <td>${formatCurrency(paid)}</td>
      <td>${formatCurrency(required)}</td>
      <td><span class="badge ${isPaid ? 'badge-success' : 'badge-warning'}">${isPaid ? 'PAID' : 'PENDING'}</span></td>
      <td>${t.status === 'vacating' ? `<button class="btn btn-sm btn-primary">Refund</button>` : '—'}</td>
    </tr>`;
  }).join('');
}

// ═══════════════ INCOME REPORT ═══════════════
function renderReportData() {
  let totalRent = 0, totalElec = 0, totalMaint = 0;

  const filteredPayments = allPayments.filter(p => {
    const matchesStatus = p.status === 'approved';
    const matchesBuilding = currentBuildingFilter === 'all' || p.building_id === currentBuildingFilter;
    const payDateStr = p.payment_date || p.created_at || '';
    const matchesMonth = currentSelectedMonth === 'all' || payDateStr.startsWith(currentSelectedMonth);
    return matchesStatus && matchesBuilding && matchesMonth;
  });

  filteredPayments.forEach(p => {
    totalRent += p.rent_amount || 0;
    totalElec += p.electricity_amount || 0;
    totalMaint += p.maintenance_amount || 0;
  });

  const filteredExpenses = expensesList.filter(e => {
    const matchesBuilding = currentBuildingFilter === 'all' || e.building_id === currentBuildingFilter;
    const matchesMonth = currentSelectedMonth === 'all' || (e.date && e.date.startsWith(currentSelectedMonth));
    return matchesBuilding && matchesMonth;
  });

  let totalExp = filteredExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
  if (currentBuildingFilter === 'all') {
    const isCurrentMonthOrAll = currentSelectedMonth === getCurrentMonthYear() || currentSelectedMonth === 'all';
    if (isCurrentMonthOrAll) {
      const paidStaffSalary = staffList
        .filter(s => s.payment_status === 'Paid')
        .reduce((acc, curr) => acc + (parseFloat(curr.salary) || 0), 0);
      totalExp += paidStaffSalary;
    }
  }
  const profit = totalRent + totalElec + totalMaint - totalExp;

  const rptRentEl = document.getElementById('rpt-rent');
  const rptElecEl = document.getElementById('rpt-elec');
  const rptProfitEl = document.getElementById('rpt-profit');
  if (rptRentEl) rptRentEl.textContent = formatCurrency(totalRent);
  if (rptElecEl) rptElecEl.textContent = formatCurrency(totalElec);
  if (rptProfitEl) rptProfitEl.textContent = formatCurrency(profit);

  // Breakdown table
  const tbody = document.getElementById('report-breakdown-body');
  if (tbody) {
    if (filteredPayments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 24px;">No data</td></tr>';
    } else {
      tbody.innerHTML = filteredPayments.map(p => `
        <tr>
          <td><strong>${p.tenant_name}</strong></td>
          <td>${p.room_number}</td>
          <td>${formatCurrency(p.rent_amount)}</td>
          <td>${formatCurrency(p.electricity_amount)}</td>
          <td><strong>${formatCurrency(p.total_amount)}</strong></td>
        </tr>`).join('');
    }
  }

  // Building summary
  const summary = document.getElementById('building-summary-list');
  if (!summary || buildings.length === 0) return;

  const displayedBuildings = currentBuildingFilter === 'all'
    ? buildings
    : buildings.filter(b => b.id === currentBuildingFilter);

  summary.innerHTML = displayedBuildings.map(b => {
    const bPayments = allPayments.filter(p => {
      const matchesStatus = p.status === 'approved';
      const matchesBuilding = p.building_name === b.name;
      const payDateStr = p.payment_date || p.created_at || '';
      const matchesMonth = currentSelectedMonth === 'all' || payDateStr.startsWith(currentSelectedMonth);
      return matchesStatus && matchesBuilding && matchesMonth;
    });
    const bTotal = bPayments.reduce((s, p) => s + p.total_amount, 0);
    const bElec = bPayments.reduce((s, p) => s + (p.electricity_amount || 0), 0);
    const bExpenses = expensesList.filter(e => {
      const matchesBuilding = e.building_id === b.id;
      const matchesMonth = currentSelectedMonth === 'all' || (e.date && e.date.startsWith(currentSelectedMonth));
      return matchesBuilding && matchesMonth;
    });
    const bTotalExp = bExpenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

    return `
      <div style="padding: 16px; border-bottom: 1px solid var(--border-color);">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
          <strong style="font-size: var(--font-sm);">${b.name}</strong>
          <strong style="color: var(--success);">${formatCurrency(bTotal - bTotalExp)} Net</strong>
        </div>
        <div style="font-size: var(--font-xs); color: var(--text-muted);">
          Income: ${formatCurrency(bTotal)} • Expenses: ${formatCurrency(bTotalExp)}
        </div>
      </div>`;
  }).join('');
}

window.downloadReport = function () {
  let totalRent = 0, totalElec = 0, totalMaint = 0;

  const filteredPayments = allPayments.filter(p => {
    const matchesStatus = p.status === 'approved';
    const matchesBuilding = currentBuildingFilter === 'all' || p.building_id === currentBuildingFilter;
    const payDateStr = p.payment_date || p.created_at || '';
    const matchesMonth = currentSelectedMonth === 'all' || payDateStr.startsWith(currentSelectedMonth);
    return matchesStatus && matchesBuilding && matchesMonth;
  });

  filteredPayments.forEach(p => {
    totalRent += p.rent_amount || 0;
    totalElec += p.electricity_amount || 0;
    totalMaint += p.maintenance_amount || 0;
  });

  let totalRooms = 0, occupied = 0, vacant = 0;
  const activeBuildings = currentBuildingFilter === 'all'
    ? buildings
    : buildings.filter(b => b.id === currentBuildingFilter);

  activeBuildings.forEach(b => b.floors?.forEach(f => f.rooms?.forEach(r => {
    totalRooms++;
    if (r.status === 'occupied' || r.status === 'partial') occupied++;
    else vacant++;
  })));

  const filteredExpenses = currentBuildingFilter === 'all'
    ? expensesList
    : expensesList.filter(e => e.building_id === currentBuildingFilter);

  let totalExp = filteredExpenses.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
  if (currentBuildingFilter === 'all') {
    const paidStaffSalary = staffList
      .filter(s => s.payment_status === 'Paid')
      .reduce((acc, curr) => acc + (parseFloat(curr.salary) || 0), 0);
    totalExp += paidStaffSalary;
  }

  generateMonthlyReportPDF({
    buildingName: currentBuildingFilter === 'all'
      ? (buildings.length > 0 ? buildings.map(b => b.name).join(', ') : 'All Buildings')
      : (buildings.find(b => b.id === currentBuildingFilter)?.name || 'Building'),
    month: currentSelectedMonth === 'all' ? 'All Time' : formatMonthYear(currentSelectedMonth + '-01'),
    ownerName: ownerData.name,
    totalRooms,
    occupiedRooms: occupied,
    vacantRooms: vacant,
    totalRent,
    totalElectricity: totalElec,
    totalMaintenance: totalMaint,
    grossIncome: totalRent + totalElec + totalMaint,
    totalExpenses: totalExp
  });

  showToast('PDF Downloaded!', 'Monthly income report saved', 'success');
};

// ═══════════════ SETTINGS ═══════════════
function renderSettingsForm() {
  document.getElementById('sett-name').value = ownerData.name || '';

  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session && session.user) {
      const emailInput = document.getElementById('sett-email');
      if (emailInput) emailInput.value = session.user.email || '';
    }
  });

  document.getElementById('sett-upi').value = ownerData.upi_id || '';
  document.getElementById('sett-phone').value = ownerData.phone || '';
  const aadhaarEl = document.getElementById('sett-aadhaar');
  if (aadhaarEl) aadhaarEl.value = ownerData.aadhaar_number || '';
  document.getElementById('sett-key').value = ownerData.owner_key || '';

  const elecRateEl = document.getElementById('sett-elec-rate');
  if (elecRateEl) elecRateEl.value = ownerData.default_electricity_rate !== undefined && ownerData.default_electricity_rate !== null ? ownerData.default_electricity_rate : 10;
  const advanceEl = document.getElementById('sett-advance');
  if (advanceEl) advanceEl.value = ownerData.default_advance !== undefined && ownerData.default_advance !== null ? ownerData.default_advance : 5000;
  const maintEl = document.getElementById('sett-maintenance');
  if (maintEl) maintEl.value = ownerData.default_maintenance !== undefined && ownerData.default_maintenance !== null ? ownerData.default_maintenance : 500;

  // Render subscription dynamically
  const statusEl = document.getElementById('sub-status');
  const expiryEl = document.getElementById('sub-expiry');
  if (statusEl && expiryEl) {
    const status = ownerData.subscription_status || 'trial';
    const expiryStr = ownerData.subscription_expiry;
    const planType = ownerData.plan_type || 'Basic';

    if (planType === 'Enterprise') {
      statusEl.textContent = 'Unlocked';
      statusEl.className = 'badge badge-success';
      expiryEl.textContent = 'Unlimited Buildings / Lifetime';
    } else if (status === 'active' && expiryStr) {
      statusEl.textContent = 'Active';
      statusEl.className = 'badge badge-success';
      expiryEl.textContent = `Valid till ${formatDate(expiryStr)}`;
    } else {
      statusEl.textContent = 'Trial Active';
      statusEl.className = 'badge badge-warning';
      expiryEl.textContent = 'Free trial ending soon';
    }
  }

  // Render building limit and usage
  const subBuildingUsage = document.getElementById('sub-building-usage');
  const subBuildingLimit = document.getElementById('sub-building-limit');
  if (subBuildingUsage) subBuildingUsage.textContent = buildings.length;
  if (subBuildingLimit) {
    if (ownerData && ownerData.plan_type === 'Enterprise') {
      subBuildingLimit.textContent = '∞ (Unlimited)';
    } else {
      subBuildingLimit.textContent = (ownerData && ownerData.allowed_buildings !== undefined && ownerData.allowed_buildings !== null) ? ownerData.allowed_buildings : 0;
    }
  }

  // Render QR Code in Settings
  const qrContainer = document.getElementById('qrcode');
  const qrKeyDisplay = document.getElementById('qr-owner-key');
  if (qrContainer && qrKeyDisplay && ownerData && ownerData.owner_key) {
    qrKeyDisplay.textContent = ownerData.owner_key;
    qrContainer.innerHTML = ''; // Clear previous QR Code if any

    // QR Code URL pointing to registration flow
    const regUrl = `${window.location.origin}/tenant-register.html?key=${ownerData.owner_key}`;

    try {
      new QRCode(qrContainer, {
        text: regUrl,
        width: 150,
        height: 150,
        colorDark: '#0f0f1a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    } catch (qrErr) {
      console.error('Failed to generate QR code:', qrErr);
    }
  }
}

function renderPlanTab() {
  if (!ownerData) return;

  const planCycleEl = document.getElementById('plan-cycle-val');
  const planBuildingsEl = document.getElementById('plan-buildings-val');
  const planExpiryEl = document.getElementById('plan-expiry-val');

  const cycle = ownerData.billing_cycle || 'monthly';
  if (planCycleEl) {
    if (ownerData.plan_type === 'Enterprise') {
      planCycleEl.textContent = 'Lifetime / None';
    } else {
      planCycleEl.textContent = cycle.charAt(0).toUpperCase() + cycle.slice(1);
    }
  }

  if (planBuildingsEl) {
    if (ownerData.plan_type === 'Enterprise') {
      planBuildingsEl.textContent = '∞ (Unlimited)';
    } else {
      planBuildingsEl.textContent = ownerData.allowed_buildings || 1;
    }
  }

  if (planExpiryEl) {
    if (ownerData.plan_type === 'Enterprise') {
      planExpiryEl.textContent = 'Never Expires / कभी समाप्त नहीं होगा';
      planExpiryEl.style.color = 'var(--success-light)';
    } else if (ownerData.subscription_expiry) {
      planExpiryEl.textContent = formatDate(ownerData.subscription_expiry);
      planExpiryEl.style.color = 'var(--warning-light)';
    } else {
      planExpiryEl.textContent = '—';
      planExpiryEl.style.color = 'var(--text-muted)';
    }
  }

  // Manage visibility of notice card for Enterprise
  const isEnterprise = ownerData.plan_type === 'Enterprise';
  const planNoticeCard = document.getElementById('plan-notice-card');

  if (planNoticeCard) {
    planNoticeCard.style.display = isEnterprise ? 'none' : 'block';
  }
}

window.showPlanChangeRestriction = function (action) {
  let actionTextEn = '';
  let actionTextHi = '';
  const expiryDateFormatted = ownerData.subscription_expiry ? formatDate(ownerData.subscription_expiry) : 'next expiry';

  if (action === 'buildings') {
    actionTextEn = 'Adding more buildings or purchasing extra building slots';
    actionTextHi = 'अधिक बिल्डिंग जोड़ने या अतिरिक्त बिल्डिंग स्लॉट खरीदने';
  } else if (action === 'yearly') {
    actionTextEn = 'Switching your billing cycle from Monthly to Yearly';
    actionTextHi = 'मासिक से वार्षिक बिलिंग चक्र में बदलने';
  } else {
    actionTextEn = 'Modifying your subscription plan';
    actionTextHi = 'सब्सक्रिप्शन प्लान में बदलाव करने';
  }

  const msg = `Plan Change Notice / प्लान में बदलाव की सूचना:\n\n` +
    `[English]: ${actionTextEn} is only allowed after your current subscription expires. Please modify your plan on your next expiry date (${expiryDateFormatted}).\n\n` +
    `[हिन्दी]: ${actionTextHi} की अनुमति केवल वर्तमान सब्सक्रिप्शन की समाप्ति के बाद ही दी जाएगी। कृपया अपनी अगली एक्सपायरी तिथि (${expiryDateFormatted}) पर ही बदलाव करें।`;

  alert(msg);
};


window.downloadQRCode = function () {
  if (!ownerData || !ownerData.owner_key) {
    showToast('Error', 'Owner Key not loaded', 'error');
    return;
  }
  const qrCanvas = document.querySelector('#qrcode canvas');
  if (!qrCanvas) {
    const qrImg = document.querySelector('#qrcode img');
    if (qrImg && qrImg.src) {
      const link = document.createElement('a');
      link.href = qrImg.src;
      link.download = `PG_Builders_QR_${ownerData.owner_key}.png`;
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
    link.download = `PG_Builders_QR_${ownerData.owner_key}.png`;
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
  if (!ownerData || !ownerData.owner_key) {
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
  const ownerName = ownerData.name ? ownerData.name.toUpperCase() : 'OUR PG/HOSTEL';
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
          ${ownerData.owner_key}
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
    link.download = `PG_Builders_Poster_${isEn ? 'English' : 'Hinglish'}_${ownerData.owner_key}.png`;
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

window.saveOwnerSettings = async function () {
  const name = document.getElementById('sett-name').value.trim();
  const upiId = document.getElementById('sett-upi').value.trim();
  const phone = document.getElementById('sett-phone').value.trim();
  const aadhaarVal = document.getElementById('sett-aadhaar')?.value.trim() || '';

  const nameErr = validateName(name);
  if (nameErr) { showToast('Invalid Name', nameErr, 'warning'); return; }

  const phoneErr = validatePhone(phone);
  if (phoneErr) { showToast('Invalid Phone', phoneErr, 'warning'); return; }

  if (aadhaarVal && !/^\d{12}$/.test(aadhaarVal)) {
    showToast('Invalid Aadhaar', 'Aadhaar Card number must be exactly 12 digits', 'warning');
    return;
  }

  try {
    const { error } = await supabase
      .from('owners')
      .update({ name, upi_id: upiId, phone, aadhaar_number: aadhaarVal })
      .eq('id', ownerData.id);

    if (error) throw error;

    ownerData.name = name;
    ownerData.upi_id = upiId;
    ownerData.phone = phone;
    ownerData.aadhaar_number = aadhaarVal;

    const ownerNameEl = document.getElementById('owner-display-name');
    if (ownerNameEl) ownerNameEl.textContent = ownerData.name;
    const ownerAvatarEl = document.getElementById('owner-avatar');
    if (ownerAvatarEl) {
      const initials = ownerData.name ? ownerData.name.split(' ').map(w => w[0]).join('').slice(0, 2) : 'OW';
      ownerAvatarEl.textContent = initials;
    }
    localStorage.setItem('pgb_owner_name', ownerData.name);
    localStorage.setItem('pgb_owner_upi', ownerData.upi_id);

    showToast('Settings Saved!', 'Your profile has been updated', 'success');
  } catch (err) {
    showToast('Error', 'Failed to save settings: ' + err.message, 'error');
  }
};

window.saveDefaultRates = async function () {
  const elecRate = parseFloat(document.getElementById('sett-elec-rate').value) || 10;
  const advance = parseFloat(document.getElementById('sett-advance').value) || 5000;
  const maint = parseFloat(document.getElementById('sett-maintenance').value) || 500;

  try {
    const { error } = await supabase
      .from('owners')
      .update({
        default_electricity_rate: elecRate,
        default_advance: advance,
        default_maintenance: maint
      })
      .eq('id', ownerData.id);

    if (error) throw error;

    ownerData.default_electricity_rate = elecRate;
    ownerData.default_advance = advance;
    ownerData.default_maintenance = maint;

    showToast('Rates Updated!', 'Default rates saved for new buildings', 'success');
  } catch (err) {
    showToast('Error', 'Failed to save rates: ' + err.message, 'error');
  }
};

// ── Add Floor & Add Room to Existing Buildings ──

window.openAddFloorModal = function () {
  const building = buildings.find(b => b.id === activeGridBuildingId);
  if (!building) {
    showToast('Select Building', 'Please select a building first', 'warning');
    return;
  }

  document.getElementById('add-floor-bld-name').value = building.name;

  // Calculate next floor number
  let nextFloorNum = 1;
  if (building.floors && building.floors.length > 0) {
    const floorNumbers = building.floors.map(f => parseInt(f.floor_number) || 0);
    nextFloorNum = Math.max(...floorNumbers) + 1;
  }
  document.getElementById('add-floor-number').value = nextFloorNum;

  // Prefill default rooms count
  document.getElementById('add-floor-rooms-count').value = 10;

  // Try to guess prefix pattern
  let roomPrefix = nextFloorNum + '01'; // Default: e.g. 301
  if (building.floors && building.floors.length > 0) {
    const firstFloor = building.floors.find(f => f.floor_number === 1) || building.floors[0];
    if (firstFloor && firstFloor.rooms && firstFloor.rooms.length > 0) {
      const roomNumSample = firstFloor.rooms[0].room_number; // e.g. "A101" or "101"
      const match = roomNumSample.match(/^([A-Za-z]*)(\d+)$/);
      if (match) {
        const letter = match[1];
        const numberPartStr = match[2];
        const numLen = numberPartStr.length; // e.g. 3 for "101", 4 for "0101"
        // Pad the floor number
        const suffixNum = nextFloorNum * Math.pow(10, numLen - 1) + 1; // e.g. 301
        roomPrefix = `${letter}${suffixNum}`;
      }
    }
  }
  document.getElementById('add-floor-room-prefix').value = roomPrefix;

  // Prefill default rent, advance, electricity, maintenance
  let defaultRent = 8000;
  let defaultAdvance = building.advance_amount || 5000;
  let defaultElec = building.electricity_included || false;
  let defaultElecRate = building.electricity_rate || 10;
  let defaultMaintIncluded = false;
  let defaultMaintCharge = building.maintenance_charge || 500;

  if (building.floors && building.floors[0]?.rooms?.[0]) {
    const sampleRoom = building.floors[0].rooms[0];
    if (sampleRoom.rent !== undefined) defaultRent = sampleRoom.rent;
    if (sampleRoom.advance_amount !== undefined) defaultAdvance = sampleRoom.advance_amount;
    if (sampleRoom.electricity_included !== undefined) defaultElec = sampleRoom.electricity_included;
    if (sampleRoom.electricity_rate !== undefined) defaultElecRate = sampleRoom.electricity_rate;
    if (sampleRoom.maintenance_included !== undefined) defaultMaintIncluded = sampleRoom.maintenance_included;
    if (sampleRoom.maintenance_charge !== undefined) defaultMaintCharge = sampleRoom.maintenance_charge;
  }
  document.getElementById('add-floor-room-rent').value = defaultRent;
  document.getElementById('add-floor-room-advance').value = defaultAdvance;
  document.getElementById('add-floor-elec-included').checked = defaultElec;
  document.getElementById('add-floor-elec-rate').value = defaultElecRate;
  document.getElementById('add-floor-maint-included').checked = defaultMaintIncluded;
  document.getElementById('add-floor-maint-charge').value = defaultMaintCharge;

  let defaultSubsidyMode = false;
  let defaultSubsidyUnits = 100;
  let defaultSubsidyRate = 1;
  if (building.floors && building.floors[0]?.rooms?.[0]) {
    const sampleRoom = building.floors[0].rooms[0];
    if (sampleRoom.electricity_subsidy_mode !== undefined) defaultSubsidyMode = sampleRoom.electricity_subsidy_mode;
    if (sampleRoom.electricity_subsidy_units !== undefined && sampleRoom.electricity_subsidy_units !== null) {
      defaultSubsidyUnits = sampleRoom.electricity_subsidy_units;
    }
    if (sampleRoom.electricity_subsidy_rate !== undefined && sampleRoom.electricity_subsidy_rate !== null) {
      defaultSubsidyRate = sampleRoom.electricity_subsidy_rate;
    }
  }
  document.getElementById('add-floor-subsidy-mode').checked = defaultSubsidyMode;
  document.getElementById('add-floor-subsidy-units').value = defaultSubsidyUnits;
  document.getElementById('add-floor-subsidy-rate').value = defaultSubsidyRate;

  toggleFloorElecIncluded();
  toggleFloorMaintIncluded();
  toggleFloorSubsidyFields('add');

  // Prefill default beds and show/hide bed group
  document.getElementById('add-floor-bed-group').style.display = 'none';

  utilOpenModal('modal-add-floor');
};

window.saveNewFloor = async function () {
  const buildingId = activeGridBuildingId;
  const building = buildings.find(b => b.id === buildingId);
  if (!building) return;

  const floorNumber = document.getElementById('add-floor-number').value.trim();
  const roomsCount = parseInt(document.getElementById('add-floor-rooms-count').value);
  const roomPrefix = document.getElementById('add-floor-room-prefix').value.trim();
  const rent = parseInt(document.getElementById('add-floor-room-rent').value) || 8000;
  const advanceAmount = parseInt(document.getElementById('add-floor-room-advance').value) || 5000;
  const elecIncluded = document.getElementById('add-floor-elec-included').checked;
  const elecRate = elecIncluded ? null : (parseInt(document.getElementById('add-floor-elec-rate').value) || 10);
  const maintIncluded = document.getElementById('add-floor-maint-included').checked;
  const maintCharge = maintIncluded ? 0 : (parseInt(document.getElementById('add-floor-maint-charge').value) || 500);
  const subsidyMode = document.getElementById('add-floor-subsidy-mode').checked;
  const subsidyUnits = subsidyMode ? (parseInt(document.getElementById('add-floor-subsidy-units').value) || 1) : 1;
  const subsidyRate = subsidyMode ? (parseInt(document.getElementById('add-floor-subsidy-rate').value) || 0) : 0;

  if (!floorNumber || !roomsCount || !roomPrefix) {
    showToast('Missing Fields', 'Please fill all required fields', 'warning');
    return;
  }

  const btn = document.getElementById('btn-save-floor');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating Floor...';

  try {
    // 1. Insert Floor into Supabase
    const { data: floorRow, error: floorErr } = await supabase
      .from('floors')
      .insert({
        building_id: buildingId,
        floor_number: floorNumber
      })
      .select()
      .single();

    if (floorErr) throw floorErr;

    // 2. Parse prefix and generate rooms
    const prefixMatch = roomPrefix.match(/^([A-Za-z]*)(\d+)$/);
    const letterPrefix = prefixMatch ? prefixMatch[1] : '';
    const startNum = prefixMatch ? parseInt(prefixMatch[2]) : 101;

    const roomsToInsert = [];
    for (let r = 0; r < roomsCount; r++) {
      const roomNum = startNum + r;
      roomsToInsert.push({
        floor_id: floorRow.id,
        building_id: buildingId,
        room_number: `${letterPrefix}${roomNum}`,
        rent,
        advance_amount: advanceAmount,
        electricity_included: elecIncluded,
        electricity_rate: elecRate,
        electricity_subsidy_mode: subsidyMode,
        electricity_subsidy_units: subsidyUnits,
        electricity_subsidy_rate: subsidyRate,
        maintenance_included: maintIncluded,
        maintenance_charge: maintCharge,
        beds_count: 1,
        beds_occupied: 0,
        status: 'vacant'
      });
    }

    const { error: roomsErr } = await supabase
      .from('rooms')
      .insert(roomsToInsert);

    if (roomsErr) throw roomsErr;

    // Refresh state
    await loadRealData();

    utilCloseModal('modal-add-floor');
    window.activeFloorId = floorRow.id;
    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();

    showToast('Floor Created!', `${getFloorLabel(floorNumber)} created with ${roomsCount} rooms.`, 'success');

  } catch (err) {
    console.error('Error creating floor:', err);
    showToast('Error', 'Failed to create floor: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

window.openEditFloorModal = function (buildingId, floorId) {
  const building = buildings.find(b => b.id === buildingId);
  const floor = building?.floors.find(f => f.id === floorId);
  if (!building || !floor) {
    showToast('Error', 'Building or floor not found.', 'error');
    return;
  }

  document.getElementById('edit-floor-bld-name').value = building.name;
  document.getElementById('edit-floor-number').value = floor.floor_number;

  // Default values
  let defaultRent = 8000;
  let defaultAdvance = building.advance_amount || 5000;
  let defaultElec = building.electricity_included || false;
  let defaultElecRate = building.electricity_rate || 10;
  let defaultMaintIncluded = false;
  let defaultMaintCharge = building.maintenance_charge || 500;

  // Prefill with the first room's properties if rooms exist
  if (floor.rooms && floor.rooms.length > 0) {
    const sampleRoom = floor.rooms[0];
    if (sampleRoom.rent !== undefined) defaultRent = sampleRoom.rent;
    if (sampleRoom.advance_amount !== undefined) defaultAdvance = sampleRoom.advance_amount;
    if (sampleRoom.electricity_included !== undefined) defaultElec = sampleRoom.electricity_included;
    if (sampleRoom.electricity_rate !== undefined && sampleRoom.electricity_rate !== null) {
      defaultElecRate = sampleRoom.electricity_rate;
    }
    if (sampleRoom.maintenance_included !== undefined) defaultMaintIncluded = sampleRoom.maintenance_included;
    if (sampleRoom.maintenance_charge !== undefined) defaultMaintCharge = sampleRoom.maintenance_charge;
  }

  document.getElementById('edit-floor-room-rent').value = defaultRent;
  document.getElementById('edit-floor-room-advance').value = defaultAdvance;
  document.getElementById('edit-floor-elec-included').checked = defaultElec;
  document.getElementById('edit-floor-elec-rate').value = defaultElecRate;
  document.getElementById('edit-floor-maint-included').checked = defaultMaintIncluded;
  document.getElementById('edit-floor-room-maint').value = defaultMaintCharge;

  let defaultSubsidyMode = false;
  let defaultSubsidyUnits = 1;
  let defaultSubsidyRate = 0;
  if (floor.rooms && floor.rooms.length > 0) {
    const sampleRoom = floor.rooms[0];
    if (sampleRoom.electricity_subsidy_mode !== undefined) defaultSubsidyMode = sampleRoom.electricity_subsidy_mode;
    if (sampleRoom.electricity_subsidy_units !== undefined && sampleRoom.electricity_subsidy_units !== null) {
      defaultSubsidyUnits = sampleRoom.electricity_subsidy_units;
    }
    if (sampleRoom.electricity_subsidy_rate !== undefined && sampleRoom.electricity_subsidy_rate !== null) {
      defaultSubsidyRate = sampleRoom.electricity_subsidy_rate;
    }
  }
  document.getElementById('edit-floor-subsidy-mode').checked = defaultSubsidyMode;
  document.getElementById('edit-floor-subsidy-units').value = defaultSubsidyUnits;
  document.getElementById('edit-floor-subsidy-rate').value = defaultSubsidyRate;

  toggleEditFloorElecIncluded();
  toggleEditFloorMaintIncluded();
  toggleFloorSubsidyFields('edit');

  utilOpenModal('modal-edit-floor');
};

window.saveEditedFloor = async function () {
  const buildingId = activeGridBuildingId;
  const floorId = window.activeFloorId;
  if (!buildingId || !floorId) {
    showToast('Error', 'No active floor to edit.', 'error');
    return;
  }

  const floorNumber = document.getElementById('edit-floor-number').value.trim();
  if (!floorNumber) {
    showToast('Validation Error', 'Floor name/number cannot be empty.', 'warning');
    return;
  }

  const rent = parseInt(document.getElementById('edit-floor-room-rent').value) || 8000;
  const advanceAmount = parseInt(document.getElementById('edit-floor-room-advance').value) || 5000;
  const elecIncluded = document.getElementById('edit-floor-elec-included').checked;
  const elecRate = elecIncluded ? null : (parseInt(document.getElementById('edit-floor-elec-rate').value) || 10);
  const maintIncluded = document.getElementById('edit-floor-maint-included').checked;
  const maintCharge = maintIncluded ? 0 : (parseInt(document.getElementById('edit-floor-room-maint').value) || 500);
  const subsidyMode = document.getElementById('edit-floor-subsidy-mode').checked;
  const subsidyUnits = subsidyMode ? (parseInt(document.getElementById('edit-floor-subsidy-units').value) || 1) : 1;
  const subsidyRate = subsidyMode ? (parseInt(document.getElementById('edit-floor-subsidy-rate').value) || 0) : 0;

  const btn = document.getElementById('btn-save-edit-floor');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving Settings...';

  try {
    const { error: floorErr } = await supabase
      .from('floors')
      .update({ floor_number: floorNumber })
      .eq('id', floorId);

    if (floorErr) throw floorErr;

    const { error } = await supabase
      .from('rooms')
      .update({
        rent: rent,
        advance_amount: advanceAmount,
        electricity_included: elecIncluded,
        electricity_rate: elecRate,
        electricity_subsidy_mode: subsidyMode,
        electricity_subsidy_units: subsidyUnits,
        electricity_subsidy_rate: subsidyRate,
        maintenance_included: maintIncluded,
        maintenance_charge: maintCharge
      })
      .eq('floor_id', floorId);

    if (error) throw error;

    // Refresh state
    await loadRealData();

    utilCloseModal('modal-edit-floor');
    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();

    showToast('Floor Updated!', 'Floor details and rooms have been updated successfully.', 'success');

  } catch (err) {
    console.error('Error saving edited floor:', err);
    showToast('Error', 'Failed to save floor settings: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

window.deleteActiveFloor = async function () {
  if (!activeGridBuildingId || !window.activeFloorId) {
    showToast('No Floor Active', 'No active floor to delete.', 'warning');
    return;
  }

  const building = buildings.find(b => b.id === activeGridBuildingId);
  const floor = building?.floors.find(f => f.id === window.activeFloorId);
  if (!floor) {
    showToast('Error', 'Active floor not found.', 'error');
    return;
  }

  let hasOccupied = false;
  if (floor.rooms) {
    hasOccupied = floor.rooms.some(r => r.status === 'occupied' || r.status === 'partial' || r.beds_occupied > 0);
  }

  if (hasOccupied) {
    if (!confirm(`Warning: ${getFloorLabel(floor.floor_number)} has occupied rooms/beds. Deleting this floor will vacate active tenants. Do you still want to delete it?`)) {
      return;
    }
  } else {
    if (!confirm(`Are you sure you want to delete ${getFloorLabel(floor.floor_number)} and all its rooms?`)) {
      return;
    }
  }

  const btn = document.querySelector('button[onclick="deleteActiveFloor()"]');
  const originalText = btn ? btn.textContent : 'Delete Floor';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting Floor...';
  }

  try {
    // Delete floor from Supabase. Cascade delete will remove all rooms on this floor.
    const { error } = await supabase
      .from('floors')
      .delete()
      .eq('id', window.activeFloorId);

    if (error) throw error;

    showToast('Floor Deleted', `${getFloorLabel(floor.floor_number)} has been removed successfully.`, 'success');

    // Refresh state
    await loadRealData();

    // Reset active floor to the first available floor of the building
    const updatedBuilding = buildings.find(b => b.id === activeGridBuildingId);
    if (updatedBuilding && updatedBuilding.floors && updatedBuilding.floors.length > 0) {
      // Sort floors ascending by floor_number
      const sortedFloors = [...updatedBuilding.floors].sort((a, b) => a.floor_number - b.floor_number);
      window.activeFloorId = sortedFloors[0].id;
    } else {
      window.activeFloorId = null;
    }

    showBuildingRooms(activeGridBuildingId);
    renderBuildingsList();
    renderKPIs();

  } catch (err) {
    console.error('Error deleting floor:', err);
    showToast('Error', 'Failed to delete floor: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

window.deleteActiveBuilding = async function () {
  if (!activeGridBuildingId) {
    showToast('Select Building', 'Please select a building first', 'warning');
    return;
  }

  const building = buildings.find(b => b.id === activeGridBuildingId);
  if (!building) {
    showToast('Error', 'Building not found', 'error');
    return;
  }

  let hasOccupied = false;
  building.floors?.forEach(f => {
    f.rooms?.forEach(r => {
      if (r.status === 'occupied' || r.status === 'partial' || r.beds_occupied > 0) {
        hasOccupied = true;
      }
    });
  });

  if (hasOccupied) {
    if (!confirm(`Warning: The building "${building.name}" has occupied rooms/beds. Deleting this building will vacate all active tenants from it. Do you still want to delete the entire building?`)) {
      return;
    }
  } else {
    if (!confirm(`Are you sure you want to delete the building "${building.name}" and all its floors and rooms? This action cannot be undone.`)) {
      return;
    }
  }

  const btn = document.querySelector('button[onclick="deleteActiveBuilding()"]');
  const originalText = btn ? btn.textContent : 'Delete Building';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Deleting Building...';
  }

  try {
    // STEP 1: Vacate all active tenants in this building BEFORE deleting
    // This ensures they see the blocked screen, not a broken dashboard
    const buildingTenants = allTenants.filter(
      t => t.building_id === activeGridBuildingId && t.status === 'active'
    );

    if (buildingTenants.length > 0) {
      const tenantIds = buildingTenants.map(t => t.id);
      await supabase.from('members').delete().in('tenant_id', tenantIds);

      await supabase
        .from('tenants')
        .update({
          status: 'vacated',
          vacate_date: new Date().toISOString().split('T')[0]
        })
        .eq('building_id', activeGridBuildingId)
        .eq('status', 'active');
    }

    // STEP 2: Now delete the building (cascade removes floors + rooms)
    const { error } = await supabase
      .from('buildings')
      .delete()
      .eq('id', activeGridBuildingId);

    if (error) throw error;

    showToast('Building Deleted', `Building "${building.name}" has been removed. ${buildingTenants.length > 0 ? buildingTenants.length + ' tenant(s) vacated.' : ''}`, 'success');

    // Refresh state
    await loadRealData();
    await logOwnerActivity(`Deleted building "${building.name}" (${buildingTenants.length} tenants vacated)`);

    // Reset active grid view since the building is deleted
    activeGridBuildingId = null;
    window.activeFloorId = null;
    document.getElementById('room-grid-section').classList.add('hidden');
    renderBuildingsList();
    renderKPIs();

  } catch (err) {
    console.error('Error deleting building:', err);
    showToast('Error', 'Failed to delete building: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

window.openAddRoomModal = function () {
  const building = buildings.find(b => b.id === activeGridBuildingId);
  if (!building) {
    showToast('Select Building', 'Please select a building first', 'warning');
    return;
  }

  document.getElementById('add-room-bld-name').value = building.name;

  // Populate Floor select dropdown
  const floorSelect = document.getElementById('add-room-floor-select');
  floorSelect.innerHTML = '';
  if (!building.floors || building.floors.length === 0) {
    floorSelect.innerHTML = '<option value="">No floors found — Please add a floor first</option>';
  } else {
    // Sort floors by number
    const sortedFloors = [...building.floors].sort((a, b) => a.floor_number - b.floor_number);
    sortedFloors.forEach(f => {
      floorSelect.innerHTML += `<option value="${f.id}">${getFloorLabel(f.floor_number)}</option>`;
    });
  }

  // Guess room number
  let defaultRoomNum = '';
  if (building.floors && building.floors.length > 0) {
    const firstFloor = building.floors[0];
    if (firstFloor && firstFloor.rooms && firstFloor.rooms.length > 0) {
      const roomNumSample = firstFloor.rooms[firstFloor.rooms.length - 1].room_number;
      const match = roomNumSample.match(/^([A-Za-z]*)(\d+)$/);
      if (match) {
        const letter = match[1];
        const nextNum = parseInt(match[2]) + 1;
        defaultRoomNum = `${letter}${nextNum}`;
      }
    }
  }
  document.getElementById('add-room-number').value = defaultRoomNum;

  // Prefill default rent
  let defaultRent = 8000;
  if (building.floors && building.floors[0]?.rooms?.[0]) {
    defaultRent = building.floors[0].rooms[0].rent;
  }
  document.getElementById('add-room-rent').value = defaultRent;

  // Prefill default beds and show/hide bed group
  document.getElementById('add-room-bed-group').style.display = 'none';

  utilOpenModal('modal-add-room');
};

window.saveNewRoom = async function () {
  const buildingId = activeGridBuildingId;
  const building = buildings.find(b => b.id === buildingId);
  if (!building) return;

  const floorId = document.getElementById('add-room-floor-select').value;
  const roomNumber = document.getElementById('add-room-number').value.trim();
  const rent = parseInt(document.getElementById('add-room-rent').value) || 8000;
  const splitEnabled = document.getElementById('add-room-split')?.checked || false;

  if (!floorId || !roomNumber) {
    showToast('Missing Fields', 'Please select a floor and enter a room number', 'warning');
    return;
  }

  // Validate duplicate room number in this building
  let duplicate = false;
  building.floors?.forEach(f => {
    f.rooms?.forEach(r => {
      if (r.room_number.toLowerCase() === roomNumber.toLowerCase()) {
        duplicate = true;
      }
    });
  });

  if (duplicate) {
    showToast('Duplicate Room', `Room ${roomNumber} already exists in this building.`, 'warning');
    return;
  }

  const btn = document.getElementById('btn-save-room');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Creating Room...';

  try {
    const bedsCount = 1;
    const perBedRent = splitEnabled ? Math.round(rent / bedsCount) : null;

    const { error } = await supabase
      .from('rooms')
      .insert({
        floor_id: floorId,
        building_id: buildingId,
        room_number: roomNumber,
        rent,
        beds_count: bedsCount,
        beds_occupied: 0,
        status: 'vacant',
        rent_split_enabled: splitEnabled,
        per_bed_rent: perBedRent
      });

    if (error) throw error;

    // Refresh state
    await loadRealData();

    utilCloseModal('modal-add-room');
    window.activeFloorId = floorId;
    showBuildingRooms(buildingId);
    renderBuildingsList();
    renderKPIs();

    showToast('Room Created!', `Room ${roomNumber} has been added${splitEnabled ? ` (Split Rent: ₹${perBedRent}/bed)` : ''}.`, 'success');

  } catch (err) {
    console.error('Error creating room:', err);
    showToast('Error', 'Failed to create room: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ─── Per Bed Rent Calculator (UI helper) ───
window.calcPerBedRent = function () {
  const splitEnabled = document.getElementById('add-room-split')?.checked;
  const preview = document.getElementById('per-bed-rent-preview');
  const valEl = document.getElementById('per-bed-rent-val');
  if (!preview || !valEl) return;

  if (splitEnabled) {
    const rent = parseInt(document.getElementById('add-room-rent')?.value || 0) || 0;
    const beds = parseInt(document.getElementById('add-room-beds')?.value || 1) || 1;
    const perBed = beds > 0 ? Math.round(rent / beds) : 0;
    valEl.textContent = `₹${perBed.toLocaleString('en-IN')}`;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }
};




window.copyOwnerKey = function () {
  const keyText = document.getElementById('sidebar-owner-key')?.textContent;
  if (!keyText || keyText === '—') {
    showToast('Not Ready', 'Owner Key is not loaded yet', 'warning');
    return;
  }
  navigator.clipboard.writeText(keyText).then(() => {
    showToast('Copied!', 'Owner Key copied to clipboard!', 'success');
  }).catch(err => {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = keyText;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Copied!', 'Owner Key copied to clipboard!', 'success');
  });
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


// ═══════════════ GLOBAL HANDLERS ═══════════════

window.switchInnerTab = function (targetId, btnElement) {
  // Hide all inner tab contents within the current main tab
  const parentTab = btnElement.closest('.tab-content');
  if (!parentTab) return;

  // Save active inner tab
  if (parentTab.id === 'tab-rent') {
    localStorage.setItem('pgb_owner_active_inner_tab_rent', targetId);
  } else if (parentTab.id === 'tab-tenants') {
    localStorage.setItem('pgb_owner_active_inner_tab_tenants', targetId);
  }

  const contents = parentTab.querySelectorAll('.inner-tab-content');
  contents.forEach(el => el.style.display = 'none');

  // Show target
  const target = document.getElementById('inner-' + targetId);
  if (target) target.style.display = 'block';

  // Update active state on buttons
  const buttons = parentTab.querySelectorAll('.inner-tab-btn');
  buttons.forEach(btn => btn.classList.remove('active', 'btn-primary'));
  buttons.forEach(btn => btn.classList.add('btn-ghost'));

  btnElement.classList.remove('btn-ghost');
  btnElement.classList.add('active', 'btn-primary');

  // Trigger sub-tab specific renders
  if (targetId === 'rent-overview') {
    renderRentOverview();
  } else if (targetId === 'rent-manual') {
    initRentCalculator();
  } else if (targetId === 'rent-txns') {
    initTransactionFilters();
    renderTransactionsTable();
  } else if (targetId === 'rent-dues') {
    renderRentDues();
  } else if (targetId === 'rent-deposits') {
    renderRentDeposits();
  }
};

window.switchProfileTab = function (tabName, btnElement) {
  // Hide all profile tab contents
  const parentModal = btnElement.closest('.modal-content');
  if (!parentModal) return;
  const contents = parentModal.querySelectorAll('.profile-tab-content');
  contents.forEach(el => el.style.display = 'none');

  // Show target
  const target = document.getElementById('ptab-' + tabName);
  if (target) target.style.display = 'block';

  // Update active state on buttons
  const buttons = parentModal.querySelectorAll('.profile-tab-btn');
  buttons.forEach(btn => btn.classList.remove('active', 'btn-primary'));
  buttons.forEach(btn => btn.classList.add('btn-ghost'));

  btnElement.classList.remove('btn-ghost');
  btnElement.classList.add('active', 'btn-primary');
};

window.switchTab = async function (tabId, el, skipLoad = false) {
  utilSwitchTab(tabId, el);
  // Save active tab so it survives page refresh
  localStorage.setItem('pgb_owner_active_tab', tabId);

  // Reset search box when switching tabs
  const searchInput = document.getElementById('topbar-search');
  if (searchInput) {
    searchInput.value = '';
  }

  // Load the latest data from Supabase so the views are always up-to-date!
  // Skip when restoring the tab on page load (data is already loaded by init)
  if (!skipLoad) {
    try {
      await loadRealData();
    } catch (err) {
      console.error('Failed to sync live data:', err);
    }
  }

  // Trigger tab-specific renders
  if (tabId === 'plan') renderPlanTab();
  if (tabId === 'buildings') renderBuildingsList();
  if (tabId === 'tenants') {
    renderTenantsTable();
    
    // Find saved active inner sub-tab or default to 'tenants-active'
    const savedInnerTabId = localStorage.getItem('pgb_owner_active_inner_tab_tenants') || 'tenants-active';
    const innerBtn = document.querySelector(`#tab-tenants .inner-tab-btn[onclick*="${savedInnerTabId}"]`);
    if (innerBtn) {
      window.switchInnerTab(savedInnerTabId, innerBtn);
    } else {
      const activeBtn = document.querySelector('#tab-tenants .inner-tab-btn.active');
      const innerTabId = activeBtn ? activeBtn.getAttribute('onclick').match(/'([^']+)'/)[1] : 'tenants-active';

    }
  }
  if (tabId === 'rent') {
    initRentCalculator();

    // Find saved active inner sub-tab or default to 'rent-overview'
    const savedInnerTabId = localStorage.getItem('pgb_owner_active_inner_tab_rent') || 'rent-overview';
    const innerBtn = document.querySelector(`#tab-rent .inner-tab-btn[onclick*="${savedInnerTabId}"]`);
    if (innerBtn) {
      window.switchInnerTab(savedInnerTabId, innerBtn);
    } else {
      const activeBtn = document.querySelector('#tab-rent .inner-tab-btn.active');
      const innerTabId = activeBtn ? activeBtn.getAttribute('onclick').match(/'([^']+)'/)[1] : 'rent-overview';

      if (innerTabId === 'rent-overview') {
        renderRentOverview();
      } else if (innerTabId === 'rent-manual') {
        // Calculator already initialized above
      } else if (innerTabId === 'rent-txns') {
        initTransactionFilters();
        renderTransactionsTable();
      } else if (innerTabId === 'rent-dues') {
        renderRentDues();
      } else if (innerTabId === 'rent-deposits') {
        renderRentDeposits();
      }
    }
  }
  if (tabId === 'broadcast') {
    populateBroadcastTargets();
    const noticeBoardTextarea = document.getElementById('notice-board-text');
    if (noticeBoardTextarea) noticeBoardTextarea.value = ownerData?.notice_board || '';
    renderBroadcastHistory();
  }
  if (tabId === 'history') renderHistoryTab();
  if (tabId === 'dashboard') renderDashboard();
  if (tabId === 'expenses') {
    const savedExpensesSubTab = localStorage.getItem('pgb_owner_active_expenses_subtab') || 'expenses';
    window.switchExpensesSubTab(savedExpensesSubTab);
    renderExpensesTab();
    renderStaffTab();
  }
  if (tabId === 'complaints') {
    renderComplaintsTab();
  }
  if (tabId === 'settings') {
    renderSettingsForm();
    renderSupportTicketsList();
  }
  if (tabId === 'whatsapp') {
    initWhatsAppTab();
  }


  // Close mobile sidebar
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('active');
};

window.openModal = function (id) {
  if (id === 'modal-add-building') {
    const allowed = (ownerData && ownerData.allowed_buildings !== undefined && ownerData.allowed_buildings !== null)
      ? parseInt(ownerData.allowed_buildings)
      : (parseInt(localStorage.getItem('pgb_allowed_buildings')) || 0);
    console.log('openModal Add Building Limit Check:', { allowed, currentCount: buildings.length, rawAllowed: ownerData?.allowed_buildings });

    const isEnterprise = ownerData && ownerData.plan_type === 'Enterprise';
    if (!isEnterprise && buildings.length >= allowed) {
      showToast(
        'Limit Reached',
        `You have reached your limit of ${allowed} building(s). You can add more buildings only after your current plan expires.`,
        'warning'
      );
      alert(`Limit Reached / सीमा समाप्त:\nYou have reached your limit of ${allowed} building(s). You can add more buildings only after your current subscription plan expires.\n\nआप अपनी सीमा ${allowed} बिल्डिंग्स तक पहुँच चुके हैं। आप नया प्लान केवल वर्तमान सब्सक्रिप्शन की समाप्ति के बाद ही रिन्यू या संशोधित कर सकते हैं।`);
      const planBtn = document.querySelector(`.menu-item[data-tab="plan"]`);
      if (planBtn) window.switchTab('plan', planBtn);
      return;
    }
  }
  if (id === 'modal-add-expense') {
    const today = new Date().toISOString().split('T')[0];
    const expDateInput = document.getElementById('exp-date');
    if (expDateInput) expDateInput.value = today;
  }
  utilOpenModal(id);
};
window.closeModal = utilCloseModal;

window.onBuildingSwitch = function () {
  currentBuildingFilter = document.getElementById('building-select').value;

  // Keep the rent tab filter select in sync
  const rentSel = document.getElementById('rent-building-select');
  if (rentSel) {
    rentSel.value = currentBuildingFilter;
  }

  renderDashboard();

  // Re-render other tabs if they are active
  const activeTab = localStorage.getItem('pgb_owner_active_tab') || 'dashboard';
  if (activeTab === 'tenants') renderTenantsTable();
  if (activeTab === 'rent') {
    const activeBtn = document.querySelector('#tab-rent .inner-tab-btn.active');
    const innerTabId = activeBtn ? activeBtn.getAttribute('onclick').match(/'([^']+)'/)[1] : 'rent-overview';
    if (innerTabId === 'rent-overview') renderRentOverview();
    else if (innerTabId === 'rent-txns') renderTransactionsTable();
    else if (innerTabId === 'rent-dues') renderRentDues();
    else if (innerTabId === 'rent-deposits') renderRentDeposits();
  }
  if (activeTab === 'expenses') {
    renderExpensesTab();
    renderStaffTab();
  }
};

window.onRentBuildingSwitch = function () {
  const rentSel = document.getElementById('rent-building-select');
  if (rentSel) {
    const mainSel = document.getElementById('building-select');
    if (mainSel) {
      mainSel.value = rentSel.value;
    }
    window.onBuildingSwitch();
  }
};

window.copyTopbarOwnerKey = function () {
  const key = ownerData?.owner_key;
  if (!key) {
    showToast('Error', 'Owner Key not loaded yet', 'error');
    return;
  }
  navigator.clipboard.writeText(key).then(() => {
    showToast('Copied!', 'Owner Key copied to clipboard (क्लिपबोर्ड पर कॉपी हो गया)', 'success');
  }).catch(() => {
    const input = document.createElement('input');
    input.value = key;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
    showToast('Copied!', 'Owner Key copied to clipboard (क्लिपबोर्ड पर COPY हो गया)', 'success');
  });
};

function filterTable(tbodyId, query) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  const rows = tbody.querySelectorAll('tr');
  if (rows.length === 1 && rows[0].cells.length === 1) return;

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });
}

window.handleTopbarSearch = function () {
  const query = document.getElementById('topbar-search').value.toLowerCase().trim();
  const dropdown = document.getElementById('search-dropdown');

  if (!dropdown) return;

  // ── First: Filter active tables in tabs ──
  const activeTabBtn = document.querySelector('.menu-item.active');
  const activeTabId = activeTabBtn ? activeTabBtn.dataset.tab : 'dashboard';

  if (activeTabId === 'tenants') {
    filterTable('tenants-table-body', query);
  } else if (activeTabId === 'buildings') {
    const roomBoxes = document.querySelectorAll('.room-box');
    roomBoxes.forEach(box => {
      const roomNum = box.querySelector('.room-number')?.textContent.toLowerCase() || '';
      const tenantName = box.querySelector('.room-tenant-name')?.textContent.toLowerCase() || '';
      if (roomNum.includes(query) || tenantName.includes(query)) {
        box.style.display = '';
      } else {
        box.style.display = 'none';
      }
    });
  } else if (activeTabId === 'deposits') {
    filterTable('deposits-table-body', query);
  } else if (activeTabId === 'reports') {
    filterTable('report-breakdown-body', query);
  } else if (activeTabId === 'rent') {
    const sel = document.getElementById('calc-tenant-select');
    if (sel) {
      const options = sel.querySelectorAll('option');
      options.forEach(opt => {
        if (opt.value === "") return;
        const text = opt.textContent.toLowerCase();
        opt.style.display = text.includes(query) ? '' : 'none';
      });
    }
  }

  // ── Second: Global interactive dropdown list ──
  if (query.length < 1) {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    return;
  }

  dropdown.style.display = 'block';

  // 1. Find matching tenants (active/pending/etc.) and check members
  const matchingTenants = allTenants.filter(t =>
    t.name.toLowerCase().includes(query) ||
    (t.phone && t.phone.includes(query)) ||
    (t.email && t.email.toLowerCase().includes(query)) ||
    (t.room_number && String(t.room_number).toLowerCase().includes(query)) ||
    (t.members && t.members.some(m => m.name.toLowerCase().includes(query) || m.phone.includes(query)))
  );

  // 2. Find matching rooms
  const matchingRooms = [];
  buildings.forEach(b => {
    (b.floors || []).forEach(f => {
      (f.rooms || []).forEach(r => {
        if (String(r.room_number).toLowerCase().includes(query)) {
          matchingRooms.push({
            ...r,
            building_id: b.id,
            building_name: b.name,
            floor_id: f.id,
            floor_number: f.floor_number
          });
        }
      });
    });
  });

  let html = '';

  if (matchingTenants.length === 0 && matchingRooms.length === 0) {
    html = `
      <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px;">
        ${ICONS.error('', 'margin-right:4px;')} No matching rooms or tenants found.<br>
        <span style="font-size: 11px;">(कोई कमरा या किरायेदार नहीं मिला)</span>
      </div>
    `;
    dropdown.innerHTML = html;
    return;
  }

  // Render Matching Tenants Group
  if (matchingTenants.length > 0) {
    html += `<div style="background: rgba(255,255,255,0.02); padding: 6px 12px; font-size: 11px; font-weight: 700; color: var(--primary-light); text-transform: uppercase; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; gap: 4px;">${ICONS.users('', 'margin-right:4px;')} Tenants (कि किरायेदार)</div>`;
    matchingTenants.forEach(t => {
      const isPending = t.status === 'pending';
      const statusText = t.status === 'active'
        ? '<span class="search-dropdown-badge" style="background: rgba(0,196,140,0.15); color: #00C48C;">Active</span>'
        : `<span class="search-dropdown-badge" style="background: rgba(253,203,110,0.15); color: #fbcb0a;">${t.status.toUpperCase()}</span>`;

      // Find floorId dynamically
      let floorId = null;
      if (t.room_id) {
        for (const b of buildings) {
          for (const f of b.floors || []) {
            if (f.rooms?.some(rm => rm.id === t.room_id)) {
              floorId = f.id;
              break;
            }
          }
          if (floorId) break;
        }
      }

      html += `
        <div class="search-dropdown-item" onclick="window.searchOpenTenantProfile('${t.id}')">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="search-dropdown-title" style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.user()} ${t.name}</span>
            ${statusText}
          </div>
          <div class="search-dropdown-subtitle">
            <span style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.building()} ${t.building_name}</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.home()} Room ${t.room_number}</span>
            <span style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.phone()} ${t.phone || '—'}</span>
          </div>
        </div>
      `;
    });
  }

  // Render Matching Rooms Group
  if (matchingRooms.length > 0) {
    html += `<div style="background: rgba(255,255,255,0.02); padding: 6px 12px; font-size: 11px; font-weight: 700; color: var(--accent); text-transform: uppercase; border-bottom: 1px solid var(--border-color); margin-top: 4px; display: flex; align-items: center; gap: 4px;">${ICONS.home()} Rooms (कमरे)</div>`;
    matchingRooms.forEach(r => {
      const roomTenants = allTenants.filter(t => (t.status === 'active' || t.status === 'vacating') && t.room_id === r.id);
      const tenantNames = roomTenants.map(t => t.name).join(', ');
      const statusText = roomTenants.length > 0
        ? `<span style="color: var(--text-secondary); font-size: 11px;">Kirayedar: <strong>${tenantNames}</strong></span>`
        : `<span style="color: #FF6B6B; font-size: 11px;">Vacant (खाली है)</span>`;

      html += `
        <div class="search-dropdown-item" onclick="window.selectSearchTenant('${r.building_id}', '${r.floor_id}', '${r.id}', false)">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="search-dropdown-title" style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.home()} Room ${r.room_number}</span>
            <span class="search-dropdown-badge" style="background: rgba(0, 210, 255, 0.15); color: var(--accent); font-size: 10px;">${r.building_name}</span>
          </div>
          <div class="search-dropdown-subtitle">
            ${statusText}
          </div>
        </div>
      `;
    });
  }

  dropdown.innerHTML = html;
};

// Global click helper — opens tenant profile popup from search
window.searchOpenTenantProfile = function (tenantId) {
  // Close search dropdown and clear input
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  const searchInput = document.getElementById('topbar-search');
  if (searchInput) searchInput.value = '';
  // Close the expanding search bar
  if (typeof closeTopbarSearch === 'function') closeTopbarSearch();

  if (!tenantId) {
    showToast('Error', 'Tenant ID missing.', 'error');
    return;
  }

  // Open the full tenant profile modal
  window.viewTenantDetails(tenantId);
};

// Global click helper for room search results
window.selectSearchTenant = function (buildingId, floorId, roomId, isPending = false) {
  const dropdown = document.getElementById('search-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  const searchInput = document.getElementById('topbar-search');
  if (searchInput) searchInput.value = '';
  if (typeof closeTopbarSearch === 'function') closeTopbarSearch();

  if (isPending) {
    // Switch to dashboard tab where pending approvals list is displayed
    const dashboardTabBtn = document.querySelector('.menu-item[data-tab="dashboard"]');
    if (dashboardTabBtn) window.switchTab('dashboard', dashboardTabBtn);

    // Scroll to approvals section
    const approvalCard = document.getElementById('dashboard-approvals-card');
    if (approvalCard) approvalCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
    showToast('Pending Approval', 'See pending tenant request under approvals section.', 'info');
    return;
  }

  if (!buildingId || !roomId) {
    showToast('Info', 'No active room or building linked to this tenant.', 'info');
    return;
  }

  // Find floorId dynamically if missing
  if (!floorId) {
    for (const b of buildings) {
      for (const f of b.floors || []) {
        if (f.rooms?.some(rm => rm.id === roomId)) {
          floorId = f.id;
          break;
        }
      }
      if (floorId) break;
    }
  }

  if (buildingId && floorId && roomId) {
    window.openRoomInfoModal(buildingId, floorId, roomId);
    openModal('modal-room-info');
  } else {
    showToast('Error', 'Unable to open room details.', 'error');
  }
};


window.handleLogout = async function () {
  const confirmLogout = confirm("Are you sure you want to logout? / क्या आप लॉगआउट करना चाहते हैं?");
  if (!confirmLogout) return;
  try {
    if (isConfigured()) await signOut();
    localStorage.removeItem('pgb_demo_mode');
    localStorage.removeItem('pgb_user_role');
    window.location.href = '/';
  } catch {
    window.location.href = '/';
  }
};

// ── Manual Tenant Addition Logic ──
let manualSelectedBuilding = null;
let manualSelectedRoom = null;
let manualMembers = [];

window.openAddTenantModal = function (preselectedBuildingId = null, preselectedFloorId = null, preselectedRoomId = null) {
  document.getElementById('manual-name').value = '';
  document.getElementById('manual-phone').value = '';
  document.getElementById('manual-alt-phone').value = '';
  document.getElementById('manual-email').value = '';
  document.getElementById('manual-aadhaar').value = '';
  document.getElementById('manual-meter').value = '0';
  document.getElementById('manual-join-date').value = new Date().toISOString().split('T')[0];

  // Reset living type
  document.querySelector('input[name="manual-living-type"][value="alone"]').checked = true;
  window.toggleManualMembersSection();

  // Populate buildings select
  const sel = document.getElementById('manual-sel-building');
  sel.innerHTML = '<option value="">— Choose Building —</option>';
  buildings.forEach(b => {
    sel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
  });

  document.getElementById('manual-floor-group').classList.add('hidden');
  document.getElementById('manual-room-group').classList.add('hidden');
  document.getElementById('manual-room-details').classList.add('hidden');

  openModal('modal-add-tenant');

  // If preselected options are provided, apply them
  if (preselectedBuildingId) {
    sel.value = preselectedBuildingId;
    window.onManualBuildingChange();

    if (preselectedFloorId) {
      const floorSel = document.getElementById('manual-sel-floor');
      if (floorSel) {
        floorSel.value = preselectedFloorId;
        window.onManualFloorChange();

        if (preselectedRoomId) {
          const roomSel = document.getElementById('manual-sel-room');
          if (roomSel) {
            roomSel.value = preselectedRoomId;
            window.onManualRoomChange();
          }
        }
      }
    }
  }
};

window.onManualBuildingChange = function () {
  const buildingId = document.getElementById('manual-sel-building').value;
  const floorGroup = document.getElementById('manual-floor-group');
  const roomGroup = document.getElementById('manual-room-group');
  const roomDetails = document.getElementById('manual-room-details');

  floorGroup.classList.add('hidden');
  roomGroup.classList.add('hidden');
  roomDetails.classList.add('hidden');

  if (!buildingId) return;

  manualSelectedBuilding = buildings.find(b => b.id === buildingId);
  if (!manualSelectedBuilding) return;

  const floors = manualSelectedBuilding.floors || [];
  const floorSel = document.getElementById('manual-sel-floor');
  floorSel.innerHTML = '<option value="">— Choose Floor —</option>';

  floors.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = getFloorLabel(f.floor_number);
    floorSel.appendChild(opt);
  });

  floorGroup.classList.remove('hidden');
};

window.onManualFloorChange = function () {
  const floorId = document.getElementById('manual-sel-floor').value;
  const roomGroup = document.getElementById('manual-room-group');
  const roomDetails = document.getElementById('manual-room-details');

  roomGroup.classList.add('hidden');
  roomDetails.classList.add('hidden');

  if (!floorId || !manualSelectedBuilding) return;

  const floor = manualSelectedBuilding.floors.find(f => f.id === floorId);
  if (!floor) return;

  const roomSel = document.getElementById('manual-sel-room');
  roomSel.innerHTML = '<option value="">— Choose Room —</option>';

  const rooms = floor.rooms || [];
  rooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    const isPG = ['pg', 'hostel'].includes(manualSelectedBuilding.type);
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

window.onManualRoomChange = function () {
  const roomId = document.getElementById('manual-sel-room').value;
  const roomDetails = document.getElementById('manual-room-details');

  if (!roomId) {
    roomDetails.classList.add('hidden');
    return;
  }

  let room = null;
  for (const floor of manualSelectedBuilding.floors) {
    room = floor.rooms.find(r => r.id === roomId);
    if (room) break;
  }

  if (!room) return;
  manualSelectedRoom = room;

  document.getElementById('manual-room-rent').textContent = formatCurrency(room.rent);
  document.getElementById('manual-room-advance').textContent = formatCurrency(manualSelectedBuilding.advance_amount || 0);
  document.getElementById('manual-room-type').textContent = manualSelectedBuilding.type.toUpperCase();
  roomDetails.classList.remove('hidden');
};

window.toggleManualMembersSection = function () {
  const livingType = document.querySelector('input[name="manual-living-type"]:checked').value;
  const section = document.getElementById('manual-members-section');
  if (livingType === 'family') {
    section.classList.remove('hidden');
    document.getElementById('manual-members-list').innerHTML = '';
    manualMembers = [];
    window.addManualMemberRow();
  } else {
    section.classList.add('hidden');
  }
};

window.addManualMemberRow = function () {
  const idx = manualMembers.length;
  manualMembers.push({ name: '', phone: '', aadhaar: '', relation: '' });

  const container = document.getElementById('manual-members-list');
  const div = document.createElement('div');
  div.className = 'manual-member-row';
  div.style.cssText = 'background: var(--bg-input); border: 1px solid var(--border-input); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 8px;';
  div.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
      <span style="font-size: var(--font-xs); font-weight: 600; color: var(--text-secondary);">Member ${idx + 1}</span>
      <button class="btn btn-sm btn-ghost" onclick="window.removeManualMember(this, ${idx})" style="color: var(--danger); font-size: 12px; padding: 2px 6px; display: flex; align-items: center; gap: 4px;">${ICONS.trash()} Remove</button>
    </div>
    <div class="form-group" style="margin-bottom: 8px;">
      <input class="form-input" type="text" placeholder="Member Name *" data-manual-member="${idx}" data-field="name" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
    </div>
    <div class="form-row" style="gap: 8px; margin-bottom: 8px;">
      <div class="form-group" style="margin-bottom: 0;">
        <input class="form-input" type="tel" placeholder="Phone *" data-manual-member="${idx}" data-field="phone" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
      </div>
      <div class="form-group" style="margin-bottom: 0;">
        <input class="form-input" type="text" placeholder="Relation" data-manual-member="${idx}" data-field="relation" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom: 0;">
      <input class="form-input" type="text" placeholder="Aadhaar Card Number *" data-manual-member="${idx}" data-field="aadhaar" maxlength="14" style="font-size: var(--font-xs); height: 32px; padding: 4px 8px;" />
    </div>
  `;
  container.appendChild(div);

  const card = container.lastElementChild;
  if (card) {
    attachNameInput(card.querySelector('[data-field="name"]'));
    attachPhoneInput(card.querySelector('[data-field="phone"]'));
    attachAadhaarInput(card.querySelector('[data-field="aadhaar"]'));
  }
};

window.removeManualMember = function (btn, idx) {
  btn.closest('.manual-member-row').remove();
  manualMembers.splice(idx, 1);
};

window.submitManualTenantRegistration = async function () {
  const name = document.getElementById('manual-name').value.trim();
  const phone = document.getElementById('manual-phone').value.trim();
  const altPhone = document.getElementById('manual-alt-phone').value.trim();
  let email = document.getElementById('manual-email').value.trim();
  const aadhaar = document.getElementById('manual-aadhaar').value.trim();
  const meterReading = parseFloat(document.getElementById('manual-meter').value) || 0;
  const joinDate = document.getElementById('manual-join-date').value;
  const livingType = document.querySelector('input[name="manual-living-type"]:checked').value;

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

  if (!manualSelectedRoom) {
    showToast('Select Room', 'Please select building and room', 'warning');
    return;
  }

  if (!email) {
    email = `manual-tenant-${phone || Date.now()}@pgbuilderss.online`;
  }

  // Collect and validate member data
  const memberData = [];
  if (livingType === 'family') {
    const rows = document.querySelectorAll('#manual-members-list .manual-member-row');
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

      memberData.push({ name: mName, phone: mPhone, relation: mRelation, aadhaar_number: mAadhaar });
    });

    if (memberErrors.length > 0) {
      showToast('Validation Error', memberErrors[0], 'warning');
      return;
    }
  }

  const btn = document.querySelector('button[onclick="submitManualTenantRegistration()"]');
  const originalText = btn ? btn.innerHTML : 'Save & Add Tenant';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    // 1. Insert tenant in database directly as active
    const { data: updated, error } = await supabase
      .from('tenants')
      .insert({
        owner_id: ownerData.id,
        building_id: manualSelectedBuilding.id,
        room_id: manualSelectedRoom.id,
        status: 'active',
        name,
        phone,
        alt_phone: altPhone,
        email,
        aadhaar_number: aadhaar,
        living_type: livingType,
        initial_meter_reading: meterReading,
        current_meter_reading: meterReading,
        join_date: joinDate || new Date().toISOString().split('T')[0]
      })
      .select();

    if (error) throw error;

    if (!updated || updated.length === 0) {
      throw new Error('Could not insert tenant profile. Please check database configuration.');
    }

    const newTenant = updated[0];

    // 2. Insert family members
    if (memberData.length > 0) {
      await supabase.from('members').insert(
        memberData.map(m => ({ ...m, tenant_id: newTenant.id }))
      );
    }

    // 3. Update room occupancy
    const nextBedsOccupied = Math.min(manualSelectedRoom.beds_count, manualSelectedRoom.beds_occupied + 1);
    const nextStatus = nextBedsOccupied === manualSelectedRoom.beds_count ? 'occupied' : 'partial';

    await supabase
      .from('rooms')
      .update({
        beds_occupied: nextBedsOccupied,
        status: nextStatus
      })
      .eq('id', manualSelectedRoom.id);

    showToast('Success!', 'Tenant added manually and room updated.', 'success');
    closeModal('modal-add-tenant');

    // Refresh client state
    await loadRealData();
    renderTenantsTable();
    renderKPIs();
    initRentCalculator();
    if (activeGridBuildingId) showBuildingRooms(activeGridBuildingId);

  } catch (err) {
    showToast('Save Failed', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

// ── Super Notifications Ticker ──
function renderSuperNotifications() {
  const container = document.getElementById('super-notifications-container');
  if (!container) return;
  if (superNotifications && superNotifications.length > 0) {
    const notice = superNotifications[0];
    document.getElementById('super-notice-title').textContent = notice.title || 'Platform Notice';
    document.getElementById('super-notice-message').textContent = notice.message || '';
    container.classList.remove('hidden');
  } else {
    container.classList.add('hidden');
  }
}

// ── Room Grid Filters ──
window.filterRoomStatus = function (status, btn) {
  document.querySelectorAll('.room-filter-row .btn').forEach(b => b.classList.remove('active-pill'));
  btn?.classList.add('active-pill');

  const boxes = document.querySelectorAll('.room-box');
  boxes.forEach(box => {
    if (status === 'all') {
      box.style.display = '';
    } else {
      const roomStatus = box.className.split(' ').find(c => ['vacant', 'occupied', 'partial', 'maintenance'].includes(c));
      box.style.display = roomStatus === status ? '' : 'none';
    }
  });
};

// ── Rent Revenue Tab sub-tab Renderers ──

function getTenantDueInfo(t, today) {
  const joinDateStr = t.join_date; // e.g. "2026-04-10"
  let joinDay = 1;
  if (joinDateStr) {
    const parts = joinDateStr.split('-');
    if (parts.length === 3) {
      joinDay = parseInt(parts[2], 10) || 1;
    }
  }

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  // Last day of current month
  const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
  const dueDay = Math.min(joinDay, lastDay);

  const dueDate = new Date(currentYear, currentMonth, dueDay);

  // Normalize dates
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dueMidnight = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());

  const diffTime = todayMidnight - dueMidnight;
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  return {
    dueDate,
    dueDay,
    diffDays,
    isOverdue: diffDays > 0,
    formattedDueDate: `${String(dueDay).padStart(2, '0')}/${String(currentMonth + 1).padStart(2, '0')}/${currentYear}`,
    formattedJoinDate: joinDateStr ? joinDateStr.split('-').reverse().join('/') : '—'
  };
}

let currentSelectedMonth = getCurrentMonthYear();

function getOwnerActiveMonths() {
  const monthsSet = new Set();

  // 1. Add current month and past months back to owner creation
  const start = ownerData?.created_at ? new Date(ownerData.created_at) : new Date();
  const end = new Date();

  let current = new Date(end.getFullYear(), end.getMonth(), 1);
  const limit = new Date(start.getFullYear(), start.getMonth(), 1);

  while (current >= limit) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    monthsSet.add(`${yyyy}-${mm}`);
    current.setMonth(current.getMonth() - 1);
  }

  // 2. Scan allPayments to add any other months that have payments (only up to current month)
  const currentMonthStr = getCurrentMonthYear();
  if (Array.isArray(allPayments)) {
    allPayments.forEach(p => {
      if (p.month_year && /^\d{4}-\d{2}$/.test(p.month_year)) {
        if (p.month_year <= currentMonthStr) {
          monthsSet.add(p.month_year);
        }
      }
      const payDateStr = p.payment_date || p.created_at;
      if (payDateStr && /^\d{4}-\d{2}/.test(payDateStr)) {
        const m = payDateStr.slice(0, 7);
        if (m <= currentMonthStr) {
          monthsSet.add(m);
        }
      }
    });
  }

  // Convert Set to sorted array of objects (newest first, chronologically descending)
  const sortedMonths = Array.from(monthsSet).sort((a, b) => b.localeCompare(a));

  return sortedMonths.map(m => ({
    val: m,
    label: formatMonthYear(m + '-01')
  }));
}

window.populateAllMonthFilters = function () {
  const activeMonths = getOwnerActiveMonths();
  const optionsHTML = activeMonths.map(m => `<option value="${m.val}" ${currentSelectedMonth === m.val ? 'selected' : ''}>${m.label}</option>`).join('');
  const optionsWithAllHTML = `<option value="all" ${currentSelectedMonth === 'all' ? 'selected' : ''}>All Months</option>` + optionsHTML;

  const dashSel = document.getElementById('dashboard-month-filter');
  if (dashSel) {
    const prevVal = dashSel.value;
    dashSel.innerHTML = optionsWithAllHTML;
    dashSel.value = prevVal || currentSelectedMonth;
  }

  const rentSel = document.getElementById('rent-overview-month-filter');
  if (rentSel) {
    const prevVal = rentSel.value;
    rentSel.innerHTML = optionsWithAllHTML;
    rentSel.value = prevVal || currentSelectedMonth;
  }

  const txnSel = document.getElementById('txn-month-filter');
  if (txnSel) {
    const prevVal = txnSel.value;
    txnSel.innerHTML = optionsWithAllHTML;
    txnSel.value = prevVal || 'all';
  }

  const tenantsTxnSel = document.getElementById('tenants-txn-month-filter');
  if (tenantsTxnSel) {
    const prevVal = tenantsTxnSel.value;
    tenantsTxnSel.innerHTML = optionsWithAllHTML;
    tenantsTxnSel.value = prevVal || 'all';
  }

  const expSel = document.getElementById('expenses-month-filter');
  if (expSel) {
    const prevVal = expSel.value;
    expSel.innerHTML = optionsWithAllHTML;
    expSel.value = prevVal || currentSelectedMonth;
  }
};

window.onMonthFilterChange = function (newVal) {
  currentSelectedMonth = newVal;

  // Sync select element values
  ['dashboard-month-filter', 'rent-overview-month-filter', 'txn-month-filter', 'expenses-month-filter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = newVal;
  });

  setDateDisplay();
  renderDashboard();
  renderRentOverview();
  renderTransactionsTable();
  renderExpensesTab();
};

function renderRentOverview() {
  const activeMonths = getOwnerActiveMonths().map(m => m.val);

  // Filter approved payments in the selected month/all and selected building
  const filteredApprovedPayments = allPayments.filter(p => {
    const matchesStatus = p.status === 'approved';
    const payDateStr = p.payment_date || p.created_at || '';
    const matchesMonth = currentSelectedMonth === 'all' || payDateStr.startsWith(currentSelectedMonth);
    const matchesBuilding = currentBuildingFilter === 'all' || p.building_id === currentBuildingFilter;
    return matchesStatus && matchesMonth && matchesBuilding;
  });

  const collected = filteredApprovedPayments.reduce((s, p) => s + (parseFloat(p.rent_amount) || 0), 0);
  const totalElectricity = filteredApprovedPayments.reduce((s, p) => s + (parseFloat(p.electricity_amount) || 0), 0);
  const totalMaintenance = filteredApprovedPayments.reduce((s, p) => s + (parseFloat(p.maintenance_amount) || 0), 0);

  let targetAmount = 0;
  let overdueAmount = 0;

  const today = new Date();
  const targetMonthsList = currentSelectedMonth === 'all' ? activeMonths : [currentSelectedMonth];

  targetMonthsList.forEach(mStr => {
    // Get active tenants for this specific month
    const tenantsInMonth = allTenants.filter(t => {
      const matchesBuilding = currentBuildingFilter === 'all' || t.building_id === currentBuildingFilter;
      if (!matchesBuilding) return false;

      const joinMonth = t.join_date ? t.join_date.slice(0, 7) : '';
      if (!joinMonth) return false;

      const joinedInOrBefore = joinMonth <= mStr;

      let notVacatedYet = true;
      if (t.vacate_date) {
        const vacateMonth = t.vacate_date.slice(0, 7);
        notVacatedYet = vacateMonth >= mStr;
      }

      return joinedInOrBefore && notVacatedYet;
    });

    targetAmount += tenantsInMonth.reduce((sum, t) => sum + (t.rent || 8000), 0);

    // Compute overdue amount for this specific month
    const paymentsInMonth = allPayments.filter(p => {
      const matchesStatus = p.status === 'approved';
      const matchesMonth = p.month_year === mStr;
      const matchesBuilding = currentBuildingFilter === 'all' || p.building_id === currentBuildingFilter;
      return matchesStatus && matchesMonth && matchesBuilding;
    });
    const paidTenantIds = new Set(paymentsInMonth.map(p => p.tenant_id));

    const currentMonthStr = getCurrentMonthYear();
    const isSelectedMonthCurrentOrFuture = mStr >= currentMonthStr;

    tenantsInMonth.forEach(t => {
      if (!paidTenantIds.has(t.id)) {
        if (!isSelectedMonthCurrentOrFuture) {
          overdueAmount += (t.rent || 8000);
        } else {
          const payDay = t.pay_day || t.rent_due_day || 1;
          const dueDate = new Date(today.getFullYear(), today.getMonth(), payDay);
          if (today > dueDate) {
            overdueAmount += (t.rent || 8000);
          }
        }
      }
    });
  });

  // Security Deposit Held (sum of advance_paid from active tenants)
  const activeTenants = allTenants.filter(t => {
    const matchesBuilding = currentBuildingFilter === 'all' || t.building_id === currentBuildingFilter;
    const isCurrentlyActive = t.status === 'active' || t.status === 'vacating';
    return matchesBuilding && isCurrentlyActive;
  });

  const totalDeposit = activeTenants.reduce((sum, t) => sum + (t.advance_paid || 0), 0);

  // Room counts for Occupancy Rate and Vacant Rooms
  let totalRooms = 0, occupiedRooms = 0, vacantRooms = 0;
  const activeBuildings = currentBuildingFilter === 'all'
    ? buildings
    : buildings.filter(b => b.id === currentBuildingFilter);

  activeBuildings.forEach(b => {
    b.floors?.forEach(f => {
      f.rooms?.forEach(r => {
        totalRooms++;
        if (r.status === 'occupied' || r.status === 'partial') occupiedRooms++;
        else vacantRooms++;
      });
    });
  });

  const occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

  const percent = targetAmount > 0 ? Math.round((collected / targetAmount) * 100) : 0;
  const pending = Math.max(0, targetAmount - collected);

  // ── Render Card 1: Expected Revenue ──
  const percentEl = document.getElementById('rent-stat-percent');
  if (percentEl) percentEl.textContent = `${percent}%`;

  const expectedEl = document.getElementById('rent-stat-expected');
  if (expectedEl) expectedEl.textContent = `${formatCurrency(collected)} / ${formatCurrency(targetAmount)}`;

  const progressBarEl = document.getElementById('rent-stat-progress-bar');
  if (progressBarEl) progressBarEl.style.width = `${percent}%`;

  // ── Render Card 2: Pending Revenue ──
  const pendingEl = document.getElementById('rent-stat-pending');
  if (pendingEl) pendingEl.textContent = formatCurrency(pending);

  // ── Render Card 3: Overdue Revenue ──
  const overdueEl = document.getElementById('rent-stat-overdue');
  if (overdueEl) overdueEl.textContent = formatCurrency(overdueAmount);

  // ── Render Card 4: Electricity Collected ──
  const electricityEl = document.getElementById('rent-stat-electricity');
  if (electricityEl) electricityEl.textContent = formatCurrency(totalElectricity);

  // ── Render Card 5: Maintenance Collected ──
  const maintenanceEl = document.getElementById('rent-stat-maintenance');
  if (maintenanceEl) maintenanceEl.textContent = formatCurrency(totalMaintenance);

  // ── Render Card 6: Security Deposit Held ──
  const depositEl = document.getElementById('rent-stat-deposit');
  if (depositEl) depositEl.textContent = formatCurrency(totalDeposit);

  // ── Render Card 7: Occupancy Rate ──
  const occupancyEl = document.getElementById('rent-stat-occupancy');
  if (occupancyEl) occupancyEl.textContent = `${occupancyRate}%`;

  const occupancyDetailEl = document.getElementById('rent-stat-occupancy-detail');
  if (occupancyDetailEl) occupancyDetailEl.textContent = `${occupiedRooms} / ${totalRooms} Rooms Occupied`;

  // ── Render Card 8: Active Tenants ──
  const activeTenantsEl = document.getElementById('rent-stat-active-tenants');
  if (activeTenantsEl) activeTenantsEl.textContent = activeTenants.length;

  // ── Render Card 9: Vacant Rooms ──
  const vacantEl = document.getElementById('rent-stat-vacant');
  if (vacantEl) vacantEl.textContent = vacantRooms;

  // Render original sections
  renderReportData();
  renderDepositsTable();
}

function initTransactionFilters() {
  const bSel = document.getElementById('txn-building-filter');
  if (bSel) {
    const prevVal = bSel.value || 'all';
    bSel.innerHTML = '<option value="all">All Buildings</option>';
    buildings.forEach(b => {
      bSel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
    bSel.value = prevVal;
  }

  populateAllMonthFilters();
}

function renderTransactionsTable() {
  const tbody = document.getElementById('rent-txns-tbody');
  if (!tbody) return;

  const searchQuery = (document.getElementById('txn-search-input')?.value || '').toLowerCase().trim();
  const buildingFilter = document.getElementById('txn-building-filter')?.value || 'all';
  const statusFilter = document.getElementById('txn-status-filter')?.value || 'all';
  const monthFilter = document.getElementById('txn-month-filter')?.value || 'all';

  // Filter allPayments
  const filtered = allPayments.filter(p => {
    // Search query: matches tenant name, room number, building name
    const matchesSearch = !searchQuery ||
      (p.tenant_name || '').toLowerCase().includes(searchQuery) ||
      (p.room_number || '').toString().includes(searchQuery) ||
      (p.building_name || '').toLowerCase().includes(searchQuery);

    // Building filter
    const matchesBuilding = buildingFilter === 'all' || p.building_id === buildingFilter;

    // Status filter
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;

    // Month filter
    const payDateStr = p.payment_date || p.created_at || '';
    const matchesMonth = monthFilter === 'all' || payDateStr.startsWith(monthFilter);

    return matchesSearch && matchesBuilding && matchesStatus && matchesMonth;
  });

  // Sort filtered transactions chronologically (newest first)
  filtered.sort((a, b) => new Date(b.created_at || b.payment_date) - new Date(a.created_at || a.payment_date));

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted" style="padding: 24px;">No transactions found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    let statusClass = 'badge-warning';
    if (p.status === 'approved') statusClass = 'badge-success';
    if (p.status === 'rejected') statusClass = 'badge-danger';

    // Breakdown text
    const breakdown = `Rent: ${formatCurrency(p.rent_amount || 0)} • Elec: ${formatCurrency(p.electricity_amount || 0)} • Maint: ${formatCurrency(p.maintenance_amount || 0)}`;

    // Actions
    let actionsHTML = '';
    if (p.status === 'pending') {
      actionsHTML = `<button class="btn btn-success btn-sm" onclick="approvePayment('${p.id}')">Approve</button>`;
    } else if (p.status === 'approved') {
      actionsHTML = `<button class="btn btn-secondary btn-sm" onclick="downloadOwnerReceipt('${p.id}')">${ICONS.receipt()} Receipt</button>`;
    } else {
      actionsHTML = `<span class="text-muted" style="font-size: var(--font-xs);">—</span>`;
    }

    // Get floor number
    let floorNum = getFloorNumberForRoom(p.room_id);
    if (!floorNum && p.tenant_id) {
      const tenant = allTenants.find(t => t.id === p.tenant_id);
      if (tenant) floorNum = tenant.floor_number;
    }
    if (!floorNum) floorNum = '—';

    // Full Date formatting
    const paymentDateObj = p.payment_date || p.created_at || new Date();
    const fullDate = formatDate(paymentDateObj);

    return `<tr>
      <td><strong>${p.tenant_name || '—'}</strong></td>
      <td>${p.building_name || '—'}</td>
      <td>Floor ${floorNum}</td>
      <td><strong>Room ${p.room_number || '—'}</strong></td>
      <td style="white-space: nowrap;">${fullDate}</td>
      <td><strong>${formatCurrency(p.total_amount)}</strong></td>
      <td style="font-size: var(--font-xs); color: var(--text-muted);">${breakdown}</td>
      <td>${p.payment_method || 'UPI'}</td>
      <td style="font-family: monospace; font-size: var(--font-xs); color: var(--text-muted);">${p.transaction_id || '—'}</td>
      <td><span class="badge ${statusClass}">${p.status.toUpperCase()}</span></td>
      <td>${actionsHTML}</td>
    </tr>`;
  }).join('');
}

window.downloadOwnerReceipt = function (paymentId) {
  const payment = allPayments.find(p => p.id === paymentId);
  if (!payment) return;

  generateReceiptPDF({
    txnId: payment.id,
    tenantName: payment.tenant_name,
    roomNo: payment.room_number,
    buildingName: payment.building_name || '—',
    month: formatMonthYear(payment.month_year + '-01'),
    date: formatDate(payment.payment_date || payment.created_at || new Date()),
    rent: payment.rent_amount,
    elec: payment.electricity_amount,
    maint: payment.maintenance_amount,
    total: payment.total_amount,
    method: payment.payment_method || 'UPI'
  });

  showToast('Receipt Downloaded!', `PDF receipt for ${formatMonthYear(payment.month_year + '-01')}`, 'success');
};

function renderRentDues() {
  const tbody = document.getElementById('rent-dues-tbody');
  if (!tbody) return;

  const currentMonthStr = getCurrentMonthYear();
  const today = new Date();

  // Find all approved payments for the current month
  const currentMonthApprovedPayments = allPayments.filter(p => p.month_year === currentMonthStr && p.status === 'approved');
  const paidTenantIds = new Set(currentMonthApprovedPayments.map(p => p.tenant_id));

  // Find all active/vacating tenants
  const activeTenants = allTenants.filter(t => t.status === 'active' || t.status === 'vacating');

  // Filter unpaid tenants
  const unpaidTenants = activeTenants.filter(t => !paidTenantIds.has(t.id));

  if (unpaidTenants.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding: 24px; color: var(--success); font-weight: 500;">All clear! All tenants have paid for this month.</td></tr>';
    return;
  }

  // Map each tenant with due date calculations
  const listData = unpaidTenants.map(t => {
    const building = buildings.find(b => b.id === t.building_id);
    const rent = t.rent || 8000;
    const maint = building?.maintenance_charge || 500;
    const totalDue = rent + maint; // Base rent + standard maintenance charge

    const dueInfo = getTenantDueInfo(t, today);

    return {
      tenant: t,
      dueInfo,
      totalDue
    };
  });

  // Sort unpaid tenants: show most overdue first, then due today, then due in future
  listData.sort((a, b) => b.dueInfo.diffDays - a.dueInfo.diffDays);

  tbody.innerHTML = listData.map(item => {
    const t = item.tenant;
    const dueInfo = item.dueInfo;

    let statusBadge = '';
    if (dueInfo.diffDays > 0) {
      statusBadge = `<span class="badge badge-danger" style="font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${ICONS.alert()} Overdue by ${dueInfo.diffDays} day${dueInfo.diffDays !== 1 ? 's' : ''}</span>`;
    } else if (dueInfo.diffDays === 0) {
      statusBadge = `<span class="badge badge-warning" style="font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${ICONS.pending()} Due Today</span>`;
    } else {
      statusBadge = `<span class="badge badge-info" style="font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">${ICONS.calendar()} Due in ${Math.abs(dueInfo.diffDays)} day${Math.abs(dueInfo.diffDays) !== 1 ? 's' : ''}</span>`;
    }

    return `<tr>
      <td><strong>${t.name}</strong><br><small class="text-muted">${t.phone}</small></td>
      <td>Room ${t.room_number} (${t.building_name || '—'})</td>
      <td><strong>${formatCurrency(item.totalDue)}</strong></td>
      <td>${dueInfo.formattedJoinDate}</td>
      <td><strong>${dueInfo.formattedDueDate}</strong></td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="remindUnpaidWhatsApp('${t.id}')" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">${ICONS.chat()} Remind</button>
      </td>
    </tr>`;
  }).join('');
}

function renderMonthlyChecklist() {
  // Deprecated checklist hook - triggers the active new sub-tabs to keep views in sync
  renderRentOverview();
  renderTransactionsTable();
  renderRentDues();
}

window.remindUnpaidWhatsApp = async function (tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  if (!tenant) return;
  const msg = `Hello ${tenant.name},\n\nYour rent for Room ${tenant.room_number} is pending. Please pay at your earliest convenience via UPI: ${ownerData.upi_id || 'N/A'}.\n\n— PG Builders`;
  
  try {
    showToast('Sending', 'Triggering Cloud WhatsApp Reminder...', 'info');

    // Call Supabase Edge Function
    const { data, error } = await supabase.functions.invoke('whatsapp-reminder', {
      body: {
        manual: true,
        tenantId: tenant.id
      }
    });

    if (error) throw error;

    if (data && data.success) {
      showToast('Success', `Rent reminder sent to ${tenant.name} successfully!`, 'success');
    } else {
      throw new Error(data?.error || 'Failed to send via API');
    }
  } catch (err) {
    console.warn('API Sending failed, falling back to manual WhatsApp:', err);
    showToast('API Offline', 'Failed to send automatically. Opening WhatsApp Web instead.', 'warning');
    sendWhatsAppReminder(tenant.phone, msg);
  }
};

// Expose renderers globally for HTML event attributes
window.renderTransactionsTable = renderTransactionsTable;
window.renderRentOverview = renderRentOverview;
window.renderRentDues = renderRentDues;

// ── Notice Board & SMS Broadcasts ──
window.saveNoticeBoard = async function () {
  const textarea = document.getElementById('notice-board-text');
  if (!textarea) return;
  const content = textarea.value.trim();

  try {
    const { error } = await supabase
      .from('owners')
      .update({ notice_board: content })
      .eq('id', ownerData.id);

    if (error) throw error;

    ownerData.notice_board = content;
    await logOwnerActivity('Notice Board rules updated.');
    showToast('Notice Published!', 'Announcements published to tenant portals.', 'success');

    // 🔔 Notify all tenants of this owner
    if (content) {
      sendNotificationToAllTenants({
        ownerId: ownerData.id,
        title: 'New Notice from Owner',
        body: content.slice(0, 100) + (content.length > 100 ? '...' : ''),
        url: '/tenant-dashboard.html',
        type: 'info'
      }).catch(() => { });
    }
  } catch (err) {
    showToast('Error', 'Failed to publish notice: ' + err.message, 'error');
  }
};


window.sendBroadcastAnnouncement = async function () {
  const message = document.getElementById('broadcast-message-text').value.trim();
  const targetBld = document.getElementById('broadcast-building-target').value;
  const titleInput = document.getElementById('broadcast-title-text');
  const title = titleInput ? titleInput.value.trim() : '';
  const pushTitle = title ? title : 'Broadcast Announcement';

  if (!message) { showToast('Empty Message', 'Write a message first.', 'warning'); return; }

  const targets = targetBld === 'all'
    ? allTenants.filter(t => t.status === 'active' || t.status === 'vacating')
    : allTenants.filter(t => (t.status === 'active' || t.status === 'vacating') && t.building_id === targetBld);

  if (targets.length === 0) {
    showToast('No Tenants', 'No active tenants in target building', 'info');
    return;
  }

  showToast('Broadcasting...', `Sending broadcast alerts to ${targets.length} tenants`, 'info');

  // 1. Save announcement to broadcast_announcements table in Supabase
  try {
    const buildingObj = buildings.find(b => b.id === targetBld);
    const insertData = {
      owner_id: ownerData.id,
      building_id: targetBld === 'all' ? null : targetBld,
      building_name: targetBld === 'all' ? 'All Buildings' : (buildingObj?.name || '—'),
      message: message,
      title: title || 'Broadcast Announcement'
    };

    let { error } = await supabase.from('broadcast_announcements').insert(insertData);

    if (error) {
      // Gracefully handle database if "title" column does not exist on the live database yet
      if (error.message && (error.message.includes('column "title" of relation') || error.message.includes('column "title" does not exist'))) {
        console.warn('title column not found in broadcast_announcements, retrying without title column.');
        delete insertData.title;
        const retryResult = await supabase.from('broadcast_announcements').insert(insertData);
        if (retryResult.error) throw retryResult.error;
      } else {
        throw error;
      }
    }
  } catch (err) {
    console.error('Failed to save announcement in DB:', err);
  }

  // 2. Dispatch Push Notifications directly to each target tenant
  await Promise.allSettled(targets.map(t => {
    if (t.auth_user_id) {
      return sendPushNotification({
        toUserId: t.auth_user_id,
        title: pushTitle,
        body: message,
        url: '/tenant-dashboard.html',
        type: 'warning',
        tag: 'broadcast_' + Date.now()
      });
    }
    return Promise.resolve();
  }));

  await logOwnerActivity(`Dispatched Broadcast Alert: "${message.substring(0, 30)}..." to ${targets.length} tenants`);

  if (titleInput) titleInput.value = '';
  document.getElementById('broadcast-message-text').value = '';

  showToast('Broadcast Dispatched!', `Notifications sent to ${targets.length} tenants successfully!`, 'success');

  // Refresh broadcast history list
  renderBroadcastHistory();
};

function populateBroadcastTargets() {
  const select = document.getElementById('broadcast-building-target');
  if (!select) return;
  select.innerHTML = '<option value="all">All Buildings</option>';
  buildings.forEach(b => {
    select.innerHTML += `<option value="${b.id}">${b.name}</option>`;
  });
}

async function renderBroadcastHistory() {
  const container = document.getElementById('broadcast-history-list');
  if (!container) return;

  try {
    const { data, error } = await supabase
      .from('broadcast_announcements')
      .select('*')
      .eq('owner_id', ownerData.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<p class="text-muted" style="font-size:13px">No broadcasts sent yet.</p>';
      return;
    }

    container.innerHTML = data.map(b => {
      const bTitle = b.title || 'Broadcast Announcement';
      const buildingName = b.building_name || 'All Buildings';

      const d = new Date(b.created_at);
      let formattedTime = '—';
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        let hours = d.getHours();
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        const hoursStr = String(hours).padStart(2, '0');
        formattedTime = `${day}/${month}/${year} ${hoursStr}:${minutes} ${ampm}`;
      }

      return `
        <div class="broadcast-item" style="padding: 14px 18px; border: 1px solid var(--border-color); background: var(--bg-card); border-radius: var(--radius); margin-bottom: 12px; position: relative;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="badge ${b.building_id ? 'badge-info' : 'badge-primary'}" style="font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px;">
                ${ICONS.building()} ${buildingName}
              </span>
              <span style="font-size: 11px; color: var(--text-muted); font-family: monospace; display: inline-flex; align-items: center; gap: 4px;">
                ${ICONS.calendar()} ${formattedTime}
              </span>
            </div>
            <button class="btn btn-ghost btn-sm text-danger" onclick="deleteBroadcast('${b.id}')" style="color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.05); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 11px; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: all 0.2s;" onmouseover="this.style.background='rgba(239, 68, 68, 0.15)'" onmouseout="this.style.background='rgba(239, 68, 68, 0.05)'" title="Delete Announcement">
              ${ICONS.trash()} Delete
            </button>
          </div>
          <h4 style="font-size: 13px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">
            ${bTitle}
          </h4>
          <p style="font-size: 12px; color: var(--text-secondary); line-height: 1.4; margin: 0; white-space: pre-wrap;">
            ${b.message}
          </p>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Failed to load broadcasts:', err);
    container.innerHTML = `<p class="text-danger" style="font-size:13px">Failed to load broadcasts: ${err.message}</p>`;
  }
}

window.deleteBroadcast = async function (id) {
  if (!confirm('Are you sure you want to delete this broadcast announcement? (क्या आप वाकई इस घोषणा को हटाना चाहते हैं?)')) return;

  try {
    const { error } = await supabase
      .from('broadcast_announcements')
      .delete()
      .eq('id', id);

    if (error) throw error;

    showToast('Deleted!', 'Broadcast announcement removed successfully.', 'success');
    await logOwnerActivity('Deleted Broadcast Announcement');
    renderBroadcastHistory();
  } catch (err) {
    console.error('Failed to delete broadcast:', err);
    showToast('Error', 'Failed to delete broadcast: ' + err.message, 'error');
  }
};

// ── History Activity Logs ──
async function logOwnerActivity(activityText) {
  try {
    await supabase.from('owner_activity_logs').insert({
      owner_id: ownerData.id,
      activity_text: activityText
    });
  } catch (err) {
    console.error('Failed to write owner activity log:', err);
  }
}

async function renderHistoryTab() {
  const tbody = document.getElementById('history-logs-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('owner_activity_logs')
      .select('*')
      .eq('owner_id', ownerData.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted" style="padding: 24px;">No activities recorded yet</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(log => `
      <tr>
        <td style="font-family: monospace; font-size: var(--font-xs); width: 180px; color: var(--text-muted);">${formatDate(log.created_at)} ${new Date(log.created_at).toLocaleTimeString()}</td>
        <td>${log.activity_text}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="2" class="text-center text-muted">Failed to load logs: ${err.message}</td></tr>`;
  }
}

window.clearActivityLogs = async function () {
  if (!confirm('Are you sure you want to clear your log history?')) return;
  try {
    const { error } = await supabase.from('owner_activity_logs').delete().eq('owner_id', ownerData.id);
    if (error) throw error;
    showToast('Logs Cleared', 'Activity logs wiped successfully', 'success');
    renderHistoryTab();
  } catch (err) {
    showToast('Error', 'Failed to clear logs: ' + err.message, 'error');
  }
};

// ── Auto-Pay Toggle ──
window.toggleAutoPay = function () {
  const checked = document.getElementById('sett-autopay').checked;
  localStorage.setItem('pgb_autopay_enabled', checked ? 'true' : 'false');
  showToast(checked ? 'Auto-Pay Enabled' : 'Auto-Pay Disabled', 'Your plan renewal settings saved.', 'success');
};

// ── Customer Support Desk ──
window.submitSupportTicket = async function (e) {
  e.preventDefault();
  const subject = document.getElementById('ticket-subject').value.trim();
  const cat = document.getElementById('ticket-category').value;
  const prio = document.getElementById('ticket-priority').value;
  const desc = document.getElementById('ticket-desc').value.trim();

  const btn = document.querySelector('#support-ticket-form button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const { error } = await supabase.from('support_tickets').insert({
      user_id: ownerData.id,
      user_name: ownerData.name,
      category: cat,
      priority: prio,
      subject: subject,
      description: desc,
      status: 'open'
    });

    if (error) throw error;

    await logOwnerActivity(`Created Support Ticket: "${subject}" (${cat})`);
    showToast('Ticket Submitted!', 'Our platform support team will respond shortly.', 'success');

    document.getElementById('ticket-subject').value = '';
    document.getElementById('ticket-desc').value = '';

    renderSupportTicketsList();
  } catch (err) {
    showToast('Error', 'Failed to submit ticket: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Support Request';
  }
};

async function renderSupportTicketsList() {
  const tbody = document.getElementById('ticket-history-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('support_tickets')
      .select('*')
      .eq('user_id', ownerData.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding: 24px;">No tickets submitted yet</td></tr>';
      return;
    }

    tbody.innerHTML = data.map(t => {
      let badgeClass = 'badge-primary';
      if (t.status === 'resolved') badgeClass = 'badge-success';
      if (t.status === 'in_progress') badgeClass = 'badge-warning';
      if (t.status === 'closed') badgeClass = 'badge-success';

      let prioClass = 'badge-secondary';
      if (t.priority === 'urgent') prioClass = 'badge-danger';
      if (t.priority === 'high') prioClass = 'badge-warning';

      return `<tr>
        <td><strong>${t.subject}</strong></td>
        <td>${t.category}</td>
        <td><span class="badge ${prioClass}">${t.priority.toUpperCase()}</span></td>
        <td><span class="badge ${badgeClass}">${t.status.toUpperCase()}</span></td>
      </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Error fetching tickets: ${err.message}</td></tr>`;
  }
}

// ── Init on DOM Ready ──
document.addEventListener('DOMContentLoaded', () => {
  init().then(() => {
    // Populate auto-pay state
    const autopayEnabled = localStorage.getItem('pgb_autopay_enabled') === 'true';
    const apToggle = document.getElementById('sett-autopay');
    if (apToggle) apToggle.checked = autopayEnabled;
  });
});

// ── Access Gate Overlays Helpers ──
window.selectGatePlan = function (planName, price, element) {
  // Update selected class on labels
  document.querySelectorAll('.gate-plan-option').forEach(el => el.classList.remove('selected'));
  if (element) {
    element.classList.add('selected');
    const radio = element.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  }

  // Update payment amount text
  const amountEl = document.getElementById('gate-pay-amount');
  if (amountEl) amountEl.textContent = price;

  // Update QR Code image source with new amount
  const qrImg = document.querySelector('.gate-qr-img');
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=upi://pay?pa=admin@pgbuilderss.online%26pn=PG%20Builders%26am=${price}%26cu=INR`;
  }
};

window.handleGateRenewSubscription = async function () {
  const txnId = document.getElementById('gate-utr').value.trim();

  if (!txnId) {
    showToast('UTR Required', 'Please enter the UPI Transaction ID / UTR Number', 'warning');
    return;
  }

  if (txnId.length !== 12 || !/^\d+$/.test(txnId)) {
    showToast('Invalid UTR', 'UPI Transaction ID must be exactly 12 digits', 'warning');
    return;
  }

  const btn = document.getElementById('btn-gate-renew');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Verifying Transaction...';

  try {
    // Simulate verification latency
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get current logged-in user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not found. Please log in again.');

    const selectedPlan = document.querySelector('input[name="gate-plan"]:checked').value;
    const expiryDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Update subscription details in Supabase
    const { error } = await supabase
      .from('owners')
      .update({
        subscription_status: 'active',
        subscription_expiry: expiryDate.toISOString(),
        plan_type: selectedPlan,
        status: 'Active'
      })
      .eq('id', user.id);

    if (error) throw error;

    showToast('Activation Successful!', 'Subscription plan activated successfully.', 'success');

    // Reset UI state and reload data
    document.getElementById('gate-expired').classList.add('hidden');
    document.getElementById('sidebar')?.classList.remove('hidden');
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.style.display = '';
    const sidebarToggle = document.getElementById('sidebar-toggle');
    if (sidebarToggle) sidebarToggle.style.display = '';

    // Reload full dashboard
    await loadRealData();
    renderDashboard();
    renderBuildingsList();
    renderBuildingSelect();
  } catch (err) {
    showToast('Verification Failed', 'Failed to activate plan: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
};

async function executeVacateTenant(tenantId, roomId, buildingId, roomNumber) {
  try {
    // 1. Update vacate notices
    await supabase
      .from('vacate_notices')
      .update({ status: 'processed', deposit_refunded: false })
      .eq('tenant_id', tenantId)
      .eq('status', 'submitted');

    // 2. Update tenant status to vacated and unlink them
    await supabase
      .from('tenants')
      .update({
        status: 'vacated',
        vacate_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', tenantId);

    // Delete members when vacating
    await supabase.from('members').delete().eq('tenant_id', tenantId);

    // 3. Update room occupancy
    if (roomId) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
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
          .eq('id', roomId);
      }
    } else if (roomNumber && buildingId) {
      const { data: roomsList } = await supabase
        .from('rooms')
        .select('*')
        .eq('building_id', buildingId)
        .eq('room_number', roomNumber);

      if (roomsList && roomsList.length > 0) {
        const roomData = roomsList[0];
        const nextBedsOccupied = Math.max(0, roomData.beds_occupied - 1);
        const nextStatus = nextBedsOccupied === 0 ? 'vacant' : (nextBedsOccupied < roomData.beds_count ? 'partial' : 'occupied');

        await supabase
          .from('rooms')
          .update({
            beds_occupied: nextBedsOccupied,
            status: nextStatus
          })
          .eq('id', roomData.id);
      }
    }
    console.log(`Auto-vacated tenant ${tenantId}`);
  } catch (err) {
    console.error(`Error in executeVacateTenant:`, err);
  }
}

async function checkAndProcessAutoVacates(ownerId) {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const { data: vacatingTenants, error } = await supabase
      .from('tenants')
      .select('id, room_id, building_id, room_number, vacate_date')
      .eq('owner_id', ownerId)
      .eq('status', 'vacating')
      .lte('vacate_date', todayStr);

    if (error) throw error;

    if (vacatingTenants && vacatingTenants.length > 0) {
      console.log(`Found ${vacatingTenants.length} tenants with expired vacate dates. Processing auto-vacate...`);
      for (const t of vacatingTenants) {
        await executeVacateTenant(t.id, t.room_id, t.building_id, t.room_number);
      }
    }
  } catch (err) {
    console.error('Failed to process auto vacates:', err);
  }
}

window.approveVacate = async function (noticeId, tenantId) {
  if (!confirm('Are you sure you want to approve this vacate request? (क्या आप वाकई इस कमरा खाली करने के अनुरोध को स्वीकार करना चाहते हैं?)')) return;

  const notice = allVacateNotices.find(n => n.id === noticeId);
  if (!notice) return;

  // Get the tenant object to get their room_id before vacating
  const tenantObj = allTenants.find(t => t.id === tenantId);

  try {
    // 1. Update vacate notice status
    const { error: noticeErr } = await supabase
      .from('vacate_notices')
      .update({ status: 'processed', deposit_refunded: false })
      .eq('id', noticeId);

    if (noticeErr) throw noticeErr;

    // 2. Update tenant status to vacated and unlink them
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        status: 'vacated',
        vacate_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', tenantId);

    if (tenantErr) throw tenantErr;

    // Delete members when vacating
    await supabase.from('members').delete().eq('tenant_id', tenantId);

    // 3. Update room occupancy using tenant's room_id (most reliable)
    const roomId = tenantObj?.room_id;
    if (roomId) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
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
          .eq('id', roomId);
      }
    } else if (notice.building_id && notice.room_number && notice.room_number !== '—') {
      // Fallback: look up by building_id + room_number
      const { data: roomsList } = await supabase
        .from('rooms')
        .select('*')
        .eq('building_id', notice.building_id)
        .eq('room_number', notice.room_number);

      if (roomsList && roomsList.length > 0) {
        const roomData = roomsList[0];
        const nextBedsOccupied = Math.max(0, roomData.beds_occupied - 1);
        const nextStatus = nextBedsOccupied === 0 ? 'vacant' : (nextBedsOccupied < roomData.beds_count ? 'partial' : 'occupied');

        await supabase
          .from('rooms')
          .update({
            beds_occupied: nextBedsOccupied,
            status: nextStatus
          })
          .eq('id', roomData.id);
      }
    }

    await logOwnerActivity(`Approved vacate request for ${tenantObj ? tenantObj.name : 'Unknown'} from Room ${tenantObj ? tenantObj.room_number : '—'} in building "${tenantObj ? tenantObj.building_name : '—'}"`);
    showToast('Vacate Approved!', 'Tenant account deactivated and room vacancy updated.', 'success');
    await loadRealData();
    refreshActiveViews();
    if (activeGridBuildingId) showBuildingRooms(activeGridBuildingId);
  } catch (err) {
    console.error('Error approving vacate:', err);
    showToast('Error', 'Failed to approve vacate: ' + err.message, 'error');
  }
};

async function syncRoomOccupancies(ownerId, buildingsList, tenantsList) {
  try {
    // Include pending tenants so their bed-slots are not reset to vacant while awaiting owner approval
    const activeTenants = tenantsList.filter(t => t.status === 'active' || t.status === 'vacating' || t.status === 'pending');

    for (const b of buildingsList) {
      if (!b.floors) continue;
      for (const f of b.floors) {
        if (!f.rooms) continue;
        for (const r of f.rooms) {
          const actualCount = activeTenants.filter(t => t.room_id === r.id).length;
          if (r.beds_occupied !== actualCount) {
            console.log(`Self-healing: Room ${r.room_number} count out of sync (${r.beds_occupied} vs actual ${actualCount}). Updating...`);
            const nextStatus = actualCount === 0 ? 'vacant' : (actualCount < r.beds_count ? 'partial' : 'occupied');

            // Update local memory
            r.beds_occupied = actualCount;
            r.status = nextStatus;

            // Update Supabase
            await supabase
              .from('rooms')
              .update({
                beds_occupied: actualCount,
                status: nextStatus
              })
              .eq('id', r.id);
          }
        }
      }
    }
  } catch (err) {
    console.error('Failed to sync room occupancies:', err);
  }
}

// ─── Rent Approvals Rendering and Operations ───
window.renderRentApprovals = function () {
  const pending = allPayments.filter(p => p.status === 'pending');
  const container = document.getElementById('rent-approvals-container');
  const badge = document.getElementById('rent-pending-count');

  if (badge) {
    badge.textContent = `${pending.length} pending`;
  }

  if (!container) return;

  if (pending.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 16px 24px;">
        <div class="empty-state-icon" style="margin-bottom: 4px; opacity: 0.7;">${ICONS.mail('', '', '24px')}</div>
        <div style="font-size: var(--font-xs); font-weight: 600; color: var(--text-secondary);">No pending rent approvals (कोई पेंडिंग रेंट भुगतान नहीं है)</div>
      </div>`;
    return;
  }

  // Auto-expand accordion when there are pending rent approvals
  const card = document.getElementById('dashboard-rent-approvals-card');
  if (card) {
    const wrapper = card.querySelector('.accordion-wrapper');
    const chevron = card.querySelector('.accordion-chevron');
    if (wrapper && !wrapper.classList.contains('expanded')) {
      wrapper.classList.add('expanded');
      if (chevron) chevron.classList.add('rotate-chevron');
    }
  }

  // Slice to 4 for the main dashboard list
  const slicedPending = pending.slice(0, 4);

  container.innerHTML = slicedPending.map(p => {
    const hasElectricity = (p.electricity_amount || 0) > 0;
    const hasAdvance = (p.advance_amount || 0) > 0;
    const payDate = formatDate(p.payment_date || p.created_at);
    return `
    <div class="approval-card" id="rent-approval-${p.id}" style="padding:0; border:none; margin-bottom:10px; border-radius:10px; overflow:hidden;">
      <!-- Header -->
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 16px; background:var(--bg-elevated); border-bottom:1px solid var(--border-light);">
        <div style="display:flex; align-items:center; gap:10px;">
          <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;color:#fff;flex-shrink:0;">${(p.tenant_name || '?')[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:700; color:var(--text-primary); font-size:var(--font-sm); line-height:1.2;">${p.tenant_name}</div>
            <div style="font-size:var(--font-xs); color:var(--text-secondary); margin-top:2px; display:flex; align-items:center; gap:4px;">${ICONS.building()} ${p.building_name || '—'} &nbsp;·&nbsp; ${ICONS.home()} Room <strong>${p.room_number || '—'}</strong></div>
          </div>
        </div>
        <span style="background:rgba(245,158,11,0.15);color:#f59e0b;border:1px solid rgba(245,158,11,0.3);border-radius:20px;padding:2px 10px;font-size:10px;font-weight:700;letter-spacing:.5px;">PENDING</span>
      </div>
      <!-- Detail Rows -->
      <div style="padding:4px 0;">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 16px;border-bottom:1px solid var(--border-light);">
          <span style="font-size:var(--font-xs);color:var(--text-secondary);display:flex;align-items:center;gap:6px;">${ICONS.home()} <span>Rent</span></span>
          <strong style="font-size:var(--font-sm);color:var(--text-primary);">${formatCurrency(p.rent_amount || 0)}</strong>
        </div>
        ${hasElectricity ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 16px;border-bottom:1px solid var(--border-light);background:rgba(251,191,36,0.05);">
          <span style="font-size:var(--font-xs);color:#d97706;display:flex;align-items:center;gap:6px;">${ICONS.electricity()} <span>Electricity <span style="opacity:.7;font-weight:400;">(${p.units_consumed || 0} units · Prev:${p.prev_reading || 0} → Curr:${p.curr_reading || 0})</span></span></span>
          <strong style="font-size:var(--font-sm);color:#d97706;">${formatCurrency(p.electricity_amount)}</strong>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 16px;border-bottom:1px solid var(--border-light);">
          <span style="font-size:var(--font-xs);color:var(--text-secondary);display:flex;align-items:center;gap:6px;">${ICONS.settings()} <span>Maintenance</span></span>
          <strong style="font-size:var(--font-sm);color:var(--text-primary);">${formatCurrency(p.maintenance_amount || 0)}</strong>
        </div>
        ${hasAdvance ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 16px;border-bottom:1px solid var(--border-light);">
          <span style="font-size:var(--font-xs);color:#8b5cf6;display:flex;align-items:center;gap:6px;">${ICONS.gem()} <span>First-Time Advance (Security)</span></span>
          <strong style="font-size:var(--font-sm);color:#8b5cf6;">${formatCurrency(p.advance_amount)}</strong>
        </div>` : ''}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 16px;border-bottom:1px solid var(--border-light);">
          <span style="font-size:var(--font-xs);color:var(--text-secondary);display:flex;align-items:center;gap:6px;">${ICONS.calendar()} <span>Payment Date</span></span>
          <span style="font-size:var(--font-xs);color:var(--text-primary);font-weight:600;">${payDate}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;padding:7px 16px;">
          <span style="font-size:var(--font-xs);color:var(--text-secondary);display:flex;align-items:center;gap:6px;">${ICONS.card()} <span>Method &nbsp;·&nbsp; ${ICONS.calendar()} ${formatMonthYear(p.month_year + '-01')}</span></span>
          <span style="font-size:var(--font-xs);color:var(--text-primary);font-weight:600;">${p.payment_method || 'UPI'}</span>
        </div>
      </div>
      <!-- Footer -->
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--bg-secondary);border-top:2px solid var(--border-light);">
        <div style="font-size:var(--font-xs);color:var(--text-secondary);">Total &nbsp;<strong style="color:var(--text-primary);font-size:var(--font-md);">${formatCurrency(p.total_amount || 0)}</strong></div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-success btn-sm" onclick="approvePayment('${p.id}')" style="padding:6px 14px; display: inline-flex; align-items: center; gap: 4px;">${ICONS.successCheck()} Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectPayment('${p.id}')" style="padding:6px 14px; display: inline-flex; align-items: center; gap: 4px;">${ICONS.error()} Reject</button>
        </div>
      </div>
    </div>`;
  }).join('');
};

window.renderPendingRentPaymentsList = function () {
  const tbody = document.getElementById('tenants-rent-table-body');
  const countEl = document.getElementById('tenants-rent-count');
  if (!tbody) return;

  const pendingPayments = currentBuildingFilter === 'all'
    ? allPayments.filter(p => p.status === 'pending')
    : allPayments.filter(p => p.status === 'pending' && p.building_id === currentBuildingFilter);

  if (countEl) countEl.textContent = `${pendingPayments.length} pending`;

  if (pendingPayments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center text-muted" style="padding: 24px;">No pending payment requests</td></tr>';
    return;
  }

  tbody.innerHTML = pendingPayments.map(p => {
    const tenant = allTenants.find(t => t.id === p.tenant_id);
    const rawFloor = getFloorNumberForRoom(p.room_id) || tenant?.floor_number;
    const floorLabel = getFloorLabel(rawFloor);

    // Build breakdown section
    const breakdownHTML = `
      <div style="font-size: var(--font-xs); line-height: 1.4; color: var(--text-secondary); display: flex; flex-direction: column; gap: 2px; white-space: nowrap; text-align: left;">
        <span>${ICONS.home()} Rent: ${formatCurrency(p.rent_amount || 0)}</span>
        ${p.electricity_amount > 0 ? `<span>${ICONS.electricity()} Elec: ${formatCurrency(p.electricity_amount)}</span>` : ''}
        ${p.maintenance_amount > 0 ? `<span>${ICONS.settings()} Maint: ${formatCurrency(p.maintenance_amount)}</span>` : ''}
        ${p.advance_amount > 0 ? `<span>${ICONS.bank()} Adv: ${formatCurrency(p.advance_amount)}</span>` : ''}
      </div>
    `;

    return `
      <tr>
        <td><strong>${p.tenant_name}</strong></td>
        <td>${p.building_name || '—'}</td>
        <td>${floorLabel}</td>
        <td>Room ${p.room_number || '—'}</td>
        <td>${formatDate(p.created_at || p.payment_date)}</td>
        <td><strong>${formatCurrency(p.total_amount)}</strong></td>
        <td>${breakdownHTML}</td>
        <td>${p.payment_method || 'UPI'}</td>
        <td><code style="font-size: var(--font-xs);">${p.transaction_id || '—'}</code></td>
        <td style="text-align: right; white-space: nowrap;">
          <button class="btn btn-success btn-sm" onclick="approvePayment('${p.id}')">${ICONS.successCheck()} Approve</button>
          <button class="btn btn-danger btn-sm" onclick="rejectPayment('${p.id}')" style="margin-left: 4px;">${ICONS.error()} Reject</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.rejectPayment = async function (paymentId) {
  const payment = allPayments.find(p => p.id === paymentId);
  if (!payment) return;

  if (!confirm(`Are you sure you want to reject this payment request of ${formatCurrency(payment.total_amount)} from ${payment.tenant_name}?`)) {
    return;
  }

  try {
    const { error } = await supabase
      .from('payments')
      .update({ status: 'rejected' })
      .eq('id', paymentId);

    if (error) throw error;

    // Push notification to tenant
    if (payment.tenant_id) {
      const tenant = allTenants.find(t => t.id === payment.tenant_id);
      if (tenant?.auth_user_id) {
        sendPushNotification({
          toUserId: tenant.auth_user_id,
          title: 'Payment Rejected',
          body: `Your rent payment of ${formatCurrency(payment.total_amount)} for ${payment.month_year} has been rejected by your owner.`,
          url: '/tenant-dashboard.html',
          type: 'error',
          tag: 'payment-rejected'
        }).catch(() => { });
      }
    }

    await loadRealData();
    refreshActiveViews();

    await logOwnerActivity(`Rejected payment of ${formatCurrency(payment.total_amount)} for ${payment.month_year} from Room ${payment.room_number} (${payment.tenant_name})`);
    showToast('Payment Rejected', `${formatCurrency(payment.total_amount)} from Room ${payment.room_number}`, 'warning');
  } catch (err) {
    console.error('Error rejecting payment:', err);
    showToast('Error', 'Failed to reject payment: ' + err.message, 'error');
  }
};

window.deleteTenantPermanently = async function (tenantId) {
  const t = allTenants.find(x => x.id === tenantId);
  if (!t) return;

  if (!confirm(`Are you sure you want to PERMANENTLY delete tenant ${t.name}? This will erase their profile and history. This action cannot be undone.`)) {
    return;
  }

  try {
    const { error } = await supabase
      .from('tenants')
      .delete()
      .eq('id', tenantId);

    if (error) throw error;

    await logOwnerActivity(`Permanently deleted tenant record for ${t.name}`);
    showToast('Tenant Deleted', `${t.name}'s record has been permanently deleted.`, 'success');

    await loadRealData();
    refreshActiveViews();
  } catch (err) {
    console.error('Error permanently deleting tenant:', err);
    showToast('Error', 'Failed to delete tenant: ' + err.message, 'error');
  }
};

// ─── Security Deposits Sub-Tab Calculations and Rendering ───
window.renderRentDeposits = function () {
  // Active deposits: Sum of advance_paid for all active/vacating tenants
  const activeTenants = allTenants.filter(t => t.status === 'active' || t.status === 'vacating');
  const totalActiveDeposit = activeTenants.reduce((sum, t) => sum + (parseFloat(t.advance_paid) || 0), 0);

  // Refunded deposits from vacate_notices (processed and refunded)
  const refundedNotices = allVacateNotices.filter(n => n.deposit_refunded === true && n.status !== 'refund_declined');
  const totalRefundedDeposit = refundedNotices.reduce((sum, n) => sum + (parseFloat(n.deposit_amount) || 0), 0);

  // Pending refunds: vacate_notices where status is processed/submitted and deposit_refunded is false
  const pendingRefunds = allVacateNotices.filter(n => n.deposit_refunded === false && (n.status === 'processed' || n.status === 'submitted'));
  const totalPendingRefund = pendingRefunds.reduce((sum, n) => sum + (parseFloat(n.deposit_amount) || 0), 0);

  // Update KPI Cards
  const activeVal = document.getElementById('dep-kpi-active');
  if (activeVal) activeVal.textContent = formatCurrency(totalActiveDeposit);
  const activeSub = document.getElementById('dep-kpi-active-sub');
  if (activeSub) activeSub.textContent = `${activeTenants.length} active occupant${activeTenants.length !== 1 ? 's' : ''}`;

  const refVal = document.getElementById('dep-kpi-refunded');
  if (refVal) refVal.textContent = formatCurrency(totalRefundedDeposit);
  const refSub = document.getElementById('dep-kpi-refunded-sub');
  if (refSub) refSub.textContent = `${refundedNotices.length} refund${refundedNotices.length !== 1 ? 's' : ''} processed`;

  const penVal = document.getElementById('dep-kpi-pending');
  if (penVal) penVal.textContent = formatCurrency(totalPendingRefund);
  const penSub = document.getElementById('dep-kpi-pending-sub');
  if (penSub) penSub.textContent = `${pendingRefunds.length} pending refund${pendingRefunds.length !== 1 ? 's' : ''}`;

  // Populate Pending Table
  const pendingTbody = document.getElementById('dep-pending-tbody');
  if (pendingTbody) {
    const filteredPending = currentBuildingFilter === 'all'
      ? pendingRefunds
      : pendingRefunds.filter(n => n.building_id === currentBuildingFilter);

    if (filteredPending.length === 0) {
      pendingTbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No pending refunds (कोई लंबित रिफंड नहीं है)</td></tr>';
    } else {
      pendingTbody.innerHTML = filteredPending.map(n => {
        const tenantName = n.tenant_name || 'Unknown';
        const roomBld = `Room ${n.room_number || '—'} (${n.building_name || '—'})`;
        const tenant = allTenants.find(t => t.id === n.tenant_id);

        let suggestionHtml = '';
        let showForfeit = false;
        if (tenant && tenant.bond_months && tenant.bond_months > 0) {
          const remaining = getBondRemainingMonths(tenant);
          if (remaining > 0) {
            suggestionHtml = `<span class="badge badge-danger" style="font-size:11px; font-weight:700; white-space:nowrap;">No Refund (Bond Active - ${remaining} Mo Left) / रिफंड न करें</span>`;
            showForfeit = true;
          } else {
            suggestionHtml = `<span class="badge badge-success" style="font-size:11px; font-weight:700; white-space:nowrap;">Refund Deposit (Bond Completed) / रिफंड करें</span>`;
          }
        } else {
          suggestionHtml = `<span class="badge badge-success" style="font-size:11px; font-weight:700; white-space:nowrap;">Refund Deposit (No Bond) / रिफंड करें</span>`;
        }

        const actionButtonsHtml = showForfeit
          ? `<button class="btn btn-danger btn-sm" onclick="forfeitDeposit('${n.id}', '${n.tenant_id}')" style="margin-right: 6px; display: inline-flex; align-items: center; gap: 4px;">✕ Reject Refund</button><button class="btn btn-success btn-sm" onclick="markDepositRefunded('${n.id}')">${ICONS.successCheck()} Mark Refunded</button>`
          : `<button class="btn btn-success btn-sm" onclick="markDepositRefunded('${n.id}')">${ICONS.successCheck()} Mark Refunded</button>`;

        return `<tr>
          <td><strong>${tenantName}</strong></td>
          <td>${roomBld}</td>
          <td>${n.preferred_date ? formatDate(n.preferred_date) : '—'}</td>
          <td><strong>${formatCurrency(n.deposit_amount || 0)}</strong></td>
          <td>${suggestionHtml}</td>
          <td style="text-align: right; white-space: nowrap;">
            ${actionButtonsHtml}
          </td>
        </tr>`;
      }).join('');
    }
  }

  // Populate History Table (refunded + declined)
  const historyTbody = document.getElementById('dep-history-tbody');
  if (historyTbody) {
    // Include both refunded and declined notices in history
    const declinedNotices = allVacateNotices.filter(n => n.status === 'refund_declined');
    const allHistoryNotices = [...refundedNotices, ...declinedNotices];

    const filteredHistory = currentBuildingFilter === 'all'
      ? allHistoryNotices
      : allHistoryNotices.filter(n => n.building_id === currentBuildingFilter);

    if (filteredHistory.length === 0) {
      historyTbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 24px;">No refund history yet (कोई रिफंड इतिहास नहीं है)</td></tr>';
    } else {
      historyTbody.innerHTML = filteredHistory.map(n => {
        const tenantName = n.tenant_name || 'Unknown';
        const roomBld = `Room ${n.room_number || '—'} (${n.building_name || '—'})`;
        const isDeclined = n.status === 'refund_declined';
        const statusBadge = isDeclined
          ? `<span class="badge badge-danger">REJECTED</span>`
          : `<span class="badge badge-success">REFUNDED</span>`;

        return `<tr>
          <td><strong>${tenantName}</strong></td>
          <td>${roomBld}</td>
          <td>${n.preferred_date ? formatDate(n.preferred_date) : '—'}</td>
          <td><strong>${formatCurrency(n.deposit_amount || 0)}</strong></td>
          <td>${statusBadge}</td>
        </tr>`;
      }).join('');
    }
  }
};

window.markDepositRefunded = async function (noticeId) {
  if (!confirm('Are you sure you want to mark this deposit as refunded? (क्या आप इस सिक्योरिटी डिपॉजिट राशि को वापस किया हुआ चिह्नित करना चाहते हैं?)')) return;

  try {
    const { error } = await supabase
      .from('vacate_notices')
      .update({ deposit_refunded: true })
      .eq('id', noticeId);

    if (error) throw error;

    showToast('Deposit Refunded!', 'Deposit status has been updated to refunded.', 'success');
    await loadRealData();
    renderRentDeposits();
  } catch (err) {
    console.error('Error marking deposit refunded:', err);
    showToast('Error', 'Failed to update deposit: ' + err.message, 'error');
  }
};

window.forfeitDeposit = async function (noticeId, tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  const tenantName = tenant ? tenant.name : 'this tenant';

  if (!confirm(`Reject refund for ${tenantName}? (क्या आप ${tenantName} का रिफंड Reject करना चाहते हैं? इससे उनका status REJECTED हो जाएगा और उन्हें खाली (vacate) चिह्नित किया जाएगा।)`)) return;

  try {
    // 1. Mark vacate notice as refund_declined
    const { error: noticeErr } = await supabase
      .from('vacate_notices')
      .update({ status: 'refund_declined' })
      .eq('id', noticeId);

    if (noticeErr) throw noticeErr;

    // 2. Mark tenant as vacated
    if (tenantId) {
      const { error: tenantErr } = await supabase
        .from('tenants')
        .update({
          status: 'vacated',
          vacate_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', tenantId);

      if (tenantErr) throw tenantErr;

      // Delete members when vacating
      await supabase.from('members').delete().eq('tenant_id', tenantId);

      // 3. Update room occupancy
      const roomId = tenant?.room_id;
      if (roomId) {
        const { data: roomData, error: roomGetErr } = await supabase
          .from('rooms')
          .select('*')
          .eq('id', roomId)
          .maybeSingle();

        if (!roomGetErr && roomData) {
          const nextBedsOccupied = Math.max(0, roomData.beds_occupied - 1);
          const nextStatus = nextBedsOccupied === 0 ? 'vacant' : (nextBedsOccupied < roomData.beds_count ? 'partial' : 'occupied');

          await supabase
            .from('rooms')
            .update({ beds_occupied: nextBedsOccupied, status: nextStatus })
            .eq('id', roomId);
        }
      }
    }

    showToast('Refund Rejected!', `Deposit refund for ${tenantName} has been REJECTED. Tenant marked as vacated.`, 'warning');
    await loadRealData();
    renderRentDeposits();
    refreshActiveViews();
  } catch (err) {
    console.error('Error rejecting deposit refund:', err);
    showToast('Error', 'Failed to reject refund: ' + err.message, 'error');
  }
};

// Decline refund for bond-active tenants — marks the vacate notice as 'refund_declined' and vacates the tenant
window.declineRefund = async function (noticeId, tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  const tenantName = tenant ? tenant.name : 'this tenant';

  if (!confirm(`Decline refund for ${tenantName}? (क्या आप ${tenantName} का रिफंड नामंजूर करना चाहते हैं? बॉन्ड अवधि सक्रिय होने से डिपॉजिट वापस नहीं किया जाएगा और उन्हें खाली (vacate) चिह्नित किया जाएगा।)`)) return;

  try {
    // 1. Update vacate notice status
    const { error: noticeErr } = await supabase
      .from('vacate_notices')
      .update({ status: 'refund_declined' })
      .eq('id', noticeId);

    if (noticeErr) throw noticeErr;

    // 2. Update tenant status to vacated and unlink them
    const { error: tenantErr } = await supabase
      .from('tenants')
      .update({
        status: 'vacated',
        vacate_date: new Date().toISOString().split('T')[0]
      })
      .eq('id', tenantId);

    if (tenantErr) throw tenantErr;

    // Delete members when vacating
    await supabase.from('members').delete().eq('tenant_id', tenantId);

    // 3. Update room occupancy using tenant's room_id
    const roomId = tenant?.room_id;
    if (roomId) {
      const { data: roomData, error: roomGetErr } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
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
          .eq('id', roomId);
      }
    } else {
      // Fallback: look up by building_id and room_number from vacate notice
      const notice = allVacateNotices.find(n => n.id === noticeId);
      if (notice && notice.building_id && notice.room_number && notice.room_number !== '—') {
        const { data: roomsList } = await supabase
          .from('rooms')
          .select('*')
          .eq('building_id', notice.building_id)
          .eq('room_number', notice.room_number);

        if (roomsList && roomsList.length > 0) {
          const roomData = roomsList[0];
          const nextBedsOccupied = Math.max(0, roomData.beds_occupied - 1);
          const nextStatus = nextBedsOccupied === 0 ? 'vacant' : (nextBedsOccupied < roomData.beds_count ? 'partial' : 'occupied');

          await supabase
            .from('rooms')
            .update({
              beds_occupied: nextBedsOccupied,
              status: nextStatus
            })
            .eq('id', roomData.id);
        }
      }
    }

    showToast('Refund Declined & Vacated', `Deposit refund for ${tenantName} has been declined and tenant marked as vacated.`, 'warning');
    await loadRealData();
    refreshActiveViews();
  } catch (err) {
    console.error('Error declining refund:', err);
    showToast('Error', 'Failed to decline refund: ' + err.message, 'error');
  }
};

// ═══════════════ STAFF & EXPENSES SUB-TAB SWITCHER ═══════════════
window.switchExpensesSubTab = function (subTab) {
  // Save subTab status
  localStorage.setItem('pgb_owner_active_expenses_subtab', subTab);

  // Toggle active class on tab buttons
  const btnExpenses = document.getElementById('subtab-btn-expenses');
  const btnStaff = document.getElementById('subtab-btn-staff');
  if (btnExpenses) btnExpenses.classList.toggle('active', subTab === 'expenses');
  if (btnStaff) btnStaff.classList.toggle('active', subTab === 'staff');

  // Toggle visibility of content divs
  const contentExpenses = document.getElementById('subtab-expenses-content');
  const contentStaff = document.getElementById('subtab-staff-content');
  if (contentExpenses) contentExpenses.classList.toggle('hidden', subTab !== 'expenses');
  if (contentStaff) contentStaff.classList.toggle('hidden', subTab !== 'staff');
};

// ═══════════════ STAFF MANAGEMENT ═══════════════
window.renderStaffTab = function () {
  const staffTbody = document.getElementById('staff-tbody');
  const kpiTotalStaff = document.getElementById('kpi-total-staff');
  const kpiStaffSalary = document.getElementById('kpi-staff-salary');

  if (kpiTotalStaff) kpiTotalStaff.textContent = staffList.length;
  const totalSal = staffList.reduce((acc, curr) => acc + (parseFloat(curr.salary) || 0), 0);
  if (kpiStaffSalary) kpiStaffSalary.textContent = formatCurrency(totalSal);

  if (!staffTbody) return;

  if (staffList.length === 0) {
    staffTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No staff members added yet</td></tr>`;
    return;
  }

  staffTbody.innerHTML = staffList.map(s => {
    const statusClass = s.payment_status === 'Paid' ? 'badge-success' : 'badge-danger';
    const statusText = s.payment_status || 'Unpaid';
    return `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.phone}</td>
        <td><strong>${formatCurrency(s.salary)}</strong></td>
        <td>Day ${s.pay_day || 5} of month</td>
        <td>
          <button class="badge ${statusClass}" onclick="toggleStaffPaymentStatus('${s.id}', '${statusText}')" style="cursor: pointer; border: none; font-family: inherit; font-size: inherit;">
            ${statusText.toUpperCase()}
          </button>
        </td>
        <td style="text-align: right;">
          <button class="btn btn-danger btn-sm" onclick="deleteStaff('${s.id}')" title="Delete Staff" style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.trash()} Delete</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.saveNewStaff = async function () {
  const name = document.getElementById('staff-name').value.trim();
  const phone = document.getElementById('staff-phone').value.trim();
  const salaryVal = document.getElementById('staff-salary').value.trim();
  const paydayVal = document.getElementById('staff-payday').value.trim();

  const nameErr = validateName(name);
  if (nameErr) { showToast('Invalid Name', nameErr, 'warning'); return; }

  const phoneErr = validatePhone(phone);
  if (phoneErr) { showToast('Invalid Phone', phoneErr, 'warning'); return; }

  const salary = parseFloat(salaryVal);
  if (isNaN(salary) || salary < 0) {
    showToast('Invalid Salary', 'Please enter a valid salary amount', 'warning');
    return;
  }

  const payday = parseInt(paydayVal);
  if (isNaN(payday) || payday < 1 || payday > 31) {
    showToast('Invalid Pay Day', 'Pay day must be between 1 and 31', 'warning');
    return;
  }

  const btn = document.getElementById('btn-save-staff');
  let originalHTML = '';
  if (btn) {
    originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const { error } = await supabase
      .from('staff')
      .insert({
        owner_id: ownerData.id,
        name,
        phone,
        salary,
        pay_day: payday,
        payment_status: 'Unpaid'
      });

    if (error) throw error;

    await logOwnerActivity(`Added staff member "${name}" (Salary: ${formatCurrency(salary)})`);
    showToast('Success', 'Staff member added successfully!', 'success');
    closeModal('modal-add-staff');

    // Clear form
    document.getElementById('staff-name').value = '';
    document.getElementById('staff-phone').value = '';
    document.getElementById('staff-salary').value = '';
    document.getElementById('staff-payday').value = '5';

    await loadRealData();
    renderStaffTab();
    renderExpensesTab();
    renderKPIs();
  } catch (err) {
    console.error('Failed to add staff:', err);
    showToast('Error', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  }
};

window.toggleStaffPaymentStatus = async function (id, currentStatus) {
  const nextStatus = currentStatus === 'Paid' ? 'Unpaid' : 'Paid';
  const staffMember = staffList.find(s => s.id === id);
  try {
    const { error } = await supabase
      .from('staff')
      .update({ payment_status: nextStatus })
      .eq('id', id);

    if (error) throw error;

    await logOwnerActivity(`Marked salary of staff "${staffMember?.name || 'Unknown'}" as ${nextStatus} (${formatCurrency(staffMember?.salary || 0)})`);
    showToast('Status Updated', `Staff status changed to ${nextStatus}`, 'success');
    await loadRealData();
    renderStaffTab();
    renderExpensesTab();
    renderKPIs();
  } catch (err) {
    console.error('Failed to toggle staff status:', err);
    showToast('Error', err.message, 'error');
  }
};

window.deleteStaff = async function (id) {
  if (!confirm('Are you sure you want to remove this staff member?')) return;
  const staffMember = staffList.find(s => s.id === id);

  try {
    const { error } = await supabase
      .from('staff')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await logOwnerActivity(`Removed staff member "${staffMember?.name || 'Unknown'}"`);
    showToast('Deleted', 'Staff member removed successfully', 'success');
    await loadRealData();
    renderStaffTab();
    renderExpensesTab();
    renderKPIs();
  } catch (err) {
    console.error('Failed to delete staff:', err);
    showToast('Error', err.message, 'error');
  }
};

// ═══════════════ EXPENSE MANAGEMENT ═══════════════
window.renderExpensesTab = function () {
  const expTbody = document.getElementById('expenses-tbody');
  const kpiTotalExpenses = document.getElementById('kpi-total-expenses');
  const kpiTotalOtherExpenses = document.getElementById('kpi-total-other-expenses');
  const kpiExpenseBreakdown = document.getElementById('kpi-expense-breakdown');

  const filtered = expensesList.filter(e => {
    const matchesBuilding = currentBuildingFilter === 'all' || e.building_id === currentBuildingFilter;
    const matchesMonth = currentSelectedMonth === 'all' || (e.date && e.date.startsWith(currentSelectedMonth));
    return matchesBuilding && matchesMonth;
  });

  const totalOtherExp = filtered.reduce((acc, curr) => acc + (parseFloat(curr.amount) || 0), 0);
  if (kpiTotalOtherExpenses) kpiTotalOtherExpenses.textContent = formatCurrency(totalOtherExp);

  // General staff salaries are only added when building filter is 'all' and selected month is the current month or all months
  const isCurrentMonthOrAll = currentSelectedMonth === getCurrentMonthYear() || currentSelectedMonth === 'all';
  const paidStaffSal = (currentBuildingFilter === 'all' && isCurrentMonthOrAll)
    ? staffList.filter(s => s.payment_status === 'Paid').reduce((acc, curr) => acc + (parseFloat(curr.salary) || 0), 0)
    : 0;

  const totalOutflow = totalOtherExp + paidStaffSal;
  if (kpiTotalExpenses) kpiTotalExpenses.textContent = formatCurrency(totalOutflow);

  // Also keep staff counts on this tab in sync
  const kpiTotalStaff = document.getElementById('kpi-total-staff');
  const kpiStaffSalary = document.getElementById('kpi-staff-salary');
  if (kpiTotalStaff) kpiTotalStaff.textContent = staffList.length;
  const totalSal = staffList.reduce((acc, curr) => acc + (parseFloat(curr.salary) || 0), 0);
  if (kpiStaffSalary) kpiStaffSalary.textContent = formatCurrency(totalSal);

  // Category breakdown
  const categoryTotals = {};
  filtered.forEach(e => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + (parseFloat(e.amount) || 0);
  });
  if (paidStaffSal > 0) {
    categoryTotals['Staff Salary'] = (categoryTotals['Staff Salary'] || 0) + paidStaffSal;
  }

  if (kpiExpenseBreakdown) {
    if (filtered.length === 0 && paidStaffSal === 0) {
      kpiExpenseBreakdown.innerHTML = 'No expenses recorded in this context';
    } else {
      const breakdownStr = Object.entries(categoryTotals)
        .map(([cat, amt]) => `<strong>${cat}</strong>: ${formatCurrency(amt)}`)
        .join(' • ');
      kpiExpenseBreakdown.innerHTML = breakdownStr;
    }
  }

  if (!expTbody) return;

  if (filtered.length === 0) {
    expTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No expense records found</td></tr>`;
    return;
  }

  expTbody.innerHTML = filtered.map(e => {
    return `
      <tr>
        <td>${formatDate(e.date)}</td>
        <td><strong>${e.item_name}</strong></td>
        <td><span class="badge badge-secondary" style="background-color: var(--bg-card); border: 1px solid var(--border-color);">${e.category}</span></td>
        <td>${e.building_name || 'General (All Properties)'}</td>
        <td class="text-danger"><strong>${formatCurrency(e.amount)}</strong></td>
        <td style="text-align: right;">
          <button class="btn btn-danger btn-sm" onclick="deleteExpense('${e.id}')" title="Delete Expense" style="display: inline-flex; align-items: center; gap: 4px;">${ICONS.trash()} Delete</button>
        </td>
      </tr>
    `;
  }).join('');
};

window.saveNewExpense = async function () {
  const itemName = document.getElementById('exp-name').value.trim();
  const amountVal = document.getElementById('exp-amount').value.trim();
  const date = document.getElementById('exp-date').value;
  const category = document.getElementById('exp-category').value;
  const buildingId = document.getElementById('exp-building-select').value || null;

  if (!itemName) {
    showToast('Validation Error', 'Please enter a description/item name', 'warning');
    return;
  }

  const amount = parseFloat(amountVal);
  if (isNaN(amount) || amount <= 0) {
    showToast('Validation Error', 'Please enter a valid expense amount (> 0)', 'warning');
    return;
  }

  if (!date) {
    showToast('Validation Error', 'Please select a date', 'warning');
    return;
  }

  const btn = document.getElementById('btn-save-expense');
  let originalHTML = '';
  if (btn) {
    originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Saving...';
  }

  try {
    const { error } = await supabase
      .from('expenses')
      .insert({
        owner_id: ownerData.id,
        building_id: buildingId,
        item_name: itemName,
        amount,
        date,
        category
      });

    if (error) throw error;

    await logOwnerActivity(`Recorded expense: "${itemName}" (${formatCurrency(amount)})`);
    showToast('Success', 'Expense recorded successfully!', 'success');
    closeModal('modal-add-expense');

    // Clear form
    document.getElementById('exp-name').value = '';
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('exp-category').selectedIndex = 0;
    document.getElementById('exp-building-select').selectedIndex = 0;

    await loadRealData();
    renderExpensesTab();
    renderStaffTab();
    renderKPIs();
  } catch (err) {
    console.error('Failed to save expense:', err);
    showToast('Error', err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  }
};

window.deleteExpense = async function (id) {
  if (!confirm('Are you sure you want to delete this expense record?')) return;
  const exp = expensesList.find(e => e.id === id);

  try {
    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    await logOwnerActivity(`Deleted expense: "${exp?.item_name || 'Unknown'}" (${formatCurrency(exp?.amount || 0)})`);
    showToast('Deleted', 'Expense record deleted successfully', 'success');
    await loadRealData();
    renderExpensesTab();
    renderStaffTab();
    renderKPIs();
  } catch (err) {
    console.error('Failed to delete expense:', err);
    showToast('Error', err.message, 'error');
  }
};

// ── Permanent Account Deletion ──
window.openDeleteAccountModal = function () {
  if (!ownerData) return;
  // Populate email label in the modal
  const emailLabel = document.getElementById('delete-confirm-email-label');
  if (emailLabel) emailLabel.textContent = ownerData.email || '';
  // Clear any previous input
  const emailInput = document.getElementById('delete-confirm-email-input');
  if (emailInput) emailInput.value = '';
  openModal('modal-delete-account');
};

window.executeDeleteOwnerAccount = async function () {
  if (!ownerData) return;

  const emailInput = document.getElementById('delete-confirm-email-input');
  const typedEmail = (emailInput?.value || '').trim().toLowerCase();
  const actualEmail = (ownerData.email || '').trim().toLowerCase();

  if (typedEmail !== actualEmail) {
    showToast('Email Mismatch', 'Please type your email exactly as shown to confirm deletion.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-execute-delete-account');
  if (btn) { btn.disabled = true; btn.textContent = 'Deleting...'; }

  try {
    // Fetch buildings and tenants for archiving before delete
    const { data: buildingsData } = await supabase
      .from('buildings')
      .select('*')
      .eq('owner_id', ownerData.id);

    const { data: tenantsData } = await supabase
      .from('tenants')
      .select('*')
      .eq('owner_id', ownerData.id);

    const { error: archiveErr } = await supabase
      .from('deleted_owners_archive')
      .insert({
        original_id: ownerData.id,
        name: ownerData.name,
        email: ownerData.email,
        phone: ownerData.phone,
        owner_key: ownerData.owner_key,
        aadhaar_number: ownerData.aadhaar_number || null,
        buildings: buildingsData || [],
        tenants: tenantsData || [],
        deleted_by: 'Owner'
      });

    if (archiveErr) throw new Error("Archive backup failed: " + archiveErr.message);

    // 1. Delete owner record (cascades to buildings, floors, rooms, tenants, payments, support tickets)
    const { error: ownerDeleteErr } = await supabase
      .from('owners')
      .delete()
      .eq('id', ownerData.id);

    if (ownerDeleteErr) throw ownerDeleteErr;

    // 2. Clear all local storage
    localStorage.removeItem('pgb_user_role');
    localStorage.removeItem('pgb_owner_key');
    localStorage.removeItem('pgb_owner_name');
    localStorage.removeItem('pgb_subscription_status');
    localStorage.removeItem('pgb_subscription_expiry');
    localStorage.removeItem('pgb_allowed_buildings');
    localStorage.removeItem('pgb_autopay_enabled');
    localStorage.removeItem('impersonate_owner_id');

    // 3. Sign out the user from Supabase auth
    await supabase.auth.signOut();

    showToast('Account Deleted', 'Your account and all data have been permanently removed. Goodbye!', 'success');

    // 4. Redirect to homepage after a short delay
    setTimeout(() => {
      window.location.href = '/';
    }, 2000);

  } catch (err) {
    console.error('Account deletion failed:', err);
    showToast('Deletion Failed', err.message || 'Unable to delete account. Please contact support.', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Yes, Delete My Account'; }
  }
};





// ═══════════════ COMPLAINTS (OWNER SIDE) ═══════════════

window.renderComplaintsTab = async function (skipFetch = false) {
  const tbody = document.getElementById('complaints-owner-tbody');
  if (!tbody) return;

  // ── Fresh data fetch from Supabase ──
  if (!skipFetch && ownerData) {
    try {
      const { data: freshComplaints, error: compErr } = await supabase
        .from('complaints')
        .select('*')
        .order('created_at', { ascending: false });

      if (compErr) {
        console.error('[Complaints] Fetch error:', compErr.message, compErr.hint);
      } else {
        allComplaints = (freshComplaints || []).map(c => {
          const tenant = allTenants.find(t => t.id === c.tenant_id);
          return {
            ...c,
            tenant_name: tenant ? tenant.name : (c.tenant_name || 'Unknown Tenant'),
            building_name: tenant ? tenant.building_name : '—',
            room_number: tenant ? tenant.room_number : '—'
          };
        });
        console.log(`[Complaints] Loaded ${allComplaints.length} complaints`);
      }
    } catch (e) {
      console.error('[Complaints] Exception fetching:', e);
    }
  }

  // ── Populate building filter ──
  const bldFilter = document.getElementById('complaint-filter-building');
  if (bldFilter) {
    const prevBldVal = bldFilter.value || 'all';
    // Rebuild options only if buildings count changed or not yet populated
    if (bldFilter.options.length - 1 !== buildings.length) {
      const bldOptions = ['<option value="all">All Buildings</option>'];
      buildings.forEach(b => {
        bldOptions.push(`<option value="${b.id}" ${prevBldVal === b.id ? 'selected' : ''}>${b.name}</option>`);
      });
      bldFilter.innerHTML = bldOptions.join('');
      // If prev value no longer exists in options, reset to 'all'
      if (prevBldVal !== 'all' && !buildings.find(b => b.id === prevBldVal)) {
        bldFilter.value = 'all';
      } else {
        bldFilter.value = prevBldVal;
      }
    }
  }

  // ── Read current filter values ──
  const statusFilter = document.getElementById('complaint-filter-status')?.value || 'all';
  const buildingFilterVal = bldFilter?.value || 'all';

  // ── Update KPIs (always from full dataset) ──
  const el = id => document.getElementById(id);
  if (el('ckpi-total')) el('ckpi-total').textContent = allComplaints.length;
  if (el('ckpi-open')) el('ckpi-open').textContent = allComplaints.filter(c => c.status === 'open').length;
  if (el('ckpi-inprogress')) el('ckpi-inprogress').textContent = allComplaints.filter(c => c.status === 'in_progress').length;
  if (el('ckpi-resolved')) el('ckpi-resolved').textContent = allComplaints.filter(c => c.status === 'resolved').length;

  // ── Update sidebar badge ──
  updateComplaintsBadge();

  // ── Apply filters ──
  let filtered = [...allComplaints];
  if (statusFilter !== 'all') {
    filtered = filtered.filter(c => c.status === statusFilter);
  }
  if (buildingFilterVal !== 'all') {
    filtered = filtered.filter(c => c.building_id === buildingFilterVal);
  }

  // ── Render table ──
  if (filtered.length === 0) {
    const msg = allComplaints.length === 0
      ? 'No complaints yet — tenants will appear here when they file a complaint'
      : `No complaints matching the current filters`;
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 40px; font-size: var(--font-sm);">${msg}</td></tr>`;
    return;
  }

  const badgeMap = {
    open: 'badge-danger',
    in_progress: 'badge-warning',
    resolved: 'badge-success',
    closed: 'badge-neutral'
  };

  tbody.innerHTML = filtered.map(c => {
    const statusLabel = (c.status || 'open').replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    const badgeCls = badgeMap[c.status] || 'badge-neutral';
    const desc = c.description ? (c.description.length > 80 ? c.description.slice(0, 80) + '…' : c.description) : '—';
    const safeDesc = (c.description || '').replace(/"/g, '&quot;');
    return `
      <tr>
        <td style="font-weight: 600;">${c.tenant_name || 'Unknown'}</td>
        <td style="color: var(--text-muted); font-size: var(--font-xs);">${c.building_name || '—'}<br><span style="opacity:.7">Room ${c.room_number || '—'}</span></td>
        <td><span class="badge badge-neutral" style="font-size:10px;">${c.category || '—'}</span></td>
        <td style="font-size: var(--font-xs); color: var(--text-secondary); max-width: 200px; word-break:break-word;" title="${safeDesc}">${desc}</td>
        <td style="color: var(--text-muted); font-size: var(--font-xs); white-space:nowrap;">${formatDate(c.created_at)}</td>
        <td><span class="badge ${badgeCls}">${statusLabel}</span></td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px; font-weight: 600; line-height: 1.2; height: 26px; ${c.status === 'in_progress' ? 'opacity: 0.4; cursor: not-allowed;' : ''}" onclick="updateComplaintStatusDirect('${c.id}', 'in_progress')" ${c.status === 'in_progress' ? 'disabled' : ''}>
              In Progress
            </button>
            <button class="btn btn-success" style="padding: 4px 8px; font-size: 11px; font-weight: 600; line-height: 1.2; height: 26px;" onclick="updateComplaintStatusDirect('${c.id}', 'resolved')">
              Resolve
            </button>
          </div>
        </td>
      </tr>`;
  }).join('');
};

window.openComplaintModal = function (complaintId) {
  const c = allComplaints.find(x => x.id === complaintId);
  if (!c) return;

  document.getElementById('edit-complaint-id').value = c.id;
  document.getElementById('edit-complaint-tenant').value = c.tenant_name || 'Unknown';
  document.getElementById('edit-complaint-category').value = c.category || '';
  document.getElementById('edit-complaint-desc').value = c.description || '';
  document.getElementById('edit-complaint-status').value = c.status || 'open';
  document.getElementById('edit-complaint-response').value = c.response || '';

  openModal('modal-update-complaint');
};

window.saveComplaintUpdate = async function () {
  const id = document.getElementById('edit-complaint-id').value;
  const status = document.getElementById('edit-complaint-status').value;
  const response = document.getElementById('edit-complaint-response').value.trim();

  if (!id) return;

  const isResolved = status === 'resolved' || status === 'closed';

  try {
    const updateData = { status, response };
    if (isResolved) {
      updateData.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('complaints')
      .update(updateData)
      .eq('id', id);

    // If DB trigger deletes the row on resolve, Supabase may return PGRST116 (no rows)
    // or a 404 — that is expected and OK for resolved/closed status
    if (error && !(isResolved && (error.code === 'PGRST116' || error.message?.includes('0 rows')))) {
      throw error;
    }

    closeModal('modal-update-complaint');

    if (isResolved) {
      // Remove from local array immediately (DB trigger already deleted it)
      allComplaints = allComplaints.filter(c => c.id !== id);
      await renderComplaintsTab(true); // skip fetch, already updated locally
      showToast('Complaint Resolved', 'Complaint has been marked as resolved and removed from both sides', 'success');
    } else {
      // Update local array with new status
      const idx = allComplaints.findIndex(c => c.id === id);
      if (idx !== -1) {
        allComplaints[idx] = { ...allComplaints[idx], status, response };
      }
      await renderComplaintsTab(true); // skip fetch, already updated locally
      showToast('Complaint Updated', `Status changed to "${status.replace('_', ' ')}"`, 'success');
    }
  } catch (err) {
    console.error('Error updating complaint:', err);
    showToast('Update Failed', err.message || 'Failed to update complaint', 'error');
  }
};

window.updateComplaintStatusDirect = async function (id, status) {
  if (!id) return;
  const isResolved = status === 'resolved' || status === 'closed';

  try {
    const updateData = { status };
    if (isResolved) {
      updateData.resolved_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('complaints')
      .update(updateData)
      .eq('id', id);

    // If DB trigger deletes the row on resolve, Supabase may return PGRST116 (no rows)
    // or a 404 — that is expected and OK for resolved/closed status
    if (error && !(isResolved && (error.code === 'PGRST116' || error.message?.includes('0 rows')))) {
      throw error;
    }

    if (isResolved) {
      // Remove from local array immediately (DB trigger already deleted it)
      allComplaints = allComplaints.filter(c => c.id !== id);
      await renderComplaintsTab(true); // skip fetch, already updated locally
      showToast('Complaint Resolved', 'Complaint has been marked as resolved and removed from both sides', 'success');
    } else {
      // Update local array with new status
      const idx = allComplaints.findIndex(c => c.id === id);
      if (idx !== -1) {
        allComplaints[idx] = { ...allComplaints[idx], status };
      }
      await renderComplaintsTab(true); // skip fetch, already updated locally
      showToast('Complaint Updated', `Status changed to "${status.replace('_', ' ')}"`, 'success');
    }
  } catch (err) {
    console.error('Error updating complaint status:', err);
    showToast('Update Failed', err.message || 'Failed to update complaint status', 'error');
  }
};

// Call updateComplaintsBadge after data loads to keep badge always fresh
function updateComplaintsBadge() {
  const openCount = allComplaints.filter(c => c.status === 'open').length;
  const badge = document.getElementById('complaints-badge');
  if (!badge) return;
  badge.textContent = openCount;
  badge.style.display = openCount > 0 ? 'inline-block' : 'none';
}

// ── Refund Request Integration ──
window.checkRefundEligibility = async function () {
  if (!ownerData) {
    showToast('Error', 'Owner details not loaded yet. Please try again.', 'error');
    return;
  }

  showToast('Verifying...', 'Checking refund eligibility...', 'info');

  try {
    // 1. Check if they already submitted a refund request
    const { data: existingRequests, error: errRequests } = await supabase
      .from('refund_requests')
      .select('*')
      .eq('owner_id', ownerData.id);

    if (errRequests) throw errRequests;

    if (existingRequests && existingRequests.length > 0) {
      const req = existingRequests[0];
      alert(`You have already submitted a refund request.\nStatus: ${req.status.toUpperCase()}\nSubmitted on: ${new Date(req.created_at).toLocaleDateString()}`);
      return;
    }

    // 2. Fetch SaaS Renewal Payments for this owner
    const { data: saasPayments, error: errPayments } = await supabase
      .from('payments')
      .select('*')
      .eq('owner_id', ownerData.id)
      .is('tenant_id', null)
      .eq('month_year', 'SaaS Renewal')
      .order('payment_date', { ascending: true }); // chronological order

    if (errPayments) throw errPayments;

    if (!saasPayments || saasPayments.length === 0) {
      alert("You have not made any subscription payments yet. Trial accounts are free and not eligible for refunds.");
      return;
    }

    // Refunds are only eligible for the first transaction
    if (saasPayments.length > 1) {
      alert("Refunds are only eligible for your very first transaction. Renewals or subsequent plan updates are not eligible for a refund.");
      return;
    }

    const firstPayment = saasPayments[0];

    // Refund must be requested within 7 days of the payment date
    const paymentDate = new Date(firstPayment.payment_date);
    const currentDate = new Date();
    paymentDate.setHours(0,0,0,0);
    currentDate.setHours(0,0,0,0);
    
    const diffTime = Math.abs(currentDate - paymentDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 7) {
      alert(`You are not eligible for a refund. Refund requests must be submitted within 7 days of the transaction. (Your transaction was ${diffDays} days ago).`);
      return;
    }

    // Autofill the form
    document.getElementById('refund-name').value = ownerData.name;
    document.getElementById('refund-email').value = ownerData.email;
    document.getElementById('refund-plan').value = ownerData.billing_cycle === 'yearly' ? 'Yearly Plan' : 'Monthly Plan';
    document.getElementById('refund-payment-date').value = firstPayment.payment_date;
    document.getElementById('refund-amount').value = `₹${Number(firstPayment.total_amount).toLocaleString('en-IN')}`;
    
    // Store first payment globally on window so we can reference it when submitting
    window.currentRefundPayment = firstPayment;

    // Open modal
    window.openModal('modal-refund-request');
    showToast('Eligible', 'Refund eligibility verified.', 'success');

  } catch (err) {
    console.error('Error checking refund eligibility:', err);
    showToast('Verification Failed', err.message || 'Unable to verify refund eligibility.', 'error');
  }
};

window.submitRefundRequest = async function () {
  const reason = document.getElementById('refund-reason').value;
  const comments = document.getElementById('refund-comments').value.trim();
  const confirmCheck = document.getElementById('refund-confirm').checked;

  if (!reason) {
    showToast('Required', 'Please select a reason for refund.', 'warning');
    return;
  }

  if (!confirmCheck) {
    showToast('Required', 'Please confirm that you understand the terms by checking the checkbox.', 'warning');
    return;
  }

  if (!window.currentRefundPayment || !ownerData) {
    showToast('Error', 'Payment details missing. Please reload page.', 'error');
    return;
  }

  const btn = document.querySelector('#modal-refund-request .btn-danger');
  const originalText = btn ? btn.textContent : 'Request Refund';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting Request...';
  }

  try {
    const payload = {
      owner_id: ownerData.id,
      owner_name: ownerData.name,
      owner_email: ownerData.email,
      plan_type: window.currentRefundPayment.month_year === 'SaaS Renewal' ? (ownerData.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly') : 'Monthly',
      payment_date: window.currentRefundPayment.payment_date,
      refund_amount: Number(window.currentRefundPayment.total_amount),
      reason: reason,
      additional_comments: comments || null,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    const { error } = await supabase
      .from('refund_requests')
      .insert(payload);

    if (error) throw error;

    alert("Refund request submitted successfully! Refund process has been initiated. You will receive an update from support shortly.");
    window.closeModal('modal-refund-request');
    
    // Log Activity
    try {
      await supabase.from('owner_activity_logs').insert({
        owner_id: ownerData.id,
        activity_text: `Submitted refund request of ${payload.refund_amount} for reason: ${reason}`
      });
    } catch (e) {
      console.warn('Failed to log activity:', e);
    }

  } catch (err) {
    console.error('Error submitting refund request:', err);
    showToast('Submission Failed', err.message || 'Failed to submit refund request.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
};

window.initTenantsTransactionFilters = function () {
  const bSel = document.getElementById('tenants-txn-building-filter');
  if (bSel) {
    const prevVal = bSel.value || 'all';
    bSel.innerHTML = '<option value="all">All Buildings</option>';
    buildings.forEach(b => {
      bSel.innerHTML += `<option value="${b.id}">${b.name}</option>`;
    });
    bSel.value = prevVal;
  }

  const mSel = document.getElementById('tenants-txn-month-filter');
  if (mSel) {
    const prevVal = mSel.value || 'all';
    const activeMonths = getOwnerActiveMonths();
    const optionsHTML = activeMonths.map(m => `<option value="${m.val}">${m.label}</option>`).join('');
    mSel.innerHTML = '<option value="all">All Months</option>' + optionsHTML;
    mSel.value = prevVal;
  }
};

window.renderTenantsTransactionsTable = function () {
  const tbody = document.getElementById('tenants-txns-tbody');
  if (!tbody) return;

  const searchQuery = (document.getElementById('tenants-txn-search-input')?.value || '').toLowerCase().trim();
  const buildingFilter = document.getElementById('tenants-txn-building-filter')?.value || 'all';
  const statusFilter = document.getElementById('tenants-txn-status-filter')?.value || 'all';
  const monthFilter = document.getElementById('tenants-txn-month-filter')?.value || 'all';

  // Filter allPayments
  const filtered = allPayments.filter(p => {
    // Search query: matches tenant name, room number, building name
    const matchesSearch = !searchQuery ||
      (p.tenant_name || '').toLowerCase().includes(searchQuery) ||
      (p.room_number || '').toString().includes(searchQuery) ||
      (p.building_name || '').toLowerCase().includes(searchQuery);

    // Building filter
    const matchesBuilding = buildingFilter === 'all' || p.building_id === buildingFilter;

    // Status filter
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;

    // Month filter
    const payDateStr = p.payment_date || p.created_at || '';
    const matchesMonth = monthFilter === 'all' || payDateStr.startsWith(monthFilter);

    return matchesSearch && matchesBuilding && matchesStatus && matchesMonth;
  });

  // Sort filtered transactions chronologically (newest first)
  filtered.sort((a, b) => new Date(b.created_at || b.payment_date) - new Date(a.created_at || a.payment_date));

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="text-center text-muted" style="padding: 24px;">No transactions found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    let statusClass = 'badge-warning';
    if (p.status === 'approved') statusClass = 'badge-success';
    if (p.status === 'rejected') statusClass = 'badge-danger';

    // Breakdown text
    const breakdown = `Rent: ${formatCurrency(p.rent_amount || 0)} • Elec: ${formatCurrency(p.electricity_amount || 0)} • Maint: ${formatCurrency(p.maintenance_amount || 0)}`;

    // Actions
    let actionsHTML = '';
    if (p.status === 'pending') {
      actionsHTML = `<button class="btn btn-success btn-sm" onclick="approvePayment('${p.id}')">Approve</button>`;
    } else if (p.status === 'approved') {
      actionsHTML = `<button class="btn btn-secondary btn-sm" onclick="downloadOwnerReceipt('${p.id}')">${ICONS.receipt()} Receipt</button>`;
    } else {
      actionsHTML = `<span class="text-muted" style="font-size: var(--font-xs);">—</span>`;
    }

    // Get floor number
    let floorNum = getFloorNumberForRoom(p.room_id);
    if (!floorNum && p.tenant_id) {
      const tenant = allTenants.find(t => t.id === p.tenant_id);
      if (tenant) floorNum = tenant.floor_number;
    }
    if (!floorNum) floorNum = '—';

    // Full Date formatting
    const paymentDateObj = p.payment_date || p.created_at || new Date();
    const fullDate = formatDate(paymentDateObj);

    return `<tr>
      <td><strong>${p.tenant_name || '—'}</strong></td>
      <td>${p.building_name || '—'}</td>
      <td>Floor ${floorNum}</td>
      <td><strong>Room ${p.room_number || '—'}</strong></td>
      <td style="white-space: nowrap;">${fullDate}</td>
      <td><strong>${formatCurrency(p.total_amount)}</strong></td>
      <td style="font-size: var(--font-xs); color: var(--text-muted);">${breakdown}</td>
      <td>${p.payment_method || 'UPI'}</td>
      <td style="font-family: monospace; font-size: var(--font-xs); color: var(--text-muted);">${p.transaction_id || '—'}</td>
      <td><span class="badge ${statusClass}">${p.status.toUpperCase()}</span></td>
      <td>${actionsHTML}</td>
    </tr>`;
  }).join('');
};


// ═══════════════ WHATSAPP AUTOMATION SYSTEM ═══════════════

window.toggleWhatsAppModePanel = function() {
  const mode = document.querySelector('input[name="wa-api-mode"]:checked')?.value || 'platform';
  const panel = document.getElementById('wa-credentials-panel');
  if (panel) {
    if (mode === 'personal') {
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }
};

window.initWhatsAppTab = async function() {
  if (!ownerData) return;
  
  try {
    let { data: waSettings, error: selectErr } = await supabase
      .from('owner_whatsapp_settings')
      .select('*')
      .eq('owner_id', ownerData.id)
      .maybeSingle();

    if (selectErr) throw selectErr;

    if (!waSettings) {
      // Create default settings row
      const { data: newSettings, error: insertErr } = await supabase
        .from('owner_whatsapp_settings')
        .insert({
          owner_id: ownerData.id,
          reminder_enabled: true,
          reminder_days: 2,
          api_mode: 'platform',
          meta_template_name: 'rent_reminder',
          meta_template_language: 'en'
        })
        .select()
        .single();
        
      if (insertErr) throw insertErr;
      waSettings = newSettings;
    }

    // Populate inputs
    const enabledEl = document.getElementById('wa-reminders-enabled');
    if (enabledEl) enabledEl.checked = waSettings.reminder_enabled;

    const daysEl = document.getElementById('wa-reminder-days');
    if (daysEl) daysEl.value = waSettings.reminder_days || 2;

    const modeRadios = document.getElementsByName('wa-api-mode');
    modeRadios.forEach(radio => {
      if (radio.value === waSettings.api_mode) radio.checked = true;
    });

    const tokenEl = document.getElementById('wa-access-token');
    if (tokenEl) tokenEl.value = waSettings.meta_access_token || '';

    const phoneIdEl = document.getElementById('wa-phone-number-id');
    if (phoneIdEl) phoneIdEl.value = waSettings.meta_phone_number_id || '';

    window.toggleWhatsAppModePanel();
    await window.renderWhatsAppLogs();

  } catch (err) {
    console.error('Failed to init WhatsApp settings tab:', err);
    showToast('Error', 'Failed to load WhatsApp settings: ' + err.message, 'error');
  }
};

window.saveWhatsAppSettings = async function() {
  if (!ownerData) return;

  const reminder_enabled = document.getElementById('wa-reminders-enabled').checked;
  const reminder_days = parseInt(document.getElementById('wa-reminder-days').value, 10) || 2;
  const api_mode = document.querySelector('input[name="wa-api-mode"]:checked')?.value || 'platform';
  const meta_access_token = document.getElementById('wa-access-token').value.trim() || null;
  const meta_phone_number_id = document.getElementById('wa-phone-number-id').value.trim() || null;

  if (api_mode === 'personal') {
    if (!meta_access_token || !meta_phone_number_id) {
      showToast('Validation Error', 'Please provide Meta Access Token and Phone Number ID', 'warning');
      return;
    }
  }

  try {
    const { error } = await supabase
      .from('owner_whatsapp_settings')
      .upsert({
        owner_id: ownerData.id,
        reminder_enabled,
        reminder_days,
        api_mode,
        meta_access_token,
        meta_phone_number_id,
        updated_at: new Date().toISOString()
      });

    if (error) throw error;
    showToast('Success', 'WhatsApp configuration saved successfully', 'success');

  } catch (err) {
    console.error('Failed to save WhatsApp settings:', err);
    showToast('Error', 'Failed to save settings: ' + err.message, 'error');
  }
};

window.renderWhatsAppLogs = async function() {
  if (!ownerData) return;

  const tbody = document.getElementById('wa-logs-tbody');
  if (!tbody) return;

  try {
    const { data: logs, error } = await supabase
      .from('whatsapp_reminder_logs')
      .select('*')
      .eq('owner_id', ownerData.id)
      .order('sent_at', { ascending: false })
      .limit(30);

    if (error) throw error;

    if (!logs || logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 24px;">No logs found</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(log => {
      const statusClass = log.status === 'sent' ? 'badge-success' : 'badge-danger';
      const formattedDate = new Date(log.sent_at).toLocaleString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
      return `<tr>
        <td style="white-space: nowrap;">${formattedDate}</td>
        <td><strong>${log.tenant_name}</strong></td>
        <td>${log.phone}</td>
        <td style="font-family: monospace; font-size: 11px; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${log.message_preview || '—'}</td>
        <td><span class="badge ${statusClass}">${log.status.toUpperCase()}</span></td>
      </tr>`;
    }).join('');

  } catch (err) {
    console.error('Failed to render WhatsApp logs:', err);
    tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger" style="padding: 24px;">Failed to load logs: ${err.message}</td></tr>`;
  }
};

