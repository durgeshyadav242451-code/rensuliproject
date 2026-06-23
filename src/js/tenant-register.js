/* ═══════════════════════════════════════════════════
   PG Builders — Tenant Registration v2 (Smart Flow)
   ═══════════════════════════════════════════════════ */
import { isConfigured, supabase, getOwnerByKey, signInWithGoogle, getSession } from './supabase-config.js';
import { showToast, showConfigErrorOverlay, formatCurrency, getReadableErrorMessage, validateName, validatePhone, attachNameInput, attachPhoneInput, getFloorLabel, validateAadhaar, attachAadhaarInput } from './utils.js';
import { ICONS } from './icons.js';

// ─── State ───
let selectedOwner = null;
let selectedBuilding = null;
let selectedRoom = null;
let members = [];
let existingTenantProfile = null; // For returning tenants
let isReturningTenant = false;
let currentStep = 0; // 0=login, 1=details, 2=key, 3=select, 4=members

// ─── Step Indicator ───
function updateStepDots(activeStep) {
  // activeStep: 0=login, 1=details, 2=key, 3=select, 4=members
  const totalDots = 4; // We show 4 dots for steps 1-4 (login is before dots)
  for (let i = 0; i < totalDots; i++) {
    const dot = document.getElementById(`dot-${i}`);
    if (!dot) continue;
    dot.className = 'step-dot';
    if (i < activeStep - 1) dot.classList.add('done');
    else if (i === activeStep - 1) dot.classList.add('active');
  }
  currentStep = activeStep;
}

function showStep(stepId, dotIndex) {
  ['step-login', 'step-details', 'step-key', 'step-select', 'step-members', 'step-pending'].forEach(id => {
    document.getElementById(id)?.classList.add('hidden');
  });
  document.getElementById(stepId)?.classList.remove('hidden');
  document.getElementById('step-indicator')?.classList.toggle('hidden', stepId === 'step-login' || stepId === 'step-pending');
  if (dotIndex !== undefined) updateStepDots(dotIndex);

  // Auto-fill and submit Owner Key if pre-filled from QR code URL
  if (stepId === 'step-key') {
    const prefilledKey = localStorage.getItem('pgb_prefilled_owner_key');
    if (prefilledKey) {
      const keyInput = document.getElementById('tenant-key');
      if (keyInput) {
        keyInput.value = prefilledKey;
        localStorage.removeItem('pgb_prefilled_owner_key'); // clear to avoid repeat loops
        setTimeout(() => {
          handleFindOwner();
        }, 150);
      }
    }
  }
}

// ─── Step Navigation ───
window.goBack = function(showId, hideId) {
  document.getElementById(showId)?.classList.remove('hidden');
  document.getElementById(hideId)?.classList.add('hidden');
};

window.goBackFromKey = function() {
  if (isReturningTenant) {
    // Returning tenants came from login step
    showStep('step-login', 0);
  } else {
    showStep('step-details', 1);
  }
};

// ─── STEP 0: Google Login ───
window.handleGoogleLogin = async function() {
  const btn = document.getElementById('btn-google');
  btn.disabled = true;
  btn.textContent = 'Opening Google...';
  try {
    await signInWithGoogle();
    // After OAuth redirect, DOMContentLoaded will call checkSession()
  } catch (err) {
    showToast('Login Failed', getReadableErrorMessage(err), 'error');
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24"><path fill="#fff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#fff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#fff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Continue with Google`;
  }
};

