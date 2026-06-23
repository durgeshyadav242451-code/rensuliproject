/* ═══════════════════════════════════════════════════
   PG Builders — Super Admin Dashboard Logic
   ═══════════════════════════════════════════════════ */
import { supabase, getSession, signOut } from './supabase-config.js';
import { formatCurrency, formatDate, showToast } from './utils.js';
import { ICONS } from './icons.js';

// Global Data States
let session = null;
let allLandlords = [];
let allBuildings = [];
let allRooms = [];
let allTenants = [];
let allPayments = [];
let allTickets = [];
let allBroadcasts = [];
let allSettings = {};
let allAuditLogs = [];
let allArchives = [];
let allRefunds = [];

let activeTicket = null;

// Chart Instances
let chartRevenueInstance = null;
let chartUsersInstance = null;
let chartPlansInstance = null;
let chartTrendsInstance = null;

// ── Initialization on Page Load ──
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Toast framework
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  // Scroll event listener to persist scroll position
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      localStorage.setItem('pgb_scroll_y_superadmin', window.scrollY);
    }, 100);
  });

  await checkAuth();
  
  // Bind global functions to window for HTML calls
  window.switchAdminTab = switchAdminTab;
  window.handleAdminLogin = handleAdminLogin;
  window.handleAdminLogout = handleAdminLogout;
  window.filterLandlordsTable = filterLandlordsTable;
  window.filterTenantsTable = filterTenantsTable;
  window.deleteTenantPermanently = deleteTenantPermanently;
  window.filterPaymentsTable = filterPaymentsTable;
  window.deletePaymentPermanently = deletePaymentPermanently;
  window.filterTicketsTable = filterTicketsTable;
  window.handleSendBroadcast = handleSendBroadcast;
  window.handleSaveGeneralSettings = handleSaveGeneralSettings;
  window.handleSaveGatewaySettings = handleSaveGatewaySettings;
  window.clearSystemAuditLogs = clearSystemAuditLogs;
  window.closeAdminModal = closeAdminModal;
  window.submitLandlordSubscriptionChange = submitLandlordSubscriptionChange;
  window.openEditSubscriptionModal = openEditSubscriptionModal;
  window.toggleLandlordStatus = toggleLandlordStatus;
  window.unlockLandlordStatus = unlockLandlordStatus;
  window.forceExpirePlan = forceExpirePlan;
  window.impersonateLandlord = impersonateLandlord;
  window.deleteLandlordPermanently = deleteLandlordPermanently;
  window.openTicketDetailsModal = openTicketDetailsModal;
  window.submitTicketReply = submitTicketReply;
  window.updateTicketStatus = updateTicketStatus;
  window.updateTicketPriority = updateTicketPriority;
  window.deleteBroadcastPermanently = deleteBroadcastPermanently;
  window.initAnalyticsCharts = initAnalyticsCharts;
  window.filterArchivesTable = filterArchivesTable;
  window.openArchiveDetailsModal = openArchiveDetailsModal;
  window.deleteArchivePermanently = deleteArchivePermanently;
  window.renderPlanConfigForm = renderPlanConfigForm;
  window.calculatePreviewPrices = calculatePreviewPrices;
  window.savePlanConfig = savePlanConfig;
  window.saveLocalExpirySim = saveLocalExpirySim;
  window.simulateExpiryDB = simulateExpiryDB;
  window.viewPaymentReceipt = viewPaymentReceipt;
  window.filterRefundsTable = filterRefundsTable;
  window.handleApproveRefund = handleApproveRefund;
  window.handleRejectRefund = handleRejectRefund;
  window.viewLandlordProfile = viewLandlordProfile;
});

// ── Security & Authentication Check ──
async function checkAuth() {
  try {
    session = await getSession();
    const loginWrapper = document.getElementById('admin-login-wrapper');
    const adminContainer = document.getElementById('admin-container');

    if (!session) {
      loginWrapper.classList.remove('hidden');
      adminContainer.classList.add('hidden');
      return;
    }

    const email = session.user.email;
    if (email !== 'admin@pgbuilderss.online') {
      showToast('Access Denied', 'You are not authorized to view the admin portal.', 'error');
      await signOut();
      loginWrapper.classList.remove('hidden');
      adminContainer.classList.add('hidden');
      return;
    }

    // Authenticated as Super Admin
    loginWrapper.classList.add('hidden');
    adminContainer.classList.remove('hidden');
    
    // Set admin name in UI
    const nameEl = document.getElementById('admin-display-name');
    if (nameEl) nameEl.textContent = session.user.user_metadata?.name || 'Super Admin';

    showToast('Authenticated', 'Welcome back, System Admin.', 'success');
    
    // Load all platform records
    await loadAllData();
  } catch (err) {
    console.error('CheckAuth Error:', err);
    showToast('System Error', err.message || String(err), 'error');
  }
}

// ── Admin Login Submission ──
async function handleAdminLogin(event) {
  event.preventDefault();
  const emailInput = document.getElementById('login-email').value.trim();
  const passwordInput = document.getElementById('login-password').value;

  if (emailInput !== 'admin@pgbuilderss.online') {
    showToast('Authentication Blocked', 'Unauthorized super admin identity.', 'error');
    return;
  }

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailInput,
      password: passwordInput
    });

    if (error) throw error;
    showToast('Success', 'Access Key Accepted. Logging in...', 'success');
    await checkAuth();
  } catch (err) {
    console.error('Login Failed:', err);
    showToast('Login Failed', err.message || String(err), 'error');
  }
}

// ── Admin Logout ──
async function handleAdminLogout() {
  const confirmLogout = confirm("Are you sure you want to logout? / क्या आप लॉगआउट करना चाहते हैं?");
  if (!confirmLogout) return;
  try {
    await signOut();
    showToast('Signed Out', 'Security session cleared.', 'info');
    location.reload();
  } catch (err) {
    console.error('Logout error:', err);
    location.reload();
  }
}

// ── Load Database Records ──
async function loadAllData() {
  try {
    // 1. Fetch Landlords (owners)
    const { data: ownersData, error: errOwners } = await supabase.from('owners').select('*').order('created_at', { ascending: false });
    if (errOwners) throw errOwners;
    allLandlords = ownersData || [];

    // 2. Fetch Buildings
    const { data: bldData, error: errBld } = await supabase.from('buildings').select('*').order('created_at', { ascending: true });
    if (errBld) throw errBld;
    allBuildings = bldData || [];

    // 3. Fetch Rooms
    const { data: roomData, error: errRooms } = await supabase.from('rooms').select('*').order('created_at', { ascending: false });
    if (errRooms) throw errRooms;
    allRooms = roomData || [];

    // 4. Fetch Tenants
    const { data: tenData, error: errTenants } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
    if (errTenants) throw errTenants;
    allTenants = tenData || [];

    // 5. Fetch Payments
    const { data: payData, error: errPay } = await supabase.from('payments').select('*').order('created_at', { ascending: false });
    if (errPay) throw errPay;
    allPayments = payData || [];

    // 6. Fetch Support Tickets
    const { data: ticketData, error: errTickets } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    if (errTickets) {
      console.warn('support_tickets table not seeded yet or query failed. Check SQL script.');
      allTickets = [];
    } else {
      allTickets = ticketData || [];
    }

    // 7. Fetch Broadcast logs
    const { data: bcastData, error: errBcast } = await supabase.from('system_notifications').select('*').order('created_at', { ascending: false });
    if (errBcast) {
      console.warn('system_notifications table not seeded yet.');
      allBroadcasts = [];
    } else {
      allBroadcasts = bcastData || [];
    }

    // 8. Fetch Platform Settings
    const { data: settingsData, error: errSettings } = await supabase.from('platform_settings').select('*');
    if (errSettings) {
      console.warn('platform_settings table not seeded yet.');
    } else {
      (settingsData || []).forEach(row => {
        allSettings[row.key] = row.value;
      });
    }

    // 9. Fetch Audit Logs
    const { data: logsData, error: errLogs } = await supabase.from('audit_logs').select('*').order('created_at', { ascending: false });
    if (errLogs) {
      console.warn('audit_logs table not seeded yet.');
      allAuditLogs = [];
    } else {
      allAuditLogs = logsData || [];
    }

    // 10. Fetch Archives
    const { data: archiveData, error: errArchive } = await supabase
      .from('deleted_owners_archive')
      .select('*')
      .order('deleted_at', { ascending: false });
    if (errArchive) {
      console.warn('deleted_owners_archive table not seeded yet or query failed:', errArchive);
      allArchives = [];
    } else {
      allArchives = archiveData || [];
    }

    // 11. Fetch Refund Requests
    const { data: refundData, error: errRefunds } = await supabase
      .from('refund_requests')
      .select('*')
      .order('created_at', { ascending: false });
    if (errRefunds) {
      console.warn('refund_requests table not created yet or query failed:', errRefunds);
      allRefunds = [];
    } else {
      allRefunds = refundData || [];
    }

    // Trigger Calculations & UI Renders
    calculateMetrics();
    renderAllViews();
    initAnalyticsCharts();

    // ── Restore last active tab on page refresh ──
    const savedTab = localStorage.getItem('superadmin_active_tab');
    if (savedTab) {
      switchAdminTab(savedTab);
    }

    // ── Restore scroll position on page refresh ──
    const savedScrollY = localStorage.getItem('pgb_scroll_y_superadmin');
    if (savedScrollY !== null) {
      setTimeout(() => {
        window.scrollTo({ top: parseInt(savedScrollY), behavior: 'instant' });
      }, 150);
    }
  } catch (err) {
    console.error('Data loading error:', err);
    showToast('Sync Failed', 'Unable to retrieve complete database records.', 'error');
  }
}

