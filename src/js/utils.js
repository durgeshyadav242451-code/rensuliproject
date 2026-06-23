/* ═══════════════════════════════════════════════════
   PG Builders — Utility Functions
   ═══════════════════════════════════════════════════ */

import { ICONS } from './icons.js';

// ── Input Validators ──

/**
 * Validates a name field — only alphabets and spaces allowed, min 2 chars.
 * Returns an error string or null if valid.
 */
export function validateName(name) {
  if (!name || name.trim().length < 2) return 'Name must be at least 2 characters.';
  if (/[^a-zA-Z\s]/.test(name)) return 'Name must contain only alphabets (no numbers or symbols).';
  return null;
}

/**
 * Validates a phone field — exactly 10 digits, no letters.
 * Returns an error string or null if valid.
 */
export function validatePhone(phone, required = true) {
  if (!phone && !required) return null;
  if (!phone || phone.trim() === '') return 'Phone number is required.';
  if (!/^\d{10}$/.test(phone.trim())) return 'Phone number must be exactly 10 digits (numbers only).';
  return null;
}

/**
 * Validates an Aadhaar number — exactly 12 digits, optional/mandatory check.
 * Returns an error string or null if valid.
 */
export function validateAadhaar(aadhaar, required = true) {
  if (!aadhaar && !required) return null;
  if (!aadhaar || aadhaar.trim() === '') return 'Aadhaar number is required.';
  const clean = aadhaar.replace(/\s/g, '');
  if (!/^\d{12}$/.test(clean)) return 'Aadhaar number must be exactly 12 digits (numbers only).';
  return null;
}

/**
 * Attaches live input filtering on an Aadhaar <input> element:
 * - Strips any non-digit as the user types.
 * - Formats with space grouping: xxxx xxxx xxxx.
 * - Limits to 12 digits maximum (14 characters with spaces).
 */
export function attachAadhaarInput(el) {
  if (!el) return;
  el.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '').slice(0, 12);
    val = val.replace(/(\d{4})(?=\d)/g, '$1 ');
    e.target.value = val;
  });
}

/**
 * Attaches live input filtering on a name <input> element:
 * - Strips any digit or special character as the user types.
 */
export function attachNameInput(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const cursor = el.selectionStart;
    const cleaned = el.value.replace(/[^a-zA-Z\s]/g, '');
    if (el.value !== cleaned) {
      el.value = cleaned;
      el.setSelectionRange(cursor - 1, cursor - 1);
    }
  });
}

/**
 * Attaches live input filtering on a phone <input> element:
 * - Strips any non-digit as the user types.
 * - Limits to 10 digits maximum.
 */
export function attachPhoneInput(el) {
  if (!el) return;
  el.addEventListener('input', () => {
    const cursor = el.selectionStart;
    const digits = el.value.replace(/\D/g, '').slice(0, 10);
    if (el.value !== digits) {
      el.value = digits;
      el.setSelectionRange(Math.min(cursor, 10), Math.min(cursor, 10));
    }
  });
}


// ── Toast Notifications ──
let toastContainer = null;

export function initToasts() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
}