// ─── STEP 0 → Check Session After Login ───
async function checkSession() {
  try {
    const session = await getSession();
    if (!session) {
      showStep('step-login', 0);
      return;
    }

    const userId = session.user.id;
    const userEmail = session.user.email;
    const googleName = session.user.user_metadata?.full_name || session.user.user_metadata?.name || '';

    // Look up existing tenant by auth_user_id
    let { data: profile } = await supabase
      .from('tenants')
      .select('*, members(*)')
      .eq('auth_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fallback: email match
    if (!profile) {
      const { data: emailProfiles } = await supabase
        .from('tenants')
        .select('*, members(*)')
        .eq('email', userEmail)
        .order('created_at', { ascending: false });

      if (emailProfiles && emailProfiles.length > 0) {
        profile = emailProfiles[0];
        // Auto-link auth_user_id
        await supabase.from('tenants').update({ auth_user_id: userId }).eq('id', profile.id);
        profile.auth_user_id = userId;
      }
    }

    // ── Case 1: Active/Pending tenant → go straight to dashboard ──
    if (profile && (profile.status === 'active' || profile.status === 'pending' || profile.status === 'vacating')) {
      window.location.href = '/tenant-dashboard.html';
      return;
    }

    // ── Case 2: Returning tenant (vacated/rejected) → skip detail step ──
    if (profile && (profile.status === 'vacated' || profile.status === 'rejected')) {
      existingTenantProfile = profile;
      isReturningTenant = true;

      // Show returning profile badge
      document.getElementById('returning-tag')?.classList.remove('hidden');
      document.getElementById('key-step-desc').textContent = 'Enter the new Owner Key to quickly register';

      const retProfile = document.getElementById('returning-profile');
      if (retProfile) {
        retProfile.classList.remove('hidden');
        document.getElementById('ret-name').textContent = profile.name;
        document.getElementById('ret-phone').textContent = profile.phone;
        const initials = profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
        document.getElementById('ret-avatar').textContent = initials;
      }

      showStep('step-key', 2);
      showToast('Welcome Back!', `${profile.name}, your details are saved. Just enter the new Owner Key!`, 'success');
      return;
    }

    // ── Case 3: Brand new user ──
    isReturningTenant = false;
    const nameInput = document.getElementById('info-name');
    const emailInput = document.getElementById('info-email');
    if (nameInput) nameInput.value = googleName;
    if (emailInput) emailInput.value = userEmail;

    showStep('step-details', 1);

  } catch (err) {
    console.error('Session check error:', err);
    showStep('step-login', 0);
  }
}

// ─── STEP 1: Validate Details → Go to Key ───
window.goToKeyStep = function() {
  const name = document.getElementById('info-name').value.trim();
  const phone = document.getElementById('info-phone').value.trim();
  const altPhone = document.getElementById('info-alt-phone').value.trim();
  const aadhaar = document.getElementById('info-aadhaar').value.trim();
  const agreeCheck = document.getElementById('info-terms-privacy');

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

  if (agreeCheck && !agreeCheck.checked) {
    showToast('Agreement Required', 'Please agree to the Terms & Conditions, Privacy Policy & Refund Policy to proceed.', 'warning');
    return;
  }

  showStep('step-key', 2);
};

// ─── STEP 2: Find Owner ───
window.handleFindOwner = async function() {
  const key = document.getElementById('tenant-key').value.trim().toUpperCase();
  if (!key) { showToast('Enter Key', 'Please enter the Owner Key', 'warning'); return; }

  const btn = document.getElementById('btn-find');
  btn.disabled = true;
  btn.textContent = 'Searching...';

  try {
    const owner = await getOwnerByKey(key);
    selectedOwner = owner;

    const { data: buildings } = await supabase
      .from('buildings')
      .select('*, floors(*, rooms(*))')
      .eq('owner_id', owner.id)
      .order('created_at', { ascending: true });

    selectedOwner.buildings = buildings || [];
    populateBuildings(buildings || []);
    document.getElementById('owner-name-display').textContent = owner.name;

    showStep('step-select', 3);
    showToast('Owner Found!', `${owner.name} — ${(buildings || []).length} buildings`, 'success');

  } catch (err) {
    showToast('Not Found', 'No owner found with this key. Please check and try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Find Buildings →';
  }
};

// ─── Populate Building Select ───
function populateBuildings(buildings) {
  const sel = document.getElementById('sel-building');
  sel.innerHTML = '<option value="">— Choose Building —</option>';
  buildings.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = `${b.name} (${b.type.toUpperCase()}) — ${b.location}`;
    sel.appendChild(opt);
  });
}

// ─── Building Change ───
window.onBuildingChange = function() {
  const buildingId = document.getElementById('sel-building').value;
  ['floor-group', 'room-group', 'bed-info', 'room-details'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

  if (!buildingId) return;
  selectedBuilding = selectedOwner.buildings.find(b => b.id === buildingId);
  if (!selectedBuilding) return;

  const floors = selectedBuilding.floors || [];
  const floorSel = document.getElementById('sel-floor');
  floorSel.innerHTML = '<option value="">— Choose Floor —</option>';
  floors.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = getFloorLabel(f.floor_number);
    floorSel.appendChild(opt);
  });
  document.getElementById('floor-group')?.classList.remove('hidden');
};