// ── Metric Calculations ──
function calculateMetrics() {
  // 1. Dashboard Tab Metrics
  const totalLandlordsCount = allLandlords.length;
  const activeLandlordsCount = allLandlords.filter(o => o.status === 'Active' || !o.status).length; // Fallback to active if status is undefined
  const suspendedCount = allLandlords.filter(o => o.status === 'Suspended').length;
  const lockedCount = allLandlords.filter(o => o.status === 'Locked').length;

  const todayStr = new Date().toISOString().slice(0, 10);
  const thisMonthStr = new Date().toISOString().slice(0, 7);
  const newOwnersToday = allLandlords.filter(o => o.created_at && o.created_at.slice(0, 10) === todayStr).length;
  const newOwnersThisMonth = allLandlords.filter(o => o.created_at && o.created_at.slice(0, 7) === thisMonthStr).length;

  // Let's compute platform revenue (sum of payments from landowners if they paid platform fee, or all payments processed through tenants)
  // Let's assume all approved payments represent tenant transacted volume, and platform gets a cut or landlord pays plan subscription.
  // In a SaaS framework, platform revenue is the subscription payments paid by landlords!
  // In the payments table, owner_id could represent landlord, and tenant_id = null represents landlord purchasing plans.
  // Let's look for landlord subscription payments in the payments table:
  const planPayments = allPayments.filter(p => !p.tenant_id && p.status === 'approved');
  const totalRevenue = planPayments.reduce((acc, p) => acc + Number(p.total_amount), 0);
  const monthlyRevenue = planPayments
    .filter(p => p.created_at && p.created_at.slice(0, 7) === thisMonthStr)
    .reduce((acc, p) => acc + Number(p.total_amount), 0);

  const pendingPayments = allPayments.filter(p => p.status === 'pending').length;
  
  // Expiration in 7 days
  const sevenDaysLater = new Date();
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
  const expiringPlans = allLandlords.filter(o => {
    if (!o.subscription_expiry) return false;
    const expDate = new Date(o.subscription_expiry);
    return expDate > new Date() && expDate <= sevenDaysLater;
  }).length;

  const totalBuildingsCount = allBuildings.length;
  const totalRoomsCount = allRooms.length;
  const totalTenantsCount = allTenants.length;
  const openSupportTicketsCount = allTickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  // Dashboard Stats HTML Render
  const kpis = [
    { label: 'Total Landlords', val: totalLandlordsCount, sub: `${activeLandlordsCount} Active • ${suspendedCount} Suspended • ${lockedCount} Locked`, icon: ICONS.users() },
    { label: 'New Signups', val: newOwnersThisMonth, sub: `${newOwnersToday} Registered Today`, icon: ICONS.plus() },
    { label: 'SaaS Platform Revenue', val: formatCurrency(totalRevenue), sub: `${formatCurrency(monthlyRevenue)} This Month`, icon: ICONS.coin() },
    { label: 'Pending Renewals', val: pendingPayments, sub: `${expiringPlans} Expiring In 7 Days`, icon: ICONS.pending() },
    { label: 'Buildings Managed', val: totalBuildingsCount, sub: `${totalRoomsCount} Rooms Total`, icon: ICONS.building() },
    { label: 'Kirayedar (Tenants)', val: totalTenantsCount, sub: 'Active Platform Tenants', icon: ICONS.user() },
    { label: 'Support Tickets', val: openSupportTicketsCount, sub: 'Needs platform response', icon: ICONS.ticket() }
  ];

  const statsGrid = document.getElementById('dashboard-stats-grid');
  if (statsGrid) {
    statsGrid.innerHTML = kpis.map(kpi => `
      <div class="admin-stat-card">
        <div class="admin-stat-header">
          <span class="admin-stat-label">${kpi.label}</span>
          <span class="admin-stat-icon">${kpi.icon}</span>
        </div>
        <div class="admin-stat-value">${kpi.val}</div>
        <div class="admin-stat-trend up">${kpi.sub}</div>
      </div>
    `).join('');
  }

  // 2. Payments Tab Metrics Dashboard
  const failedCount = allPayments.filter(p => p.status === 'rejected').length;
  const refundAmount = allPayments.filter(p => p.status === 'refunded').reduce((acc, p) => acc + Number(p.total_amount), 0);
  const arpu = totalLandlordsCount > 0 ? (totalRevenue / totalLandlordsCount) : 0;

  const payStatsGrid = document.getElementById('payments-stats-grid');
  if (payStatsGrid) {
    payStatsGrid.innerHTML = `
      <div class="admin-stat-card">
        <div class="admin-stat-header">
          <span class="admin-stat-label">Total Volume</span>
          <span class="admin-stat-icon">${ICONS.coin()}</span>
        </div>
        <div class="admin-stat-value">${formatCurrency(totalRevenue)}</div>
        <div class="admin-stat-trend">Gross Platform Collections</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-header">
          <span class="admin-stat-label">Failed Trans</span>
          <span class="admin-stat-icon">${ICONS.error()}</span>
        </div>
        <div class="admin-stat-value" style="color: var(--danger);">${failedCount}</div>
        <div class="admin-stat-trend">Declined orders</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-header">
          <span class="admin-stat-label">Refunded Volume</span>
          <span class="admin-stat-icon">${ICONS.history()}</span>
        </div>
        <div class="admin-stat-value">${formatCurrency(refundAmount)}</div>
        <div class="admin-stat-trend">Returned to user</div>
      </div>
      <div class="admin-stat-card">
        <div class="admin-stat-header">
          <span class="admin-stat-label">ARPU (Landlord LTV)</span>
          <span class="admin-stat-icon">${ICONS.trendingUp()}</span>
        </div>
        <div class="admin-stat-value">${formatCurrency(arpu.toFixed(0))}</div>
        <div class="admin-stat-trend">Average Revenue per Account</div>
      </div>
    `;
  }
}

