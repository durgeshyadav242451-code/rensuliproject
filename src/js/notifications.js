// ═══════════════════════════════════════════════════
// PG Builders — Push Notifications Module
// Uses Firebase Cloud Messaging (FCM) + Supabase for token storage
// ═══════════════════════════════════════════════════

import { supabase } from './supabase-config.js';
import { ICONS } from './icons.js';

// ── Firebase config — must match your project ──
// NOTE: After getting these from Firebase Console, also update firebase-messaging-sw.js
const FIREBASE_CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: 'pgbuilderss-f0957.firebaseapp.com',
  projectId: 'pgbuilderss-f0957',
  storageBucket: 'pgbuilderss-f0957.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || ''
};

// ── VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web Push ──
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || '';

let messagingInstance = null;
let fcmToken = null;

// ── Check if notifications are supported ──
function isNotificationSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

// ── Initialize FCM ──
async function initFCM() {
  if (!FIREBASE_CONFIG.apiKey || !FIREBASE_CONFIG.messagingSenderId) {
    console.warn('[Notif] Firebase not configured. Add VITE_FIREBASE_* env vars.');
    return null;
  }
  if (!isNotificationSupported()) {
    console.warn('[Notif] Notifications not supported in this browser.');
    return null;
  }

  try {
    // Dynamic import to avoid loading firebase unless needed
    const { initializeApp, getApps } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const { getMessaging, getToken, onMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');

    const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
    messagingInstance = getMessaging(app);

    // Register service worker
    const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    // Get FCM token
    const token = await getToken(messagingInstance, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg
    });

    fcmToken = token;

    // Handle foreground messages (app is open)
    onMessage(messagingInstance, (payload) => {
      console.log('[Notif] Foreground message:', payload);
      showInAppNotification(
        payload.notification?.title || payload.data?.title || 'PG Builders',
        payload.notification?.body || payload.data?.body || '',
        payload.data?.url || null,
        payload.data?.type || 'info'
      );
    });

    return token;
  } catch (err) {
    console.warn('[Notif] FCM init failed:', err.message);
    return null;
  }
}

// ── Request notification permission and save token ──
export async function initNotifications(role = 'tenant', ownerId = null) {
  if (!isNotificationSupported()) return false;

  // Check if already granted
  if (Notification.permission === 'denied') {
    console.warn('[Notif] Notifications denied by user.');
    return false;
  }

  // Request permission if not yet granted
  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') return false;

  // Init FCM and get token
  const token = await initFCM();
  if (!token) return false;

  // Save token to Supabase
  await saveFcmToken(token, role, ownerId);
  return true;
}

// ── Save FCM token to Supabase ──
async function saveFcmToken(token, role, ownerId) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from('fcm_tokens').upsert({
      user_id: user.id,
      token,
      role,
      owner_id: ownerId || null,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

  } catch (err) {
    console.warn('[Notif] Failed to save FCM token:', err.message);
  }
}

// ── Send notification to a specific user (calls Supabase Edge Function) ──
export async function sendPushNotification({ toUserId, title, body, url = '/', type = 'info', tag = null }) {
  try {
    // Fetch FCM token for target user
    const { data: tokenRow } = await supabase
      .from('fcm_tokens')
      .select('token')
      .eq('user_id', toUserId)
      .maybeSingle();

    if (!tokenRow?.token) {
      console.log('[Notif] No FCM token for user:', toUserId);
      return false;
    }

    // Call Supabase Edge Function to dispatch via FCM HTTP v1 API
    const { error } = await supabase.functions.invoke('send-notification', {
      body: { token: tokenRow.token, title, body, url, type, tag }
    });

    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[Notif] Failed to send push notification:', err.message);
    return false;
  }
}

// ── Send notification to ALL tenants of an owner ──
export async function sendNotificationToAllTenants({ ownerId, title, body, url = '/tenant-dashboard.html', type = 'info' }) {
  try {
    // Get all active tenants of this owner
    const { data: tenants } = await supabase
      .from('tenants')
      .select('auth_user_id')
      .eq('owner_id', ownerId)
      .eq('status', 'active')
      .not('auth_user_id', 'is', null);

    if (!tenants || tenants.length === 0) return;

    const userIds = tenants.map(t => t.auth_user_id);

    // Fetch their FCM tokens
    const { data: tokens } = await supabase
      .from('fcm_tokens')
      .select('token')
      .in('user_id', userIds);

    if (!tokens || tokens.length === 0) return;

    // Send to each
    await Promise.allSettled(tokens.map(row =>
      supabase.functions.invoke('send-notification', {
        body: { token: row.token, title, body, url, type }
      })
    ));
  } catch (err) {
    console.warn('[Notif] Failed to send bulk notification:', err.message);
  }
}