// ─── Floor Change ───
window.onFloorChange = function() {
  const floorId = document.getElementById('sel-floor').value;
  ['room-group', 'bed-info', 'room-details'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

  if (!floorId || !selectedBuilding) return;
  const floor = selectedBuilding.floors.find(f => f.id === floorId);
  if (!floor) return;

  const roomSel = document.getElementById('sel-room');
  roomSel.innerHTML = '<option value="">— Choose Room —</option>';
  const floorRooms = (floor.rooms || []).concat(
    (selectedBuilding.rooms || []).filter(r => r.floor_id === floorId)
  );
  const uniqueRoomsMap = new Map();
  floorRooms.forEach(r => uniqueRoomsMap.set(r.id, r));
  const rooms = Array.from(uniqueRoomsMap.values());
  rooms.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    const isPG = ['pg', 'hostel'].includes(selectedBuilding.type);
    let label = `Room ${r.room_number}`;

    if (isPG) {
      const splitEnabled = r.rent_split_enabled || selectedBuilding.rent_split_enabled;
      const rentToShow = splitEnabled && r.per_bed_rent ? r.per_bed_rent : (r.rent / r.beds_count);
      label += ` — ${formatCurrency(Math.round(rentToShow))}/bed`;
      const bedsAvail = r.beds_count - r.beds_occupied;
      if (bedsAvail <= 0) { label += ' (FULL)'; opt.disabled = true; }
      else label += ` (${bedsAvail} bed${bedsAvail > 1 ? 's' : ''} free)`;
    } else {
      label += ` — ${formatCurrency(r.rent)}/mo`;
      if (r.status === 'occupied') { label += ' (OCCUPIED)'; opt.disabled = true; }
    }
    opt.textContent = label;
    roomSel.appendChild(opt);
  });
  document.getElementById('room-group')?.classList.remove('hidden');
};