// ── Tab Navigation Switching ──
function switchAdminTab(tabId, clickedEl) {
  // Save active tab
  localStorage.setItem('superadmin_active_tab', tabId);

  // Toggle sections
  document.querySelectorAll('.admin-tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById('tab-' + tabId);
  if (targetPane) targetPane.classList.add('active');

  // Sidebar link update
  document.querySelectorAll('.admin-menu-item').forEach(m => m.classList.remove('active'));
  if (clickedEl) {
    clickedEl.classList.add('active');
  } else {
    const savedBtn = document.querySelector(`.admin-menu-item[data-tab="${tabId}"]`);
    if (savedBtn) savedBtn.classList.add('active');
  }

  // Update header text
  const headerMap = {
    dashboard: 'Platform SaaS Overview',
    landlords: 'Landlord & Subscriber Management',
    tenants: 'Platform Tenants Registry',
    payments: 'SaaS Payment Operations Centre',
    'plan-config': 'SaaS Plan Configuration',
    tickets: 'Platform Customer Support Desk',
    broadcasts: 'Global Broadcast System',
    analytics: 'SaaS Platform Analytics',
    settings: 'Global Platform Configuration',
    logs: 'System Security Audit Logs'
  };
  const topbarTitle = document.getElementById('admin-topbar-title');
  if (topbarTitle) topbarTitle.textContent = headerMap[tabId] || 'SaaS Control Centre';
}

// ── Render Views ──
function renderAllViews() {
  renderLandlordsTable();
  renderTenantsTable();
  renderPaymentsTable();
  renderTicketsTable();
  renderBroadcastsTable();
  renderAnalyticsSummary();
  renderSettingsForm();
  renderAuditLogsTable();
  renderArchivesTable();
  renderPlanConfigForm();
  renderRefundsTable();
}

// Render Landlords Directory
function renderLandlordsTable(data = allLandlords) {
  const tbody = document.getElementById('landlords-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 24px;">No landlords found</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(owner => {
    // Get stats
    const ownerBlds = allBuildings.filter(b => b.owner_id === owner.id).length;
    // Calculate total rooms in buildings owned by landlord
    const ownerRooms = allRooms.filter(r => {
      const bld = allBuildings.find(b => b.id === r.building_id);
      return bld && bld.owner_id === owner.id;
    }).length;
    const ownerTenants = allTenants.filter(t => t.owner_id === owner.id).length;

    // Plan revenue
    const revenue = allPayments
      .filter(p => p.owner_id === owner.id && p.status === 'approved' && !p.tenant_id)
      .reduce((acc, p) => acc + Number(p.total_amount), 0);

    const expiryStr = owner.subscription_expiry ? formatDate(owner.subscription_expiry) : 'N/A';
    const planClass = owner.plan_type === 'Enterprise' ? 'admin-badge-success' : 'admin-badge-warning';
    const planLabel = owner.plan_type === 'Enterprise' ? 'unlocked account' : '(paid) plan';

    let ownerStatus = owner.status || 'Active';
    const isExpired = owner.subscription_expiry && new Date(owner.subscription_expiry) < new Date();
    if (isExpired && ownerStatus !== 'Suspended' && ownerStatus !== 'Locked') {
      ownerStatus = 'Expired';
    }

    const statusClass = ownerStatus === 'Suspended' ? 'admin-badge-danger' : 
                        (ownerStatus === 'Locked' ? 'admin-badge-warning' : 
                        (ownerStatus === 'Expired' ? 'admin-badge-danger' : 'admin-badge-success'));

    return `
      <tr>
        <td><strong>${owner.name || 'Anonymous'}</strong></td>
        <td>
          <div style="font-size: var(--font-xs);">${owner.email}</div>
          <div style="font-size: var(--font-xs); color: var(--text-muted);">${owner.phone || 'No Phone'}</div>
        </td>
        <td>${owner.company_name || 'N/A'}</td>
        <td><code style="color: var(--primary-light);">${owner.owner_key}</code></td>
        <td><span class="admin-badge ${planClass}">${planLabel}</span></td>
        <td><span class="admin-badge ${statusClass}">${ownerStatus}</span></td>
        <td>${ownerBlds} Blds / ${ownerRooms} Rooms / ${ownerTenants} Tenants</td>
        <td>${expiryStr}</td>
        <td>${formatCurrency(revenue)}</td>
        <td style="text-align: right; white-space: nowrap; width: 1%;">
          <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center; flex-wrap: nowrap;">
            <button class="admin-btn admin-btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="viewLandlordProfile('${owner.id}')" title="View Landlord Profile">${ICONS.eye()} View</button>
            <button class="admin-btn admin-btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="impersonateLandlord('${owner.id}')" title="Login as Landlord">${ICONS.key()} Login</button>
            <button class="admin-btn admin-btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openEditSubscriptionModal('${owner.id}', '${owner.plan_type || 'Basic'}')">${ICONS.settings()} Plan</button>
            <button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background: #e67e22; border-color: #e67e22; display: inline-flex; align-items: center; gap: 4px;" onclick="forceExpirePlan('${owner.id}')" title="Force expire this landlord's subscription immediately">${ICONS.pending()} Expire</button>
            ${owner.status === 'Locked' ? `
              <button class="admin-btn admin-btn-primary" style="padding: 4px 8px; font-size: 11px; background: #2ecc71; border: none; display: inline-flex; align-items: center; gap: 4px;" onclick="unlockLandlordStatus('${owner.id}')" title="Unlock account manually">${ICONS.unlock()} Unlock</button>
            ` : `
              <button class="admin-btn ${owner.status === 'Suspended' ? 'admin-btn-primary' : 'admin-btn-danger'}" style="padding: 4px 8px; font-size: 11px;" onclick="toggleLandlordStatus('${owner.id}', '${owner.status || 'Active'}')">
                ${owner.status === 'Suspended' ? 'Activate' : 'Suspend'}
              </button>
            `}
            <button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background: #c0392b; display: inline-flex; align-items: center; justify-content: center;" onclick="deleteLandlordPermanently('${owner.id}')">${ICONS.trash()}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// View Landlord details in a popup modal
async function viewLandlordProfile(ownerId) {
  const owner = allLandlords.find(o => o.id === ownerId);
  if (!owner) {
    showToast('Error', 'Landlord profile not found.', 'error');
    return;
  }

  // Calculate statistics
  const ownerBlds = allBuildings.filter(b => b.owner_id === owner.id).length;
  const ownerRooms = allRooms.filter(r => {
    const bld = allBuildings.find(b => b.id === r.building_id);
    return bld && bld.owner_id === owner.id;
  }).length;
  const ownerTenants = allTenants.filter(t => t.owner_id === owner.id).length;

  const revenue = allPayments
    .filter(p => p.owner_id === owner.id && p.status === 'approved' && !p.tenant_id)
    .reduce((acc, p) => acc + Number(p.total_amount), 0);

  // Status markings
  let ownerStatus = owner.status || 'Active';
  const isExpired = owner.subscription_expiry && new Date(owner.subscription_expiry) < new Date();
  if (isExpired && ownerStatus !== 'Suspended' && ownerStatus !== 'Locked') {
    ownerStatus = 'Expired';
  }

  const planLabel = owner.plan_type === 'Enterprise' ? 'Enterprise' : 'Basic Plan';
  
  // Set UI elements
  document.getElementById('ld-owner-name').textContent = owner.name || 'Anonymous';
  
  // Status Badge
  const statusEl = document.getElementById('ld-status');
  statusEl.textContent = ownerStatus;
  statusEl.className = `admin-badge ${ownerStatus === 'Suspended' ? 'admin-badge-danger' : 
                                    (ownerStatus === 'Locked' ? 'admin-badge-warning' : 
                                    (ownerStatus === 'Expired' ? 'admin-badge-danger' : 'admin-badge-success'))}`;

  // Plan Badge
  const planEl = document.getElementById('ld-plan');
  planEl.textContent = planLabel;
  planEl.className = `admin-badge ${owner.plan_type === 'Enterprise' ? 'admin-badge-success' : 'admin-badge-warning'}`;

  document.getElementById('ld-key').textContent = owner.owner_key || '—';
  document.getElementById('ld-email').textContent = owner.email || '—';
  document.getElementById('ld-phone').textContent = owner.phone || '—';
  document.getElementById('ld-company').textContent = owner.company_name || 'N/A';
  document.getElementById('ld-joined').textContent = owner.created_at ? formatDate(owner.created_at) : '—';

  // Stats
  document.getElementById('ld-buildings').textContent = ownerBlds;
  document.getElementById('ld-rooms').textContent = ownerRooms;
  document.getElementById('ld-tenants').textContent = ownerTenants;
  document.getElementById('ld-revenue').textContent = formatCurrency(revenue);

  // Billing & defaults
  document.getElementById('ld-elec-rate').textContent = owner.default_electricity_rate ? `₹${owner.default_electricity_rate}/unit` : 'N/A';
  document.getElementById('ld-advance').textContent = owner.default_advance ? formatCurrency(owner.default_advance) : 'N/A';
  document.getElementById('ld-maint').textContent = owner.default_maintenance ? formatCurrency(owner.default_maintenance) : 'N/A';
  document.getElementById('ld-upi').textContent = owner.upi_id || 'N/A';
  document.getElementById('ld-aadhaar').textContent = owner.aadhaar_number || 'N/A';

  // Open modal
  document.getElementById('modal-landlord-detail').classList.add('active');
}

// Impersonate landlord: sets token and redirects
function impersonateLandlord(ownerId) {
  const landlord = allLandlords.find(o => o.id === ownerId);
  if (!landlord) return;

  localStorage.setItem('impersonate_owner_id', ownerId);
  showToast('Impersonation Active', `Simulating owner session for ${landlord.name}. Redirecting...`, 'warning');
  
  // Log Action
  logAdminAction(`Impersonated landlord ${landlord.name} (${landlord.owner_key})`, 'Landlords');

  setTimeout(() => {
    window.location.href = '/owner-dashboard.html';
  }, 1000);
}

// Manually unlock/activate locked landlord
async function unlockLandlordStatus(ownerId) {
  const owner = allLandlords.find(o => o.id === ownerId);
  if (!confirm(`Are you sure you want to Unlock (Manually Activate) ${owner?.name}?`)) return;

  try {
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const targetAllowed = owner && owner.allowed_buildings > 0 ? owner.allowed_buildings : 1;
    
    const { data, error } = await supabase
      .from('owners')
      .update({ 
        status: 'Active', 
        subscription_status: 'active',
        subscription_expiry: expiry,
        allowed_buildings: targetAllowed
      })
      .eq('id', ownerId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Update failed: No rows modified. This is usually due to database RLS policy restrictions.");
    }

    showToast('Success', `Landlord account unlocked and marked as Active.`, 'success');
    logAdminAction(`Manually unlocked and activated landlord: ${owner?.name} (${owner?.owner_key})`, 'Landlords');
    await loadAllData();
  } catch (err) {
    showToast('Unlock Failed', err.message || String(err), 'error');
  }
}

// ── Force Expire Plan ──
async function forceExpirePlan(ownerId) {
  const owner = allLandlords.find(o => o.id === ownerId);
  if (!owner) return;

  if (!confirm(`Force Expire Plan for "${owner.name}"?\n\nThis will immediately set their subscription to EXPIRED. They will be locked out of their dashboard until they renew.\n\nConfirm?`)) return;

  try {
    // Set expiry to yesterday so it is definitely expired
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const expiredAt = yesterday.toISOString();

    const { data, error } = await supabase
      .from('owners')
      .update({
        subscription_expiry: expiredAt,
        subscription_status: 'expired'
      })
      .eq('id', ownerId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Update failed: No rows modified. This is usually due to database RLS policy restrictions.");
    }

    showToast('Plan Expired', `${owner.name}'s subscription has been force-expired. They will see the renewal page on next login.`, 'warning');
    logAdminAction(`Force-expired plan for landlord: ${owner.name} (${owner.owner_key})`, 'Landlords');
    await loadAllData();
  } catch (err) {
    showToast('Failed', err.message || String(err), 'error');
  }
}

// Toggle Suspend Status
async function toggleLandlordStatus(ownerId, currentStatus) {
  const newStatus = currentStatus === 'Suspended' ? 'Active' : 'Suspended';
  const owner = allLandlords.find(o => o.id === ownerId);
  
  if (!confirm(`Are you sure you want to change subscription status to: ${newStatus} for ${owner?.name}?`)) return;

  try {
    const { data, error } = await supabase
      .from('owners')
      .update({ status: newStatus })
      .eq('id', ownerId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Update failed: No rows modified. This is usually due to database RLS policy restrictions.");
    }

    showToast('Success', `Landlord account marked as ${newStatus}.`, 'success');
    logAdminAction(`Toggled landlord status for ${owner?.name} to ${newStatus}`, 'Landlords');
    await loadAllData();
  } catch (err) {
    showToast('Failed to Update', err.message || String(err), 'error');
  }
}

// Edit Subscription modal actions
function openEditSubscriptionModal(ownerId, planType) {
  document.getElementById('sub-modal-owner-id').value = ownerId;
  document.getElementById('sub-modal-plan').value = planType;
  
  // Show modal
  document.getElementById('modal-edit-subscription').classList.add('active');
}

async function submitLandlordSubscriptionChange(event) {
  event.preventDefault();
  const ownerId = document.getElementById('sub-modal-owner-id').value;
  const newPlan = document.getElementById('sub-modal-plan').value;

  const owner = allLandlords.find(o => o.id === ownerId);

  try {
    const updatePayload = {
      plan_type: newPlan
    };

    if (newPlan === 'Enterprise') {
      updatePayload.subscription_status = 'active';
      updatePayload.subscription_expiry = null;
      updatePayload.allowed_buildings = 9999;
    } else {
      // If changing from Enterprise to Basic, reset subscription to expired so they have to pay/renew
      if (owner && owner.plan_type === 'Enterprise') {
        updatePayload.subscription_status = 'expired';
        updatePayload.subscription_expiry = null;
        updatePayload.allowed_buildings = 1;
      }
    }

    const { data, error } = await supabase
      .from('owners')
      .update(updatePayload)
      .eq('id', ownerId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Update failed: No rows modified. This is usually due to database RLS policy restrictions.");
    }

    showToast('Success', `Subscription modified for ${owner?.name}.`, 'success');
    const planLabel = newPlan === 'Enterprise' ? 'unlocked account' : '(paid) plan';
    const logDesc = newPlan === 'Enterprise' 
      ? `Changed plan of ${owner?.name} to unlocked account (unlimited, lifetime)`
      : `Changed plan of ${owner?.name} to (paid) plan`;
    logAdminAction(logDesc, 'Landlords');
    closeAdminModal('modal-edit-subscription');
    await loadAllData();
  } catch (err) {
    showToast('Update Failed', err.message || String(err), 'error');
  }
}

// Permanent Owner Deletion
async function deleteLandlordPermanently(ownerId) {
  const owner = allLandlords.find(o => o.id === ownerId);
  if (!owner) return;

  if (!confirm(`CRITICAL ACTION: Are you sure you want to PERMANENTLY delete landlord ${owner.name}? This removes all their properties, rooms, tenants, payments, and data cascades. This action is irreversible!`)) return;

  try {
    // Fetch buildings and tenants for archiving before delete
    const { data: buildingsData } = await supabase
      .from('buildings')
      .select('*')
      .eq('owner_id', ownerId);

    const { data: tenantsData } = await supabase
      .from('tenants')
      .select('*')
      .eq('owner_id', ownerId);

    const archiveData = {
      original_id: ownerId,
      name: owner.name,
      email: owner.email,
      phone: owner.phone,
      owner_key: owner.owner_key,
      aadhaar_number: owner.aadhaar_number || null,
      buildings: buildingsData || [],
      tenants: tenantsData || [],
      deleted_by: 'Super Admin'
    };

    const { error: archiveErr } = await supabase
      .from('deleted_owners_archive')
      .insert(archiveData);

    if (archiveErr) throw new Error("Archive failed: " + archiveErr.message);

    // Supplying standard delete call to Supabase
    // Cascade settings on DB should handle cleaning tables
    const { error } = await supabase.from('owners').delete().eq('id', ownerId);
    if (error) throw error;

    showToast('Account Deleted', `${owner.name} profile has been permanently erased.`, 'success');
    logAdminAction(`Permanently deleted landlord account: ${owner.name} (${owner.owner_key})`, 'Landlords');
    await loadAllData();
  } catch (err) {
    showToast('Deletion Failed', err.message || String(err), 'error');
  }
}

// Close helper
function closeAdminModal(id) {
  document.getElementById(id).classList.remove('active');
}

// Filter Landlords directory
function filterLandlordsTable() {
  const search = document.getElementById('landlord-search').value.toLowerCase().trim();
  const plan = document.getElementById('landlord-filter-plan').value;
  const status = document.getElementById('landlord-filter-status').value;

  const filtered = allLandlords.filter(owner => {
    const landlordBuildings = allBuildings.filter(b => b.owner_id === owner.id);
    const locationsString = landlordBuildings.map(b => b.location || '').join(' ').toLowerCase();

    const matchesSearch = 
      (owner.name && owner.name.toLowerCase().includes(search)) || 
      (owner.email && owner.email.toLowerCase().includes(search)) || 
      (owner.owner_key && owner.owner_key.toLowerCase().includes(search)) ||
      locationsString.includes(search);

    const matchesPlan = (plan === 'all') || 
                        (plan === 'Basic' && owner.plan_type !== 'Enterprise') || 
                        (plan === 'Enterprise' && owner.plan_type === 'Enterprise');
    
    let ownerStatus = owner.status || 'Active';
    const isExpired = owner.subscription_expiry && new Date(owner.subscription_expiry) < new Date();
    if (isExpired && ownerStatus !== 'Suspended' && ownerStatus !== 'Locked') {
      ownerStatus = 'Expired';
    }

    const matchesStatus = (status === 'all') || (ownerStatus === status);

    return matchesSearch && matchesPlan && matchesStatus;
  });

  renderLandlordsTable(filtered);
}

// ── Payment Log Operations ──
// Local date formatter to output like "22 Jun 2026"
function formatPaymentDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// ── Payment Log Operations ──
function renderPaymentsTable(data = allPayments) {
  const tbody = document.getElementById('payments-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted" style="padding: 24px;">No transactions recorded</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(pay => {
    // Resolve Landlord
    const owner = pay.owner_id ? allLandlords.find(o => o.id === pay.owner_id) : null;
    const landlordName = owner ? owner.name : 'N/A';

    // Plan text
    const isTenantPay = !!pay.tenant_id;
    const planText = isTenantPay 
      ? 'Room Rent (Tenant)' 
      : (pay.month_year === 'SaaS Renewal' 
          ? (owner ? owner.plan_type : 'SaaS Plan') 
          : (pay.month_year || 'SaaS Renewal'));

    // Buildings limit
    const buildingsCount = owner ? (owner.allowed_buildings || 1) : 1;

    // Financial Breakdown
    // For SaaS plan payments, Amount is subtotal (Total / (1 + GST / 100)) and GST is calculated from subtotal.
    // For Tenant payments, GST is 0 and Amount equals Total.
    const activeGstRate = (allSettings.subscription && allSettings.subscription.gst_rate !== undefined) 
      ? Number(allSettings.subscription.gst_rate) 
      : 18;
    const totalPaid = Number(pay.total_amount) || 0;
    const amountVal = isTenantPay ? totalPaid : Math.round(totalPaid / (1 + activeGstRate / 100));
    const gstVal = isTenantPay ? 0 : (totalPaid - amountVal);

    // Payment Status mapping
    let paymentStatusText = 'Pending';
    let statusClass = 'admin-badge-warning';
    
    if (pay.status === 'approved' || pay.status === 'verified') {
      paymentStatusText = 'Paid';
      statusClass = 'admin-badge-success';
    } else if (pay.status === 'rejected' || pay.status === 'failed') {
      paymentStatusText = 'Failed';
      statusClass = 'admin-badge-danger';
    } else if (pay.status === 'refunded') {
      paymentStatusText = 'Refunded';
      statusClass = 'admin-badge-info';
    }

    // Refund Status logic
    let refundStatus = '-';
    let refundClass = 'text-muted';
    
    if (pay.status === 'refunded') {
      refundStatus = 'Refunded';
      refundClass = 'text-info';
    } else if (pay.status === 'approved' || pay.status === 'verified') {
      const paymentDate = new Date(pay.created_at || pay.payment_date);
      const daysDiff = (Date.now() - paymentDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 7) {
        refundStatus = 'Eligible';
        refundClass = 'text-success';
      } else {
        refundStatus = 'Expired';
        refundClass = 'text-muted';
      }
    }

    return `
      <tr>
        <td><code>${pay.transaction_id || 'TXN-DIRECT'}</code></td>
        <td>${landlordName}</td>
        <td>${planText}</td>
        <td>${buildingsCount}</td>
        <td><strong>${formatCurrency(amountVal)}</strong></td>
        <td>${formatCurrency(gstVal)}</td>
        <td><strong>${formatCurrency(totalPaid)}</strong></td>
        <td>${pay.payment_method || 'UPI'}</td>
        <td><span class="admin-badge ${statusClass}">${paymentStatusText}</span></td>
        <td class="${refundClass}" style="font-weight: 600;">${refundStatus}</td>
        <td>${pay.created_at ? formatPaymentDate(pay.created_at) : formatPaymentDate(new Date())}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
            <button class="admin-btn admin-btn-secondary" style="padding: 4px 10px; font-size: 11px; font-weight: 600;" onclick="viewPaymentReceipt('${pay.id}')">View</button>
            ${pay.status === 'pending' ? `<button class="admin-btn admin-btn-primary" style="padding: 4px 8px; font-size: 11px;" onclick="verifyPaymentState('${pay.id}', 'approved')" title="Verify Payment">Verify</button>` : ''}
            ${pay.status === 'approved' ? `<button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background:#e67e22;" onclick="verifyPaymentState('${pay.id}', 'refunded')" title="Refund Payment">Refund</button>` : ''}
            <button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background: #c0392b; display: inline-flex; align-items: center; justify-content: center;" onclick="deletePaymentPermanently('${pay.id}')" title="Delete transaction">${ICONS.trash()}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Verify or update transaction
async function verifyPaymentState(paymentId, targetState) {
  if (!confirm(`Are you sure you want to mark this transaction as ${targetState.toUpperCase()}?`)) return;

  try {
    const { data, error } = await supabase
      .from('payments')
      .update({ status: targetState })
      .eq('id', paymentId)
      .select();

    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error("Update failed: No rows modified. This is usually due to database RLS policy restrictions.");
    }

    showToast('Transaction Updated', `Payment successfully marked as ${targetState}.`, 'success');
    logAdminAction(`Modified payment status of txn ID ${paymentId} to ${targetState}`, 'Payments');
    await loadAllData();
  } catch (err) {
    showToast('Update Failed', err.message || String(err), 'error');
  }
}

// Generate receipt PDF fallback/trigger -> Now displays the Transaction Detail Modal
async function viewPaymentReceipt(paymentId) {
  const pay = allPayments.find(p => p.id === paymentId);
  if (!pay) {
    showToast('Error', 'Transaction record not found.', 'error');
    return;
  }

  // Resolve Landlord
  const owner = pay.owner_id ? allLandlords.find(o => o.id === pay.owner_id) : null;

  // Suffixes for deterministic mock data
  const paySuffix = pay.id ? pay.id.split('-')[0].toUpperCase() : 'DIRECT';
  const txnSuffix = pay.transaction_id || paySuffix;

  // Mock integration IDs
  const mockOrderId = `order_${txnSuffix.toLowerCase()}_${paySuffix.toLowerCase()}`;
  const mockPaymentId = `pay_${txnSuffix.toLowerCase()}_${paySuffix.toLowerCase()}`;
  const mockSubscriptionId = pay.tenant_id ? 'N/A (Tenant Payment)' : `sub_${txnSuffix.toLowerCase()}_${paySuffix.toLowerCase()}`;
  const mockInvoiceNumber = `INV-2026-${txnSuffix}`;

  // Financial calculations
  const activeGstRate = (allSettings.subscription && allSettings.subscription.gst_rate !== undefined) 
    ? Number(allSettings.subscription.gst_rate) 
    : 18;
  const totalPaid = Number(pay.total_amount) || 0;
  const isTenantPay = !!pay.tenant_id;
  const amountVal = isTenantPay ? totalPaid : Math.round(totalPaid / (1 + activeGstRate / 100));
  const gstVal = isTenantPay ? 0 : (totalPaid - amountVal);
  const gatewayFee = (totalPaid * 0.02);

  // Status mappings
  let paymentStatusText = 'Pending';
  let statusClass = 'admin-badge-warning';
  if (pay.status === 'approved' || pay.status === 'verified') {
    paymentStatusText = 'Paid';
    statusClass = 'admin-badge-success';
  } else if (pay.status === 'rejected' || pay.status === 'failed') {
    paymentStatusText = 'Failed';
    statusClass = 'admin-badge-danger';
  } else if (pay.status === 'refunded') {
    paymentStatusText = 'Refunded';
    statusClass = 'admin-badge-info';
  }

  let refundStatusText = '-';
  let refundClass = 'admin-badge-info';
  if (pay.status === 'refunded') {
    refundStatusText = 'Refunded';
    refundClass = 'admin-badge-info';
  } else if (pay.status === 'approved' || pay.status === 'verified') {
    const paymentDate = new Date(pay.created_at || pay.payment_date);
    const daysDiff = (Date.now() - paymentDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 7) {
      refundStatusText = 'Eligible';
      refundClass = 'admin-badge-success';
    } else {
      refundStatusText = 'Expired';
      refundClass = 'admin-badge-danger';
    }
  } else {
    refundStatusText = 'N/A';
    refundClass = 'admin-badge-info';
  }

  // Dates
  const paymentDateObj = new Date(pay.created_at || pay.payment_date || new Date());
  const refundDeadlineObj = new Date(paymentDateObj.getTime() + 7 * 24 * 60 * 60 * 1000);

  // Set DOM Fields
  document.getElementById('det-transaction-id').textContent = pay.transaction_id || 'TXN-DIRECT';
  
  // Payment Status Badge
  const payStatusEl = document.getElementById('det-payment-status');
  payStatusEl.textContent = paymentStatusText;
  payStatusEl.className = `admin-badge ${statusClass}`;

  // Refund Status Badge
  const refundStatusEl = document.getElementById('det-refund-status');
  refundStatusEl.textContent = refundStatusText;
  refundStatusEl.className = `admin-badge ${refundClass}`;

  // Owner contact details
  document.getElementById('det-owner-name').textContent = owner ? (owner.name || 'Anonymous') : 'N/A';
  document.getElementById('det-owner-email').textContent = owner ? (owner.email || 'N/A') : 'N/A';
  document.getElementById('det-owner-phone').textContent = owner ? (owner.phone || 'N/A') : 'N/A';

  // Plan metadata
  document.getElementById('det-plan-type').textContent = isTenantPay 
    ? `Room Rent (Tenant: ${pay.tenant_name || 'Anonymous'})` 
    : (owner ? (owner.plan_type || 'Basic') : 'Basic');
  document.getElementById('det-building-count').textContent = owner ? (owner.allowed_buildings || 1) : 'N/A';

  // Billing ledger
  document.getElementById('det-amount').textContent = formatCurrency(amountVal);
  document.getElementById('det-gst').textContent = formatCurrency(gstVal);
  document.getElementById('det-gateway-fee').textContent = formatCurrency(gatewayFee);
  document.getElementById('det-total-paid').textContent = formatCurrency(totalPaid);

  // Metadata context
  document.getElementById('det-payment-date').textContent = pay.created_at ? formatPaymentDate(pay.created_at) : formatPaymentDate(new Date());
  document.getElementById('det-refund-deadline').textContent = formatPaymentDate(refundDeadlineObj);
  document.getElementById('det-payment-method').textContent = pay.payment_method || 'UPI';
  document.getElementById('det-invoice-number').textContent = mockInvoiceNumber;

  // Razorpay attributes
  document.getElementById('det-razorpay-order-id').textContent = mockOrderId;
  document.getElementById('det-razorpay-payment-id').textContent = mockPaymentId;
  document.getElementById('det-razorpay-subscription-id').textContent = mockSubscriptionId;

  // Show Modal
  document.getElementById('modal-payment-detail').classList.add('active');
}

// Filter payments
function filterPaymentsTable() {
  const search = document.getElementById('payment-search').value.toLowerCase().trim();
  const status = document.getElementById('payment-filter-status').value;

  const filtered = allPayments.filter(pay => {
    let ownerMatches = false;
    if (pay.owner_id) {
      const owner = allLandlords.find(o => o.id === pay.owner_id);
      ownerMatches = owner && owner.name.toLowerCase().includes(search);
    }
    const matchesSearch = 
      (pay.transaction_id && pay.transaction_id.toLowerCase().includes(search)) || 
      (pay.tenant_name && pay.tenant_name.toLowerCase().includes(search)) || 
      ownerMatches;

    const matchesStatus = (status === 'all') || (pay.status === status);

    return matchesSearch && matchesStatus;
  });

  renderPaymentsTable(filtered);
}


// ── Support Ticketing Centre ──
function renderTicketsTable(data = allTickets) {
  const tbody = document.getElementById('tickets-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 24px;">No support tickets active</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(t => {
    const priorityClass = t.priority === 'urgent' ? 'admin-badge-danger' : (t.priority === 'high' ? 'admin-badge-warning' : 'admin-badge-info');
    const statusClass = t.status === 'open' ? 'admin-badge-danger' : (t.status === 'resolved' ? 'admin-badge-success' : 'admin-badge-warning');

    return `
      <tr>
        <td><code>#${t.id.substring(0, 8)}</code></td>
        <td><strong>${t.user_name || 'Owner User'}</strong></td>
        <td>${t.category}</td>
        <td>${t.subject}</td>
        <td><span class="admin-badge ${priorityClass}">${t.priority}</span></td>
        <td><span class="admin-badge ${statusClass}">${t.status}</span></td>
        <td>${t.assigned_staff || 'Unassigned'}</td>
        <td>${formatDate(t.created_at)}</td>
        <td>${t.updated_at ? formatDate(t.updated_at) : 'No update'}</td>
        <td style="text-align: right;">
          <button class="admin-btn admin-btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openTicketDetailsModal('${t.id}')">${ICONS.chat()} Respond</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Open chat details panel
async function openTicketDetailsModal(ticketId) {
  activeTicket = allTickets.find(t => t.id === ticketId);
  if (!activeTicket) return;

  document.getElementById('ticket-user-name').textContent = activeTicket.user_name;
  document.getElementById('ticket-category').textContent = activeTicket.category;
  document.getElementById('ticket-priority').textContent = activeTicket.priority;
  document.getElementById('ticket-status').textContent = activeTicket.status;
  document.getElementById('ticket-subject').textContent = activeTicket.subject;
  document.getElementById('ticket-description').textContent = activeTicket.description;

  document.getElementById('ticket-action-status').value = activeTicket.status;
  document.getElementById('ticket-action-priority').value = activeTicket.priority;

  // Load chat messages
  await renderTicketReplies();

  document.getElementById('modal-ticket-details').classList.add('active');
}

// Load Chat responses from Supabase
async function renderTicketReplies() {
  const chatArea = document.getElementById('ticket-chat-area');
  if (!chatArea || !activeTicket) return;

  chatArea.innerHTML = `<div class="text-center text-muted" style="font-size:11px;">Loading chat timeline...</div>`;

  try {
    const { data, error } = await supabase
      .from('ticket_replies')
      .select('*')
      .eq('ticket_id', activeTicket.id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    if (!data || data.length === 0) {
      chatArea.innerHTML = `<div class="text-center text-muted" style="padding: 24px; font-size:12px;">Start conversation thread. No replies sent yet.</div>`;
      return;
    }

    chatArea.innerHTML = data.map(reply => {
      const isAdmin = reply.sender_role === 'admin';
      return `
        <div class="chat-bubble ${isAdmin ? 'admin' : 'user'}">
          <strong>${reply.sender_name}:</strong><br/>
          ${reply.message}
          <span class="chat-meta">${formatDate(reply.created_at)}</span>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    chatArea.scrollTop = chatArea.scrollHeight;
  } catch (err) {
    chatArea.innerHTML = `<div style="color:var(--danger); font-size:12px;">Timeline failed to load: ${err.message}</div>`;
  }
}

// Send Chat Reply
async function submitTicketReply() {
  const replyInput = document.getElementById('ticket-reply-text');
  const msg = replyInput.value.trim();
  if (!msg || !activeTicket) return;

  try {
    const adminName = session.user.user_metadata?.name || 'Super Admin';
    const { error } = await supabase
      .from('ticket_replies')
      .insert({
        ticket_id: activeTicket.id,
        sender_id: session.user.id,
        sender_name: adminName,
        sender_role: 'admin',
        message: msg
      });

    if (error) throw error;

    // Update ticket modified time
    await supabase.from('support_tickets').update({ updated_at: new Date().toISOString() }).eq('id', activeTicket.id);

    replyInput.value = '';
    await renderTicketReplies();
    
    // Refresh parent list
    const { data: ticketData } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    allTickets = ticketData || [];
    renderTicketsTable();
  } catch (err) {
    showToast('Failed to Reply', err.message || String(err), 'error');
  }
}

// Update status inline
async function updateTicketStatus() {
  if (!activeTicket) return;
  const status = document.getElementById('ticket-action-status').value;
  try {
    const { error } = await supabase.from('support_tickets').update({ status, updated_at: new Date().toISOString() }).eq('id', activeTicket.id);
    if (error) throw error;
    document.getElementById('ticket-status').textContent = status;
    showToast('Status Updated', `Ticket marked as ${status}`, 'success');
    logAdminAction(`Updated status of ticket #${activeTicket.id.substring(0,8)} to ${status}`, 'Tickets');
    
    const { data: ticketData } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    allTickets = ticketData || [];
    renderTicketsTable();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// Update priority inline
async function updateTicketPriority() {
  if (!activeTicket) return;
  const priority = document.getElementById('ticket-action-priority').value;
  try {
    const { error } = await supabase.from('support_tickets').update({ priority, updated_at: new Date().toISOString() }).eq('id', activeTicket.id);
    if (error) throw error;
    document.getElementById('ticket-priority').textContent = priority;
    showToast('Priority Updated', `Ticket marked as ${priority}`, 'success');
    
    const { data: ticketData } = await supabase.from('support_tickets').select('*').order('created_at', { ascending: false });
    allTickets = ticketData || [];
    renderTicketsTable();
  } catch (err) {
    showToast('Error', err.message, 'error');
  }
}

// Filter support tickets
function filterTicketsTable() {
  const priority = document.getElementById('ticket-filter-priority').value;
  const status = document.getElementById('ticket-filter-status').value;

  const filtered = allTickets.filter(t => {
    const matchesPriority = (priority === 'all') || (t.priority === priority);
    const matchesStatus = (status === 'all') || (t.status === status);
    return matchesPriority && matchesStatus;
  });

  renderTicketsTable(filtered);
}


// ── Broadcasting Centre (Notifications) ──
function renderBroadcastsTable() {
  const tbody = document.getElementById('broadcasts-table-body');
  if (!tbody) return;

  if (allBroadcasts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding: 24px;">No broadcasts sent yet</td></tr>`;
    return;
  }

  tbody.innerHTML = allBroadcasts.map(b => `
    <tr>
      <td>${formatDate(b.created_at)}</td>
      <td><span class="admin-badge admin-badge-info">${b.audience}</span></td>
      <td><strong>${b.title}</strong></td>
      <td>${b.notice_type}</td>
      <td>${b.delivered_count} recipients</td>
      <td style="text-align: right;">
        <button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background: #c0392b; display: inline-flex; align-items: center; justify-content: center;" onclick="deleteBroadcastPermanently('${b.id}')" title="Delete broadcast notice">${ICONS.trash()}</button>
      </td>
    </tr>
  `).join('');
}

// Permanent Broadcast Notice Deletion
async function deleteBroadcastPermanently(broadcastId) {
  const b = allBroadcasts.find(x => x.id === broadcastId);
  if (!b) return;

  if (!confirm(`CRITICAL ACTION: Are you sure you want to delete the broadcast "${b.title}"? This will permanently remove the notice from all landlords' dashboards.`)) return;

  try {
    const { error } = await supabase.from('system_notifications').delete().eq('id', broadcastId);
    if (error) throw error;

    showToast('Broadcast Deleted', 'Notice successfully deleted from history.', 'success');
    logAdminAction(`Permanently deleted system notification: "${b.title}"`, 'Broadcaster');
    await loadAllData();
  } catch (err) {
    showToast('Deletion Failed', err.message || String(err), 'error');
  }
}

// Send targeted notice
async function handleSendBroadcast(event) {
  event.preventDefault();
  const title = document.getElementById('notice-title').value.trim();
  const audience = document.getElementById('notice-audience').value;
  const deliveryType = document.getElementById('notice-channel').value;
  const noticeType = document.getElementById('notice-type').value;
  const message = document.getElementById('notice-message').value.trim();

  try {
    // 1. Identify targeted users
    let targets = [];
    if (audience === 'all') {
      targets = allLandlords;
    } else if (audience === 'basic') {
      targets = allLandlords.filter(o => o.plan_type !== 'Enterprise');
    } else if (audience === 'enterprise') {
      targets = allLandlords.filter(o => o.plan_type === 'Enterprise');
    } else if (audience === 'expiring') {
      const sevenDaysLater = new Date();
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      targets = allLandlords.filter(o => o.subscription_expiry && new Date(o.subscription_expiry) <= sevenDaysLater);
    } else if (audience === 'suspended') {
      targets = allLandlords.filter(o => o.status === 'Suspended');
    }

    const count = targets.length;

    // 2. Insert into notices log
    const { error: errNotice } = await supabase
      .from('system_notifications')
      .insert({
        title,
        message,
        audience,
        delivery_type: deliveryType,
        notice_type: noticeType,
        delivered_count: count,
        open_rate: 0
      });

    if (errNotice) throw errNotice;

    // 3. For In-App channels, let's update owners notice board to make it visible
    if (deliveryType === 'In-App') {
      // Updates notice boards for landlords matches
      const targetIds = targets.map(t => t.id);
      if (targetIds.length > 0) {
        await supabase
          .from('owners')
          .update({ notice_board: `[${noticeType}] ${title}: ${message}` })
          .in('id', targetIds);
      }
    }

    showToast('Notice Dispatched', `Alert successfully queued to ${count} landlords.`, 'success');
    logAdminAction(`Dispatched notification "${title}" to "${audience}" tier`, 'Broadcaster');

    // Reset form
    document.getElementById('broadcast-form').reset();
    await loadAllData();
  } catch (err) {
    showToast('Dispatch Failed', err.message || String(err), 'error');
  }
}


// ── Analytics Centre ──
function renderAnalyticsSummary() {
  const occupancyEl = document.getElementById('metric-occupancy');
  const churnEl = document.getElementById('metric-churn');
  const mauEl = document.getElementById('metric-mau');
  const popularEl = document.getElementById('metric-popular');
  const topBody = document.getElementById('top-landlords-body');

  // Compute Occupancy
  // Total Rooms and Occupied Rooms
  let totalBeds = 0;
  let occupiedBeds = 0;
  allRooms.forEach(r => {
    totalBeds += (r.beds_count || 1);
    occupiedBeds += (r.beds_occupied || 0);
  });
  const occupancyRate = totalBeds > 0 ? ((occupiedBeds / totalBeds) * 100).toFixed(1) : 0;
  if (occupancyEl) occupancyEl.textContent = `${occupancyRate}% (${occupiedBeds}/${totalBeds} Beds)`;

  // Compute Churn (ratio of suspended accounts to total accounts)
  const totalL = allLandlords.length;
  const suspendedL = allLandlords.filter(o => o.status === 'Suspended').length;
  const churnRate = totalL > 0 ? ((suspendedL / totalL) * 100).toFixed(1) : 0;
  if (churnEl) churnEl.textContent = `${churnRate}%`;

  // Compute MAU (mock estimation based on active accounts logging in within 30 days)
  const activeL = allLandlords.filter(o => o.status === 'Active' || !o.status).length;
  if (mauEl) mauEl.textContent = `${activeL} Landlords Active`;

  // Popular plan
  const planCounts = { paid: 0, unlocked: 0 };
  allLandlords.forEach(o => {
    if (o.plan_type === 'Enterprise') {
      planCounts.unlocked++;
    } else {
      planCounts.paid++;
    }
  });
  const popularPlan = planCounts.unlocked > planCounts.paid ? 'unlocked account' : '(paid) plan';
  if (popularEl) popularEl.textContent = `${popularPlan} (unlocked: ${planCounts.unlocked}, paid: ${planCounts.paid})`;

  // Top Paying Landlords (highest total revenue generated)
  // Map Landlords to their computed revenue
  const landlordsWithRev = allLandlords.map(o => {
    const blds = allBuildings.filter(b => b.owner_id === o.id).length;
    const rms = allRooms.filter(r => {
      const b = allBuildings.find(bld => bld.id === r.building_id);
      return b && b.owner_id === o.id;
    }).length;
    // SaaS plans paid
    const rev = allPayments
      .filter(p => p.owner_id === o.id && p.status === 'approved' && !p.tenant_id)
      .reduce((acc, p) => acc + Number(p.total_amount), 0);

    return { name: o.name, blds, rms, rev };
  });

  // Sort by revenue descending
  landlordsWithRev.sort((a, b) => b.rev - a.rev);

  if (topBody) {
    topBody.innerHTML = landlordsWithRev.slice(0, 5).map(l => `
      <tr>
        <td><strong>${l.name}</strong></td>
        <td>${l.blds} buildings</td>
        <td>${l.rms} rooms</td>
        <td><strong>${formatCurrency(l.rev)}</strong></td>
      </tr>
    `).join('');
  }
}

// ── Chart.js Configurations ──
function initAnalyticsCharts() {
  // Clear existing Chart JS objects to prevent resizing glitches
  if (chartRevenueInstance) chartRevenueInstance.destroy();
  if (chartUsersInstance) chartUsersInstance.destroy();
  if (chartPlansInstance) chartPlansInstance.destroy();
  if (chartTrendsInstance) chartTrendsInstance.destroy();

  // Aggregate monthly data for the charts
  const monthlyRevenueData = {};
  const monthlyUserRegData = {};
  const gatewayCounts = { Razorpay: 0, Stripe: 0, UPI_Direct: 0, PayPal: 0 };
  const planCounts = { paid: 0, unlocked: 0 };

  // Calculate Plan Distribution
  allLandlords.forEach(o => {
    if (o.plan_type === 'Enterprise') {
      planCounts.unlocked++;
    } else {
      planCounts.paid++;
    }
  });

  // Collect payments statistics
  allPayments.forEach(p => {
    if (p.status === 'approved') {
      const month = p.created_at ? p.created_at.slice(0, 7) : new Date().toISOString().slice(0,7);
      
      // Platform SaaS plan payments
      if (!p.tenant_id) {
        monthlyRevenueData[month] = (monthlyRevenueData[month] || 0) + Number(p.total_amount);
      }
      
      // Payment Gateways
      const gate = p.payment_gateway || 'Razorpay';
      if (gatewayCounts[gate] !== undefined) gatewayCounts[gate]++;
      else gatewayCounts[gate] = (gatewayCounts[gate] || 0) + 1;
    }
  });

  // Collect landlord registration dates
  allLandlords.forEach(o => {
    const month = o.created_at ? o.created_at.slice(0, 7) : new Date().toISOString().slice(0,7);
    monthlyUserRegData[month] = (monthlyUserRegData[month] || 0) + 1;
  });

  // Sort months keys
  const months = Array.from(new Set([...Object.keys(monthlyRevenueData), ...Object.keys(monthlyUserRegData)])).sort();
  const revenueValues = months.map(m => monthlyRevenueData[m] || 0);
  const registrationValues = months.map(m => monthlyUserRegData[m] || 0);

  // Style chart configs
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const labelColor = isLight ? '#0f172a' : '#F0F0FF';
  const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)';
  const tickColor = isLight ? '#475569' : '#B0B0CC';
  const primaryColor = '#6C5CE7';
  const accentColor = '#00D2FF';

  // 1. Revenue Chart
  const ctxRev = document.getElementById('chart-revenue');
  if (ctxRev) {
    chartRevenueInstance = new Chart(ctxRev.getContext('2d'), {
      type: 'line',
      data: {
        labels: months.length > 0 ? months : ['No Data'],
        datasets: [{
          label: 'Platform Subscriptions (₹)',
          data: revenueValues.length > 0 ? revenueValues : [0],
          borderColor: primaryColor,
          backgroundColor: 'rgba(108, 92, 231, 0.15)',
          fill: true,
          tension: 0.3,
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: gridColor }, ticks: { color: tickColor } },
          x: { grid: { display: false }, ticks: { color: tickColor } }
        }
      }
    });
  }

  // 2. Registrations Chart
  const ctxUsers = document.getElementById('chart-users');
  if (ctxUsers) {
    chartUsersInstance = new Chart(ctxUsers.getContext('2d'), {
      type: 'bar',
      data: {
        labels: months.length > 0 ? months : ['No Data'],
        datasets: [{
          label: 'New Landlords',
          data: registrationValues.length > 0 ? registrationValues : [0],
          backgroundColor: accentColor,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: gridColor }, ticks: { color: tickColor, stepSize: 1 } },
          x: { grid: { display: false }, ticks: { color: tickColor } }
        }
      }
    });
  }

  // 3. Plan Distribution Chart
  const ctxPlans = document.getElementById('chart-plans');
  if (ctxPlans) {
    chartPlansInstance = new Chart(ctxPlans.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['(paid) plan', 'unlocked account'],
        datasets: [{
          data: [planCounts.paid, planCounts.unlocked],
          backgroundColor: ['#6C5CE7', '#00D2FF'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: labelColor, boxWidth: 12 } } }
      }
    });
  }

  // 4. Payment Gateway Trends Chart
  const ctxTrends = document.getElementById('chart-trends');
  if (ctxTrends) {
    chartTrendsInstance = new Chart(ctxTrends.getContext('2d'), {
      type: 'polarArea',
      data: {
        labels: Object.keys(gatewayCounts),
        datasets: [{
          data: Object.values(gatewayCounts),
          backgroundColor: [
            'rgba(108, 92, 231, 0.6)',
            'rgba(0, 210, 255, 0.6)',
            'rgba(0, 196, 140, 0.6)',
            'rgba(253, 203, 110, 0.6)'
          ],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { color: labelColor, boxWidth: 12 } } },
        scales: {
          r: { grid: { color: gridColor }, ticks: { color: tickColor, backdropColor: 'transparent' } }
        }
      }
    });
  }
}