// ── Show in-app notification toast (when app is in foreground) ──
export function showInAppNotification(title, body, url = null, type = 'info') {
  // Create notification element
  const notif = document.createElement('div');
  notif.id = 'push-notif-toast-' + Date.now();

  const colors = {
    success: { bg: 'rgba(0,196,140,0.15)', border: 'rgba(0,196,140,0.4)', icon: ICONS.success() },
    error: { bg: 'rgba(255,107,107,0.15)', border: 'rgba(255,107,107,0.4)', icon: ICONS.error() },
    warning: { bg: 'rgba(253,203,110,0.15)', border: 'rgba(253,203,110,0.4)', icon: ICONS.alert() },
    info: { bg: 'rgba(108,92,231,0.15)', border: 'rgba(108,92,231,0.4)', icon: ICONS.info() }
  };
  const c = colors[type] || colors.info;

  notif.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 99999;
    max-width: 360px;
    width: calc(100vw - 32px);
    background: ${c.bg};
    border: 1px solid ${c.border};
    backdrop-filter: blur(20px);
    border-radius: 12px;
    padding: 14px 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    animation: slideInRight 0.35s cubic-bezier(0.34,1.56,0.64,1);
    cursor: ${url ? 'pointer' : 'default'};
    font-family: 'Inter', sans-serif;
  `;

  notif.innerHTML = `
    <span style="font-size:20px;flex-shrink:0;margin-top:1px">${c.icon}</span>
    <div style="flex:1;min-width:0">
      <div style="font-weight:700;font-size:13px;color:#F0F0FF;margin-bottom:3px">${title}</div>
      <div style="font-size:12px;color:#B0B0CC;line-height:1.4">${body}</div>
    </div>
    <button onclick="document.getElementById('${notif.id}').remove()" style="background:none;border:none;color:#7878A0;cursor:pointer;font-size:18px;padding:0;flex-shrink:0;line-height:1">×</button>
  `;

  // Add slide-in animation if not already in stylesheet
  if (!document.getElementById('push-notif-style')) {
    const style = document.createElement('style');
    style.id = 'push-notif-style';
    style.textContent = `@keyframes slideInRight{from{transform:translateX(calc(100% + 24px));opacity:0}to{transform:translateX(0);opacity:1}}`;
    document.head.appendChild(style);
  }

  if (url) {
    notif.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      window.location.href = url;
    });
  }

  document.body.appendChild(notif);

  // Auto-remove after 7 seconds
  setTimeout(() => notif.remove(), 7000);
}

// ── PWA Install Prompt ──
let deferredInstallPrompt = null;

export function showPremiumInstallModal() {
  if (document.getElementById('premium-install-modal')) return;
  
  const modal = document.createElement('div');
  modal.id = 'premium-install-modal';
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 100000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10, 10, 20, 0.75);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: 'Inter', sans-serif;
    padding: 20px;
    animation: fadeIn 0.3s ease;
  `;

  modal.innerHTML = `
    <div style="background: linear-gradient(135deg, #1A1A3E 0%, #12122A 100%); border: 1px solid rgba(108,92,231,0.3); border-radius: 20px; max-width: 420px; width: 100%; padding: 28px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); position: relative; text-align: center; animation: zoomIn 0.3s cubic-bezier(0.34,1.56,0.64,1);">
      <button onclick="document.getElementById('premium-install-modal').remove()" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: #7878A0; font-size: 24px; cursor: pointer;">×</button>
      <div style="width: 64px; height: 64px; background: linear-gradient(135deg, #6C5CE7, #00D2FF); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; box-shadow: 0 6px 20px rgba(108,92,231,0.4)">${ICONS.building('', 'color:white;', '32px')}</div>
      <h3 style="font-weight: 800; font-size: 18px; color: #F0F0FF; margin-bottom: 8px;">Download Mobile App</h3>
      <p style="font-size: 13px; color: #B0B0CC; line-height: 1.5; margin-bottom: 24px;">Get real-time push notifications for payments, complaints, rules & updates directly on your phone.</p>
      
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <button id="download-apk-btn" onclick="downloadAPK()" style="display: flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, #6C5CE7, #00D2FF); border: none; color: white; font-weight: 700; font-size: 14px; padding: 14px; border-radius: 12px; cursor: pointer; text-decoration: none; box-shadow: 0 4px 15px rgba(108,92,231,0.4); transition: transform 0.2s; min-height: 44px;">
          <span>${ICONS.android('', 'color:white;', '1.2em')}</span> Download Android APK
        </button>
        <button id="pwa-modal-install-btn" style="display: flex; align-items: center; justify-content: center; gap: 10px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #F0F0FF; font-weight: 600; font-size: 13px; padding: 13px; border-radius: 12px; cursor: pointer; transition: background 0.2s; min-height: 44px;">
          <span>${ICONS.smartphone('', 'color:white;', '1.2em')}</span> Add to Home Screen (PWA)
        </button>
      </div>
      
      <div style="font-size: 10px; color: #7878A0; margin-top: 18px;">
        * For instant setup, use PWA installation. Android APK download is also available.
      </div>
    </div>
  `;

  // Add styles if not already present
  if (!document.getElementById('install-modal-style')) {
    const s = document.createElement('style');
    s.id = 'install-modal-style';
    s.textContent = `
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
      #download-apk-btn:hover { transform: translateY(-2px); }
      #pwa-modal-install-btn:hover { background: rgba(255,255,255,0.1); }
    `;
    document.head.appendChild(s);
  }

  document.body.appendChild(modal);

  // Bind install button
  const pwaBtn = modal.querySelector('#pwa-modal-install-btn');
  pwaBtn.addEventListener('click', async () => {
    modal.remove();
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (outcome === 'accepted') localStorage.setItem('pgb_install_dismissed', '1');
    } else {
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      if (isIOS) {
        showIOSInstallBanner();
      } else {
        showInAppNotification(
          'PWA Installation',
          'Open your browser menu (⋮) and tap "Add to Home Screen" or "Install App".',
          null,
          'info'
        );
      }
    }
  });
}