export function showToast(title, desc = '', type = 'info', duration = 3500) {
  initToasts();

  const icons = {
    info: ICONS.lightbulb('toast-icon-svg'),
    success: ICONS.success('toast-icon-svg'),
    warning: ICONS.alert('toast-icon-svg'),
    error: ICONS.error('toast-icon-svg'),
    payment: ICONS.coin('toast-icon-svg'),
    building: ICONS.building('toast-icon-svg')
  };

  const colors = {
    info: 'var(--primary)',
    success: 'var(--success)',
    warning: 'var(--warning-dark)',
    error: 'var(--danger)',
    payment: 'var(--accent)',
    building: 'var(--primary-light)'
  };

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.borderLeftColor = colors[type] || colors.info;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || icons.info}</span>
    <div class="toast-body">
      <div class="toast-title">${title}</div>
      ${desc ? `<div class="toast-desc">${desc}</div>` : ''}
    </div>
    <button class="toast-close" onclick="this.closest('.toast').remove()">×</button>
  `;

  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ── Currency Formatting ──
export function formatCurrency(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN');
}

export function parseCurrency(str) {
  return parseInt(String(str).replace(/[₹,\s]/g, '')) || 0;
}

// ── Date Formatting ──
export function formatDate(date) {
  if (!date) return '—';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '—';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatMonthYear(date) {
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric'
  });
}

export function getCurrentMonthYear() {
  return new Date().toISOString().slice(0, 7); // "2026-06"
}

// ── Sidebar Toggle (Mobile) ──
export function initSidebar() {
  const toggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');

  if (toggle && sidebar) {
    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay?.classList.toggle('active');
    });

    overlay?.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }
}

// ── Tab Switcher ──
export function switchTab(tabId, clickedEl) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));

  const tab = document.getElementById('tab-' + tabId);
  if (tab) tab.classList.add('active');

  if (clickedEl) {
    clickedEl.classList.add('active');
  } else {
    document.querySelectorAll('.menu-item').forEach(btn => {
      if (btn.dataset.tab === tabId) btn.classList.add('active');
    });
  }
}

// ── Modal Helpers ──
export function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('active');
}

export function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

// ── Generate Transaction ID ──
export function generateTxnId() {
  return 'TXN' + Date.now().toString().slice(-6) + Math.random().toString(36).slice(-4).toUpperCase();
}

// ── PDF Receipt Generator ──
export async function generateReceiptPDF(data) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  const formatPDFCurrency = (amount) => {
    return 'Rs. ' + Number(amount).toLocaleString('en-IN');
  };

  // Document Border / Frame
  doc.setDrawColor(230, 230, 235);
  doc.setLineWidth(0.5);
  doc.rect(10, 10, 190, 277);

  // Logo / Title banner
  doc.setFillColor(26, 26, 46);
  doc.rect(10, 10, 190, 30, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text('PG Builders', 20, 28);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text('Smart Property Management Platform', 20, 34);

  // Receipt Tag
  doc.setFillColor(108, 92, 231);
  doc.rect(145, 19, 45, 12, 'F');
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(255, 255, 255);
  doc.text('RENT RECEIPT', 167.5, 26.5, { align: 'center' });

  // Details section
  let y = 60;
  doc.setTextColor(60, 60, 67);
  doc.setFontSize(10);
  
  const addField = (label, val, x1, x2) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, x1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(val), x2, y);
  };

  addField('Tenant Name:', data.tenantName || '-', 20, 50);
  addField('Receipt No:', data.txnId ? data.txnId.substring(0, 12) : '-', 120, 148);
  y += 9;
  addField('Building Name:', data.buildingName || '-', 20, 50);
  addField('Billing Month:', data.month || '-', 120, 148);
  y += 9;
  addField('Room Number:', data.roomNumber || '-', 20, 50);
  addField('Payment Date:', data.date || '-', 120, 148);
  y += 15;

  // Table Header
  doc.setFillColor(245, 245, 250);
  doc.rect(20, y, 170, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('BILL ITEM DESCRIPTION', 25, y + 5.5);
  doc.text('AMOUNT', 185, y + 5.5, { align: 'right' });
  
  y += 8;
  
  // Table Rows
  const drawRow = (desc, val) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(40, 40, 40);
    doc.text(desc, 25, y + 6);
    doc.setFont('helvetica', 'bold');
    doc.text(formatPDFCurrency(val), 185, y + 6, { align: 'right' });
    doc.setDrawColor(240, 240, 245);
    doc.line(20, y + 10, 190, y + 10);
    y += 10;
  };

  drawRow('Monthly Base Room Rent', data.rent || 0);
  if (data.advance && data.advance > 0) {
    drawRow('Advance Security Deposit', data.advance);
  }
  if (data.electricity && data.electricity > 0) {
    drawRow('Electricity Utility Charges', data.electricity || 0);
  }
  drawRow('Maintenance & Amenities Charge', data.maintenance || 0);

  // Total Section
  y += 6;
  doc.setFillColor(245, 245, 255);
  doc.rect(100, y, 90, 15, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(26, 26, 46);
  doc.text('Total Paid Amount:', 105, y + 9.5);
  doc.setFontSize(12);
  doc.setTextColor(108, 92, 231);
  doc.text(formatPDFCurrency(data.total || 0), 185, y + 9.5, { align: 'right' });

  // Transaction info box
  y += 22;
  doc.setFillColor(250, 250, 252);
  doc.rect(20, y, 170, 24, 'F');
  doc.setDrawColor(230, 230, 235);
  doc.rect(20, y, 170, 24);
  
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 100, 100);
  doc.text('TRANSACTION DETAILS:', 25, y + 6);
  
  doc.setFont('helvetica', 'normal');
  doc.text(`Payment Method: ${data.method || 'UPI'}`, 25, y + 13);
  doc.text(`Full TXN ID: ${data.txnId || '-'}`, 25, y + 19);

  // Footer / Greeting
  y += 45;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(26, 26, 46);
  doc.text('Thank you for choosing PG Builders!', 105, y, { align: 'center' });
  
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 140, 140);
  doc.text('This is a digitally generated payment receipt. No physical signature is required.', 105, y + 6, { align: 'center' });

  doc.save(`PGBuilders_Receipt_${data.month || 'receipt'}.pdf`);
}

// ── Monthly Report PDF ──
export async function generateMonthlyReportPDF(data) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF();

  const formatPDFCurrency = (amount) => {
    return 'Rs. ' + Number(amount).toLocaleString('en-IN');
  };

  // Document Border / Frame
  doc.setDrawColor(230, 230, 235);
  doc.setLineWidth(0.5);
  doc.rect(10, 10, 190, 277);

  // Logo / Title banner
  doc.setFillColor(26, 26, 46);
  doc.rect(10, 10, 190, 30, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('PG Builders — Monthly Income Report', 20, 28);
  
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(180, 180, 180);
  doc.text('Automated Property Analytics & Revenue Sheet', 20, 34);

  // Details section
  let y = 60;
  doc.setTextColor(60, 60, 67);
  doc.setFontSize(10);
  
  const addField = (label, val, x1, x2) => {
    doc.setFont('helvetica', 'bold');
    doc.text(label, x1, y);
    doc.setFont('helvetica', 'normal');
    doc.text(String(val), x2, y);
  };

  addField('Building Name:', data.buildingName || '-', 20, 52);
  addField('Report Month:', data.month || '-', 120, 148);
  y += 9;
  addField('Property Owner:', data.ownerName || '-', 20, 52);
  addField('Generated On:', new Date().toLocaleDateString('en-IN'), 120, 148);
  y += 15;

  // Occupancy Stats Section
  doc.setFillColor(245, 245, 250);
  doc.rect(20, y, 170, 20, 'F');
  doc.setDrawColor(220, 220, 225);
  doc.rect(20, y, 170, 20);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 100, 100);
  doc.text('OCCUPANCY METRICS', 25, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(40, 40, 40);
  doc.text(`Total Rooms: ${data.totalRooms}`, 25, y + 14);
  doc.text(`Occupied: ${data.occupiedRooms}`, 85, y + 14);
  doc.text(`Vacant: ${data.vacantRooms}`, 140, y + 14);

  y += 30;

  // Table Header
  doc.setFillColor(245, 245, 250);
  doc.rect(20, y, 170, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  doc.text('INCOME / EXPENSE BREAKDOWN', 25, y + 5.5);
  doc.text('AMOUNT', 185, y + 5.5, { align: 'right' });
  
  y += 8;

  // Table Rows
  const drawRow = (desc, val, isBold = false) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(26, 26, 46);
    doc.text(desc, 25, y + 6);
    doc.text(formatPDFCurrency(val), 185, y + 6, { align: 'right' });
    doc.setDrawColor(240, 240, 245);
    doc.line(20, y + 10, 190, y + 10);
    y += 10;
  };

  drawRow('Base Room Rent Collected', data.totalRent, true);
  drawRow('Electricity Utility Collection', data.totalElectricity);
  drawRow('Maintenance Charges Collection', data.totalMaintenance);
  drawRow('Gross Collected Revenue', data.grossIncome, true);
  drawRow('Total Monthly Expenses', data.totalExpenses);

  // Profit / Net Margin Section
  y += 10;
  const profit = (data.grossIncome || 0) - (data.totalExpenses || 0);
  doc.setFillColor(245, 245, 255);
  doc.rect(100, y, 90, 15, 'F');
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(26, 26, 46);
  doc.text('Net Monthly Profit:', 105, y + 9.5);
  
  doc.setFontSize(12);
  if (profit >= 0) {
    doc.setTextColor(0, 196, 140); // Emerald Green
  } else {
    doc.setTextColor(255, 107, 107); // Soft Coral Red
  }
  doc.text(formatPDFCurrency(profit), 185, y + 9.5, { align: 'right' });
  doc.setTextColor(0, 0, 0);

  // Footer / Disclaimer
  y = 265;
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(140, 140, 140);
  doc.text('Report processed automatically by PG Builders Cloud Analytics Platform.', 105, y, { align: 'center' });
  doc.text('All calculations are subject to active owner approvals and tenant payment confirmations.', 105, y + 5, { align: 'center' });

  doc.save(`PGBuilders_Report_${data.buildingName}_${data.month}.pdf`);
}

// ── WhatsApp Message Sender ──
export function sendWhatsAppReminder(phone, message) {
  const cleanPhone = String(phone).replace(/\D/g, '');
  const fullPhone = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
  const url = `https://api.whatsapp.com/send?phone=${fullPhone}&text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