// ── Settings Management ──
function renderSettingsForm() {
  const genSettings = allSettings['general'] || {};
  const gateSettings = allSettings['gateways'] || {};
  const emailSettings = allSettings['email_sms'] || {};
  const legalSettings = allSettings['legal'] || {};

  // Form elements bindings
  const nameEl = document.getElementById('settings-platform-name');
  if (nameEl) nameEl.value = genSettings.platform_name || 'PG Builders';
  
  const gstEl = document.getElementById('settings-gst-rate');
  if (gstEl) gstEl.value = genSettings.gst_rate || 18;

  const trialEl = document.getElementById('settings-free-trial');
  if (trialEl) trialEl.value = genSettings.free_trial_days || 30;

  const emailEl = document.getElementById('settings-contact-email');
  if (emailEl) emailEl.value = genSettings.contact_email || 'support@pgbuilders.in';

  const phoneEl = document.getElementById('settings-contact-phone');
  if (phoneEl) phoneEl.value = genSettings.contact_phone || '+91 9876543210';

  const privacyEl = document.getElementById('settings-privacy');
  if (privacyEl) privacyEl.value = legalSettings.privacy_policy || '';

  const termsEl = document.getElementById('settings-terms');
  if (termsEl) termsEl.value = legalSettings.terms_conditions || '';

  // Gateways
  const razorEnable = document.getElementById('gate-enable-razorpay');
  if (razorEnable) razorEnable.checked = !!gateSettings.razorpay?.enabled;

  const razorId = document.getElementById('gate-razorpay-id');
  if (razorId) razorId.value = gateSettings.razorpay?.key_id || '';

  const razorSec = document.getElementById('gate-razorpay-secret');
  if (razorSec) razorSec.value = gateSettings.razorpay?.key_secret || '';

  const stripeEnable = document.getElementById('gate-enable-stripe');
  if (stripeEnable) stripeEnable.checked = !!gateSettings.stripe?.enabled;

  const stripeId = document.getElementById('gate-stripe-id');
  if (stripeId) stripeId.value = gateSettings.stripe?.publishable_key || '';

  const stripeSec = document.getElementById('gate-stripe-secret');
  if (stripeSec) stripeSec.value = gateSettings.stripe?.secret_key || '';

  // SMTP Settings
  const hostEl = document.getElementById('settings-smtp-host');
  if (hostEl) hostEl.value = emailSettings.smtp_host || 'smtp.mailtrap.io';

  const portEl = document.getElementById('settings-smtp-port');
  if (portEl) portEl.value = emailSettings.smtp_port || 2525;

  const userEl = document.getElementById('settings-smtp-user');
  if (userEl) userEl.value = emailSettings.smtp_user || '';

  const passEl = document.getElementById('settings-smtp-pass');
  if (passEl) passEl.value = emailSettings.smtp_pass || '';
}

