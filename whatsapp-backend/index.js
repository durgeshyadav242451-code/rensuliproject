import express from 'express';
import cors from 'cors';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';
import cron from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const { Client, LocalAuth } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Memory Stores
const clients = {}; // ownerId -> Client instance
const qrCodes = {}; // ownerId -> current QR code string
const connectionStatuses = {}; // ownerId -> 'disconnected' | 'connecting' | 'connected'

// Helper: Get or create client session
async function getOrCreateClient(ownerId) {
  if (clients[ownerId]) {
    return clients[ownerId];
  }

  console.log(`[Session] Initializing client for Owner ID: ${ownerId}`);
  connectionStatuses[ownerId] = 'connecting';
  await updateDbStatus(ownerId, 'connecting');

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: ownerId,
      dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', (qr) => {
    console.log(`[QR] Generated QR for Owner ID: ${ownerId}`);
    qrCodes[ownerId] = qr;
    connectionStatuses[ownerId] = 'disconnected';
    updateDbStatus(ownerId, 'disconnected');
  });

  client.on('ready', () => {
    console.log(`[Auth] Client ready for Owner ID: ${ownerId}`);
    qrCodes[ownerId] = null;
    connectionStatuses[ownerId] = 'connected';
    updateDbStatus(ownerId, 'connected');
  });

  client.on('authenticated', () => {
    console.log(`[Auth] Authenticated Owner ID: ${ownerId}`);
  });

  client.on('auth_failure', (msg) => {
    console.error(`[Auth Error] Failed to authenticate Owner ID: ${ownerId}:`, msg);
    qrCodes[ownerId] = null;
    connectionStatuses[ownerId] = 'disconnected';
    updateDbStatus(ownerId, 'disconnected');
  });

  client.on('disconnected', (reason) => {
    console.log(`[Auth] Owner ID ${ownerId} logged out/disconnected. Reason:`, reason);
    qrCodes[ownerId] = null;
    connectionStatuses[ownerId] = 'disconnected';
    updateDbStatus(ownerId, 'disconnected');
    try {
      client.destroy();
    } catch {}
    delete clients[ownerId];
  });

  clients[ownerId] = client;
  
  // Start async initialization, handling errors safely
  client.initialize().catch(err => {
    console.error(`[Init Error] Error initializing client for Owner ID ${ownerId}:`, err);
    connectionStatuses[ownerId] = 'disconnected';
    updateDbStatus(ownerId, 'disconnected');
    delete clients[ownerId];
  });

  return client;
}

// Helper: Sync status to Supabase DB
async function updateDbStatus(ownerId, status) {
  try {
    const { error } = await supabase
      .from('owners')
      .update({ whatsapp_status: status })
      .eq('id', ownerId);
    if (error) console.error(`[DB Error] Failed to update whatsapp_status in DB for ${ownerId}:`, error.message);
  } catch (err) {
    console.error(`[DB Error] Exception updating status for ${ownerId}:`, err.message);
  }
}

// ═══════════════════════════════════════════════════
// HTTP ENDPOINTS
// ═══════════════════════════════════════════════════

// Status API
app.get('/api/status', async (req, res) => {
  const { ownerId } = req.query;
  if (!ownerId) return res.status(400).json({ error: 'ownerId query parameter required' });

  const status = connectionStatuses[ownerId] || 'disconnected';
  const qr = qrCodes[ownerId] || null;

  // Auto-init if client settings exist but client is not initialized in memory yet
  if (!clients[ownerId]) {
    try {
      const { data: owner } = await supabase
        .from('owners')
        .select('whatsapp_enabled')
        .eq('id', ownerId)
        .maybeSingle();

      // If user enabled WhatsApp, auto-init to restore session
      if (owner && owner.whatsapp_enabled) {
        getOrCreateClient(ownerId);
      }
    } catch {}
  }

  res.json({
    status,
    qr: qr ? true : false,
    phone: clients[ownerId]?.info?.me?.user || null
  });
});