window.showPremiumInstallModal = showPremiumInstallModal;

window.downloadAPK = function(btnElement) {
  const btn = btnElement || document.getElementById('download-apk-btn');
  const originalText = btn ? btn.innerHTML : `${ICONS.android('', 'color:white;', '1.2em')} Download Android APK`;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `${ICONS.pending('', 'color:white;', '1.2em')} Downloading...`;
  }

  fetch('/pg-builders-app.txt')
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.text();
    })
    .then(base64Data => {
      const byteCharacters = atob(base64Data.trim());
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/vnd.android.package-archive' });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'PG-Builders.apk';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
      
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    })
    .catch(error => {
      console.error('Error downloading APK:', error);
      alert('Failed to download APK directly. Please try again or use PWA installation.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    });
};

export function initInstallPrompt() {
  // Register service worker immediately (this is what enables PWA install)
  if ('serviceWorker' in navigator) {
    // Force reload when new service worker takes control
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('[PWA] Controller changed, new worker activated.');
      // window.location.reload(); // Removed to prevent infinite refresh glitch
    });

    navigator.serviceWorker.register('/firebase-messaging-sw.js').then(reg => {
      console.log('[PWA] Service Worker registered:', reg.scope);
      // Check for updates immediately
      reg.update();
    }).catch(err => console.warn('[PWA] SW registration failed:', err));
  }

  // Already installed as standalone app — no need to show banner
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone) return; // iOS Safari

  // Permanently dismissed
  if (localStorage.getItem('pgb_install_dismissed') === '1') return;

  // Only show on mobile devices (laptop/desktop check)
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return;

  // Listen for the browser's install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    // Disabled to prevent automatic popups from disrupting mobile users
    // if (localStorage.getItem('pgb_install_dismissed') === 'temp') {
    //   localStorage.removeItem('pgb_install_dismissed');
    // }
    // showInstallBanner();
  });

  // On iOS — do not show guide banner automatically
  // const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // const isSafari = /safari/i.test(navigator.userAgent) && !/chrome/i.test(navigator.userAgent);
  // if (isIOS && isSafari && !localStorage.getItem('pgb_install_dismissed')) {
  //   setTimeout(() => showIOSInstallBanner(), 2000);
  // }
}

// ── Manual trigger (called from settings/sidebar Install button) ──
export async function triggerInstallPrompt() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('pwa-install-banner')?.remove();
    if (outcome === 'accepted') localStorage.setItem('pgb_install_dismissed', '1');
    return outcome;
  } else {
    showPremiumInstallModal();
  }
  return null;
}