// General and Legal Settings submit
async function handleSaveGeneralSettings(event) {
  event.preventDefault();
  const nameVal = document.getElementById('settings-platform-name').value.trim();
  const gstVal = parseInt(document.getElementById('settings-gst-rate').value) || 0;
  const trialVal = parseInt(document.getElementById('settings-free-trial').value) || 0;
  const emailVal = document.getElementById('settings-contact-email').value.trim();
  const phoneVal = document.getElementById('settings-contact-phone').value.trim();
  const privacyVal = document.getElementById('settings-privacy').value.trim();
  const termsVal = document.getElementById('settings-terms').value.trim();

  try {
    // 1. Update general settings
    const generalJSON = {
      platform_name: nameVal,
      gst_rate: gstVal,
      free_trial_days: trialVal,
      contact_email: emailVal,
      contact_phone: phoneVal
    };
    const { error: errGen } = await supabase
      .from('platform_settings')
      .upsert({ key: 'general', value: generalJSON });

    if (errGen) throw errGen;

    // 2. Update legal settings
    const legalJSON = {
      privacy_policy: privacyVal,
      terms_conditions: termsVal,
      refund_policy: allSettings.legal?.refund_policy || 'Standard refund policy applies.'
    };
    const { error: errLeg } = await supabase
      .from('platform_settings')
      .upsert({ key: 'legal', value: legalJSON });

    if (errLeg) throw errLeg;

    showToast('Settings Saved', 'Branding, GST and policies updated.', 'success');
    logAdminAction('Saved General & Legal platform settings', 'Settings');
    await loadAllData();
  } catch (err) {
    showToast('Failed to Save', err.message || String(err), 'error');
  }
}