// ─── Room Change ───
window.onRoomChange = function() {
  const roomId = document.getElementById('sel-room').value;
  ['bed-info', 'room-details'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

  if (!roomId) return;
  let room = (selectedBuilding.rooms || []).find(r => r.id === roomId);
  if (!room) {
    for (const floor of selectedBuilding.floors) {
      room = (floor.rooms || []).find(r => r.id === roomId);
      if (room) break;
    }
  }
  if (!room) return;
  selectedRoom = room;

  const isPG = ['pg', 'hostel'].includes(selectedBuilding.type);

  // Bed info for PG
  if (isPG) {
    const avail = room.beds_count - room.beds_occupied;
    document.getElementById('beds-available').textContent = avail;
    document.getElementById('beds-total').textContent = room.beds_count;
    const dotsContainer = document.getElementById('bed-dots');
    if (dotsContainer) {
      dotsContainer.innerHTML = '';
      for (let i = 0; i < room.beds_count; i++) {
        const dot = document.createElement('span');
        dot.className = `bed-dot ${i < room.beds_occupied ? 'filled' : 'empty'}`;
        dot.title = i < room.beds_occupied ? 'Occupied' : 'Available';
        dotsContainer.appendChild(dot);
      }
    }
    document.getElementById('bed-info')?.classList.remove('hidden');
  }

  // Room details + rent split
  const splitEnabled = room.rent_split_enabled || selectedBuilding.rent_split_enabled;
  let rentDisplay = room.rent;
  if (isPG && splitEnabled) {
    const perBed = room.per_bed_rent || Math.round(room.rent / room.beds_count);
    rentDisplay = perBed;
    document.getElementById('room-per-bed-rent').textContent = `${formatCurrency(perBed)}/bed`;
    document.getElementById('room-rent').textContent = formatCurrency(room.rent) + ' (total room)';
    document.getElementById('split-rent-row')?.classList.remove('hidden');
  } else {
    document.getElementById('room-rent').textContent = formatCurrency(room.rent);
    document.getElementById('split-rent-row')?.classList.add('hidden');
  }

  const advanceAmount = room.advance_amount !== undefined && room.advance_amount !== null ? room.advance_amount : (selectedBuilding.advance_amount !== undefined && selectedBuilding.advance_amount !== null ? selectedBuilding.advance_amount : (selectedOwner.default_advance !== undefined && selectedOwner.default_advance !== null ? selectedOwner.default_advance : 5000));
  document.getElementById('room-advance').textContent = formatCurrency(advanceAmount);
  
  const maintIncluded = room.maintenance_included !== undefined ? room.maintenance_included : (selectedBuilding.maintenance_included || false);
  const maintCharge = room.maintenance_charge !== undefined && room.maintenance_charge !== null ? room.maintenance_charge : (selectedBuilding.maintenance_charge !== undefined && selectedBuilding.maintenance_charge !== null ? selectedBuilding.maintenance_charge : (selectedOwner.default_maintenance !== undefined && selectedOwner.default_maintenance !== null ? selectedOwner.default_maintenance : 500));
  const roomMaintEl = document.getElementById('room-maint');
  if (roomMaintEl) {
    roomMaintEl.textContent = maintIncluded ? 'Included in Rent' : formatCurrency(maintCharge);
  }

  document.getElementById('room-type').textContent = selectedBuilding.type.toUpperCase();
  document.getElementById('room-details')?.classList.remove('hidden');

  // Hide or show initial meter reading field based on electricity_included
  const meterGroup = document.getElementById('info-meter-group');
  if (meterGroup) {
    const elecIncluded = room.electricity_included || selectedBuilding.electricity_included || false;
    if (elecIncluded) {
      meterGroup.classList.add('hidden');
      const input = document.getElementById('info-meter');
      if (input) input.value = '';
    } else {
      meterGroup.classList.remove('hidden');
    }
  }
};

// ─── STEP 3 → Go to Members ───
window.goToMembersStep = function() {
  if (!selectedRoom) {
    showToast('Select Room', 'Please select a building and room first', 'warning');
    return;
  }

  // ── Electricity meter reading is MANDATORY if electricity is not included ──
  const meterGroup = document.getElementById('info-meter-group');
  const meterInput = document.getElementById('info-meter');
  const elecIncluded = selectedRoom.electricity_included || selectedBuilding?.electricity_included || false;

  if (!elecIncluded && meterGroup && !meterGroup.classList.contains('hidden')) {
    const meterVal = meterInput ? meterInput.value.trim() : '';
    if (meterVal === '' || isNaN(parseFloat(meterVal)) || parseFloat(meterVal) < 0) {
      // Highlight the input
      if (meterInput) {
        meterInput.style.borderColor = 'var(--danger, #ef4444)';
        meterInput.style.boxShadow = '0 0 0 2px rgba(239,68,68,0.25)';
        meterInput.focus();
        // Remove highlight after user starts typing
        meterInput.addEventListener('input', () => {
          meterInput.style.borderColor = '';
          meterInput.style.boxShadow = '';
        }, { once: true });
      }
      showToast('Meter Reading Required', 'Please enter the current electricity meter reading before proceeding.', 'warning');
      return;
    }
  }

  showStep('step-members', 4);
};


// ─── Toggle Members Section ───
window.toggleMembersSection = function() {
  const livingType = document.querySelector('input[name="living-type"]:checked')?.value;
  const section = document.getElementById('members-section');
  if (livingType === 'family') {
    section?.classList.remove('hidden');
    if (members.length === 0) addMemberRow();
  } else {
    section?.classList.add('hidden');
  }
};

// ─── Add Member Row ───
window.addMemberRow = function() {
  const idx = Date.now(); // Use timestamp as unique key
  members.push({ key: idx });

  const container = document.getElementById('members-list');
  const div = document.createElement('div');
  div.className = 'member-card';
  div.dataset.memberKey = idx;
  div.innerHTML = `
    <button class="remove-btn" onclick="window.removeMember(this)" style="display:flex;align-items:center;justify-content:center;padding:4px 8px;font-size:12px;gap:4px;">${ICONS.trash()} Remove</button>
    <div style="font-size: var(--font-xs); font-weight: 700; color: var(--text-secondary); margin-bottom: 10px;">Member</div>
    <div class="form-group">
      <input class="form-input" type="text" placeholder="Member Name *" data-field="name" style="font-size: var(--font-sm);" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <input class="form-input" type="tel" placeholder="Phone *" data-field="phone" style="font-size: var(--font-sm);" />
      </div>
      <div class="form-group">
        <input class="form-input" type="text" placeholder="Relation" data-field="relation" style="font-size: var(--font-sm);" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom: 0;">
      <input class="form-input" type="text" placeholder="Aadhaar *" data-field="aadhaar" maxlength="14" style="font-size: var(--font-sm);" />
    </div>
  `;
  container?.appendChild(div);

  const card = container.querySelector(`[data-member-key="${idx}"]`);
  if (card) {
    attachNameInput(card.querySelector('[data-field="name"]'));
    attachPhoneInput(card.querySelector('[data-field="phone"]'));
    attachAadhaarInput(card.querySelector('[data-field="aadhaar"]'));
  }
};

window.removeMember = function(btn) {
  const card = btn.closest('.member-card');
  const key = card?.dataset.memberKey;
  members = members.filter(m => String(m.key) !== String(key));
  card?.remove();
};

// ─── Collect Member Data from DOM ───
function collectMemberData() {
  const data = [];
  document.querySelectorAll('#members-list .member-card').forEach(card => {
    const name = card.querySelector('[data-field="name"]')?.value?.trim() || '';
    const phone = card.querySelector('[data-field="phone"]')?.value?.trim() || '';
    const relation = card.querySelector('[data-field="relation"]')?.value?.trim() || '';
    const aadhaar = card.querySelector('[data-field="aadhaar"]')?.value?.trim() || '';
    if (name) data.push({ name, phone, relation, aadhaar_number: aadhaar, is_active: true });
  });
  return data;
}

// ─── STEP 4: Submit Registration ───
window.handleSubmitRegistration = async function() {
  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  const livingType = document.querySelector('input[name="living-type"]:checked')?.value || 'alone';
  if (livingType === 'family') {
    const cards = document.querySelectorAll('#members-list .member-card');
    if (cards.length === 0) {
      showToast('Validation Error', 'Please add at least one member or select "Alone"', 'warning');
      btn.disabled = false;
      btn.textContent = 'Submit Registration Request →';
      return;
    }
    
    let memberErrors = [];
    cards.forEach((card, i) => {
      const name = card.querySelector('[data-field="name"]')?.value?.trim() || '';
      const phone = card.querySelector('[data-field="phone"]')?.value?.trim() || '';
      const aadhaar = card.querySelector('[data-field="aadhaar"]')?.value?.trim() || '';

      const nameErr = validateName(name);
      if (nameErr) memberErrors.push(`Member ${i+1}: ${nameErr}`);

      const phoneErr = validatePhone(phone, true);
      if (phoneErr) memberErrors.push(`Member ${i+1}: ${phoneErr}`);

      const aadhaarErr = validateAadhaar(aadhaar, true);
      if (aadhaarErr) memberErrors.push(`Member ${i+1}: ${aadhaarErr}`);
    });

    if (memberErrors.length > 0) {
      showToast('Validation Error', memberErrors[0], 'warning');
      btn.disabled = false;
      btn.textContent = 'Submit Registration Request →';
      return;
    }
  }

  try {
    const session = await getSession();
    if (!session) throw new Error('Session expired. Please login again.');

    const userId = session.user.id;
    const userEmail = session.user.email;
    const livingType = document.querySelector('input[name="living-type"]:checked')?.value || 'alone';
    const meterReading = parseFloat(document.getElementById('info-meter')?.value || 0) || 0;

    let tenantId;
    const isPG = ['pg', 'hostel'].includes(selectedBuilding?.type || '');
    const splitEnabled = selectedRoom?.rent_split_enabled || selectedBuilding?.rent_split_enabled;
    const rentToUse = (isPG && splitEnabled && selectedRoom?.per_bed_rent)
      ? selectedRoom.per_bed_rent
      : selectedRoom?.rent || 0;

    if (isReturningTenant && existingTenantProfile) {
      // Delete old members for returning tenant so they don't carry over
      await supabase.from('members').delete().eq('tenant_id', existingTenantProfile.id);

      // UPDATE existing tenant profile (returning tenant)
      const { error } = await supabase
        .from('tenants')
        .update({
          owner_id: selectedOwner.id,
          building_id: selectedBuilding.id,
          room_id: selectedRoom.id,
          status: 'pending',
          living_type: livingType,
          advance_paid: 0,
          initial_meter_reading: meterReading,
          current_meter_reading: meterReading,
          join_date: new Date().toISOString().split('T')[0],
          vacate_date: null,
          auth_user_id: userId
        })
        .eq('id', existingTenantProfile.id);

      if (error) throw error;
      tenantId = existingTenantProfile.id;

      // Log history entry
      await logTenantHistory(tenantId, selectedOwner.id, selectedBuilding.id, selectedRoom.id,
        selectedBuilding.name, selectedRoom.room_number,
        new Date().toISOString().split('T')[0]);

    } else {
      // INSERT new tenant
      const name = document.getElementById('info-name').value.trim();
      const phone = document.getElementById('info-phone').value.trim();
      const altPhone = document.getElementById('info-alt-phone').value.trim();
      const aadhaar = document.getElementById('info-aadhaar').value.trim();

      const { data: inserted, error } = await supabase
        .from('tenants')
        .insert({
          owner_id: selectedOwner.id,
          building_id: selectedBuilding.id,
          room_id: selectedRoom.id,
          auth_user_id: userId,
          name,
          phone,
          alt_phone: altPhone,
          email: userEmail,
          aadhaar_number: aadhaar,
          living_type: livingType,
          status: 'pending',
          advance_paid: 0,
          initial_meter_reading: meterReading,
          current_meter_reading: meterReading,
          join_date: new Date().toISOString().split('T')[0]
        })
        .select();

      if (error) throw error;
      tenantId = inserted[0].id;

      // Log history entry
      await logTenantHistory(tenantId, selectedOwner.id, selectedBuilding.id, selectedRoom.id,
        selectedBuilding.name, selectedRoom.room_number,
        new Date().toISOString().split('T')[0]);
    }

    // Insert NEW members (if any added in this step)
    const newMembers = collectMemberData();
    if (newMembers.length > 0) {
      await supabase.from('members').insert(
        newMembers.map(m => ({ ...m, tenant_id: tenantId }))
      );
    }

    // Update room beds_occupied
    const currentBeds = selectedRoom.beds_occupied || 0;
    const newBeds = Math.min(currentBeds + 1, selectedRoom.beds_count || 1);
    const newStatus = newBeds >= (selectedRoom.beds_count || 1) ? 'occupied' : (newBeds > 0 ? 'partial' : 'vacant');
    await supabase.from('rooms').update({
      beds_occupied: newBeds,
      status: newStatus
    }).eq('id', selectedRoom.id);

    localStorage.setItem('pgb_user_role', 'tenant');
    showToast('Submitted!', 'Request sent to owner. Redirecting...', 'success');

    setTimeout(() => {
      window.location.href = '/tenant-dashboard.html';
    }, 1500);

  } catch (err) {
    showToast('Submission Failed', getReadableErrorMessage(err), 'error');
    btn.disabled = false;
    btn.textContent = 'Submit Registration Request →';
  }
};

// ─── Log Tenant History ───
async function logTenantHistory(tenantId, ownerId, buildingId, roomId, buildingName, roomNumber, movedIn) {
  try {
    await supabase.from('tenant_history').insert({
      tenant_id: tenantId,
      owner_id: ownerId,
      building_id: buildingId,
      room_id: roomId,
      building_name: buildingName,
      room_number: roomNumber,
      moved_in: movedIn,
      reason: isReturningTenant ? 'Re-registration' : 'Initial registration'
    });
  } catch (err) {
    console.warn('Could not log tenant history:', err.message);
  }
}

// ─── DOMContentLoaded ───
document.addEventListener('DOMContentLoaded', () => {
  if (!isConfigured()) {
    showConfigErrorOverlay();
    return;
  }

  // Parse prefilled owner key from URL if scanning QR code
  const urlParams = new URLSearchParams(window.location.search);
  const keyParam = urlParams.get('key');
  if (keyParam) {
    localStorage.setItem('pgb_prefilled_owner_key', keyParam.toUpperCase().trim());
  }

  // Attach input formatters
  const aadhaarInput = document.getElementById('info-aadhaar');
  if (aadhaarInput) {
    aadhaarInput.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '').slice(0, 12);
      val = val.replace(/(\d{4})(?=\d)/g, '$1 ');
      e.target.value = val;
    });
  }
  attachNameInput(document.getElementById('info-name'));
  attachPhoneInput(document.getElementById('info-phone'));
  attachPhoneInput(document.getElementById('info-alt-phone'));

  // Check if user is already logged in
  checkSession();
});