// ── LocalStorage Fallback (when Supabase is not configured) ──
const LS_KEY = 'pgbuilders_local_db';

export function getLocalDB() {
  try {
    const data = localStorage.getItem(LS_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setLocalDB(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

// ── Debounce ──
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ── Supabase Missing Credentials Overlay ──
export function showConfigErrorOverlay() {
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(15, 15, 26, 0.97);
    backdrop-filter: blur(12px);
    z-index: 99999;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: #fff;
    font-family: 'Inter', sans-serif;
    padding: 30px;
    text-align: center;
  `;
  overlay.innerHTML = `
    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); padding: 40px; border-radius: 16px; max-width: 600px; box-shadow: 0 20px 50px rgba(0,0,0,0.6);">
      <div style="font-size: 64px; margin-bottom: 20px; color: var(--primary);">${ICONS.building('', '', '64px')}</div>
      <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 16px; color: #a29bfe;">Supabase Config Required</h2>
      <p style="font-size: 15px; color: #a0aec0; line-height: 1.6; margin-bottom: 24px;">
        To connect to your database, you must configure your Supabase credentials.<br/>
        Please create a <strong>.env</strong> file in your project root folder and add:
      </p>
      <pre style="background: #0d0d16; border: 1px solid #2d2d3a; color: #a29bfe; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 13px; text-align: left; margin-bottom: 24px; overflow-x: auto;">
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here</pre>
      <p style="font-size: 13px; color: #718096; margin-top: 10px;">
        After saving the <strong>.env</strong> file, restart your Vite development server.
      </p>
    </div>
  `;
  document.body.appendChild(overlay);
}

/** Formats errors nicely for the user, explaining network/adblocker blocks */
export function getReadableErrorMessage(error) {
  if (!error) return 'An unknown error occurred.';
  const msg = error.message || String(error);
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('fetch')) {
    return 'Connection Blocked: Your browser, Ad-blocker, or Brave Shields is blocking requests to Supabase Auth/Database APIs. Please disable ad-blockers or shields for this website and try again.';
  }
  return msg;
}

export function getFloorLabel(floorNumber) {
  const num = parseInt(floorNumber);
  if (isNaN(num)) {
    return String(floorNumber);
  }
  return num === 0 ? 'Ground Floor' : `Floor ${num}`;
}