function showInstallBanner() {
  // Only show on mobile devices (laptop/desktop check)
  const isMobile = window.innerWidth <= 768 || /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return;

  if (document.getElementById('pwa-install-banner')) return;
  if (localStorage.getItem('pgb_install_dismissed') === '1') return;

  const hasBottomNav = !!document.getElementById('mobile-bottom-nav');
  const bottomOffset = hasBottomNav ? '70px' : '0px';

  // Add CSS
  if (!document.getElementById('pwa-banner-style')) {
    const s = document.createElement('style');
    s.id = 'pwa-banner-style';
    s.textContent = `
      @keyframes pgbSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}
      #pwa-install-banner{animation:pgbSlideUp 0.45s cubic-bezier(0.34,1.56,0.64,1);}
    `;
    document.head.appendChild(s);
  }

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: ${bottomOffset};
    left: 0; right: 0;
    z-index: 99990;
    background: linear-gradient(135deg, #1A1A3E 0%, #12122A 100%);
    border-top: 1px solid rgba(108,92,231,0.5);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    padding: 14px 16px;
    padding-bottom: calc(14px + env(safe-area-inset-bottom));
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 -4px 24px rgba(0,0,0,0.5);
    font-family: 'Inter', -apple-system, sans-serif;
  `;

  banner.innerHTML = `
    <div style="width:46px;height:46px;background:linear-gradient(135deg,#6C5CE7,#00D2FF);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 4px 12px rgba(108,92,231,0.4)">${ICONS.building('', 'color:white;', '24px')}</div>
    <div style="flex:1;min-width:0;overflow:hidden">
      <div style="font-weight:700;font-size:14px;color:#F0F0FF;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Install PG Builders App</div>
      <div style="font-size:11px;color:#7878A0;margin-top:2px">Fast access + Push Notifications</div>
    </div>
    <button id="pwa-install-btn" style="display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,#6C5CE7,#00D2FF);border:none;color:white;font-weight:700;font-size:13px;padding:11px 18px;border-radius:10px;cursor:pointer;white-space:nowrap;flex-shrink:0;box-shadow:0 4px 12px rgba(108,92,231,0.4);min-height:44px">
      ${ICONS.smartphone('', 'color:white;', '1.2em')} Install
    </button>
    <button id="pwa-dismiss-btn" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#7878A0;font-size:18px;cursor:pointer;padding:0;flex-shrink:0;line-height:1;width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center">×</button>
  `;

  document.body.appendChild(banner);

  banner.querySelector('#pwa-install-btn').addEventListener('click', async () => {
    banner.remove();
    showPremiumInstallModal();
  });

  banner.querySelector('#pwa-dismiss-btn').addEventListener('click', () => {
    banner.remove();
    localStorage.setItem('pgb_install_dismissed', 'temp');
    setTimeout(() => localStorage.removeItem('pgb_install_dismissed'), 3 * 24 * 60 * 60 * 1000);
  });
}

function showIOSInstallBanner() {
  if (document.getElementById('pwa-install-banner')) return;
  if (localStorage.getItem('pgb_install_dismissed')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 12px; right: 12px;
    z-index: 99990;
    background: linear-gradient(135deg, #1A1A3E 0%, #12122A 100%);
    border: 1px solid rgba(108,92,231,0.4);
    border-radius: 16px;
    padding: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    font-family: 'Inter', -apple-system, sans-serif;
  `;
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="width:36px;height:36px;background:linear-gradient(135deg,#6C5CE7,#00D2FF);border-radius:8px;display:flex;align-items:center;justify-content:center">${ICONS.building('', 'color:white;', '18px')}</div>
      <div>
        <div style="font-weight:700;font-size:13px;color:#F0F0FF">Install PG Builders on iOS</div>
        <div style="font-size:11px;color:#7878A0">Add to Home Screen</div>
      </div>
      <button onclick="this.closest('#pwa-install-banner').remove();localStorage.setItem('pgb_install_dismissed','temp')" style="background:none;border:none;color:#7878A0;font-size:20px;cursor:pointer;margin-left:auto;padding:4px">×</button>
    </div>
    <div style="font-size:12px;color:#B0B0CC;line-height:1.6">
      Tap <strong style="color:#F0F0FF">Share</strong> (${ICONS.share('', 'color:white;', '1.1em')}) at the bottom of Safari,<br>
      then tap <strong style="color:#F0F0FF">"Add to Home Screen"</strong> ${ICONS.plus('', 'color:white;', '1.1em')}
    </div>
  `;
  document.body.appendChild(banner);
}