// QR Code Stream API
app.get('/api/qr', async (req, res) => {
  const { ownerId } = req.query;
  if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

  await getOrCreateClient(ownerId);
  const qrText = qrCodes[ownerId];

  if (!qrText) {
    const status = connectionStatuses[ownerId] || 'disconnected';
    return res.status(200).json({ status, message: 'QR not ready or already connected' });
  }

  try {
    const qrDataUrl = await qrcode.toDataURL(qrText);
    res.json({ qr: qrDataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR image' });
  }
});

// Disconnect Session API
app.post('/api/disconnect', async (req, res) => {
  const { ownerId } = req.body;
  if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

  const client = clients[ownerId];
  if (client) {
    try {
      console.log(`[Session] Logging out and destroying client for Owner ID: ${ownerId}`);
      await client.logout();
      await client.destroy();
    } catch (err) {
      console.warn(`[Session Warning] Error during logout/destroy for ${ownerId}:`, err.message);
    }
    delete clients[ownerId];
  }

  qrCodes[ownerId] = null;
  connectionStatuses[ownerId] = 'disconnected';
  await updateDbStatus(ownerId, 'disconnected');

  res.json({ success: true, status: 'disconnected' });
});

// Test/Manual message trigger API
app.post('/api/send', async (req, res) => {
  const { ownerId, phone, message } = req.body;
  if (!ownerId || !phone || !message) {
    return res.status(400).json({ error: 'ownerId, phone, and message parameters required' });
  }

  const client = clients[ownerId];
  if (!client || connectionStatuses[ownerId] !== 'connected') {
    return res.status(400).json({ error: 'WhatsApp not connected. Scan QR first.' });
  }

  try {
    const formattedPhone = phone.replace(/\D/g, '');
    const recipient = formattedPhone.startsWith('91') ? formattedPhone : `91${formattedPhone}`;
    const response = await client.sendMessage(`${recipient}@c.us`, message);
    res.json({ success: true, messageId: response.id._serialized });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════
// AUTOMATIC RENT REMINDERS SCHEDULER
// ═══════════════════════════════════════════════════

// Core function to check and send due reminders
async function processDueReminders() {
  console.log('[Scheduler] Running daily check for rent due reminders...');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    // 1. Fetch all owners who have enabled WhatsApp reminders
    const { data: owners, error: ownerErr } = await supabase
      .from('owners')
      .select('*')
      .eq('whatsapp_enabled', true)
      .eq('whatsapp_status', 'connected');

    if (ownerErr) throw ownerErr;
    if (!owners || owners.length === 0) {
      console.log('[Scheduler] No active, connected owners configured for automatic reminders.');
      return;
    }

    console.log(`[Scheduler] Checking dues for ${owners.length} connected landlords.`);

    for (const owner of owners) {
      const ownerId = owner.id;
      const client = clients[ownerId];
      if (!client) {
        // Auto-restore session in memory
        getOrCreateClient(ownerId);
        continue;
      }

      // Fetch all active/vacating tenants for this landlord
      const { data: tenants, error: tenErr } = await supabase
        .from('tenants')
        .select('*')
        .eq('owner_id', ownerId)
        .in('status', ['active', 'vacating']);

      if (tenErr) {
        console.error(`[Scheduler Error] Failed to fetch tenants for owner ${ownerId}:`, tenErr.message);
        continue;
      }

      if (!tenants || tenants.length === 0) continue;

      // Fetch all approved/pending payments for these tenants to verify paid status
      const tenantIds = tenants.map(t => t.id);
      const { data: payments, error: payErr } = await supabase
        .from('payments')
        .select('*')
        .in('tenant_id', tenantIds)
        .in('status', ['approved', 'pending']);

      if (payErr) {
        console.error(`[Scheduler Error] Failed to fetch payments for owner ${ownerId}:`, payErr.message);
        continue;
      }

      // Process each tenant
      for (const tenant of tenants) {
        const joinDate = tenant.join_date ? new Date(tenant.join_date) : null;
        if (!joinDate) continue;

        // Calculate the next unpaid target billing month (same as frontend getTenantTargetMonth)
        const tenantPayments = (payments || []).filter(p => p.tenant_id === tenant.id);
        const submittedPaymentsCount = tenantPayments.length;
        const targetDate = new Date(joinDate);
        targetDate.setMonth(targetDate.getMonth() + submittedPaymentsCount);
        const targetMonthStr = targetDate.toISOString().slice(0, 7); // e.g. "2026-06"

        // Check if there is already a payment for this billing cycle
        const isPaid = (payments || []).some(p => p.tenant_id === tenant.id && p.month_year === targetMonthStr);
        if (isPaid) continue; // Rent already paid for this cycle!

        // Compute the due date of this billing cycle: DD of joinDate, but bounded by last day of target month
        const joinDay = joinDate.getDate();
        const dueYear = targetDate.getFullYear();
        const dueMonth = targetDate.getMonth();
        const lastDayOfDueMonth = new Date(dueYear, dueMonth + 1, 0).getDate();
        const effectiveDueDay = Math.min(joinDay, lastDayOfDueMonth);
        
        const dueDate = new Date(dueYear, dueMonth, effectiveDueDay);
        dueDate.setHours(0, 0, 0, 0);

        // Compute difference in days
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

        const offsetDays = owner.whatsapp_reminder_offset !== undefined ? owner.whatsapp_reminder_offset : 3;

        // If today is exactly targetOffset days before the due date, trigger reminder!
        if (diffDays === offsetDays) {
          console.log(`[Reminder Triggered] Tenant ${tenant.name} is due in ${diffDays} days on ${dueDate.toLocaleDateString()}`);

          // Fetch building/room rent
          const rentAmount = tenant.advance_paid || 8000; // estimated due default

          // Format template
          let text = owner.whatsapp_message_template || 
            'Dear {name}, rent of ₹{amount} for room {room_number} is pending. Please pay by {due_date} to UPI: {upi_id}.';
          
          const formattedDueDate = dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

          text = text
            .replace(/{name}/g, tenant.name)
            .replace(/{amount}/g, rentAmount)
            .replace(/{room_number}/g, tenant.room_number || '—')
            .replace(/{due_date}/g, formattedDueDate)
            .replace(/{upi_id}/g, owner.upi_id || '—')
            .replace(/{building_name}/g, tenant.building_name || '—');

          try {
            const cleanPhone = tenant.phone.replace(/\D/g, '');
            const recipient = cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}`;

            // Send WhatsApp
            await client.sendMessage(`${recipient}@c.us`, text);
            console.log(`[Success] WhatsApp sent to ${tenant.name} (${tenant.phone})`);

            // Log Success in DB
            await supabase.from('whatsapp_logs').insert({
              owner_id: ownerId,
              tenant_id: tenant.id,
              tenant_name: tenant.name,
              phone: tenant.phone,
              message: text,
              status: 'sent'
            });

          } catch (sendErr) {
            console.error(`[Failed] Failed to send WhatsApp to ${tenant.name}:`, sendErr.message);

            // Log Failure in DB
            await supabase.from('whatsapp_logs').insert({
              owner_id: ownerId,
              tenant_id: tenant.id,
              tenant_name: tenant.name,
              phone: tenant.phone,
              message: text,
              status: 'failed',
              error_message: sendErr.message
            });
          }
        }
      }
    }
  } catch (err) {
    console.error('[Scheduler Error] Critical error in processDueReminders loop:', err.message);
  }
}

// Run schedule daily at 9:00 AM
// Cron syntax: minute hour day-of-month month day-of-week
cron.schedule('0 9 * * *', () => {
  processDueReminders();
}, {
  scheduled: true,
  timezone: "Asia/Kolkata"
});

// Also auto-restore sessions on server start for all owners that had WhatsApp enabled
async function autoRestoreSessions() {
  console.log('[Startup] Restoring active WhatsApp client sessions from database...');
  try {
    const { data: owners } = await supabase
      .from('owners')
      .select('id')
      .eq('whatsapp_enabled', true)
      .eq('whatsapp_status', 'connected');

    if (owners && owners.length > 0) {
      console.log(`[Startup] Restoring ${owners.length} active sessions...`);
      for (const owner of owners) {
        getOrCreateClient(owner.id);
      }
    }
  } catch (err) {
    console.error('[Startup Error] Failed to restore owner sessions on startup:', err.message);
  }
}

// Start Server
app.listen(PORT, () => {
  console.log(`[Server] WhatsApp Gateway running on port ${PORT}`);
  autoRestoreSessions();
});