// Save gateways & SMTP settings
async function handleSaveGatewaySettings(event) {
  event.preventDefault();
  const razorEnable = document.getElementById('gate-enable-razorpay').checked;
  const razorId = document.getElementById('gate-razorpay-id').value.trim();
  const razorSec = document.getElementById('gate-razorpay-secret').value.trim();

  const stripeEnable = document.getElementById('gate-enable-stripe').checked;
  const stripeId = document.getElementById('gate-stripe-id').value.trim();
  const stripeSec = document.getElementById('gate-stripe-secret').value.trim();

  const smtpHost = document.getElementById('settings-smtp-host').value.trim();
  const smtpPort = parseInt(document.getElementById('settings-smtp-port').value) || 587;
  const smtpUser = document.getElementById('settings-smtp-user').value.trim();
  const smtpPass = document.getElementById('settings-smtp-pass').value.trim();

  try {
    // 1. Gateways JSON update
    const gatewayJSON = {
      razorpay: { enabled: razorEnable, key_id: razorId, key_secret: razorSec },
      stripe: { enabled: stripeEnable, publishable_key: stripeId, secret_key: stripeSec },
      cashfree: allSettings.gateways?.cashfree || { enabled: false, app_id: '', secret_key: '' },
      paypal: allSettings.gateways?.paypal || { enabled: false, client_id: '', secret_key: '' }
    };
    const { error: errGate } = await supabase
      .from('platform_settings')
      .upsert({ key: 'gateways', value: gatewayJSON });

    if (errGate) throw errGate;

    // 2. Email Server SMTP update
    const smtpJSON = {
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_user: smtpUser,
      smtp_pass: smtpPass,
      sms_gateway: allSettings.email_sms?.sms_gateway || 'Twilio'
    };
    const { error: errSmtp } = await supabase
      .from('platform_settings')
      .upsert({ key: 'email_sms', value: smtpJSON });

    if (errSmtp) throw errSmtp;

    showToast('Credentials Saved', 'Payment Gateways & SMTP configurations updated.', 'success');
    logAdminAction('Saved Payment Gateways and SMTP server details', 'Settings');
    await loadAllData();
  } catch (err) {
    showToast('Failed to Save', err.message || String(err), 'error');
  }
}


// ── System Security Audit Logging ──
async function logAdminAction(actionDetail, moduleName) {
  try {
    const name = session.user.user_metadata?.name || 'Super Admin';
    const { error } = await supabase
      .from('audit_logs')
      .insert({
        admin_name: name,
        action: actionDetail,
        module: moduleName,
        ip_address: 'localhost' // mock IP address
      });

    if (error) throw error;
  } catch (err) {
    console.error('Audit log failure:', err);
  }
}

// Render audits view
function renderAuditLogsTable() {
  const tbody = document.getElementById('audit-table-body');
  if (!tbody) return;

  if (allAuditLogs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted" style="padding: 24px;">No audit records stored</td></tr>`;
    return;
  }

  tbody.innerHTML = allAuditLogs.map(log => `
    <tr>
      <td>${formatDate(log.created_at)}</td>
      <td><strong>${log.admin_name}</strong></td>
      <td><span class="admin-badge admin-badge-warning">${log.module}</span></td>
      <td>${log.action}</td>
    </tr>
  `).join('');
}

// Clear Audit logs
async function clearSystemAuditLogs() {
  if (!confirm('Are you sure you want to permanently clear all security audit logs? This action is tracked in the database.')) return;

  try {
    const { error } = await supabase.from('audit_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;

    showToast('Logs Cleared', 'System audit logs cleared successfully.', 'success');
    await logAdminAction('Cleared security logs history', 'Audit Logs');
    await loadAllData();
  } catch (err) {
    showToast('Failed to Clear', err.message, 'error');
  }
}

// ── Tenant Management operations ──

// Render Tenants Directory
function renderTenantsTable(data = allTenants) {
  const tbody = document.getElementById('tenants-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 24px;">No tenants found</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(tenant => {
    const landlordName = allLandlords.find(o => o.id === tenant.owner_id)?.name || 'N/A';
    const buildingName = allBuildings.find(b => b.id === tenant.building_id)?.name || 'N/A';
    const roomNumber = allRooms.find(r => r.id === tenant.room_id)?.room_number || 'N/A';

    const joinDateStr = tenant.join_date ? formatDate(tenant.join_date) : 'N/A';
    
    let statusClass = 'admin-badge-warning';
    if (tenant.status === 'active') statusClass = 'admin-badge-success';
    if (tenant.status === 'rejected' || tenant.status === 'vacated') statusClass = 'admin-badge-danger';
    if (tenant.status === 'vacating') statusClass = 'admin-badge-warning';
    if (tenant.status === 'pending') statusClass = 'admin-badge-info';

    return `
      <tr>
        <td><strong>${tenant.name || 'Anonymous'}</strong></td>
        <td>
          <div style="font-size: var(--font-xs);">${tenant.email}</div>
          <div style="font-size: var(--font-xs); color: var(--text-muted);">${tenant.phone || 'No Phone'}</div>
        </td>
        <td>${tenant.aadhaar_number || 'N/A'}</td>
        <td>
          <div>${buildingName}</div>
          <div style="font-size: var(--font-xs); color: var(--text-muted);">Room: ${roomNumber}</div>
        </td>
        <td>${landlordName}</td>
        <td>${joinDateStr}</td>
        <td><span class="admin-badge ${statusClass}">${tenant.status || 'pending'}</span></td>
        <td style="text-align: right;">
          <button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background: #c0392b; display: inline-flex; align-items: center; gap: 4px;" onclick="deleteTenantPermanently('${tenant.id}')">${ICONS.trash()} Remove</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Permanent Tenant Deletion
async function deleteTenantPermanently(tenantId) {
  const tenant = allTenants.find(t => t.id === tenantId);
  if (!tenant) return;

  if (!confirm(`CRITICAL ACTION: Are you sure you want to PERMANENTLY remove tenant ${tenant.name}? This will check them out, remove them from their room, delete their profile record, and they will need to register or be re-added again. This action is irreversible!`)) return;

  try {
    const { error } = await supabase.from('tenants').delete().eq('id', tenantId);
    if (error) throw error;

    showToast('Tenant Removed', `${tenant.name} record has been permanently deleted.`, 'success');
    logAdminAction(`Permanently deleted tenant account: ${tenant.name}`, 'Tenants');
    await loadAllData();
  } catch (err) {
    showToast('Removal Failed', err.message || String(err), 'error');
  }
}

// Filter Tenants directory
function filterTenantsTable() {
  const search = document.getElementById('tenant-search').value.toLowerCase().trim();
  const status = document.getElementById('tenant-filter-status').value;

  const filtered = allTenants.filter(tenant => {
    const landlordName = allLandlords.find(o => o.id === tenant.owner_id)?.name || '';
    const buildingName = allBuildings.find(b => b.id === tenant.building_id)?.name || '';
    
    const matchesSearch = 
      (tenant.name && tenant.name.toLowerCase().includes(search)) || 
      (tenant.email && tenant.email.toLowerCase().includes(search)) || 
      (tenant.phone && tenant.phone.toLowerCase().includes(search)) ||
      (landlordName.toLowerCase().includes(search)) ||
      (buildingName.toLowerCase().includes(search));

    const matchesStatus = (status === 'all') || (tenant.status === status);

    return matchesSearch && matchesStatus;
  });

  renderTenantsTable(filtered);
}

// Delete payment permanently
async function deletePaymentPermanently(paymentId) {
  const payment = allPayments.find(p => p.id === paymentId);
  if (!payment) return;

  if (!confirm(`Are you sure you want to PERMANENTLY delete transaction ${payment.transaction_id || 'TXN-DIRECT'}? This action is irreversible!`)) return;

  try {
    const { error } = await supabase.from('payments').delete().eq('id', paymentId);
    if (error) throw error;

    showToast('Payment Deleted', 'Transaction record has been permanently deleted.', 'success');
    logAdminAction(`Permanently deleted payment record: ${payment.transaction_id || paymentId}`, 'Payments');
    await loadAllData();
  } catch (err) {
    showToast('Deletion Failed', err.message || String(err), 'error');
  }
}

// Render Archives Directory
function renderArchivesTable(data = allArchives) {
  const tbody = document.getElementById('archives-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 24px;">No archived owners found</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(arch => {
    const bldsCount = Array.isArray(arch.buildings) ? arch.buildings.length : 0;
    const tenantsCount = Array.isArray(arch.tenants) ? arch.tenants.length : 0;
    const deletedDate = arch.deleted_at ? formatDate(arch.deleted_at) : 'N/A';
    const aadhaarVal = arch.aadhaar_number || '—';

    return `
      <tr>
        <td><strong>${arch.name || 'Anonymous'}</strong></td>
        <td>
          <div style="font-size: var(--font-xs);">${arch.email || '—'}</div>
          <div style="font-size: var(--font-xs); color: var(--text-muted);">${arch.phone || 'No Phone'}</div>
        </td>
        <td>${aadhaarVal}</td>
        <td><code style="color: var(--primary-light);">${arch.owner_key || '—'}</code></td>
        <td><span class="admin-badge admin-badge-info">${arch.deleted_by || 'Owner'}</span></td>
        <td>${deletedDate}</td>
        <td>${bldsCount} Buildings</td>
        <td>${tenantsCount} Tenants</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 4px; justify-content: flex-end;">
            <button class="admin-btn admin-btn-secondary" style="padding: 4px 8px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;" onclick="openArchiveDetailsModal('${arch.id}')">${ICONS.eye()} View Data</button>
            <button class="admin-btn admin-btn-danger" style="padding: 4px 8px; font-size: 11px; background: #c0392b; display: inline-flex; align-items: center; justify-content: center;" onclick="deleteArchivePermanently('${arch.id}')">${ICONS.trash()}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Filter Archives Table
function filterArchivesTable() {
  const search = document.getElementById('archive-search').value.toLowerCase().trim();

  const filtered = allArchives.filter(arch => {
    const buildingsList = Array.isArray(arch.buildings) ? arch.buildings : [];
    const locationsString = buildingsList.map(b => b.location || '').join(' ').toLowerCase();

    return (arch.name && arch.name.toLowerCase().includes(search)) || 
           (arch.email && arch.email.toLowerCase().includes(search)) || 
           (arch.phone && arch.phone.toLowerCase().includes(search)) || 
           (arch.owner_key && arch.owner_key.toLowerCase().includes(search)) ||
           locationsString.includes(search);
  });

  renderArchivesTable(filtered);
}

// Open Archive Details Modal
function openArchiveDetailsModal(archiveId) {
  const arch = allArchives.find(a => a.id === archiveId);
  if (!arch) return;

  const modalBody = document.getElementById('archive-modal-body');
  if (!modalBody) return;

  const buildingsList = Array.isArray(arch.buildings) ? arch.buildings : [];
  const tenantsList = Array.isArray(arch.tenants) ? arch.tenants : [];

  let buildingsHtml = '';
  if (buildingsList.length === 0) {
    buildingsHtml = '<p class="text-muted" style="font-size: var(--font-sm);">No buildings archived for this landlord.</p>';
  } else {
    buildingsHtml = buildingsList.map(b => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 12px; margin-bottom: 8px;">
        <div style="font-weight:700; color: var(--primary-light);">${b.name || 'Unnamed Property'}</div>
        <div style="font-size: var(--font-xs); color: var(--text-muted); margin-bottom: 4px;">Location: ${b.location || 'N/A'} • Type: ${b.type || 'N/A'}</div>
        <div style="font-size: var(--font-xs);">Elec Rate: ₹${b.electricity_rate || 0}/unit • Advance: ₹${b.advance_amount || 0} • Maintenance: ₹${b.maintenance_charge || 0}</div>
      </div>
    `).join('');
  }

  let tenantsHtml = '';
  if (tenantsList.length === 0) {
    tenantsHtml = '<p class="text-muted" style="font-size: var(--font-sm);">No tenants archived for this landlord.</p>';
  } else {
    tenantsHtml = tenantsList.map(t => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 12px; margin-bottom: 8px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
          <span style="font-weight:700;">${t.name || 'Unnamed Tenant'}</span>
          <span class="admin-badge ${t.status === 'active' ? 'admin-badge-success' : 'admin-badge-warning'}" style="font-size: 10px; padding: 2px 6px;">${t.status || 'N/A'}</span>
        </div>
        <div style="font-size: var(--font-xs); color: var(--text-muted);">Phone: ${t.phone || 'N/A'} • Email: ${t.email || 'N/A'}</div>
        <div style="font-size: var(--font-xs); color: var(--text-muted);">Aadhaar: ${t.aadhaar_number || 'N/A'}</div>
        <div style="font-size: var(--font-xs); margin-top: 4px;">Joined: ${t.join_date || 'N/A'} • Advance Paid: ₹${t.advance_paid || 0}</div>
      </div>
    `).join('');
  }

  modalBody.innerHTML = `
    <div class="settings-grid" style="display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: 16px;">
      <div style="background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px;">
        <h4 style="margin-top: 0; color: var(--primary-light); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px;">Landlord Profile Information</h4>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; font-size: var(--font-sm); margin-top: 12px;">
          <div><strong>Name:</strong> ${arch.name || 'N/A'}</div>
          <div><strong>Email:</strong> ${arch.email || 'N/A'}</div>
          <div><strong>Phone:</strong> ${arch.phone || 'N/A'}</div>
          <div><strong>Aadhaar Number:</strong> ${arch.aadhaar_number || 'N/A'}</div>
          <div><strong>Owner Key:</strong> <code style="color: var(--primary-light);">${arch.owner_key || 'N/A'}</code></div>
          <div><strong>Deleted By:</strong> ${arch.deleted_by || 'Owner'}</div>
          <div><strong>Deleted At:</strong> ${arch.deleted_at ? formatDate(arch.deleted_at) : 'N/A'}</div>
        </div>
      </div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
      <div>
        <h4 style="color: var(--primary-light); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 12px;">Archived Buildings (${buildingsList.length})</h4>
        <div style="max-height: 350px; overflow-y: auto; padding-right: 4px;">
          ${buildingsHtml}
        </div>
      </div>
      <div>
        <h4 style="color: var(--primary-light); border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 12px;">Archived Tenants (${tenantsList.length})</h4>
        <div style="max-height: 350px; overflow-y: auto; padding-right: 4px;">
          ${tenantsHtml}
        </div>
      </div>
    </div>
  `;

  document.getElementById('modal-archive-details').classList.add('active');
}

// Delete Archive permanently
async function deleteArchivePermanently(archiveId) {
  if (!confirm('Are you sure you want to PERMANENTLY delete this archive record? This action is irreversible.')) return;
  try {
    const { error } = await supabase.from('deleted_owners_archive').delete().eq('id', archiveId);
    if (error) throw error;
    showToast('Success', 'Archive record deleted permanently.', 'success');
    await loadAllData();
  } catch (err) {
    showToast('Failed to Delete', err.message, 'error');
  }
}

// ── Plan Configuration Form Render ──
function renderPlanConfigForm() {
  const subConfig = allSettings['subscription'] || {
    price_per_building: 5,
    gst_rate: 18,
    yearly_discount_months: 1,
    enable_yearly_plan: true
  };
  
  const priceInput = document.getElementById('plan-price-building');
  const discountSelect = document.getElementById('plan-discount-months');
  const gstInput = document.getElementById('plan-gst-rate');
  const enableYearlyCheckbox = document.getElementById('plan-enable-yearly');

  if (priceInput) priceInput.value = subConfig.price_per_building;
  if (discountSelect) discountSelect.value = subConfig.yearly_discount_months;
  if (gstInput) gstInput.value = subConfig.gst_rate;
  if (enableYearlyCheckbox) {
    enableYearlyCheckbox.checked = subConfig.enable_yearly_plan !== false;
  }

  calculatePreviewPrices();
  initExpirySimulatorUI();
}

// ── Interactive Price Calculator Live Preview ──
function calculatePreviewPrices() {
  const priceInput = document.getElementById('plan-price-building');
  const discountSelect = document.getElementById('plan-discount-months');
  const gstInput = document.getElementById('plan-gst-rate');
  const simInput = document.getElementById('sim-building-count');
  const enableYearlyCheckbox = document.getElementById('plan-enable-yearly');

  if (!priceInput || !discountSelect || !gstInput || !simInput) return;

  const enableYearly = enableYearlyCheckbox ? enableYearlyCheckbox.checked : true;
  discountSelect.disabled = !enableYearly;

  const pricePerBuilding = parseFloat(priceInput.value) || 0;
  const yearlyDiscountMonths = parseInt(discountSelect.value) || 0;
  const gstRate = parseFloat(gstInput.value) || 0;
  const buildingCount = parseInt(simInput.value) || 0;

  // Monthly Cycle breakdown
  const monSubtotal = pricePerBuilding * buildingCount;
  const monGst = Math.round(monSubtotal * (gstRate / 100));
  const monTotal = monSubtotal + monGst;

  // Yearly Cycle breakdown
  const yearlyMonthsToPay = Math.max(0, 12 - yearlyDiscountMonths);
  const yrSubtotal = pricePerBuilding * buildingCount * yearlyMonthsToPay;
  const yrGst = Math.round(yrSubtotal * (gstRate / 100));
  const yrTotal = yrSubtotal + yrGst;

  // Savings (monthly total * 12 vs yearly total)
  const fullYearlyCostWithoutDiscount = monTotal * 12;
  const savings = Math.max(0, fullYearlyCostWithoutDiscount - yrTotal);

  // Update UI Elements
  const monSubEl = document.getElementById('val-mon-sub');
  const monGstEl = document.getElementById('val-mon-gst');
  const monTotEl = document.getElementById('val-mon-total');

  const yrSubEl = document.getElementById('val-yr-sub');
  const yrGstEl = document.getElementById('val-yr-gst');
  const yrTotEl = document.getElementById('val-yr-total');

  if (monSubEl) monSubEl.textContent = formatCurrency(monSubtotal);
  if (monGstEl) monGstEl.textContent = formatCurrency(monGst);
  if (monTotEl) monTotEl.textContent = formatCurrency(monTotal);

  if (yrSubEl) yrSubEl.textContent = formatCurrency(yrSubtotal);
  if (yrGstEl) yrGstEl.textContent = formatCurrency(yrGst);
  if (yrTotEl) yrTotEl.textContent = formatCurrency(yrTotal);

  const yrContainer = document.getElementById('preview-yearly-container');
  if (yrContainer) {
    if (!enableYearly) {
      yrContainer.style.opacity = '0.35';
      yrContainer.style.pointerEvents = 'none';
    } else {
      yrContainer.style.opacity = '1';
      yrContainer.style.pointerEvents = 'auto';
    }
  }

  const savingsTextEl = document.getElementById('val-savings-text');
  if (savingsTextEl) {
    if (!enableYearly) {
      savingsTextEl.textContent = 'Yearly plan is disabled.';
      const previewSavingsCard = document.getElementById('preview-savings-card');
      if (previewSavingsCard) {
        previewSavingsCard.style.borderColor = 'rgba(255,255,255,0.08)';
        previewSavingsCard.style.background = 'rgba(255,255,255,0.02)';
        previewSavingsCard.style.color = 'var(--text-muted)';
      }
    } else {
      savingsTextEl.textContent = `Yearly discount saves the landlord ${formatCurrency(savings)}!`;
      const previewSavingsCard = document.getElementById('preview-savings-card');
      if (previewSavingsCard) {
        previewSavingsCard.style.borderColor = 'rgba(46, 204, 113, 0.15)';
        previewSavingsCard.style.background = 'rgba(46, 204, 113, 0.08)';
        previewSavingsCard.style.color = 'var(--success)';
      }
    }
  }
}

// ── Save Subscription Plan Settings ──
async function savePlanConfig(event) {
  if (event) event.preventDefault();
  const priceInput = document.getElementById('plan-price-building');
  const discountSelect = document.getElementById('plan-discount-months');
  const gstInput = document.getElementById('plan-gst-rate');
  const enableYearlyCheckbox = document.getElementById('plan-enable-yearly');

  if (!priceInput || !discountSelect || !gstInput) return;

  const pricePerBuilding = parseFloat(priceInput.value) || 0;
  const yearlyDiscountMonths = parseInt(discountSelect.value) || 0;
  const gstRate = parseFloat(gstInput.value) || 0;
  const enableYearlyPlan = enableYearlyCheckbox ? enableYearlyCheckbox.checked : true;

  try {
    const subscriptionJSON = {
      price_per_building: pricePerBuilding,
      yearly_discount_months: yearlyDiscountMonths,
      gst_rate: gstRate,
      enable_yearly_plan: enableYearlyPlan
    };

    const { error } = await supabase
      .from('platform_settings')
      .upsert({ key: 'subscription', value: subscriptionJSON });

    if (error) throw error;

    showToast('Plan Settings Saved', 'Pricing, discounts and taxes updated successfully.', 'success');
    logAdminAction('Saved subscription plan configuration', 'Settings');
    await loadAllData();
  } catch (err) {
    showToast('Failed to Save', err.message || String(err), 'error');
  }
}

// ── Expiry Simulator Helper Functions ──

function initExpirySimulatorUI() {
  const dropdown = document.getElementById('sim-expiry-owner');
  if (dropdown) {
    const selectedVal = dropdown.value;
    dropdown.innerHTML = '<option value="">-- Choose a Landlord --</option>' + 
      allLandlords.map(o => {
        const typeSuffix = o.plan_type === 'Enterprise' ? ' (Enterprise - Lifetime)' : ' (Basic - Paid)';
        return `<option value="${o.id}">${o.name}${typeSuffix}</option>`;
      }).join('');
    if (selectedVal) dropdown.value = selectedVal;
  }

  const localActiveCheckbox = document.getElementById('sim-local-active');
  const localDaysSelect = document.getElementById('sim-local-days');

  if (localActiveCheckbox) {
    localActiveCheckbox.checked = localStorage.getItem('pgb_mock_expiry_active') === 'true';
  }
  if (localDaysSelect) {
    localDaysSelect.value = localStorage.getItem('pgb_mock_expiry_days') || '3';
  }
}

function saveLocalExpirySim() {
  const active = document.getElementById('sim-local-active').checked;
  const days = document.getElementById('sim-local-days').value;
  localStorage.setItem('pgb_mock_expiry_active', active ? 'true' : 'false');
  localStorage.setItem('pgb_mock_expiry_days', days);
  showToast('Local Simulator Updated', `Expiry mockup is now ${active ? 'ENABLED' : 'DISABLED'} (${days} days to expiry).`, 'info');
}

async function simulateExpiryDB(daysRemaining) {
  const dropdown = document.getElementById('sim-expiry-owner');
  if (!dropdown || !dropdown.value) {
    showToast('Simulation Failed', 'Please select a landlord to simulate.', 'warning');
    return;
  }

  const ownerId = dropdown.value;
  const landlord = allLandlords.find(o => o.id === ownerId);
  if (!landlord) return;

  // Calculate target expiry time based on mock choice
  let targetDate = null;
  let statusText = '';
  
  if (daysRemaining === -1) {
    // Clear/Extend by 30 days
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 30);
    statusText = 'extended for 30 days';
  } else if (daysRemaining === 3) {
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 3);
    targetDate.setMinutes(targetDate.getMinutes() + 5); // 5 min buffer to ensure in the 2-3 day window
    statusText = 'set to expire in 3 days';
  } else if (daysRemaining === 2) {
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 2);
    targetDate.setMinutes(targetDate.getMinutes() + 5);
    statusText = 'set to expire in 2 days';
  } else if (daysRemaining === 1) {
    targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    targetDate.setMinutes(targetDate.getMinutes() + 5);
    statusText = 'set to expire tomorrow';
  } else if (daysRemaining === 0) {
    targetDate = new Date();
    targetDate.setHours(targetDate.getHours() + 2); // 2 hours from now (expires today)
    statusText = 'set to expire today (in 2 hours)';
  }

  try {
    const { error } = await supabase
      .from('owners')
      .update({
        subscription_expiry: targetDate ? targetDate.toISOString() : null,
        subscription_status: 'active'
      })
      .eq('id', ownerId);

    if (error) throw error;

    showToast('DB Simulation Success', `Landlord subscription ${statusText}.`, 'success');
    logAdminAction(`Simulated subscription expiry for landlord ${landlord.name} (${statusText})`, 'Settings');
    
    // Refresh admin data
    await loadAllData();
  } catch (err) {
    showToast('Simulation Failed', err.message || String(err), 'error');
  }
}

// ── Refund Management ──
function renderRefundsTable(data = allRefunds) {
  const tbody = document.getElementById('refunds-table-body');
  if (!tbody) return;

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 24px;">No refund requests found</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(req => {
    const requestDate = req.created_at ? formatDate(req.created_at) : 'N/A';
    const paymentDate = req.payment_date ? formatDate(req.payment_date) : 'N/A';
    
    let statusClass = 'admin-badge-warning';
    if (req.status === 'approved') statusClass = 'admin-badge-success';
    if (req.status === 'rejected') statusClass = 'admin-badge-danger';

    const isPending = req.status === 'pending';

    return `
      <tr>
        <td><strong>${req.owner_name || 'N/A'}</strong></td>
        <td>${req.owner_email || 'N/A'}</td>
        <td><span class="admin-badge admin-badge-info">${req.plan_type || 'Monthly'}</span></td>
        <td>${paymentDate}</td>
        <td><strong style="color:var(--success)">₹${Number(req.refund_amount).toLocaleString('en-IN')}</strong></td>
        <td><span style="font-size: 12px; font-weight:600; color: #ff6b6b;">${req.reason || 'N/A'}</span></td>
        <td><span style="font-size: 11px; color: var(--text-muted); max-width: 200px; display: inline-block; white-space: normal; word-break: break-word;">${req.additional_comments || '—'}</span></td>
        <td>${requestDate}</td>
        <td><span class="admin-badge ${statusClass}">${req.status.toUpperCase()}</span></td>
        <td style="text-align: right; white-space: nowrap; width: 1%;">
          <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center;">
            ${isPending ? `
              <button class="admin-btn admin-btn-primary" style="background:#2ecc71; border:none; padding:4px 8px; font-size:11px;" onclick="handleApproveRefund('${req.id}', '${req.owner_id}')">Approve</button>
              <button class="admin-btn admin-btn-danger" style="background:#e74c3c; border:none; padding:4px 8px; font-size:11px;" onclick="handleRejectRefund('${req.id}')">Reject</button>
            ` : `
              <span style="font-size:11px; color: var(--text-muted); font-style:italic;">No Actions</span>
            `}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterRefundsTable() {
  const search = document.getElementById('refund-search').value.toLowerCase().trim();
  const status = document.getElementById('refund-filter-status').value;

  const filtered = allRefunds.filter(req => {
    const matchesSearch = 
      (req.owner_name && req.owner_name.toLowerCase().includes(search)) || 
      (req.owner_email && req.owner_email.toLowerCase().includes(search)) ||
      (req.reason && req.reason.toLowerCase().includes(search));

    const matchesStatus = (status === 'all') || (req.status === status);

    return matchesSearch && matchesStatus;
  });

  renderRefundsTable(filtered);
}

async function handleApproveRefund(requestId, ownerId) {
  const req = allRefunds.find(r => r.id === requestId);
  if (!req) return;

  const confirmApprove = confirm(`Are you sure you want to APPROVE the refund request of ₹${req.refund_amount} for "${req.owner_name}"?\n\nThis will suspend their account and lock their dashboard immediately. This action is irreversible!`);
  if (!confirmApprove) return;

  try {
    showToast('Processing...', 'Approving refund and suspending account...', 'info');

    // 1. Update refund request status to approved
    const { error: errReq } = await supabase
      .from('refund_requests')
      .update({ status: 'approved', updated_at: new Date().toISOString() })
      .eq('id', requestId);

    if (errReq) throw errReq;

    // 2. Suspend the owner's account (sets status to Suspended and subscription_status to expired)
    const { error: errOwner } = await supabase
      .from('owners')
      .update({ 
        status: 'Suspended',
        subscription_status: 'expired'
      })
      .eq('id', ownerId);

    if (errOwner) throw errOwner;

    showToast('Approved', 'Refund request approved. Owner account has been suspended.', 'success');
    logAdminAction(`Approved refund of ₹${req.refund_amount} and suspended account for landlord: ${req.owner_name}`, 'Payments');
    
    await loadAllData();

  } catch (err) {
    console.error('Error approving refund:', err);
    showToast('Failed', err.message || 'Failed to approve refund.', 'error');
  }
}

async function handleRejectRefund(requestId) {
  const req = allRefunds.find(r => r.id === requestId);
  if (!req) return;

  const confirmReject = confirm(`Are you sure you want to REJECT the refund request of ₹${req.refund_amount} for "${req.owner_name}"?`);
  if (!confirmReject) return;

  try {
    showToast('Processing...', 'Rejecting refund request...', 'info');

    // Update refund request status to rejected
    const { error } = await supabase
      .from('refund_requests')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', requestId);

    if (error) throw error;

    showToast('Rejected', 'Refund request rejected.', 'warning');
    logAdminAction(`Rejected refund request of ₹${req.refund_amount} for landlord: ${req.owner_name}`, 'Payments');
    
    await loadAllData();

  } catch (err) {
    console.error('Error rejecting refund:', err);
    showToast('Failed', err.message || 'Failed to reject refund.', 'error');
  }
}


