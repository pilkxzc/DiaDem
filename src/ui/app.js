/**
 * DiaDem UI Controller
 * Connects the blockchain node to the HTML frontend.
 * All data displayed comes from the blockchain state.
 */

import { getNode } from '../diadem.js';
import { t, getLang, setLang, getLanguages } from '../i18n.js';

let node = null;

const LEVEL_COLORS = {
  'Newcomer': '#6B7280', 'Beginner': '#9CA3AF', 'Member': '#3B82F6', 'Active': '#22C55E',
  'Veteran': '#8B5CF6', 'Expert': '#F59E0B', 'Legend': '#EF4444', 'Bronze': '#CD7F32',
  'Silver': '#C0C0C0', 'Gold': '#FFD700', 'Platinum': '#00CED1', 'Diamond': '#B9F2FF',
  'Master': '#FF6B6B', 'Grandmaster': '#FF4500', 'Titan': '#DC143C', 'Overlord': '#9400D3',
  'Sovereign': '#4B0082', 'Celestial': '#00BFFF', 'Mythic': '#FF1493', 'Transcendent': '#FFD700',
  'Immortal': '#FF0000',
};

const LEVEL_THRESHOLDS = [
  { level: 'Newcomer', min: 0 }, { level: 'Beginner', min: 5 }, { level: 'Member', min: 30 },
  { level: 'Active', min: 100 }, { level: 'Veteran', min: 200 }, { level: 'Expert', min: 500 },
  { level: 'Legend', min: 1000 }, { level: 'Bronze', min: 2000 }, { level: 'Silver', min: 5000 },
  { level: 'Gold', min: 10000 }, { level: 'Platinum', min: 20000 }, { level: 'Diamond', min: 30000 },
  { level: 'Master', min: 50000 }, { level: 'Grandmaster', min: 70000 }, { level: 'Titan', min: 100000 },
  { level: 'Overlord', min: 150000 }, { level: 'Sovereign', min: 200000 }, { level: 'Celestial', min: 300000 },
  { level: 'Mythic', min: 500000 }, { level: 'Transcendent', min: 750000 }, { level: 'Immortal', min: 1000000 },
];

function getRepProgress(score) {
  let curIdx = 0;
  for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (score >= LEVEL_THRESHOLDS[i].min) { curIdx = i; break; }
  }
  const cur = LEVEL_THRESHOLDS[curIdx];
  const next = LEVEL_THRESHOLDS[curIdx + 1] || null;
  const prev = curIdx > 0 ? LEVEL_THRESHOLDS[curIdx - 1] : null;
  const progress = next ? ((score - cur.min) / (next.min - cur.min)) * 100 : 100;
  const remaining = next ? next.min - score : 0;
  return { curIdx, cur, next, prev, progress: Math.min(100, progress), remaining, total: LEVEL_THRESHOLDS.length };
}

// ─── Toast & Confirm System (replaces browser alert/confirm/prompt) ──

function _ensureToastContainer() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
  return c;
}

const TOAST_ICONS = {
  success: '<i class="icon-check-circle"></i>',
  error: '<i class="icon-alert-circle"></i>',
  info: '<i class="icon-info"></i>',
  warning: '<i class="icon-alert-triangle"></i>',
};

function showToast(message, type = 'info', duration = 4000) {
  const container = _ensureToastContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `
    <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <div class="toast-body"><div class="toast-msg">${escapeHtml(message)}</div></div>
    <button class="toast-close" onclick="this.parentElement.classList.add('toast-out');setTimeout(()=>this.parentElement.remove(),300)"><i class="icon-x"></i></button>
  `;
  container.appendChild(el);
  setTimeout(() => {
    if (el.parentElement) {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 300);
    }
  }, duration);
}

function showConfirm(title, message, onYes, onNo) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-title">${escapeHtml(title)}</div>
      <div class="confirm-msg">${escapeHtml(message)}</div>
      <div class="confirm-actions">
        <button class="btn btn-outline" id="_confirm-no">Cancel</button>
        <button class="btn btn-primary" id="_confirm-yes">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#_confirm-yes').onclick = () => { overlay.remove(); if (onYes) onYes(); };
  overlay.querySelector('#_confirm-no').onclick = () => { overlay.remove(); if (onNo) onNo(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); if (onNo) onNo(); } });
}

function showPrompt(title, message, placeholder, onDone) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-title">${escapeHtml(title)}</div>
      <div class="confirm-msg">${escapeHtml(message)}</div>
      <input class="confirm-input" id="_prompt-input" placeholder="${escapeHtml(placeholder || '')}" autofocus>
      <div class="confirm-actions">
        <button class="btn btn-outline" id="_prompt-cancel">Cancel</button>
        <button class="btn btn-primary" id="_prompt-ok">OK</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#_prompt-input');
  setTimeout(() => input.focus(), 50);
  const submit = () => { const val = input.value; overlay.remove(); if (onDone) onDone(val); };
  overlay.querySelector('#_prompt-ok').onclick = submit;
  overlay.querySelector('#_prompt-cancel').onclick = () => { overlay.remove(); if (onDone) onDone(null); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); if (onDone) onDone(null); } });
}

function showCopyDialog(title, text) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <div class="confirm-title">${escapeHtml(title)}</div>
      <textarea class="confirm-input" style="min-height:80px;resize:vertical;font-size:12px;" readonly>${escapeHtml(text)}</textarea>
      <div class="confirm-actions">
        <button class="btn btn-outline" id="_copy-close">Close</button>
        <button class="btn btn-primary" id="_copy-btn"><i class="icon-copy" style="margin-right:6px;"></i>Copy</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector('#_copy-btn').onclick = () => {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success', 2000));
    overlay.remove();
  };
  overlay.querySelector('#_copy-close').onclick = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── Image Utilities ─────────────────────────────────────

/** Resize image file to max dimensions and return base64 data URL */
function resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Image crop editor modal — canvas-based, no CSS transform.
 * @param {File} file - image file
 * @param {object} opts - { cropW, cropH, shape: 'circle'|'rect', title }
 * @returns {Promise<string|null>} base64 data URL or null if cancelled
 */
function showImageEditor(file, opts = {}) {
  const { cropW = 256, cropH = 256, shape = 'rect', title = 'Edit Image' } = opts;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const imgSrc = e.target.result;

      // Preview canvas size
      const maxW = Math.min(440, window.innerWidth - 48);
      const pvW = Math.min(maxW, cropW);
      const pvH = Math.round(pvW * (cropH / cropW));
      const borderR = shape === 'circle' ? '50%' : '12px';

      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.style.zIndex = '10000';
      overlay.innerHTML = `
        <div class="confirm-box" style="max-width:500px;width:90vw;padding:0;overflow:hidden;">
          <div style="padding:20px 24px 12px;font-size:16px;font-weight:700;color:var(--text-primary);">${escapeHtml(title)}</div>
          <div style="margin:0 auto;width:${pvW}px;height:${pvH}px;border-radius:${borderR};overflow:hidden;cursor:grab;touch-action:none;user-select:none;" id="_crop-wrap">
            <canvas id="_crop-cv" width="${pvW}" height="${pvH}" style="display:block;width:${pvW}px;height:${pvH}px;"></canvas>
          </div>
          <div style="padding:16px 24px;display:flex;align-items:center;gap:12px;">
            <i class="icon-minus" style="font-size:14px;color:var(--text-muted);"></i>
            <input type="range" id="_crop-zoom" min="100" max="400" value="100" step="1" style="flex:1;accent-color:var(--btn-primary-bg);">
            <i class="icon-plus" style="font-size:14px;color:var(--text-muted);"></i>
          </div>
          <div style="padding:12px 24px 20px;display:flex;gap:12px;justify-content:flex-end;">
            <button class="btn btn-outline" id="_crop-cancel">Cancel</button>
            <button class="btn btn-primary" id="_crop-save">Apply</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      const wrap = overlay.querySelector('#_crop-wrap');
      const cv = overlay.querySelector('#_crop-cv');
      const ctx = cv.getContext('2d');
      const slider = overlay.querySelector('#_crop-zoom');

      // x,y = top-left of drawn image in canvas coords; w,h = drawn size
      let x = 0, y = 0, w = 0, h = 0;
      let coverW = 0, coverH = 0; // size at zoom=100% (cover fit)
      let dragging = false, dsx = 0, dsy = 0, dox = 0, doy = 0;

      const img = new Image();
      img.onload = () => {
        // Cover fit: image fills entire canvas, cropping the overflow
        const scale = Math.max(pvW / img.naturalWidth, pvH / img.naturalHeight);
        coverW = img.naturalWidth * scale;
        coverH = img.naturalHeight * scale;
        w = coverW; h = coverH;
        x = (pvW - w) / 2;
        y = (pvH - h) / 2;
        draw();
      };
      img.src = imgSrc;

      function draw() {
        ctx.clearRect(0, 0, pvW, pvH);
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, pvW, pvH);
        ctx.drawImage(img, x, y, w, h);
      }

      function clampPos() {
        // Don't let edges show: image must cover canvas
        if (w >= pvW) { x = Math.min(0, Math.max(pvW - w, x)); }
        else { x = (pvW - w) / 2; }
        if (h >= pvH) { y = Math.min(0, Math.max(pvH - h, y)); }
        else { y = (pvH - h) / 2; }
      }

      function applyZoom(newW, newH, pivotX, pivotY) {
        // Keep point under pivot stationary
        const rx = (pivotX - x) / w;
        const ry = (pivotY - y) / h;
        w = newW; h = newH;
        x = pivotX - rx * w;
        y = pivotY - ry * h;
        clampPos();
        draw();
      }

      // Slider: 100 = cover, 400 = 4x cover
      slider.addEventListener('input', () => {
        const z = parseInt(slider.value) / 100;
        applyZoom(coverW * z, coverH * z, pvW / 2, pvH / 2);
      });

      // Drag
      wrap.addEventListener('pointerdown', (e) => {
        dragging = true;
        dsx = e.clientX; dsy = e.clientY;
        dox = x; doy = y;
        wrap.setPointerCapture(e.pointerId);
        wrap.style.cursor = 'grabbing';
      });
      wrap.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        x = dox + (e.clientX - dsx);
        y = doy + (e.clientY - dsy);
        clampPos();
        draw();
      });
      wrap.addEventListener('pointerup', () => { dragging = false; wrap.style.cursor = 'grab'; });
      wrap.addEventListener('lostpointercapture', () => { dragging = false; wrap.style.cursor = 'grab'; });

      // Wheel zoom towards cursor
      wrap.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.95 : 1.05;
        const nw = Math.max(coverW, Math.min(coverW * 4, w * factor));
        const nh = nw * (coverH / coverW);
        slider.value = Math.round((nw / coverW) * 100);
        const rect = wrap.getBoundingClientRect();
        applyZoom(nw, nh, e.clientX - rect.left, e.clientY - rect.top);
      }, { passive: false });

      // Cancel
      overlay.querySelector('#_crop-cancel').onclick = () => { overlay.remove(); resolve(null); };
      overlay.addEventListener('click', (e) => { if (e.target === overlay) { overlay.remove(); resolve(null); } });

      // Save — redraw onto output-sized canvas
      overlay.querySelector('#_crop-save').onclick = () => {
        const outCv = document.createElement('canvas');
        outCv.width = cropW; outCv.height = cropH;
        const outCtx = outCv.getContext('2d');
        // Scale preview coords → output coords
        const s = cropW / pvW;
        outCtx.drawImage(img, x * s, y * s, w * s, h * s);
        const result = outCv.toDataURL('image/jpeg', 0.85);
        overlay.remove();
        resolve(result);
      };
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

// Pending compose image data URL
let _composeImageData = null;
let _composeImageList = []; // multiple images (up to 4)
let _composeSpoiler = false;
// Pending avatar data URL
let _pendingAvatarData = null;
let _pendingBannerData = null;
// Pending DM image data URL
let _dmImageData = null;
// Current open DM chat address
let _activeDMAddress = null;
// Typing indicator state
let _typingTimeout = null;
let _typingSendTimeout = null;

// Unread messages tracking: { chatKey: lastReadTimestamp }
function _getLastRead() {
  try { return JSON.parse(localStorage.getItem('diadem_dm_lastread') || '{}'); } catch { return {}; }
}
function _markChatRead(otherAddr) {
  const data = _getLastRead();
  const key = node?.wallet ? [node.wallet.address, otherAddr].sort().join(':') : otherAddr;
  data[key] = Date.now();
  localStorage.setItem('diadem_dm_lastread', JSON.stringify(data));
  _updateUnreadBadges();
}
function _getUnreadDMCount() {
  if (!node?.wallet) return 0;
  const myAddr = node.wallet.address;
  const lastRead = _getLastRead();
  const chats = node.getDMChats();
  let total = 0;
  for (const chat of chats) {
    const key = [myAddr, chat.otherAddress].sort().join(':');
    const lr = lastRead[key] || 0;
    const unread = chat.messages.filter(m => m.from !== myAddr && m.timestamp > lr).length;
    total += unread;
  }
  return total;
}
function _getUnreadNotifCount() {
  if (!node?.wallet) return 0;
  const lastSeen = parseInt(localStorage.getItem('diadem_notif_seen') || '0', 10);
  const txs = node.blockchain.state.getTransactions(node.wallet.address, 50);
  return txs.filter(tx => tx.timestamp > lastSeen && tx.from !== node.wallet.address).length;
}
function _updateUnreadBadges() {
  const dmBadge = document.getElementById('dm-unread-badge');
  const notifBadge = document.getElementById('notif-unread-badge');
  if (dmBadge) {
    const dmCount = _getUnreadDMCount();
    if (dmCount > 0) {
      dmBadge.textContent = dmCount > 9 ? '9+' : dmCount;
      dmBadge.style.display = '';
    } else {
      dmBadge.style.display = 'none';
    }
  }
  if (notifBadge) {
    const notifCount = _getUnreadNotifCount();
    if (notifCount > 0) {
      notifBadge.textContent = notifCount > 9 ? '9+' : notifCount;
      notifBadge.style.display = '';
    } else {
      notifBadge.style.display = 'none';
    }
  }
}

function _showTypingIndicator(fromAddr) {
  const el = document.getElementById('dm-typing-indicator');
  if (!el) return;
  const p = node.getProfile(fromAddr) || {};
  const name = p.name || fromAddr.slice(0, 8) + '...';
  el.innerHTML = `<span style="font-size:12px;color:var(--accent);font-style:italic;padding:4px 16px;">${escapeHtml(name)} ${t('dm_typing')}...</span>`;
  el.style.display = 'block';
  clearTimeout(_typingTimeout);
  _typingTimeout = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function _showPaymentAnimation(type = 'sent') {
  // Pure CSS animation — no canvas, no per-frame JS, GPU-accelerated
  const c1 = type === 'sent' ? '#22C55E' : '#3B82F6';
  const c2 = type === 'sent' ? '#10B981' : '#60A5FA';
  const c3 = type === 'sent' ? '#34D399' : '#93C5FD';

  const wrap = document.createElement('div');
  wrap.className = 'pay-anim-wrap';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:10000;pointer-events:none;display:flex;align-items:center;justify-content:center;';

  // Central icon
  const iconSvg = type === 'sent'
    ? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
    : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#FFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;

  // Generate particles HTML — 20 lightweight divs
  let particlesHtml = '';
  for (let i = 0; i < 20; i++) {
    const angle = (i / 20) * 360;
    const dist = 80 + Math.random() * 100;
    const sz = 3 + Math.random() * 5;
    const dur = 0.5 + Math.random() * 0.3;
    const delay = Math.random() * 0.15;
    const col = [c1, c2, c3][i % 3];
    const tx = Math.cos(angle * Math.PI / 180) * dist;
    const ty = Math.sin(angle * Math.PI / 180) * dist;
    const shape = i % 2 === 0 ? '50%' : '2px';
    particlesHtml += `<div style="position:absolute;width:${sz}px;height:${sz}px;border-radius:${shape};background:${col};opacity:0;animation:payP ${dur}s ${delay}s cubic-bezier(.2,.8,.3,1) forwards;--ptx:${tx}px;--pty:${ty}px;"></div>`;
  }

  wrap.innerHTML = `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;">
      <div class="pay-icon-circle" style="width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,${c1},${c2});display:flex;align-items:center;justify-content:center;animation:payIcon 1.4s cubic-bezier(.34,1.56,.64,1) forwards;will-change:transform,opacity;">${iconSvg}</div>
      <div style="position:absolute;width:100%;height:100%;border-radius:50%;border:2.5px solid ${c1};animation:payR1 0.8s 0.05s ease-out forwards;opacity:0;will-change:transform,opacity;"></div>
      <div style="position:absolute;width:100%;height:100%;border-radius:50%;border:1.5px solid ${c2};animation:payR2 1s 0.15s ease-out forwards;opacity:0;will-change:transform,opacity;"></div>
      <div style="position:absolute;width:100%;height:100%;border-radius:50%;border:1px solid ${c3};animation:payR3 1.2s 0.3s ease-out forwards;opacity:0;will-change:transform,opacity;"></div>
      ${particlesHtml}
    </div>
  `;

  document.body.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1800);
}

function _sendTypingSignal(toAddr) {
  if (_typingSendTimeout) return; // throttle: max 1 per 2s
  node.sendTypingIndicator(toAddr);
  _typingSendTimeout = setTimeout(() => { _typingSendTimeout = null; }, 2000);
}

// ─── Navigation ───────────────────────────────────────────

const standalonePages = ['landing', 'login', 'signup', 'wallet-setup'];

// Current context for sub-pages (postId for single-post, address for other-profile)
let _currentPostId = null;
let _currentProfileAddr = null;
let _currentProfileTab = 'posts';

function showPage(pageId) {
  // Parse compound hashes like "single-post/abc123" or "other-profile/0xabc"
  let basePage = pageId;
  let param = null;
  const slashIdx = pageId.indexOf('/');
  if (slashIdx !== -1) {
    basePage = pageId.slice(0, slashIdx);
    param = pageId.slice(slashIdx + 1);
  }

  if (basePage === 'single-post' && param) _currentPostId = param;
  if (basePage === 'other-profile' && param) _currentProfileAddr = param;
  if (basePage !== 'profile' && basePage !== 'other-profile') _currentProfileTab = 'posts';

  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const appShell = document.getElementById('app-shell');

  if (standalonePages.includes(basePage)) {
    appShell.style.display = 'none';
    const page = document.getElementById('page-' + basePage);
    if (page) page.classList.remove('hidden');
  } else {
    appShell.style.display = 'flex';
    const page = document.getElementById('page-' + basePage);
    if (page) page.classList.remove('hidden');
    document.querySelectorAll('.sidebar-nav a').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`.sidebar-nav a[data-page="${basePage}"]`);
    if (link) link.classList.add('active');
    // Mobile nav
    document.querySelectorAll('.mobile-bottom-nav a').forEach(l => l.classList.remove('active'));
    const mLink = document.querySelector(`.mobile-bottom-nav a[data-page="${basePage}"]`);
    if (mLink) mLink.classList.add('active');
  }

  // Запам'ятати поточну сторінку (з параметром)
  const fullPage = basePage + (param ? '/' + param : (basePage === 'single-post' && _currentPostId ? '/' + _currentPostId : (basePage === 'other-profile' && _currentProfileAddr ? '/' + _currentProfileAddr : '')));
  try { sessionStorage.setItem('diadem_last_page', fullPage); } catch {}

  refreshPageData(basePage);
}

function navigate(pageId) {
  history.pushState(null, '', '#' + pageId);
  showPage(pageId);
}

// ─── Sidebar i18n update ──────────────────────────────────

function updateSidebarLabels() {
  const map = {
    home: 'nav_home', explore: 'nav_explore', messages: 'nav_messages',
    notifications: 'nav_notifications', bookmarks: 'nav_bookmarks',
    profile: 'nav_profile', wallet: 'nav_wallet', staking: 'nav_staking',
    governance: 'nav_governance', transactions: 'nav_transactions',
    shop: 'nav_shop', settings: 'nav_settings', peers: 'nav_peers',
  };
  for (const [page, key] of Object.entries(map)) {
    const link = document.querySelector(`.sidebar-nav a[data-page="${page}"]`);
    if (link) {
      const icon = link.querySelector('i');
      link.textContent = '';
      if (icon) link.appendChild(icon);
      link.append(' ' + t(key));
    }
  }
  const btn = document.getElementById('btn-compose');
  if (btn) btn.textContent = t('nav_new_post');
}

// ─── Data Rendering ───────────────────────────────────────

function refreshPageData(pageId) {
  if (!node || !node.wallet) return;
  switch (pageId) {
    case 'home': renderFeed(); break;
    case 'explore': renderExplore(); break;
    case 'profile': renderProfile(); break;
    case 'other-profile': if (_currentProfileAddr) renderProfile(_currentProfileAddr); break;
    case 'single-post': if (_currentPostId) renderSinglePost(_currentPostId); break;
    case 'wallet': renderWallet(); break;
    case 'notifications': renderNotifications(); break;
    case 'staking': renderStaking(); break;
    case 'governance': renderGovernance(); break;
    case 'transactions': renderTransactions(); break;
    case 'messages': renderMessages(); break;
    case 'bookmarks': renderBookmarks(); break;
    case 'search': renderSearch(); break;
    case 'shop': renderShop(); break;
    case 'settings': renderSettingsData(); break;
  }
  updateSidebarInfo();
}

function updateSidebarInfo() {
  if (!node?.wallet) return;
  const info = node.getNodeInfo();
  const rep = node.getReputation();
  const profile = node.getProfile(node.wallet.address);
  const displayName = profile?.name || 'Anonymous';
  const addr = node.wallet.address;
  const avatarHtml = profile?.avatar
    ? `<img src="${profile.avatar}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">`
    : `<div class="sidebar-user-avatar">${displayName.charAt(0).toUpperCase()}</div>`;
  const el = document.getElementById('node-status');
  if (el) {
    const peers = info.network.peers;
    const sigOk = info.network.signaling === 'connected';
    const syncStatus = peers > 0 ? 'synced' : (sigOk ? 'ready' : 'offline');
    const statusColor = syncStatus === 'synced' ? 'var(--green, #22C55E)' : (syncStatus === 'ready' ? 'var(--green, #22C55E)' : 'var(--danger, #EF4444)');
    const statusLabel = syncStatus === 'synced' ? `${peers} ${peers === 1 ? 'peer' : 'peers'}` : (syncStatus === 'ready' ? (t('online') || 'Online') : t('offline') || 'Offline');

    el.innerHTML = `
      <div class="sidebar-connection-bar">
        <div class="sidebar-conn-row">
          <div class="sidebar-conn-dot" style="background:${statusColor};"></div>
          <span class="sidebar-conn-label">${statusLabel}</span>
          <span class="sidebar-conn-block">#${info.chain.height}</span>
        </div>
        <div class="sidebar-conn-track">
          <div class="sidebar-conn-fill" style="background:${statusColor};width:${syncStatus === 'offline' ? '0' : '100'}%;"></div>
        </div>
      </div>
      <div class="sidebar-user-card" onclick="location.hash='profile'">
        ${avatarHtml}
        <div class="sidebar-user-info">
          <div class="sidebar-user-name">${escapeHtml(displayName)}</div>
          <div class="sidebar-user-addr">${addr.slice(0, 10)}...${addr.slice(-4)}</div>
        </div>
      </div>
      <div class="sidebar-stats">
        <div class="sidebar-stat">
          <div class="sidebar-stat-value">${node.getBalance().toLocaleString()}</div>
          <div class="sidebar-stat-label">DDM</div>
        </div>
        <div class="sidebar-stat">
          <div class="sidebar-stat-value">${rep.score.toFixed(0)}</div>
          <div class="sidebar-stat-label">Rep</div>
        </div>
        <div class="sidebar-stat">
          <div class="sidebar-stat-value">${peers}</div>
          <div class="sidebar-stat-label">Peers</div>
        </div>
      </div>
    `;
  }
  _updateUnreadBadges();
}

// ─── Time formatting ──────────────────────────────────────

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return t('just_now');
  if (diff < 3600000) return Math.floor(diff / 60000) + t('min_ago');
  if (diff < 86400000) return Math.floor(diff / 3600000) + t('hour_ago');
  return Math.floor(diff / 86400000) + t('day_ago');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Text formatting ──────────────────────────────────────
function formatPostContent(text) {
  let s = escapeHtml(text);
  // Bold: **text** or __text__
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  // Italic: *text* or _text_
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  s = s.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, '<em>$1</em>');
  // Strikethrough: ~~text~~
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Code: `text`
  s = s.replace(/`(.+?)`/g, '<code style="background:var(--bg-input);padding:1px 5px;border-radius:4px;font-size:13px;">$1</code>');
  // Spoiler: ||text||
  s = s.replace(/\|\|(.+?)\|\|/g, '<span class="post-spoiler-text" onclick="this.classList.add(\'revealed\')">$1</span>');
  // Line breaks
  s = s.replace(/\n/g, '<br>');
  return s;
}

// ─── Post media renderer ──────────────────────────────────
function renderPostMedia(post) {
  const images = post.mediaList || (post.media ? [post.media] : []);
  if (images.length === 0) return '';
  const isSpoiler = post.spoilerMedia;
  const count = images.length;
  const gridClass = count === 1 ? 'post-media-single' : (count === 2 ? 'post-media-2' : (count === 3 ? 'post-media-3' : 'post-media-4'));

  let html = `<div class="post-media-grid ${gridClass}${isSpoiler ? ' post-media-spoiler' : ''}">`;
  if (isSpoiler) {
    html += `<div class="post-spoiler-overlay" onclick="this.parentElement.classList.remove('post-media-spoiler');this.remove();">
      <i class="icon-eye-off" style="font-size:24px;"></i>
      <span>Spoiler</span>
    </div>`;
  }
  images.forEach((src, i) => {
    if (i < 4) {
      html += `<img src="${src}" alt="" loading="lazy" onclick="event.stopPropagation();window.diademUI._viewImage('${src.replace(/'/g, "\\'")}')" style="cursor:pointer;">`;
    }
  });
  html += '</div>';
  return html;
}

// ─── Feed ──────────────────────────────────────────────────

function renderStoryBar() {
  const activeStories = node.getActiveStories();
  const myAddr = node.wallet?.address;
  const myProfile = node.getProfile(myAddr) || {};
  const myStories = activeStories.find(s => s.address === myAddr);

  let html = `<div class="story-bar">`;

  // Add story button (always first)
  const myName = myProfile.name || 'You';
  const myInitials = myName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const myAvatar = myProfile.avatar
    ? `<img src="${myProfile.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
    : `<span style="font-size:14px;font-weight:600;color:var(--text-muted);">${myInitials}</span>`;

  html += `
    <div class="story-item" onclick="window.diademUI.${myStories ? `viewStory('${myAddr}')` : 'createStory()'}">
      <div class="story-ring${myStories ? '' : ' story-ring-add'}">
        <div class="story-avatar">${myAvatar}</div>
        <div class="story-add-badge" onclick="event.stopPropagation();window.diademUI.createStory()"><i class="icon-plus" style="font-size:10px;color:#FFF;"></i></div>
      </div>
      <div class="story-name">${myStories ? t('stories_your') : t('stories_add')}</div>
    </div>`;

  // Other users' stories
  for (const s of activeStories) {
    if (s.address === myAddr) continue;
    const prof = s.profile || {};
    const sName = prof.name || s.address.slice(0, 8);
    const sInitials = sName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const sAvatar = prof.avatar
      ? `<img src="${prof.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`
      : `<span style="font-size:14px;font-weight:600;color:var(--text-muted);">${sInitials}</span>`;
    const allViewed = s.stories.every(st => st.views && st.views.has(myAddr));

    html += `
      <div class="story-item" onclick="window.diademUI.viewStory('${s.address}')">
        <div class="story-ring${allViewed ? ' story-ring-seen' : ''}">
          <div class="story-avatar">${sAvatar}</div>
        </div>
        <div class="story-name">${escapeHtml(sName.length > 10 ? sName.slice(0, 9) + '...' : sName)}</div>
      </div>`;
  }

  html += `</div>`;
  return html;
}

function renderFeed() {
  const container = document.getElementById('feed-posts');
  if (!container) return;
  const header = container.closest('.content-area')?.querySelector('.page-header h2');
  if (header) header.textContent = t('feed_title');

  // Story bar
  let storyBarEl = document.getElementById('story-bar-container');
  if (!storyBarEl) {
    storyBarEl = document.createElement('div');
    storyBarEl.id = 'story-bar-container';
    container.parentElement.insertBefore(storyBarEl, container);
  }
  storyBarEl.innerHTML = renderStoryBar();

  // Show all posts (global feed) — everyone sees everything, this is a decentralized network
  const feed = node.getExplorePosts(50);

  if (feed.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 0;">
        <div class="text-muted mb-16">${t('feed_empty')}</div>
        <button class="btn btn-primary" onclick="document.getElementById('compose-modal').classList.add('active')">${t('feed_create')}</button>
      </div>`;
    return;
  }
  container.innerHTML = feed.map(post => renderPost(post)).join('');
}

function renderAvatar(profile, size = '') {
  const name = profile?.name || '??';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
  if (profile?.avatar) {
    return `<div class="avatar${size ? ' avatar-' + size : ''}"><img src="${profile.avatar}" alt=""></div>`;
  }
  return `<div class="avatar${size ? ' avatar-' + size : ''}" style="background:var(--avatar-fill);"><span class="avatar-initials">${initials}</span></div>`;
}

const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🚀', '💎'];

function renderReactions(postId) {
  const postReactions = node.blockchain.state.reactions?.get(postId);
  if (!postReactions || postReactions.size === 0) return '';
  const myAddr = node.wallet?.address;
  let html = '<div class="post-reactions">';
  for (const [emoji, users] of postReactions) {
    if (users.size === 0) continue;
    const active = myAddr && users.has(myAddr) ? ' reaction-active' : '';
    html += `<button class="reaction-btn${active}" onclick="window.diademUI.reactToPost('${postId}','${emoji}')">${emoji} <span>${users.size}</span></button>`;
  }
  html += `<button class="reaction-btn reaction-add" onclick="window.diademUI.showReactionPicker('${postId}')">+</button>`;
  html += '</div>';
  return html;
}

function renderPost(post, expanded = false) {
  const profile = post.profile || {};
  const name = profile.name || post.author.slice(0, 10) + '...';
  const handle = profile.handle || post.author.slice(0, 12);
  const timeAgo = formatTimeAgo(post.timestamp);
  const postId = post.id || post.hash;
  // Check like state from blockchain — check both id and hash keys
  const myAddr = node.wallet?.address;
  const likesById = node.blockchain.state.likes.get(postId);
  const likesByHash = post.hash && post.hash !== postId ? node.blockchain.state.likes.get(post.hash) : null;
  const likesSet = likesById || likesByHash || new Set();
  const liked = (myAddr && likesSet.has(myAddr)) ? ' liked' : '';
  const likesCount = likesSet.size || post.likesCount || 0;
  const bookmarks = JSON.parse(localStorage.getItem('diadem_bookmarks') || '[]');
  const isBookmarked = bookmarks.includes(postId);
  const hasReactions = node.blockchain.state.reactions?.has(postId);

  // Decoration effects on posts
  const postDecor = node.blockchain.state.profileDecor.get(post.author) || {};
  const postBadgeItem = postDecor.badge ? SHOP_ITEMS.find(i => i.id === postDecor.badge) : null;
  const postBadgeHtml = postBadgeItem ? ` <i class="icon-${postBadgeItem.icon || 'check-circle'}" style="font-size:13px;color:${postBadgeItem.preview};"></i>` : '';
  const postNameColorItem = postDecor.name_color ? SHOP_ITEMS.find(i => i.id === postDecor.name_color) : null;
  const postNameStyle = postNameColorItem
    ? (postNameColorItem.preview.startsWith('linear') ? `background:${postNameColorItem.preview};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-size:200% 200%;animation:gradientShift 3s ease infinite;` : `color:${postNameColorItem.preview};`)
    : '';
  const postFrameItem = postDecor.frame ? SHOP_ITEMS.find(i => i.id === postDecor.frame) : null;
  const postFontItem = postDecor.name_font ? SHOP_ITEMS.find(i => i.id === postDecor.name_font) : null;
  const postFontStyle = postFontItem ? `font-family:${postFontItem.font};` : '';

  const repostLabel = post.repostedBy
    ? `<div class="post-repost-label"><i class="icon-repeat-2" style="font-size:12px;"></i> ${escapeHtml(post.repostedByProfile?.name || post.repostedBy.slice(0, 10))} reposted</div>`
    : '';

  return `
    <div class="post${expanded ? ' single-post' : ''}" data-post-id="${postId}">
      ${repostLabel}
      <div class="post-header">
        ${postFrameItem
          ? `<div class="avatar${expanded ? ' avatar-lg' : ''}" style="border:2px solid transparent;background-image:${postFrameItem.preview};background-origin:border-box;background-clip:padding-box,border-box;">
              ${profile.avatar ? `<img src="${profile.avatar}" alt="">` : `<span class="avatar-initials">${(name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)) || '??'}</span>`}
            </div>`
          : renderAvatar(profile, expanded ? 'lg' : '')
        }
        <div style="flex:1;">
          <span class="post-author" style="cursor:pointer;${postNameStyle}${postFontStyle}" onclick="window.diademUI.viewUser('${post.author}')">${escapeHtml(name)}${postBadgeHtml}</span>
          <div class="post-handle">${escapeHtml(handle)} · ${timeAgo}</div>
        </div>
      </div>
      <div class="post-content${post.content.length > 500 && !expanded ? '' : ' expanded'}" style="${expanded ? 'font-size:16px;line-height:1.6;' : 'cursor:pointer;'}" ${expanded ? '' : `onclick="window.diademUI.viewPost('${postId}')"`}>${formatPostContent(post.content)}</div>
      ${post.content.length > 500 && !expanded ? `<button class="post-content-more" onclick="const c=this.previousElementSibling;c.classList.toggle('expanded');this.textContent=c.classList.contains('expanded')?'${t('sp_show_less')}':'${t('sp_show_more')}'">${t('sp_show_more')}</button>` : ''}
      ${renderPostMedia(post)}
      ${renderReactions(postId)}
      <div class="post-actions">
        <button class="post-action${liked}" onclick="window.diademUI.likePost('${postId}')">
          <i class="icon-heart"></i> ${likesCount}
        </button>
        <button class="post-action" onclick="window.diademUI.viewPost('${postId}')"><i class="icon-message-circle"></i> ${(node.blockchain.state.replies.get(postId) || []).length}</button>
        <button class="post-action${(node.blockchain.state.reposts.get(postId) || new Set()).has(myAddr) ? ' reposted' : ''}" onclick="window.diademUI.repostPost('${postId}')"><i class="icon-repeat-2"></i> ${(node.blockchain.state.reposts.get(postId) || new Set()).size || ''}</button>
        <button class="post-action${isBookmarked ? ' liked' : ''}" onclick="window.diademUI.bookmarkPost('${postId}')"><i class="icon-bookmark"></i></button>
        ${post.author === node.wallet?.address ? `<button class="post-action" onclick="window.diademUI.deletePost('${postId}')" title="Delete"><i class="icon-trash-2"></i></button>` : ''}
      </div>
    </div>`;
}

// ─── Explore ──────────────────────────────────────────────

function renderExplore() {
  const posts = node.getExplorePosts(50);
  const container = document.getElementById('explore-posts');
  if (!container) return;

  if (posts.length === 0) {
    container.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('explore_empty')}</div>`;
    return;
  }
  container.innerHTML = `
    <div class="search-box mb-24">
      <i class="icon-search"></i>
      <input type="text" class="input-field" placeholder="${t('explore_search')}" style="padding-left:36px;" id="explore-search" onkeydown="if(event.key==='Enter')window.diademUI.doSearch(this.value)">
    </div>
  ` + posts.map(post => renderPost(post)).join('');
}

// ─── Profile ──────────────────────────────────────────────

function renderProfile(address = null) {
  const addr = address || node.wallet?.address;
  const isOwnProfile = !address || address === node.wallet?.address;
  const profile = node.getProfile(addr) || {};
  const stats = node.getSocialStats(addr);
  const balance = isOwnProfile ? node.getBalance() : (node.blockchain.state.getBalance(addr) || 0);
  const posts = node.getUserPosts(addr);
  const rep = node.getReputation(addr);

  const el = isOwnProfile ? document.getElementById('profile-data') : document.getElementById('other-profile-data');
  if (!el) return;

  const name = profile.name || (isOwnProfile ? 'Anonymous' : addr.slice(0, 10) + '...');
  const handle = profile.handle || addr.slice(0, 12);
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
  const following = node.blockchain.state.following.get(node.wallet?.address) || new Set();
  const decor = node.getProfileDecor(addr);
  const isFollowing = following.has(addr);

  // Reputation level colors
  const levelColors = LEVEL_COLORS;
  const levelColor = levelColors[rep.level] || '#6B7280';

  // Decoration-derived styles
  const bannerItem = decor.banner ? SHOP_ITEMS.find(i => i.id === decor.banner) : null;
  const customBanner = profile.banner;
  const bannerBg = customBanner ? `url(${customBanner})` : (bannerItem ? bannerItem.preview : 'linear-gradient(135deg, var(--btn-primary-bg) 0%, var(--purple) 100%)');
  const frameItem = decor.frame ? SHOP_ITEMS.find(i => i.id === decor.frame) : null;
  const frameStyle = frameItem ? `border:3px solid transparent;background-image:${frameItem.preview};background-origin:border-box;background-clip:padding-box,border-box;` : 'border:4px solid var(--bg);';
  const badgeItem = decor.badge ? SHOP_ITEMS.find(i => i.id === decor.badge) : null;
  const badgeHtml = badgeItem ? `<i class="icon-${badgeItem.icon || 'check-circle'}" style="font-size:16px;color:${badgeItem.preview};margin-left:4px;"></i>` : '';
  const nameColorItem = decor.name_color ? SHOP_ITEMS.find(i => i.id === decor.name_color) : null;
  const nameStyle = nameColorItem
    ? (nameColorItem.preview.startsWith('linear') ? `background:${nameColorItem.preview};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-size:200% 200%;animation:gradientShift 3s ease infinite;` : `color:${nameColorItem.preview};`)
    : '';
  const animItem = decor.animation ? SHOP_ITEMS.find(i => i.id === decor.animation) : null;
  const nameClass = animItem?.id === 'anim-glow' ? ' decor-glow' : (animItem?.id === 'anim-gradient-name' ? ' decor-gradient-name' : '');
  const bioStyleItem = decor.bio_style ? SHOP_ITEMS.find(i => i.id === decor.bio_style) : null;
  const bioStyle = bioStyleItem?.id === 'bio-italic' ? 'font-style:italic;'
    : bioStyleItem?.id === 'bio-glow' ? 'text-shadow:0 0 8px rgba(0,255,255,0.4);'
    : bioStyleItem?.id === 'bio-mono' ? 'font-family:monospace;'
    : bioStyleItem?.id === 'bio-bold' ? 'font-weight:700;'
    : bioStyleItem?.id === 'bio-gradient' ? 'background:linear-gradient(90deg,#EC4899,#8B5CF6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;'
    : '';
  const titleItem = decor.title ? SHOP_ITEMS.find(i => i.id === decor.title) : null;
  const fontItem = decor.name_font ? SHOP_ITEMS.find(i => i.id === decor.name_font) : null;
  const fontStyle = fontItem ? `font-family:${fontItem.font};` : '';

  el.innerHTML = `
    <div class="profile-cover" style="background:${bannerBg};${customBanner ? 'background-size:cover;background-position:center;' : ''}"></div>
    <div style="padding:0 clamp(12px, 4vw, 40px) 24px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:-48px;">
        ${profile.avatar
          ? `<div class="avatar avatar-xl" style="${frameStyle}"><img src="${profile.avatar}" alt=""></div>`
          : `<div class="avatar avatar-xl" style="${frameStyle}"><span class="avatar-initials" style="font-size:28px;">${initials}</span></div>`
        }
        <div style="display:flex;gap:8px;">
          ${isOwnProfile
            ? `<button class="btn btn-outline" style="border-radius:18px;height:36px;" onclick="window.diademUI.navigate('shop')"><i class="icon-shopping-bag" style="font-size:14px;"></i></button>
               <button class="btn btn-outline" style="border-radius:18px;height:36px;" onclick="window.diademUI.navigate('edit-profile')">${t('profile_edit')}</button>`
            : `<button class="btn btn-outline" style="border-radius:18px;height:36px;padding:0 14px;" onclick="window.diademUI.startDMFromProfile('${addr}')" title="${t('dm_message')}"><i class="icon-message-circle" style="font-size:16px;"></i></button>
               <button class="btn btn-outline" style="border-radius:18px;height:36px;padding:0 14px;" onclick="window.diademUI.dmPaymentDialog('${addr}')" title="${t('dm_send_ddm')}"><i class="icon-wallet" style="font-size:16px;"></i></button>
               <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" style="border-radius:18px;height:36px;padding:0 24px;" onclick="window.diademUI.followUser('${addr}')">${isFollowing ? t('profile_following') : t('profile_follow')}</button>`
          }
        </div>
      </div>
      <div style="margin-top:12px;">
        <div class="profile-name${nameClass}" style="${nameStyle}${fontStyle}">${escapeHtml(name)}${badgeHtml} <span style="font-size:12px;color:${levelColor};background:${levelColor}20;padding:2px 8px;border-radius:10px;font-weight:600;vertical-align:middle;-webkit-text-fill-color:${levelColor};">${rep.level}</span></div>
        <div class="profile-handle">${escapeHtml(handle)}${titleItem ? ` <span style="font-size:11px;font-weight:600;color:${titleItem.preview};margin-left:4px;">${titleItem.name}</span>` : ''}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <i class="icon-wallet" style="font-size:14px;color:var(--text-muted);"></i>
          <span style="font-family:monospace;font-size:12px;color:var(--text-muted);">${shortAddr}</span>
          <span style="background:var(--bg-input);border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600;color:var(--text-body);">${balance.toLocaleString()} DDM</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:8px;">
          <span style="font-size:12px;color:${levelColor};font-weight:600;">⭐ ${rep.score.toFixed(1)} rep</span>
          <span style="font-size:11px;color:var(--text-muted);">${rep.posts} posts · ${rep.likesReceived} likes received · ${rep.followersGained} followers gained</span>
        </div>
        <div class="profile-bio" style="margin-top:12px;${bioStyle}">${escapeHtml(profile.bio || '')}</div>
        <div class="profile-stats" style="margin-top:12px;">
          <div style="cursor:pointer;" onclick="window.diademUI.showFollowList('${addr}','following')"><strong>${stats.following}</strong> <span>${t('profile_following')}</span></div>
          <div style="cursor:pointer;" onclick="window.diademUI.showFollowList('${addr}','followers')"><strong>${stats.followers}</strong> <span>${t('profile_followers')}</span></div>
        </div>
      </div>
    </div>
    <div style="height:1px;background:var(--divider);"></div>
    <div class="tabs" style="padding:0 clamp(12px, 4vw, 40px);" id="profile-tabs-${addr.slice(0,8)}">
      <button class="tab active" onclick="window.diademUI._profileTab('${addr}','posts',this)">${t('profile_posts')}</button>
      <button class="tab" onclick="window.diademUI._profileTab('${addr}','replies',this)">${t('profile_replies')}</button>
      <button class="tab" onclick="window.diademUI._profileTab('${addr}','media',this)">${t('profile_media')}</button>
      <button class="tab" onclick="window.diademUI._profileTab('${addr}','likes',this)">${t('profile_likes')}</button>
      <button class="tab" onclick="window.diademUI._profileTab('${addr}','stats',this)">${t('profile_stats')}</button>
      <button class="tab" onclick="window.diademUI._profileTab('${addr}','stories',this)">${t('stories_title')}</button>
    </div>
    <div style="padding:0 clamp(12px, 4vw, 40px);" id="profile-tab-content">
      ${posts.length > 0 ? posts.map(p => renderPost(p)).join('') :
        `<div class="text-muted" style="text-align:center;padding:40px;">${t('profile_no_posts')}</div>`}
    </div>
  `;

  // Restore active tab if not 'posts'
  if (_currentProfileTab && _currentProfileTab !== 'posts') {
    const savedTab = _currentProfileTab;
    requestAnimationFrame(() => {
      window.diademUI._profileTab(addr, savedTab);
    });
  }
}

// ─── Single Post View ─────────────────────────────────────

function renderSinglePost(postId) {
  const el = document.getElementById('single-post-data');
  if (!el) return;

  let post = node.blockchain.state.posts.get(postId);
  // If not found in posts, search in replies
  if (!post) {
    for (const [parentId, replyList] of node.blockchain.state.replies) {
      const found = replyList.find(r => r.id === postId || r.hash === postId);
      if (found) {
        post = { ...found, _isReply: true, _parentId: parentId };
        break;
      }
    }
  }
  if (!post) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('search_empty')}</div>`;
    return;
  }

  const profile = node.getProfile(post.author) || {};
  const name = profile.name || post.author.slice(0, 10) + '...';
  const handle = profile.handle || post.author.slice(0, 12);
  const myAddr = node.wallet?.address;
  const likesById = node.blockchain.state.likes.get(postId);
  const likesByHash = post.hash && post.hash !== postId ? node.blockchain.state.likes.get(post.hash) : null;
  const likesSet = likesById || likesByHash || new Set();
  const likesCount = likesSet.size;
  const liked = (myAddr && likesSet.has(myAddr)) ? ' liked' : '';
  const myProfile = node.getProfile() || {};
  const rep = node.blockchain.state.getReputation(post.author);
  const authorStats = node.getSocialStats(post.author);
  const isFollowing = (node.blockchain.state.following.get(myAddr) || new Set()).has(post.author);
  const isOwnPost = post.author === myAddr;
  const bookmarks = JSON.parse(localStorage.getItem('diadem_bookmarks') || '[]');
  const isBookmarked = bookmarks.includes(postId);

  // Full date formatting
  const postDate = new Date(post.timestamp);
  const fullDate = postDate.toLocaleDateString(getLang() === 'uk' ? 'uk-UA' : 'en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const fullTime = postDate.toLocaleTimeString(getLang() === 'uk' ? 'uk-UA' : 'en-US', {
    hour: '2-digit', minute: '2-digit',
  });

  // Reputation level colors
  const levelColors = LEVEL_COLORS;
  const levelColor = levelColors[rep.level] || '#6B7280';

  // Decor
  const spDecor = node.blockchain.state.profileDecor.get(post.author) || {};
  const spFontItem = spDecor.name_font ? SHOP_ITEMS.find(i => i.id === spDecor.name_font) : null;
  const spFontStyle = spFontItem ? `font-family:${spFontItem.font};` : '';

  // List of likers
  const likersList = [...likesSet].slice(0, 8);
  const likersProfiles = likersList.map(addr => {
    const p = node.getProfile(addr) || {};
    return { address: addr, name: p.name || addr.slice(0, 8) + '...', avatar: p.avatar };
  });

  // Find replies
  const replies = [];
  const stateReplies = node.blockchain.state.replies.get(postId) || [];
  for (const r of stateReplies) {
    const rLikesById = node.blockchain.state.likes.get(r.id) || new Set();
    const rLiked = (myAddr && rLikesById.has(myAddr)) ? ' liked' : '';
    replies.push({ ...r, profile: node.getProfile(r.author), likesCount: rLikesById.size, liked: rLiked });
  }
  // Legacy
  for (const [pid, p] of node.blockchain.state.posts) {
    if (p.content && p.content.startsWith(`@reply:${postId} `)) {
      const rLikes = node.blockchain.state.likes.get(pid) || new Set();
      replies.push({ ...p, id: pid, profile: node.getProfile(p.author), likesCount: rLikes.size, liked: myAddr && rLikes.has(myAddr) ? ' liked' : '' });
    }
  }
  replies.sort((a, b) => a.timestamp - b.timestamp);

  el.innerHTML = `
    <div class="sp-header">
      <button class="sp-back" onclick="history.back()">
        <i class="icon-arrow-left"></i>
      </button>
      <h2 class="sp-title">${t('post_title')}</h2>
    </div>

    <div class="sp-main">
      <div class="sp-author-row">
        <div class="sp-author-left" onclick="window.diademUI.viewUser('${post.author}')" style="cursor:pointer;">
          ${renderAvatar(profile, 'lg')}
          <div class="sp-author-info">
            <div class="sp-author-name" style="${spFontStyle}">
              ${escapeHtml(name)}
              <span class="sp-badge" style="background:${levelColor}20;color:${levelColor};">${rep.level}</span>
            </div>
            <div class="sp-author-handle">${escapeHtml(handle)}</div>
          </div>
        </div>
        ${isOwnPost ? `
          <button class="post-action" onclick="window.diademUI.deletePost('${postId}')" title="Delete"><i class="icon-trash-2"></i></button>
        ` : `
          <button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" style="border-radius:20px;height:36px;padding:0 20px;font-size:13px;" onclick="window.diademUI.followUser('${post.author}')">${isFollowing ? t('profile_following') : t('profile_follow')}</button>
        `}
      </div>

      ${post._isReply ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;"><i class="icon-corner-up-left" style="font-size:12px;"></i> <a href="#single-post/${post._parentId}" onclick="event.preventDefault();window.diademUI.viewPost('${post._parentId}')" style="color:var(--btn-primary-bg);text-decoration:none;">${t('reply_to_original') || 'View original post'}</a></div>` : ''}
      <div class="sp-content">${formatPostContent(post.content)}</div>

      ${renderPostMedia(post)}

      ${renderReactions(postId)}

      <div class="sp-meta">
        <span class="sp-time">${fullTime}</span>
        <span class="sp-dot">·</span>
        <span class="sp-date">${fullDate}</span>
        <span class="sp-dot">·</span>
        <span class="sp-chain"><i class="icon-link" style="font-size:12px;"></i> ${t('sp_on_chain')}</span>
      </div>

      <div class="sp-stats-bar">
        <div class="sp-stat" onclick="window.diademUI._showLikersList('${postId}')" style="cursor:pointer;">
          <strong>${likesCount}</strong> <span>${t('sp_like')}</span>
        </div>
        <div class="sp-stat">
          <strong>${replies.length}</strong> <span>${t('post_replies')}</span>
        </div>
        ${likersProfiles.length > 0 ? `
          <div class="sp-likers">
            ${likersProfiles.map(l => l.avatar
              ? `<div class="sp-liker-avatar" title="${escapeHtml(l.name)}"><img src="${l.avatar}" alt=""></div>`
              : `<div class="sp-liker-avatar" title="${escapeHtml(l.name)}" style="background:var(--avatar-fill);font-size:9px;color:var(--text-muted);display:flex;align-items:center;justify-content:center;">${l.name[0]}</div>`
            ).join('')}
            ${likesCount > 8 ? `<span class="sp-likers-more">+${likesCount - 8}</span>` : ''}
          </div>
        ` : ''}
      </div>

      <div class="sp-actions">
        <button class="sp-action-btn${liked}" onclick="window.diademUI.likePost('${postId}')">
          <i class="icon-heart"></i>
          <span>${liked ? t('sp_liked') : t('sp_like')}</span>
        </button>
        <button class="sp-action-btn" onclick="document.getElementById('reply-input').focus()">
          <i class="icon-message-circle"></i>
          <span>${t('sp_reply')}</span>
        </button>
        <button class="sp-action-btn${(node.blockchain.state.reposts.get(postId) || new Set()).has(myAddr) ? ' reposted' : ''}" onclick="window.diademUI.repostPost('${postId}')">
          <i class="icon-repeat-2"></i>
          <span>${(node.blockchain.state.reposts.get(postId) || new Set()).size || ''} Repost</span>
        </button>
        <button class="sp-action-btn${isBookmarked ? ' liked' : ''}" onclick="window.diademUI.bookmarkPost('${postId}')">
          <i class="icon-bookmark"></i>
          <span>${isBookmarked ? t('sp_saved') : t('sp_save')}</span>
        </button>
      </div>
    </div>

    <div class="sp-reply-compose">
      ${renderAvatar(myProfile)}
      <div class="sp-reply-input-wrap">
        <input type="text" id="reply-input" class="sp-reply-input" placeholder="${t('post_reply_placeholder')}" onkeydown="if(event.key==='Enter'&&this.value.trim())window.diademUI.postReply('${postId}')">
      </div>
      <button class="sp-reply-send" onclick="window.diademUI.postReply('${postId}')">
        <i class="icon-send"></i>
      </button>
    </div>

    <div class="sp-replies-section">
      <div class="sp-replies-header">
        <span>${t('post_replies')}</span>
        <span class="sp-replies-count">${replies.length}</span>
      </div>

      ${replies.length === 0
        ? `<div class="sp-empty-replies">
            <i class="icon-message-circle" style="font-size:32px;color:var(--text-muted);opacity:0.4;"></i>
            <p>${t('post_no_replies')}</p>
          </div>`
        : `<div class="sp-replies-list">
            ${replies.map((r, idx) => {
              const rp = r.profile || {};
              const rn = rp.name || r.author.slice(0, 10);
              const rh = rp.handle || r.author.slice(0, 12);
              const content = r.content.replace(`@reply:${postId} `, '');
              const rRep = node.blockchain.state.getReputation(r.author);
              const rLevelColor = levelColors[rRep.level] || '#6B7280';
              const rReactions = renderReactions(r.id);
              return `
                <div class="sp-reply${idx === 0 ? ' sp-reply-first' : ''}">
                  <div class="sp-reply-thread-line"></div>
                  ${renderAvatar(rp)}
                  <div class="sp-reply-body">
                    <div class="sp-reply-header">
                      <span class="sp-reply-name" onclick="window.diademUI.viewUser('${r.author}')">${escapeHtml(rn)}</span>
                      <span class="sp-reply-badge" style="color:${rLevelColor};">${rRep.level}</span>
                      <span class="sp-reply-time">${formatTimeAgo(r.timestamp)}</span>
                    </div>
                    <div class="sp-reply-text">${escapeHtml(content)}</div>
                    ${rReactions}
                    <div class="sp-reply-actions">
                      <button class="post-action${r.liked || ''}" onclick="window.diademUI.likePost('${r.id}')"><i class="icon-heart"></i> ${r.likesCount}</button>
                      <button class="post-action" onclick="window.diademUI.showReactionPicker('${r.id}')"><i class="icon-smile"></i></button>
                      ${r.author === myAddr ? `<button class="post-action" onclick="window.diademUI.deleteReply('${r.id}','${postId}')" title="Delete"><i class="icon-trash-2"></i></button>` : ''}
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>`
      }
    </div>
  `;
}

// ─── Wallet ───────────────────────────────────────────────

function renderWallet() {
  const balance = node.getBalance();
  const stake = node.getStake();
  const info = node.getNodeInfo();
  const rep = node.getReputation();
  const el = document.getElementById('wallet-data');
  if (!el) return;

  const levelColors = LEVEL_COLORS;
  const levelColor = levelColors[rep.level] || '#6B7280';

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
      <h2>${t('wallet_title')}</h2>
      <div class="flex gap-8">
        <button class="btn btn-sm" style="background:var(--green);color:#FFF;border:none;" onclick="window.diademUI.showTransferModal()">${t('wallet_send')}</button>
        <button class="btn btn-outline btn-sm" onclick="navigator.clipboard.writeText('${node.wallet.address}').then(()=>window.diademUI._toast('${t('copied')}','success',2000))">${t('wallet_copy')}</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px;">
      <div class="card" style="padding:20px;">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${t('wallet_total')}</div>
        <div style="font-size:28px;font-weight:700;color:var(--text-primary);">${balance.toLocaleString()} DDM</div>
      </div>
      <div class="card" style="padding:20px;">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${t('wallet_staked')}</div>
        <div style="font-size:28px;font-weight:700;color:var(--text-primary);">${stake.amount.toLocaleString()} DDM</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">APY 14.2%</div>
      </div>
      <div class="card" style="padding:20px;cursor:pointer;position:relative;" onclick="document.getElementById('rep-panel').classList.toggle('hidden')">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Reputation <i class="icon-chevron-down" style="font-size:12px;"></i></div>
        <div style="font-size:28px;font-weight:700;color:${levelColor};">${rep.score.toFixed(1)}</div>
        <div style="font-size:13px;color:${levelColor};margin-top:4px;">${rep.level}</div>
      </div>
      <div class="card" style="padding:20px;">
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${t('wallet_network')}</div>
        <div style="font-size:28px;font-weight:700;color:var(--text-primary);">Block #${info.chain.height}</div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:4px;">${info.network.peers} ${t('wallet_peers')}</div>
      </div>
    </div>
    ${(() => {
      const rp = getRepProgress(rep.score);
      const nextColor = rp.next ? (LEVEL_COLORS[rp.next.level] || '#6B7280') : levelColor;
      const pct = Math.round(rp.progress);
      return `
    <div id="rep-panel" class="card hidden" style="padding:0;margin-bottom:24px;overflow:hidden;">
      <!-- Hero banner -->
      <div style="background:linear-gradient(135deg,${levelColor}20,${nextColor}10);padding:24px 24px 20px;border-bottom:1px solid var(--divider);">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">
          <div style="width:56px;height:56px;border-radius:50%;background:${levelColor};display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:#FFF;flex-shrink:0;">${rp.curIdx + 1}</div>
          <div style="flex:1;">
            <div style="font-size:20px;font-weight:800;color:${levelColor};line-height:1.2;">${rep.level}</div>
            <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">${rep.score.toLocaleString()} reputation</div>
          </div>
          ${rp.next ? `<div style="text-align:right;">
            <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">Next</div>
            <div style="font-size:15px;font-weight:700;color:${nextColor};">${rp.next.level}</div>
          </div>` : `<div style="font-size:13px;font-weight:700;color:${levelColor};">MAX</div>`}
        </div>
        <!-- Progress bar -->
        <div style="height:8px;background:rgba(0,0,0,0.15);border-radius:4px;overflow:hidden;">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,${levelColor},${nextColor});border-radius:4px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;">
          <span style="color:${levelColor};font-weight:600;">${pct}%</span>
          <span style="color:var(--text-muted);">${rp.next ? rp.remaining.toLocaleString() + ' to go' : 'Complete!'}</span>
        </div>
      </div>

      <!-- Stats row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--divider);">
        ${[
          { label: 'Posts', val: rep.posts, icon: 'edit-3', rep: '+1' },
          { label: 'Likes In', val: rep.likesReceived, icon: 'heart', rep: '+2' },
          { label: 'Likes Out', val: rep.likesGiven, icon: 'thumbs-up', rep: '+0.5' },
          { label: 'Followers', val: rep.followersGained, icon: 'users', rep: '+3' },
        ].map(s => `
          <div style="padding:16px 12px;text-align:center;border-right:1px solid var(--divider);">
            <i class="icon-${s.icon}" style="font-size:16px;color:var(--text-muted);margin-bottom:6px;display:block;"></i>
            <div style="font-size:18px;font-weight:700;color:var(--text-primary);">${s.val.toLocaleString()}</div>
            <div style="font-size:11px;color:var(--text-muted);">${s.label}</div>
            <div style="font-size:10px;color:var(--green);margin-top:2px;">${s.rep} rep</div>
          </div>
        `).join('')}
      </div>

      <!-- Level roadmap -->
      <div style="padding:20px 24px;">
        <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Level Roadmap</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          ${LEVEL_THRESHOLDS.map((t, i) => {
            const c = LEVEL_COLORS[t.level] || '#6B7280';
            const passed = rep.score >= t.min;
            const isCurrent = t.level === rep.level;
            const nextT = LEVEL_THRESHOLDS[i + 1];
            const segPct = passed && nextT ? Math.min(100, ((rep.score - t.min) / (nextT.min - t.min)) * 100) : (passed ? 100 : 0);
            return `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;border-radius:8px;${isCurrent ? 'background:' + c + '15;' : ''}">
              <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${passed ? c : 'var(--divider)'};${isCurrent ? 'box-shadow:0 0 6px ' + c + ';' : ''}"></div>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <span style="font-size:12px;font-weight:${isCurrent ? '700' : '500'};color:${passed ? c : 'var(--text-muted)'};">${t.level}</span>
                  <span style="font-size:11px;color:var(--text-muted);">${t.min.toLocaleString()}</span>
                </div>
                ${isCurrent && rp.next ? `<div style="height:3px;background:var(--divider);border-radius:2px;margin-top:4px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:${c};border-radius:2px;"></div>
                </div>` : ''}
              </div>
              ${passed ? '<i class="icon-check" style="font-size:12px;color:var(--green);flex-shrink:0;"></i>' : ''}
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
    })()}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div class="card" style="padding:24px;">
        <h4 style="margin-bottom:16px;">${t('wallet_cas')}</h4>
        <div style="color:var(--text-secondary);font-size:14px;">
          <div class="flex justify-between mb-8"><span>${t('wallet_objects')}:</span><span style="color:var(--text-primary);">${info.cas.objects}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_size')}:</span><span style="color:var(--text-primary);">${info.cas.size}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_pinned')}:</span><span style="color:var(--text-primary);">${info.cas.pins}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_ipfs_mapped')}:</span><span style="color:var(--text-primary);">${info.ipfs?.mappedObjects || 0}</span></div>
          <div class="flex justify-between"><span>${t('wallet_accounts')}:</span><span style="color:var(--text-primary);">${info.state.totalAccounts}</span></div>
        </div>
      </div>
      <div class="card" style="padding:24px;">
        <h4 style="margin-bottom:16px;">${t('wallet_blockchain')}</h4>
        <div style="color:var(--text-secondary);font-size:14px;">
          <div class="flex justify-between mb-8"><span>${t('wallet_height')}:</span><span style="color:var(--text-primary);">#${info.chain.height}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_blocks')}:</span><span style="color:var(--text-primary);">${info.chain.blocks}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_pending')}:</span><span style="color:var(--text-primary);">${info.chain.pendingTxs}</span></div>
          <div class="flex justify-between"><span>${t('wallet_total_staked')}:</span><span style="color:var(--text-primary);">${info.state.totalStaked.toLocaleString()} DDM</span></div>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px;">
      <div class="card" style="padding:24px;">
        <h4 style="margin-bottom:16px;">Fees & Rewards</h4>
        <div style="color:var(--text-secondary);font-size:14px;">
          <div class="flex justify-between mb-8"><span>Create Post:</span><span style="color:var(--red);">-1 DDM</span></div>
          <div class="flex justify-between mb-8"><span>Update Profile:</span><span style="color:var(--red);">-0.5 DDM</span></div>
          <div class="flex justify-between mb-8"><span>Receive Like:</span><span style="color:var(--green);">+0.1 DDM</span></div>
          <div class="flex justify-between mb-8"><span>Block Reward:</span><span style="color:var(--green);">+10 DDM</span></div>
          <div class="flex justify-between"><span>Staking APY:</span><span style="color:var(--green);">14.2%</span></div>
        </div>
      </div>
      <div class="card" style="padding:24px;">
        <h4 style="margin-bottom:16px;">Reputation Stats</h4>
        <div style="color:var(--text-secondary);font-size:14px;">
          <div class="flex justify-between mb-8"><span>Posts Created:</span><span style="color:var(--text-primary);">${rep.posts} (+1 rep)</span></div>
          <div class="flex justify-between mb-8"><span>Likes Received:</span><span style="color:var(--text-primary);">${rep.likesReceived} (+2 rep)</span></div>
          <div class="flex justify-between mb-8"><span>Likes Given:</span><span style="color:var(--text-primary);">${rep.likesGiven} (+0.5 rep)</span></div>
          <div class="flex justify-between mb-8"><span>Followers Gained:</span><span style="color:var(--text-primary);">${rep.followersGained} (+3 rep)</span></div>
          <div class="flex justify-between"><span>Total Score:</span><span style="color:${levelColor};font-weight:700;">${rep.score.toFixed(1)} — ${rep.level}</span></div>
        </div>
      </div>
    </div>
  `;
}

// ─── Staking ──────────────────────────────────────────────

function renderStaking() {
  const balance = node.getBalance();
  const stake = node.getStake();
  const validators = node.getValidators();
  const el = document.getElementById('staking-data');
  if (!el) return;

  el.innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="label">${t('staking_total')}</div><div class="value">${stake.amount.toLocaleString()} DDM</div></div>
      <div class="stat-card"><div class="label">${t('staking_apy')}</div><div class="value">14.2%</div><div class="sub">${t('staking_compound')}</div></div>
      <div class="stat-card"><div class="label">${t('staking_available')}</div><div class="value">${balance.toLocaleString()} DDM</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div class="card">
        <h4 class="mb-16">${t('staking_title')}</h4>
        <div class="form-group">
          <label>${t('staking_amount')}</label>
          <input type="number" class="input-field" id="stake-amount" placeholder="100" value="1000">
          <div class="text-xs text-muted mt-16">${t('staking_available')}: ${balance.toLocaleString()} DDM (${t('staking_min')})</div>
        </div>
        <button class="btn btn-primary btn-lg w-full" onclick="window.diademUI.doStake()">${t('staking_now')}</button>
        ${stake.amount > 0 ? `<button class="btn btn-outline btn-lg w-full mt-16" onclick="window.diademUI.doUnstake()">${t('staking_unstake')}</button>` : ''}
      </div>
      <div class="card">
        <h4 class="mb-16">${t('staking_validators')} (${validators.length})</h4>
        ${validators.length > 0 ? validators.map(v => `
          <div class="validator-row">
            <div class="validator-dot" style="background:#22C55E;"></div>
            <div class="validator-info"><div class="font-medium text-sm" style="color:var(--text-primary);">${v.profile?.name || v.address.slice(0, 12) + '...'}</div></div>
            <div class="validator-stats"><div style="color:var(--text-primary);">${v.stake.toLocaleString()} DDM</div></div>
          </div>`).join('') : `<div class="text-muted text-sm">${t('staking_no_validators')}</div>`}
      </div>
    </div>
  `;
}

// ─── Governance ──────────────────────────────────────────

function renderGovernance() {
  const el = document.getElementById('governance-data');
  if (!el) return;
  const stake = node.getStake();
  el.innerHTML = `
    <div class="stat-cards">
      <div class="stat-card"><div class="label">${t('governance_power')}</div><div class="value">${stake.amount.toLocaleString()} DDM</div></div>
      <div class="stat-card"><div class="label">${t('governance_active')}</div><div class="value">0</div></div>
    </div>
    <div class="card">
      <h4 class="mb-16">${t('governance_title')}</h4>
      <p class="text-muted text-sm">${t('governance_empty')}</p>
      <p class="text-muted text-sm mt-16">${t('governance_stake_note')}</p>
    </div>
  `;
}

// ─── Notifications ────────────────────────────────────────

function renderNotifications() {
  const el = document.getElementById('notifications-data');
  if (!el) return;
  localStorage.setItem('diadem_notif_seen', String(Date.now()));
  _updateUnreadBadges();
  const txs = node.getTransactions(30);
  if (txs.length === 0) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('notif_empty')}</div>`;
    return;
  }
  // Filter out string hashes (legacy data) — only show proper tx objects
  const validTxs = txs.filter(tx => typeof tx !== 'string' && tx.type);
  if (validTxs.length === 0) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">No detailed notifications yet.<br><span style="font-size:12px;">New actions will appear here with full details.</span></div>`;
    return;
  }
  // Helper: get display name for an address
  const getName = (addr) => {
    if (!addr) return '?';
    const p = node.getProfile(addr);
    return p?.name || addr.slice(0, 8) + '...';
  };
  const myAddr = node.wallet?.address;

  el.innerHTML = `<div class="notif-section-title">${t('notif_recent')}</div>` +
    validTxs.map(tx => {
      const txObj = tx;
      const type = txObj.type || 'unknown';
      let icon = 'icon-bell', text = '', clickAddr = null;

      if (type === 'like') {
        icon = 'icon-heart';
        if (txObj.from === myAddr) {
          text = t('notif_like');
        } else {
          text = `<strong>${escapeHtml(getName(txObj.from))}</strong> ${t('notif_liked_your')} (+0.1 DDM)`;
          clickAddr = txObj.from;
        }
      }
      else if (type === 'follow') {
        icon = 'icon-user-plus';
        if (txObj.from === myAddr) {
          text = `${t('notif_you_followed')} <strong>${escapeHtml(getName(txObj.to))}</strong>`;
          clickAddr = txObj.to;
        } else {
          text = `<strong>${escapeHtml(getName(txObj.from))}</strong> ${t('notif_followed_you')} (+3 rep)`;
          clickAddr = txObj.from;
        }
      }
      else if (type === 'unfollow') {
        icon = 'icon-user-minus';
        text = `${t('notif_unfollowed')} <strong>${escapeHtml(getName(txObj.to))}</strong>`;
        clickAddr = txObj.to;
      }
      else if (type === 'transfer') {
        icon = 'icon-arrow-left-right';
        if (txObj.to === myAddr) {
          text = `${t('notif_received')} ${(txObj.amount || 0).toLocaleString()} DDM ${t('notif_from')} <strong>${escapeHtml(getName(txObj.from))}</strong>`;
          clickAddr = txObj.from;
        } else {
          text = `${t('notif_sent')} ${(txObj.amount || 0).toLocaleString()} DDM → <strong>${escapeHtml(getName(txObj.to))}</strong>`;
          clickAddr = txObj.to;
        }
      }
      else if (type === 'post') { icon = 'icon-edit'; text = `${t('notif_post')} (-1 DDM)`; }
      else if (type === 'stake') { icon = 'icon-landmark'; text = `${t('notif_staked')} ${(txObj.amount || 0).toLocaleString()} DDM`; }
      else if (type === 'unstake') { icon = 'icon-landmark'; text = `${t('notif_unstaked')} ${(txObj.amount || 0).toLocaleString()} DDM`; }
      else if (type === 'reward') { icon = 'icon-gift'; text = `${t('notif_reward')} +${(txObj.amount || 0).toLocaleString()} DDM`; }
      else if (type === 'profile_update') { icon = 'icon-user'; text = `${t('notif_profile_updated')} (-0.5 DDM)`; }
      else if (type === 'reply') {
        icon = 'icon-message-circle';
        if (txObj.from === myAddr) {
          text = t('notif_you_replied');
        } else {
          text = `<strong>${escapeHtml(getName(txObj.from))}</strong> ${t('notif_replied_your')}`;
          clickAddr = txObj.from;
        }
      }
      else if (type === 'unlike') {
        icon = 'icon-heart';
        if (txObj.from === myAddr) {
          text = t('notif_unlike');
        } else {
          text = `<strong>${escapeHtml(getName(txObj.from))}</strong> ${t('notif_unliked_your')}`;
          clickAddr = txObj.from;
        }
      }
      else if (type === 'delete_post') { icon = 'icon-trash-2'; text = t('notif_deleted_post'); }
      else if (type === 'delete_reply') { icon = 'icon-trash-2'; text = t('notif_deleted_reply'); }
      else if (type === 'saved_message') { icon = 'icon-bookmark'; text = t('notif_saved_msg'); }
      else if (type === 'reaction') {
        icon = 'icon-smile';
        const emoji = txObj.data?.emoji || '';
        if (txObj.from === myAddr) {
          text = `${t('notif_you_reacted')} ${emoji}`;
        } else {
          text = `<strong>${escapeHtml(getName(txObj.from))}</strong> ${t('notif_reacted')} ${emoji}`;
          clickAddr = txObj.from;
        }
      }
      else if (type === 'profile_decor' || type === 'equip_decor') { icon = 'icon-shopping-bag'; text = t('notif_decor'); }
      else if (type === 'vote') { icon = 'icon-check-circle'; text = t('notif_voted'); }
      else if (!text) { text = type !== 'unknown' ? type.replace(/_/g, ' ') : 'Transaction'; }

      const clickable = clickAddr ? ` style="cursor:pointer;" onclick="window.diademUI.viewUser('${clickAddr}')"` : '';
      return `<div class="notif-item"${clickable}><div class="notif-icon"><i class="${icon}"></i></div><div class="notif-text">${text}${txObj.timestamp ? `<div class="notif-time">${formatTimeAgo(txObj.timestamp)}</div>` : ''}</div></div>`;
    }).join('');
}

// ─── Transactions ─────────────────────────────────────────

function renderTransactions(filter = 'all') {
  const el = document.getElementById('transactions-data');
  if (!el) return;
  let txs = node.getTransactions(50);
  const txItems = txs.map(tx => typeof tx === 'string' ? { hash: tx, type: 'unknown' } : tx);

  const pills = [
    { id: 'all', label: t('tx_all') },
    { id: 'transfer', label: t('tx_sent') },
    { id: 'received', label: t('tx_received') },
    { id: 'social', label: 'Social' },
    { id: 'stake', label: t('tx_staking') },
    { id: 'vote', label: t('tx_governance') },
  ];

  const filtered = filter === 'all' ? txItems : txItems.filter(tx => {
    if (filter === 'transfer') return tx.type === 'transfer' && tx.from === node.wallet.address;
    if (filter === 'received') return tx.type === 'transfer' && tx.to === node.wallet.address;
    if (filter === 'social') return ['post', 'like', 'follow', 'unfollow', 'profile_update'].includes(tx.type);
    if (filter === 'stake') return ['stake', 'unstake', 'reward'].includes(tx.type);
    if (filter === 'vote') return tx.type === 'vote';
    return true;
  });

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:20px;">
      <h2 style="font-size:20px;">${t('tx_title')}</h2>
      <div class="search-box" style="width:260px;">
        <i class="icon-search"></i>
        <input type="text" class="input-field" placeholder="${t('tx_search')}" style="padding-left:36px;border-radius:19px;height:38px;">
      </div>
    </div>
    <div class="filter-pills" style="margin-bottom:20px;">
      ${pills.map(p => `<button class="pill${filter === p.id ? ' active' : ''}" onclick="window.diademUI.filterTransactions('${p.id}')">${p.label}</button>`).join('')}
    </div>
    <div style="height:1px;background:var(--divider);"></div>
    ${filtered.length === 0
      ? `<div class="text-muted" style="text-align:center;padding:40px;">${t('tx_empty')}</div>`
      : filtered.map(tx => renderTransactionRow(tx)).join('')}
  `;
}

function renderTransactionRow(tx) {
  if (typeof tx === 'string') return `<div class="tx-row"><div class="tx-info"><div class="tx-name" style="font-family:monospace;font-size:12px;">${tx.slice(0, 40)}...</div></div></div>`;

  const type = tx.type || 'unknown';
  let bgColor = '#F5F5F5', iconColor = '#6B7280', title = type, amountStr = '', amountColor = 'var(--text-primary)';
  const addr = (type === 'transfer' && tx.to === node.wallet.address) ? tx.from : (tx.to || tx.from || '');
  const shortAddr = addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : '';
  const prefix = (type === 'transfer' && tx.to === node.wallet.address) ? t('tx_from') : t('tx_to');

  switch (type) {
    case 'transfer':
      if (tx.to === node.wallet.address) {
        title = t('tx_received_ddm'); bgColor = '#F0FDF4'; iconColor = '#22C55E';
        amountStr = `+${(tx.amount || 0).toLocaleString()} DDM`; amountColor = '#22C55E';
      } else {
        title = t('tx_sent_ddm'); bgColor = '#FEF2F2'; iconColor = '#EF4444';
        amountStr = `-${(tx.amount || 0).toLocaleString()} DDM`; amountColor = '#EF4444';
      }
      break;
    case 'stake': title = t('tx_stake_deposit'); amountStr = `-${(tx.amount || 0).toLocaleString()} DDM`; break;
    case 'unstake': title = t('tx_unstake'); bgColor = '#F0FDF4'; iconColor = '#22C55E'; amountStr = `+${(tx.amount || 0).toLocaleString()} DDM`; amountColor = '#22C55E'; break;
    case 'reward': title = t('tx_stake_reward'); bgColor = '#F0FDF4'; iconColor = '#22C55E'; amountStr = `+${(tx.amount || 0).toLocaleString()} DDM`; amountColor = '#22C55E'; break;
    case 'vote': title = t('tx_gov_vote'); bgColor = '#EFF6FF'; iconColor = '#3B82F6'; amountStr = t('tx_voted'); amountColor = '#3B82F6'; break;
    case 'post': title = t('tx_post_created'); amountStr = '-1 DDM'; amountColor = '#EF4444'; bgColor = '#FEF2F2'; iconColor = '#EF4444'; break;
    case 'like':
      title = t('tx_liked'); bgColor = '#FEF2F2'; iconColor = '#EF4444';
      // Check if we received a like reward
      if (tx.data?.postHash) {
        const likedPost = node.blockchain.state.posts.get(tx.data.postHash);
        if (likedPost && likedPost.author === node.wallet?.address && tx.from !== node.wallet?.address) {
          title = 'Received like'; bgColor = '#F0FDF4'; iconColor = '#22C55E';
          amountStr = '+0.1 DDM'; amountColor = '#22C55E';
        }
      }
      break;
    case 'follow': title = t('tx_followed'); bgColor = '#EFF6FF'; iconColor = '#3B82F6'; break;
    case 'unfollow': title = 'Unfollowed'; bgColor = '#F5F5F5'; iconColor = '#6B7280'; break;
    case 'profile_update': title = t('tx_profile_update'); amountStr = '-0.5 DDM'; amountColor = '#EF4444'; break;
  }

  return `
    <div class="tx-row">
      <div class="tx-icon" style="background:${bgColor};color:${iconColor};width:40px;height:40px;border-radius:20px;"><i class="icon-arrow-left-right" style="font-size:18px;"></i></div>
      <div class="tx-info">
        <div class="tx-name">${title}</div>
        <div class="tx-detail">${shortAddr ? `${prefix} ${shortAddr}` : ''} · ${formatTimeAgo(tx.timestamp)}</div>
      </div>
      <div class="tx-amount" style="color:${amountColor};">${amountStr}</div>
    </div>`;
}

// ─── Messages ──────────────────────────────────────────────

// Track rendered message count to enable incremental updates
let _dmRenderedCount = 0;

function renderMessages() {
  const el = document.getElementById('messages-data');
  if (!el) return;

  // If chat is already open, try incremental update first
  if (_activeDMAddress && _activeDMAddress !== '__saved__' && _dmRenderedCount > 0 && el.querySelector(`.chat-messages[data-chat="${_activeDMAddress}"]`)) {
    if (_incrementalDMUpdate(_activeDMAddress)) {
      _updateChatList(); // lightweight sidebar refresh
      return;
    }
  }

  // Full render (first load or chat switch)
  _fullRenderMessages(el);
}

function _fullRenderMessages(el) {
  const savedMsgs = node.getSavedMessages();
  const dmChats = node.getDMChats();

  const chatListHtml = _buildChatListHtml(dmChats, savedMsgs);

  let chatAreaHtml = '';
  if (_activeDMAddress === '__saved__') {
    chatAreaHtml = _renderSavedChat(savedMsgs);
  } else if (_activeDMAddress) {
    chatAreaHtml = _renderDMChat(_activeDMAddress);
  } else {
    chatAreaHtml = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
        <i class="icon-message-circle" style="font-size:56px;margin-bottom:16px;opacity:0.3;"></i>
        <div style="font-size:16px;font-weight:500;">${t('dm_select_chat')}</div>
        <div style="font-size:13px;margin-top:4px;">${t('dm_select_hint')}</div>
      </div>`;
  }

  el.innerHTML = `
    <div class="messages-layout">
      <div class="messages-list">
        <div class="messages-list-header">
          <h3 style="font-size:18px;">${t('msg_title')}</h3>
          <button class="btn btn-outline" style="border-radius:18px;height:32px;padding:0 14px;font-size:12px;" onclick="window.diademUI.newDMDialog()"><i class="icon-edit" style="font-size:14px;"></i></button>
        </div>
        <div id="dm-chat-list" style="padding:4px 0;">
          ${chatListHtml}
        </div>
      </div>
      <div class="chat-area">
        ${chatAreaHtml}
      </div>
    </div>
  `;

  // Track how many messages we rendered
  if (_activeDMAddress && _activeDMAddress !== '__saved__') {
    _dmRenderedCount = node.getDMMessages(_activeDMAddress).length;
  }

  // Scroll chat to bottom
  const chatEl = el.querySelector('.chat-messages');
  if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
}

/** Append only new messages without touching the rest of the DOM */
function _incrementalDMUpdate(otherAddr) {
  const msgs = node.getDMMessages(otherAddr);
  const chatEl = document.querySelector(`.chat-messages[data-chat="${otherAddr}"]`);
  if (!chatEl) return false; // wrong chat or not rendered yet — need full render

  // Collect IDs already in the DOM
  const existingIds = new Set();
  chatEl.querySelectorAll('[data-msg-id]').forEach(el => existingIds.add(el.dataset.msgId));

  // Find truly new messages
  const newMsgs = msgs.filter(m => !existingIds.has(m.id));
  if (newMsgs.length === 0) return true; // nothing new, skip

  const myAddr = node.wallet?.address;
  const wasAtBottom = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 60;

  for (const msg of newMsgs) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = _renderMsgBubble(msg, myAddr);
    const child = wrapper.firstElementChild;
    if (child) {
      child.style.opacity = '0';
      child.style.transform = 'translateY(12px)';
      chatEl.appendChild(child);
      requestAnimationFrame(() => {
        child.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        child.style.opacity = '1';
        child.style.transform = 'translateY(0)';
      });
    }
  }

  _dmRenderedCount = msgs.length;

  if (wasAtBottom) {
    requestAnimationFrame(() => {
      chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
    });
  }

  return true;
}

/** Update sidebar chat list without touching the chat area */
function _updateChatList() {
  const listEl = document.getElementById('dm-chat-list');
  if (!listEl) return;
  const savedMsgs = node.getSavedMessages();
  const dmChats = node.getDMChats();
  listEl.innerHTML = _buildChatListHtml(dmChats, savedMsgs);
}

function _buildChatListHtml(dmChats, savedMsgs) {
  const savedActive = _activeDMAddress === '__saved__';
  const savedItem = `<div class="message-item${savedActive ? ' active' : ''}" onclick="window.diademUI.openDM('__saved__')" style="display:flex;gap:12px;align-items:center;padding:12px;border-radius:12px;cursor:pointer;margin:2px 8px;${savedActive ? 'background:var(--bg-active);' : ''}">
    <div class="avatar" style="width:44px;height:44px;background:var(--purple);flex-shrink:0;"><span class="avatar-initials" style="color:#FFF;font-size:16px;"><i class="icon-bookmark" style="font-size:18px;"></i></span></div>
    <div style="flex:1;">
      <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${t('dm_saved')}</div>
      <div style="font-size:12px;color:var(--text-muted);">${savedMsgs.length} ${t('dm_messages_count')}</div>
    </div>
  </div>`;

  const chatListHtml = dmChats.map(chat => {
    const p = node.getProfile(chat.otherAddress) || {};
    const name = p.name || chat.otherAddress.slice(0, 10) + '...';
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const last = chat.lastMessage;
    let preview = '';
    if (last?.payment) preview = `${last.payment.amount} DDM`;
    else if (last?.image) preview = t('dm_photo');
    else if (last?.content) preview = last.content.length > 30 ? last.content.slice(0, 30) + '...' : last.content;
    const isActive = _activeDMAddress === chat.otherAddress;
    return `<div class="message-item${isActive ? ' active' : ''}" onclick="window.diademUI.openDM('${chat.otherAddress}')" style="display:flex;gap:12px;align-items:center;padding:12px;border-radius:12px;cursor:pointer;margin:2px 8px;${isActive ? 'background:var(--bg-active);' : ''}">
      ${p.avatar ? `<img src="${p.avatar}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0;">` :
        `<div class="avatar" style="width:44px;height:44px;background:var(--avatar-fill);flex-shrink:0;"><span class="avatar-initials">${initials}</span></div>`}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</div>
          <div style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${last ? formatTimeAgo(last.timestamp) : ''}</div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;">${escapeHtml(preview)}</div>
      </div>
    </div>`;
  }).join('');

  return savedItem + chatListHtml;
}

function _renderSavedChat(savedMsgs) {
  return `
    <div class="chat-header">
      <div style="display:flex;align-items:center;gap:12px;">
        <div class="avatar" style="width:36px;height:36px;background:var(--purple);"><span class="avatar-initials" style="color:#FFF;font-size:12px;"><i class="icon-bookmark" style="font-size:14px;"></i></span></div>
        <div>
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);">${t('dm_saved')}</div>
          <div style="font-size:11px;color:var(--text-muted);">${t('dm_saved_hint')}</div>
        </div>
      </div>
    </div>
    <div class="chat-messages" style="padding:16px;overflow-y:auto;">
      ${savedMsgs.length === 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            <i class="icon-bookmark" style="font-size:48px;margin-bottom:16px;opacity:0.3;"></i>
            <div style="font-size:15px;font-weight:500;">${t('dm_saved')}</div>
            <div style="font-size:13px;margin-top:4px;">${t('dm_saved_empty')}</div>
          </div>`
        : savedMsgs.map(msg => `
          <div style="display:flex;justify-content:flex-end;margin-bottom:12px;">
            <div style="max-width:70%;background:var(--purple);color:#FFF;padding:10px 14px;border-radius:16px 16px 4px 16px;">
              <div style="font-size:14px;line-height:1.5;word-break:break-word;">${escapeHtml(msg.content)}</div>
              <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:4px;">
                <span style="font-size:11px;opacity:0.7;">${formatTimeAgo(msg.timestamp)}</span>
                <button onclick="window.diademUI.deleteSavedMessage('${msg.id}')" style="background:none;border:none;padding:0;cursor:pointer;opacity:0.6;color:#FFF;font-size:12px;" title="Delete"><i class="icon-trash-2" style="font-size:12px;"></i></button>
              </div>
            </div>
          </div>
        `).join('')
      }
    </div>
    <div id="dm-image-preview" style="display:none;padding:8px 24px 0;"></div>
    <div class="chat-input-area">
      <label style="cursor:pointer;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--bg-input);flex-shrink:0;" title="${t('dm_attach_photo')}">
        <i class="icon-image" style="font-size:18px;color:var(--text-muted);"></i>
        <input type="file" accept="image/*" style="display:none;" onchange="window.diademUI.previewDMImage(this)">
      </label>
      <input type="text" class="input-field" id="saved-msg-input" placeholder="${t('dm_saved_placeholder')}" style="border-radius:20px;flex:1;" onkeydown="if(event.key==='Enter')window.diademUI.sendSavedMessage()">
      <button class="send-btn" onclick="window.diademUI.sendSavedMessage()"><i class="icon-send" style="font-size:18px;"></i></button>
    </div>`;
}

/** Render a single DM bubble — used by both full render and incremental update */
function _renderMsgBubble(msg, myAddr) {
  const isMine = msg.from === myAddr;
  const align = isMine ? 'flex-end' : 'flex-start';
  const bubbleBg = isMine ? 'var(--accent)' : 'var(--bg-input)';
  const bubbleColor = isMine ? '#FFF' : 'var(--text-primary)';
  const radius = isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px';
  const timeColor = isMine ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)';

  let content = '';

  const payReqMatch = msg.content?.match(/^__PAY_REQUEST__(\d+\.?\d*)__(.*)$/);
  if (payReqMatch) {
    const reqAmount = parseFloat(payReqMatch[1]);
    const reqMemo = payReqMatch[2] || '';
    const canPay = !isMine;
    content = `
      <div style="background:${isMine ? 'rgba(255,255,255,0.15)' : 'rgba(59,130,246,0.1)'};border-radius:12px;padding:12px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${timeColor};margin-bottom:4px;"><i class="icon-arrow-down-circle" style="font-size:12px;vertical-align:middle;margin-right:4px;"></i>${isMine ? t('dm_you_requested') : t('dm_payment_request')}</div>
        <div style="font-size:22px;font-weight:700;color:${isMine ? '#FFF' : 'var(--accent)'};">${reqAmount.toLocaleString()} DDM</div>
        ${reqMemo ? `<div style="font-size:12px;margin-top:4px;opacity:0.8;">${escapeHtml(reqMemo)}</div>` : ''}
        ${canPay ? `<button class="btn btn-primary" style="margin-top:8px;padding:6px 20px;border-radius:16px;font-size:13px;" onclick="window.diademUI._payRequest('${msg.from}',${reqAmount},'${escapeHtml(reqMemo)}')"><i class="icon-wallet" style="font-size:13px;margin-right:4px;"></i>${t('dm_pay_now')} ${reqAmount} DDM</button>` : ''}
      </div>`;
  } else if (msg.payment) {
    const payIcon = isMine ? '↑' : '↓';
    const payColor = isMine ? '#FFF' : 'var(--accent)';
    content = `
      <div style="background:${isMine ? 'rgba(255,255,255,0.15)' : 'var(--accent)10'};border-radius:12px;padding:12px;margin-bottom:${msg.content ? '8' : '0'}px;">
        <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${timeColor};margin-bottom:4px;">${isMine ? t('dm_you_sent') : t('dm_received')}</div>
        <div style="font-size:22px;font-weight:700;color:${payColor};">${payIcon} ${msg.payment.amount.toLocaleString()} DDM</div>
        ${msg.payment.memo ? `<div style="font-size:12px;margin-top:4px;opacity:0.8;">${escapeHtml(msg.payment.memo)}</div>` : ''}
      </div>
      ${msg.content ? `<div style="font-size:14px;line-height:1.5;word-break:break-word;">${escapeHtml(msg.content)}</div>` : ''}`;
  } else {
    if (msg.image) {
      content += `<img src="${msg.image}" alt="" style="max-width:260px;max-height:200px;border-radius:8px;cursor:pointer;display:block;margin-bottom:${msg.content ? '8' : '0'}px;" onclick="window.diademUI._viewImage('${msg.image.replace(/'/g, "\\'")}')">`;
    }
    if (msg.content) {
      content += `<div style="font-size:14px;line-height:1.5;word-break:break-word;">${escapeHtml(msg.content)}</div>`;
    }
  }

  return `<div data-msg-id="${msg.id}" style="display:flex;justify-content:${align};margin-bottom:8px;">
    <div style="max-width:70%;background:${bubbleBg};color:${bubbleColor};padding:10px 14px;border-radius:${radius};">
      ${content}
      <div style="display:flex;justify-content:flex-end;margin-top:4px;">
        <span style="font-size:11px;color:${timeColor};">${formatTimeAgo(msg.timestamp)}</span>
      </div>
    </div>
  </div>`;
}

function _renderDMChat(otherAddr) {
  const myAddr = node.wallet?.address;
  const msgs = node.getDMMessages(otherAddr);
  const p = node.getProfile(otherAddr) || {};
  const name = p.name || otherAddr.slice(0, 10) + '...';
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const shortAddr = otherAddr.slice(0, 6) + '...' + otherAddr.slice(-4);

  const msgsHtml = msgs.map(msg => _renderMsgBubble(msg, myAddr)).join('');

  return `
    <div class="chat-header">
      <div style="display:flex;align-items:center;gap:12px;flex:1;min-width:0;">
        ${p.avatar ? `<img src="${p.avatar}" alt="" style="width:36px;height:36px;border-radius:50%;object-fit:cover;cursor:pointer;" onclick="window.diademUI.viewUser('${otherAddr}')">` :
          `<div class="avatar" style="width:36px;height:36px;background:var(--avatar-fill);cursor:pointer;" onclick="window.diademUI.viewUser('${otherAddr}')"><span class="avatar-initials">${initials}</span></div>`}
        <div style="min-width:0;cursor:pointer;" onclick="window.diademUI.viewUser('${otherAddr}')">
          <div style="font-size:15px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(name)}</div>
          <div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${shortAddr}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-outline" style="border-radius:50%;width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;" onclick="window.diademUI.dmPaymentDialog('${otherAddr}')" title="${t('dm_send_ddm')}">
          <i class="icon-wallet" style="font-size:16px;"></i>
        </button>
      </div>
    </div>
    <div class="chat-messages" data-chat="${otherAddr}" style="padding:16px;overflow-y:auto;">
      ${msgs.length === 0
        ? `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            <i class="icon-message-circle" style="font-size:48px;margin-bottom:16px;opacity:0.3;"></i>
            <div style="font-size:15px;font-weight:500;">${t('dm_empty_chat')}</div>
            <div style="font-size:13px;margin-top:4px;">${t('dm_empty_hint')}</div>
          </div>`
        : msgsHtml}
    </div>
    <div id="dm-typing-indicator" style="display:none;"></div>
    <div id="dm-image-preview" style="display:none;padding:8px 24px 0;"></div>
    <div class="chat-input-area">
      <label style="cursor:pointer;display:flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:50%;background:var(--bg-input);flex-shrink:0;" title="${t('dm_attach_photo')}">
        <i class="icon-image" style="font-size:18px;color:var(--text-muted);"></i>
        <input type="file" accept="image/*" style="display:none;" onchange="window.diademUI.previewDMImage(this)">
      </label>
      <input type="text" class="input-field" id="dm-msg-input" placeholder="${t('dm_placeholder')}" style="border-radius:20px;flex:1;" onkeydown="if(event.key==='Enter')window.diademUI.sendDM('${otherAddr}')" oninput="window.diademUI._dmTyping('${otherAddr}')">
      <button class="btn btn-outline" style="border-radius:50%;width:36px;height:36px;padding:0;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onclick="window.diademUI.dmPaymentDialog('${otherAddr}')" title="${t('dm_send_ddm')}">
        <i class="icon-wallet" style="font-size:16px;"></i>
      </button>
      <button class="send-btn" onclick="window.diademUI.sendDM('${otherAddr}')"><i class="icon-send" style="font-size:18px;"></i></button>
    </div>`;
}

// ─── Bookmarks ────────────────────────────────────────────

function renderBookmarks() {
  const el = document.getElementById('bookmarks-data');
  if (!el) return;
  const bookmarks = JSON.parse(localStorage.getItem('diadem_bookmarks') || '[]');
  const posts = bookmarks.map(id => {
    const post = node.blockchain.state.posts.get(id);
    if (!post) return null;
    return { ...post, id, profile: node.getProfile(post.author), likesCount: (node.blockchain.state.likes.get(id) || new Set()).size };
  }).filter(Boolean);

  if (posts.length === 0) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('bookmarks_empty')}</div>`;
    return;
  }
  el.innerHTML = posts.map(p => renderPost(p)).join('');
}

// ─── Search ───────────────────────────────────────────────

function renderSearch(query = '') {
  const el = document.getElementById('search-data');
  if (!el) return;

  const profiles = [];
  for (const [addr, profile] of node.blockchain.state.profiles) {
    if (!query || (profile.name || '').toLowerCase().includes(query.toLowerCase()) ||
        (profile.handle || '').toLowerCase().includes(query.toLowerCase())) {
      profiles.push({ address: addr, ...profile });
    }
  }
  const posts = [];
  if (query) {
    for (const [pid, post] of node.blockchain.state.posts) {
      if (post.content.toLowerCase().includes(query.toLowerCase())) {
        posts.push({ ...post, id: pid, profile: node.getProfile(post.author), likesCount: (node.blockchain.state.likes.get(pid) || new Set()).size });
      }
    }
  }
  const followingSet = node.blockchain.state.following.get(node.wallet.address) || new Set();

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:20px;">
      <h2 style="font-size:20px;">${t('search_title')}</h2>
      <div class="search-box" style="width:320px;">
        <i class="icon-search"></i>
        <input type="text" class="input-field" id="search-input" value="${escapeHtml(query)}" placeholder="${t('tx_search')}" style="padding-left:36px;border-radius:19px;height:38px;" onkeydown="if(event.key==='Enter')window.diademUI.doSearch(this.value)">
      </div>
    </div>
    <div class="tabs" style="gap:24px;margin-bottom:0;">
      <button class="tab active">${t('search_people')}</button>
      <button class="tab">${t('search_posts')}</button>
      <button class="tab">${t('search_daos')}</button>
      <button class="tab">${t('search_tokens')}</button>
    </div>
    <div>
      ${profiles.length === 0 && posts.length === 0
        ? `<div class="text-muted" style="text-align:center;padding:40px;">${t('search_empty')}</div>`
        : profiles.map(p => {
            const name = p.name || p.address.slice(0, 10);
            const handle = p.handle || p.address.slice(0, 12);
            const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            const isFol = followingSet.has(p.address);
            return `
              <div style="display:flex;gap:12px;align-items:center;padding:16px 0;border-bottom:1px solid var(--divider);cursor:pointer;">
                <div class="avatar" style="width:48px;height:48px;" onclick="window.diademUI.viewUser('${p.address}')"><span class="avatar-initials">${initials}</span></div>
                <div style="flex:1;" onclick="window.diademUI.viewUser('${p.address}')">
                  <div style="font-size:15px;font-weight:600;color:var(--text-primary);">${escapeHtml(name)}</div>
                  <div style="font-size:13px;color:var(--text-muted);">${escapeHtml(handle)}</div>
                </div>
                <button class="btn ${isFol ? 'btn-outline' : 'btn-primary'}" style="border-radius:17px;height:34px;padding:0 20px;font-size:13px;" onclick="window.diademUI.followUser('${p.address}')">${isFol ? t('profile_following') : t('profile_follow')}</button>
              </div>`;
          }).join('') + posts.map(p => renderPost(p)).join('')
      }
    </div>
  `;
}

// ─── Profile Shop ──────────────────────────────────────────

const SHOP_ITEMS = [
  // ═══ FRAMES ═══
  { id: 'frame-gold', slot: 'frame', name: 'Gold Frame', desc: 'Classic golden border', price: 50, preview: 'linear-gradient(135deg, #FFD700, #FFA500)', category: 'Frames' },
  { id: 'frame-diamond', slot: 'frame', name: 'Diamond Frame', desc: 'Sparkling diamond border', price: 150, preview: 'linear-gradient(135deg, #B9F2FF, #0FF, #B9F2FF)', category: 'Frames' },
  { id: 'frame-fire', slot: 'frame', name: 'Fire Frame', desc: 'Blazing fire border', price: 100, preview: 'linear-gradient(135deg, #FF4500, #FF8C00, #FFD700)', category: 'Frames' },
  { id: 'frame-neon', slot: 'frame', name: 'Neon Glow', desc: 'Vibrant neon glow', price: 80, preview: 'linear-gradient(135deg, #0FF, #F0F, #0FF)', category: 'Frames' },
  { id: 'frame-rainbow', slot: 'frame', name: 'Rainbow Frame', desc: 'Animated rainbow gradient', price: 120, preview: 'linear-gradient(135deg, #FF0000, #FF7700, #FFFF00, #00FF00, #0000FF, #8B00FF)', category: 'Frames' },
  { id: 'frame-ice', slot: 'frame', name: 'Ice Frame', desc: 'Frozen crystalline border', price: 70, preview: 'linear-gradient(135deg, #E0F7FA, #80DEEA, #4DD0E1)', category: 'Frames' },
  { id: 'frame-plasma', slot: 'frame', name: 'Plasma Frame', desc: 'Electric plasma border', price: 130, preview: 'linear-gradient(135deg, #7C3AED, #EC4899, #7C3AED)', category: 'Frames' },
  { id: 'frame-matrix', slot: 'frame', name: 'Matrix Frame', desc: 'Green code rain border', price: 90, preview: 'linear-gradient(135deg, #003300, #00FF00, #003300)', category: 'Frames' },
  { id: 'frame-shadow', slot: 'frame', name: 'Dark Shadow', desc: 'Dark ethereal shadow effect', price: 60, preview: 'linear-gradient(135deg, #1A1A2E, #16213E, #0F3460)', category: 'Frames' },
  { id: 'frame-sakura', slot: 'frame', name: 'Sakura Frame', desc: 'Cherry blossom pink border', price: 85, preview: 'linear-gradient(135deg, #FFB7C5, #FF69B4, #FFB7C5)', category: 'Frames' },
  { id: 'frame-lava', slot: 'frame', name: 'Lava Frame', desc: 'Molten lava border', price: 110, preview: 'linear-gradient(135deg, #FF0000, #FF4500, #FF6600)', category: 'Frames' },
  { id: 'frame-emerald', slot: 'frame', name: 'Emerald Frame', desc: 'Deep emerald green', price: 95, preview: 'linear-gradient(135deg, #064E3B, #10B981, #064E3B)', category: 'Frames' },

  // ═══ BANNERS ═══
  { id: 'banner-galaxy', slot: 'banner', name: 'Galaxy', desc: 'Cosmic starfield', price: 75, preview: 'linear-gradient(135deg, #0B0B2B, #1A0533, #2D1B69)', category: 'Banners' },
  { id: 'banner-sunset', slot: 'banner', name: 'Sunset', desc: 'Warm sunset gradient', price: 40, preview: 'linear-gradient(135deg, #FF6B6B, #FFE66D)', category: 'Banners' },
  { id: 'banner-ocean', slot: 'banner', name: 'Ocean Wave', desc: 'Deep ocean gradient', price: 40, preview: 'linear-gradient(135deg, #0077B6, #00B4D8, #90E0EF)', category: 'Banners' },
  { id: 'banner-forest', slot: 'banner', name: 'Enchanted Forest', desc: 'Mystical green tones', price: 60, preview: 'linear-gradient(135deg, #1B4332, #2D6A4F, #40916C)', category: 'Banners' },
  { id: 'banner-aurora', slot: 'banner', name: 'Aurora Borealis', desc: 'Northern lights', price: 100, preview: 'linear-gradient(135deg, #00C9FF, #92FE9D, #00C9FF)', category: 'Banners' },
  { id: 'banner-cyberpunk', slot: 'banner', name: 'Cyberpunk', desc: 'Neon city vibes', price: 90, preview: 'linear-gradient(135deg, #0D0221, #7B2D8E, #FF2E63)', category: 'Banners' },
  { id: 'banner-retrowave', slot: 'banner', name: 'Retrowave', desc: '80s synthwave aesthetic', price: 85, preview: 'linear-gradient(135deg, #2B1055, #D53F8C, #FF6B6B)', category: 'Banners' },
  { id: 'banner-volcano', slot: 'banner', name: 'Volcano', desc: 'Fiery lava eruption', price: 70, preview: 'linear-gradient(135deg, #1A0000, #8B0000, #FF4500)', category: 'Banners' },
  { id: 'banner-arctic', slot: 'banner', name: 'Arctic', desc: 'Icy cold polar landscape', price: 55, preview: 'linear-gradient(135deg, #E8F4FD, #B8D8E8, #7EC8E3)', category: 'Banners' },
  { id: 'banner-nebula', slot: 'banner', name: 'Nebula', desc: 'Colorful space nebula', price: 110, preview: 'linear-gradient(135deg, #1A0533, #4A148C, #E040FB)', category: 'Banners' },
  { id: 'banner-midnight', slot: 'banner', name: 'Midnight', desc: 'Deep midnight blue', price: 45, preview: 'linear-gradient(135deg, #0C1445, #191970, #0C1445)', category: 'Banners' },
  { id: 'banner-cherry', slot: 'banner', name: 'Cherry Blossom', desc: 'Soft cherry blossom pink', price: 55, preview: 'linear-gradient(135deg, #FFD1DC, #FF69B4, #FFD1DC)', category: 'Banners' },
  { id: 'banner-matrix', slot: 'banner', name: 'Matrix Code', desc: 'Green digital rain', price: 80, preview: 'linear-gradient(135deg, #000000, #003300, #00FF00)', category: 'Banners' },
  { id: 'banner-gold', slot: 'banner', name: 'Gold Luxury', desc: 'Premium golden gradient', price: 120, preview: 'linear-gradient(135deg, #B8860B, #FFD700, #B8860B)', category: 'Banners' },

  // ═══ BADGES ═══
  { id: 'badge-verified', slot: 'badge', name: 'Verified', desc: 'Blue checkmark', price: 200, preview: '#3B82F6', icon: 'check-circle', category: 'Badges' },
  { id: 'badge-star', slot: 'badge', name: 'Star', desc: 'Golden star icon', price: 100, preview: '#FFD700', icon: 'star', category: 'Badges' },
  { id: 'badge-crown', slot: 'badge', name: 'Crown', desc: 'Royal crown', price: 300, preview: '#FFD700', icon: 'crown', category: 'Badges' },
  { id: 'badge-bolt', slot: 'badge', name: 'Lightning', desc: 'Electric bolt', price: 75, preview: '#FBBF24', icon: 'zap', category: 'Badges' },
  { id: 'badge-gem', slot: 'badge', name: 'Gem', desc: 'Precious gem', price: 250, preview: '#8B5CF6', icon: 'diamond', category: 'Badges' },
  { id: 'badge-shield', slot: 'badge', name: 'Shield', desc: 'Trusted member', price: 150, preview: '#22C55E', icon: 'shield', category: 'Badges' },
  { id: 'badge-flame', slot: 'badge', name: 'Flame', desc: 'Hot streak', price: 80, preview: '#EF4444', icon: 'flame', category: 'Badges' },
  { id: 'badge-heart', slot: 'badge', name: 'Heart', desc: 'Community lover', price: 60, preview: '#EC4899', icon: 'heart', category: 'Badges' },
  { id: 'badge-globe', slot: 'badge', name: 'Globe', desc: 'World explorer', price: 120, preview: '#06B6D4', icon: 'globe', category: 'Badges' },
  { id: 'badge-code', slot: 'badge', name: 'Developer', desc: 'Code master badge', price: 180, preview: '#10B981', icon: 'code', category: 'Badges' },
  { id: 'badge-palette', slot: 'badge', name: 'Creator', desc: 'Creative artist badge', price: 160, preview: '#F59E0B', icon: 'palette', category: 'Badges' },
  { id: 'badge-music', slot: 'badge', name: 'Music', desc: 'Music producer badge', price: 140, preview: '#8B5CF6', icon: 'music', category: 'Badges' },
  { id: 'badge-camera', slot: 'badge', name: 'Photographer', desc: 'Photography badge', price: 130, preview: '#F97316', icon: 'camera', category: 'Badges' },
  { id: 'badge-rocket', slot: 'badge', name: 'Rocket', desc: 'To the moon!', price: 200, preview: '#EF4444', icon: 'rocket', category: 'Badges' },
  { id: 'badge-trophy', slot: 'badge', name: 'Trophy', desc: 'Champion status', price: 350, preview: '#FFD700', icon: 'trophy', category: 'Badges' },
  { id: 'badge-eye', slot: 'badge', name: 'Visionary', desc: 'Sees the future', price: 175, preview: '#7C3AED', icon: 'eye', category: 'Badges' },
  { id: 'badge-infinity', slot: 'badge', name: 'Infinity', desc: 'Limitless power', price: 500, preview: '#06B6D4', icon: 'infinity', category: 'Badges' },

  // ═══ EFFECTS & ANIMATIONS ═══
  { id: 'anim-glow', slot: 'animation', name: 'Name Glow', desc: 'Soft golden glow on your name', price: 60, preview: 'linear-gradient(135deg, #FFF, #FFD700)', category: 'Effects' },
  { id: 'anim-sparkle', slot: 'animation', name: 'Sparkle', desc: 'Sparkles on your posts', price: 90, preview: 'linear-gradient(135deg, #FFE600, #FFF, #FFE600)', category: 'Effects' },
  { id: 'anim-gradient-name', slot: 'animation', name: 'Gradient Name', desc: 'Animated gradient text', price: 80, preview: 'linear-gradient(90deg, #F0F, #0FF, #F0F)', category: 'Effects' },
  { id: 'anim-pulse', slot: 'animation', name: 'Pulse Effect', desc: 'Subtle pulsing avatar', price: 70, preview: 'linear-gradient(135deg, #3B82F6, #60A5FA)', category: 'Effects' },
  { id: 'anim-float', slot: 'animation', name: 'Float Effect', desc: 'Floating avatar animation', price: 85, preview: 'linear-gradient(135deg, #A78BFA, #818CF8)', category: 'Effects' },
  { id: 'anim-glitch', slot: 'animation', name: 'Glitch', desc: 'Cyberpunk glitch effect', price: 120, preview: 'linear-gradient(135deg, #FF0000, #00FF00, #0000FF)', category: 'Effects' },
  { id: 'anim-typing', slot: 'animation', name: 'Typing Cursor', desc: 'Animated typing cursor in bio', price: 55, preview: 'linear-gradient(135deg, #FFF, #888)', category: 'Effects' },
  { id: 'anim-rainbow-border', slot: 'animation', name: 'Rainbow Glow', desc: 'Rotating rainbow glow on profile card', price: 150, preview: 'linear-gradient(90deg, #FF0000, #FF7700, #FFFF00, #00FF00, #0000FF, #8B00FF)', category: 'Effects' },

  // ═══ BIO STYLES ═══
  { id: 'bio-italic', slot: 'bio_style', name: 'Italic Bio', desc: 'Elegant italic font', price: 20, preview: '#9CA3AF', category: 'Styles' },
  { id: 'bio-glow', slot: 'bio_style', name: 'Glowing Bio', desc: 'Subtle neon glow text', price: 45, preview: 'linear-gradient(135deg, #0FF, #FFF)', category: 'Styles' },
  { id: 'bio-mono', slot: 'bio_style', name: 'Monospace Bio', desc: 'Developer-style monospace font', price: 25, preview: '#10B981', category: 'Styles' },
  { id: 'bio-bold', slot: 'bio_style', name: 'Bold Bio', desc: 'Strong bold statement', price: 15, preview: '#F59E0B', category: 'Styles' },
  { id: 'bio-gradient', slot: 'bio_style', name: 'Gradient Bio', desc: 'Gradient colored bio text', price: 65, preview: 'linear-gradient(90deg, #EC4899, #8B5CF6)', category: 'Styles' },

  // ═══ NAME COLORS ═══
  { id: 'name-red', slot: 'name_color', name: 'Red', desc: 'Fiery red name', price: 30, preview: '#EF4444', category: 'Name Colors' },
  { id: 'name-purple', slot: 'name_color', name: 'Purple', desc: 'Royal purple name', price: 30, preview: '#8B5CF6', category: 'Name Colors' },
  { id: 'name-gold', slot: 'name_color', name: 'Gold', desc: 'Luxurious gold name', price: 50, preview: '#FFD700', category: 'Name Colors' },
  { id: 'name-cyan', slot: 'name_color', name: 'Cyan', desc: 'Cool cyan name', price: 30, preview: '#06B6D4', category: 'Name Colors' },
  { id: 'name-gradient', slot: 'name_color', name: 'Gradient', desc: 'Animated gradient', price: 100, preview: 'linear-gradient(90deg, #F0F, #0FF)', category: 'Name Colors' },
  { id: 'name-emerald', slot: 'name_color', name: 'Emerald', desc: 'Rich emerald green', price: 35, preview: '#10B981', category: 'Name Colors' },
  { id: 'name-rose', slot: 'name_color', name: 'Rose', desc: 'Elegant rose pink', price: 35, preview: '#F43F5E', category: 'Name Colors' },
  { id: 'name-amber', slot: 'name_color', name: 'Amber', desc: 'Warm amber tone', price: 35, preview: '#F59E0B', category: 'Name Colors' },
  { id: 'name-ice', slot: 'name_color', name: 'Ice Blue', desc: 'Cool icy blue', price: 40, preview: '#38BDF8', category: 'Name Colors' },
  { id: 'name-fire-gradient', slot: 'name_color', name: 'Fire Gradient', desc: 'Red to orange animated', price: 120, preview: 'linear-gradient(90deg, #FF0000, #FF8C00)', category: 'Name Colors' },
  { id: 'name-ocean-gradient', slot: 'name_color', name: 'Ocean Gradient', desc: 'Blue to cyan animated', price: 110, preview: 'linear-gradient(90deg, #0077B6, #00B4D8)', category: 'Name Colors' },
  { id: 'name-rainbow', slot: 'name_color', name: 'Rainbow', desc: 'Full rainbow animated', price: 200, preview: 'linear-gradient(90deg, #FF0000, #FF7700, #FFFF00, #00FF00, #0000FF, #8B00FF)', category: 'Name Colors' },

  // ═══ PROFILE TITLES ═══
  { id: 'title-creator', slot: 'title', name: 'Creator', desc: 'Show "Creator" under your name', price: 50, preview: '#F59E0B', category: 'Titles' },
  { id: 'title-developer', slot: 'title', name: 'Developer', desc: 'Show "Developer" under your name', price: 50, preview: '#10B981', category: 'Titles' },
  { id: 'title-artist', slot: 'title', name: 'Artist', desc: 'Show "Artist" under your name', price: 50, preview: '#EC4899', category: 'Titles' },
  { id: 'title-musician', slot: 'title', name: 'Musician', desc: 'Show "Musician" under your name', price: 50, preview: '#8B5CF6', category: 'Titles' },
  { id: 'title-trader', slot: 'title', name: 'Trader', desc: 'Show "Trader" under your name', price: 50, preview: '#22C55E', category: 'Titles' },
  { id: 'title-gamer', slot: 'title', name: 'Gamer', desc: 'Show "Gamer" under your name', price: 50, preview: '#EF4444', category: 'Titles' },
  { id: 'title-influencer', slot: 'title', name: 'Influencer', desc: 'Show "Influencer" under your name', price: 75, preview: '#3B82F6', category: 'Titles' },
  { id: 'title-whale', slot: 'title', name: 'Whale', desc: 'Show "Whale" under your name', price: 100, preview: '#06B6D4', category: 'Titles' },
  { id: 'title-og', slot: 'title', name: 'OG', desc: 'Show "OG" — original member', price: 150, preview: '#FFD700', category: 'Titles' },
  { id: 'title-degen', slot: 'title', name: 'Degen', desc: 'Show "Degen" — proud degen', price: 40, preview: '#A855F7', category: 'Titles' },
  { id: 'title-hodler', slot: 'title', name: 'HODLER', desc: 'Show "HODLER" — diamond hands', price: 60, preview: '#60A5FA', category: 'Titles' },
  { id: 'title-builder', slot: 'title', name: 'Builder', desc: 'Show "Builder" — creating the future', price: 75, preview: '#F97316', category: 'Titles' },
  { id: 'title-validator', slot: 'title', name: 'Validator', desc: 'Show "Validator" — securing the network', price: 100, preview: '#10B981', category: 'Titles' },
  { id: 'title-legend', slot: 'title', name: 'Legend', desc: 'Show "Legend" — absolute legend', price: 500, preview: '#FFD700', category: 'Titles' },

  // ═══ POST STYLES ═══
  { id: 'poststyle-glow', slot: 'post_style', name: 'Glowing Posts', desc: 'Your posts have a subtle glow', price: 80, preview: 'linear-gradient(135deg, #1E3A5F, #2563EB)', category: 'Post Styles' },
  { id: 'poststyle-border', slot: 'post_style', name: 'Accent Border', desc: 'Colored left border on posts', price: 40, preview: 'linear-gradient(180deg, #8B5CF6, #EC4899)', category: 'Post Styles' },
  { id: 'poststyle-dark', slot: 'post_style', name: 'Dark Mode Posts', desc: 'Extra dark background on posts', price: 35, preview: 'linear-gradient(135deg, #0A0A0A, #1A1A1A)', category: 'Post Styles' },
  { id: 'poststyle-gradient-bg', slot: 'post_style', name: 'Gradient Background', desc: 'Subtle gradient post background', price: 70, preview: 'linear-gradient(135deg, #1E1B4B, #312E81)', category: 'Post Styles' },
  { id: 'poststyle-neon-border', slot: 'post_style', name: 'Neon Border', desc: 'Neon glowing post border', price: 95, preview: 'linear-gradient(135deg, #0FF, #F0F)', category: 'Post Styles' },
  { id: 'poststyle-gold-border', slot: 'post_style', name: 'Gold Border', desc: 'Premium gold post border', price: 110, preview: 'linear-gradient(135deg, #FFD700, #FFA500)', category: 'Post Styles' },

  // ═══ NAME FONTS ═══
  { id: 'font-playfair', slot: 'name_font', name: 'Playfair Display', desc: 'Elegant serif font', price: 30, preview: '#E5E7EB', font: "'Playfair Display', serif", category: 'Fonts' },
  { id: 'font-oswald', slot: 'name_font', name: 'Oswald', desc: 'Bold condensed font', price: 25, preview: '#E5E7EB', font: "'Oswald', sans-serif", category: 'Fonts' },
  { id: 'font-lobster', slot: 'name_font', name: 'Lobster', desc: 'Fun cursive script', price: 35, preview: '#E5E7EB', font: "'Lobster', cursive", category: 'Fonts' },
  { id: 'font-pacifico', slot: 'name_font', name: 'Pacifico', desc: 'Retro surf style', price: 35, preview: '#E5E7EB', font: "'Pacifico', cursive", category: 'Fonts' },
  { id: 'font-dancing', slot: 'name_font', name: 'Dancing Script', desc: 'Elegant handwriting', price: 30, preview: '#E5E7EB', font: "'Dancing Script', cursive", category: 'Fonts' },
  { id: 'font-righteous', slot: 'name_font', name: 'Righteous', desc: 'Retro groovy style', price: 30, preview: '#E5E7EB', font: "'Righteous', sans-serif", category: 'Fonts' },
  { id: 'font-bebas', slot: 'name_font', name: 'Bebas Neue', desc: 'Tall uppercase display', price: 25, preview: '#E5E7EB', font: "'Bebas Neue', sans-serif", category: 'Fonts' },
  { id: 'font-permanent', slot: 'name_font', name: 'Permanent Marker', desc: 'Hand-drawn marker', price: 40, preview: '#E5E7EB', font: "'Permanent Marker', cursive", category: 'Fonts' },
  { id: 'font-caveat', slot: 'name_font', name: 'Caveat', desc: 'Natural handwriting', price: 25, preview: '#E5E7EB', font: "'Caveat', cursive", category: 'Fonts' },
  { id: 'font-monoton', slot: 'name_font', name: 'Monoton', desc: 'Retro neon outline', price: 50, preview: '#E5E7EB', font: "'Monoton', display", category: 'Fonts' },
  { id: 'font-orbitron', slot: 'name_font', name: 'Orbitron', desc: 'Futuristic sci-fi font', price: 40, preview: '#E5E7EB', font: "'Orbitron', sans-serif", category: 'Fonts' },
  { id: 'font-press-start', slot: 'name_font', name: 'Press Start 2P', desc: '8-bit pixel font', price: 45, preview: '#E5E7EB', font: "'Press Start 2P', monospace", category: 'Fonts' },
  { id: 'font-cinzel', slot: 'name_font', name: 'Cinzel', desc: 'Classical Roman style', price: 35, preview: '#E5E7EB', font: "'Cinzel', serif", category: 'Fonts' },
  { id: 'font-comfortaa', slot: 'name_font', name: 'Comfortaa', desc: 'Rounded modern font', price: 25, preview: '#E5E7EB', font: "'Comfortaa', sans-serif", category: 'Fonts' },
  { id: 'font-abril', slot: 'name_font', name: 'Abril Fatface', desc: 'Bold display serif', price: 35, preview: '#E5E7EB', font: "'Abril Fatface', serif", category: 'Fonts' },
  { id: 'font-russo', slot: 'name_font', name: 'Russo One', desc: 'Bold geometric style', price: 30, preview: '#E5E7EB', font: "'Russo One', sans-serif", category: 'Fonts' },
  { id: 'font-sacramento', slot: 'name_font', name: 'Sacramento', desc: 'Thin elegant script', price: 30, preview: '#E5E7EB', font: "'Sacramento', cursive", category: 'Fonts' },
  { id: 'font-quicksand', slot: 'name_font', name: 'Quicksand', desc: 'Light rounded sans', price: 20, preview: '#E5E7EB', font: "'Quicksand', sans-serif", category: 'Fonts' },
  { id: 'font-audiowide', slot: 'name_font', name: 'Audiowide', desc: 'Wide tech display', price: 35, preview: '#E5E7EB', font: "'Audiowide', display", category: 'Fonts' },
  { id: 'font-bangers', slot: 'name_font', name: 'Bangers', desc: 'Comic book style', price: 30, preview: '#E5E7EB', font: "'Bangers', cursive", category: 'Fonts' },
  { id: 'font-creepster', slot: 'name_font', name: 'Creepster', desc: 'Spooky horror font', price: 40, preview: '#E5E7EB', font: "'Creepster', display", category: 'Fonts' },
  { id: 'font-fredoka', slot: 'name_font', name: 'Fredoka One', desc: 'Friendly rounded bold', price: 25, preview: '#E5E7EB', font: "'Fredoka One', sans-serif", category: 'Fonts' },
  { id: 'font-satisfy', slot: 'name_font', name: 'Satisfy', desc: 'Smooth brush script', price: 30, preview: '#E5E7EB', font: "'Satisfy', cursive", category: 'Fonts' },
  { id: 'font-special-elite', slot: 'name_font', name: 'Special Elite', desc: 'Vintage typewriter', price: 35, preview: '#E5E7EB', font: "'Special Elite', cursive", category: 'Fonts' },
];

function renderShop() {
  const el = document.getElementById('shop-data');
  if (!el) return;
  const titleEl = document.getElementById('shop-page-title');
  if (titleEl) titleEl.innerHTML = `<i class="icon-shopping-bag" style="margin-right:8px;"></i> ${t('shop_title')}`;
  const balance = node.getBalance();
  const decor = node.getProfileDecor();
  const categories = [...new Set(SHOP_ITEMS.map(i => i.category))];

  // Profile preview data
  const myProfile = node.getProfile() || {};
  const myName = myProfile.name || 'Anonymous';
  const myHandle = myProfile.handle || node.wallet.address.slice(0, 12);
  const myInitials = myName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const myRep = node.getReputation();
  const previewBannerItem = decor.banner ? SHOP_ITEMS.find(i => i.id === decor.banner) : null;
  const previewBanner = previewBannerItem ? previewBannerItem.preview : 'linear-gradient(135deg, var(--btn-primary-bg) 0%, var(--purple) 100%)';
  const previewFrameItem = decor.frame ? SHOP_ITEMS.find(i => i.id === decor.frame) : null;
  const previewFrame = previewFrameItem ? `border:3px solid transparent;background-image:${previewFrameItem.preview};background-origin:border-box;background-clip:padding-box,border-box;` : 'border:3px solid var(--bg);';
  const previewBadgeItem = decor.badge ? SHOP_ITEMS.find(i => i.id === decor.badge) : null;
  const previewBadge = previewBadgeItem ? `<i class="icon-${previewBadgeItem.icon || 'check-circle'}" style="font-size:14px;color:${previewBadgeItem.preview};"></i>` : '';
  const previewNameColorItem = decor.name_color ? SHOP_ITEMS.find(i => i.id === decor.name_color) : null;
  const previewNameStyle = previewNameColorItem
    ? (previewNameColorItem.preview.startsWith('linear') ? `background:${previewNameColorItem.preview};-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-size:200% 200%;animation:gradientShift 3s ease infinite;` : `color:${previewNameColorItem.preview};`)
    : '';
  const previewTitleItem = decor.title ? SHOP_ITEMS.find(i => i.id === decor.title) : null;
  const previewFontItem = decor.name_font ? SHOP_ITEMS.find(i => i.id === decor.name_font) : null;
  const previewFontStyle = previewFontItem ? `font-family:${previewFontItem.font};` : '';

  el.innerHTML = `
    <div class="shop-balance">
      <div class="shop-balance-label">${t('shop_balance')}</div>
      <div class="shop-balance-value">${balance.toLocaleString()} DDM</div>
    </div>

    <div class="shop-preview-card">
      <div class="shop-preview-title">${t('shop_preview')}</div>
      <div class="shop-preview-banner" style="background:${previewBanner};"></div>
      <div class="shop-preview-body">
        <div class="shop-preview-avatar-row">
          ${myProfile.avatar
            ? `<div class="avatar avatar-lg" style="${previewFrame}"><img src="${myProfile.avatar}" alt=""></div>`
            : `<div class="avatar avatar-lg" style="${previewFrame}"><span class="avatar-initials" style="font-size:20px;">${myInitials}</span></div>`
          }
          <div>
            <div style="font-size:16px;font-weight:700;${previewNameStyle}${previewFontStyle}">${escapeHtml(myName)} ${previewBadge}</div>
            <div style="font-size:13px;color:var(--text-muted);">${escapeHtml(myHandle)}${previewTitleItem ? ` <span style="font-size:11px;font-weight:600;color:${previewTitleItem.preview};">${previewTitleItem.name}</span>` : ''}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="shop-filter-tabs">
      <button class="shop-filter-tab active" onclick="window.diademUI._shopFilter('all',this)">${t('shop_all') || 'All'}</button>
      ${categories.map(cat => `<button class="shop-filter-tab" onclick="window.diademUI._shopFilter('${cat}',this)">${cat}</button>`).join('')}
    </div>

    <div class="shop-equipped">
      <h3 style="font-size:15px;font-weight:600;margin-bottom:12px;color:var(--text-primary);">${t('shop_equipped')}</h3>
      <div class="shop-equipped-grid">
        ${['frame', 'banner', 'badge', 'animation', 'bio_style', 'name_color', 'name_font', 'title', 'post_style'].map(slot => {
          const equipped = decor[slot] || null;
          const item = equipped ? SHOP_ITEMS.find(i => i.id === equipped) : null;
          return `<div class="shop-equipped-slot">
            <div class="shop-equipped-slot-label">${slot.replace('_', ' ')}</div>
            <div class="shop-equipped-slot-value">${item ? item.name : t('shop_none')}</div>
            ${item ? `<button class="shop-unequip" onclick="window.diademUI.unequipDecor('${slot}')"><i class="icon-x" style="font-size:12px;"></i></button>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    ${categories.map(cat => {
      const items = SHOP_ITEMS.filter(i => i.category === cat);
      return `
        <div class="shop-category" data-shop-cat="${cat}">
          <h3 class="shop-category-title">${cat}</h3>
          <div class="shop-grid">
            ${items.map(item => {
              const owned = decor.purchased.has(item.id);
              const equipped = decor[item.slot] === item.id;
              const canAfford = balance >= item.price;
              const isFontItem = item.slot === 'name_font';
              return `
                <div class="shop-item${equipped ? ' shop-item-equipped' : ''}${owned ? ' shop-item-owned' : ''}">
                  <div class="shop-item-preview" style="background:${isFontItem ? 'var(--bg-card)' : item.preview};${isFontItem ? 'display:flex;align-items:center;justify-content:center;' : ''}">
                    ${item.icon ? `<i class="icon-${item.icon}" style="font-size:24px;color:#FFF;"></i>` : ''}
                    ${isFontItem ? `<span style="font-family:${item.font};font-size:20px;color:var(--text-primary);">Aa</span>` : ''}
                  </div>
                  <div class="shop-item-info">
                    <div class="shop-item-name"${isFontItem ? ` style="font-family:${item.font};"` : ''}>${item.name}</div>
                    <div class="shop-item-desc">${item.desc}</div>
                    <div class="shop-item-footer">
                      ${owned
                        ? (equipped
                          ? `<span class="shop-item-status equipped">${t('shop_equipped_label')}</span>`
                          : `<button class="btn btn-outline shop-item-btn" onclick="window.diademUI.equipDecor('${item.id}','${item.slot}')">${t('shop_equip')}</button>`)
                        : `<button class="btn btn-primary shop-item-btn${canAfford ? '' : ' disabled'}" onclick="window.diademUI.buyDecor('${item.id}','${item.slot}',${item.price})" ${canAfford ? '' : 'disabled'}>${item.price} DDM</button>`
                      }
                    </div>
                  </div>
                </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('')}
  `;
}

// ─── Settings dynamic data ─────────────────────────────────

function renderSettingsData() {
  if (!node?.wallet) return;
  const info = node.getNodeInfo();

  // Update settings labels from i18n
  const setText = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };

  setText('settings-address', node.wallet.address);
  setText('settings-balance', node.getBalance().toLocaleString() + ' DDM');
  setText('settings-staked', node.getStake().amount.toLocaleString() + ' DDM');
  setText('settings-ipfs-status', info.ipfs?.localNode ? 'Local node active' : 'Gateways only');
  setText('settings-signaling-status', info.network.signaling === 'connected' ? t('settings_active') : 'Disconnected');

  // Language selector
  const langContainer = document.getElementById('lang-selector');
  if (langContainer) {
    const langs = getLanguages();
    langContainer.innerHTML = langs.map(l =>
      `<button class="pill${getLang() === l.code ? ' active' : ''}" onclick="window.diademUI.changeLang('${l.code}')" style="margin-right:8px;">${l.native}</button>`
    ).join('');
  }
}

// ─── Public API ───────────────────────────────────────────

window.diademUI = {
  navigate,

  _shopFilter(category, btn) {
    document.querySelectorAll('.shop-filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.shop-category').forEach(el => {
      if (category === 'all') {
        el.style.display = '';
      } else {
        el.style.display = el.dataset.shopCat === category ? '' : 'none';
      }
    });
  },

  async likePost(postId) {
    try {
      const likes = node.blockchain.state.likes.get(postId) || new Set();
      if (likes.has(node.wallet?.address)) {
        await node.unlikePost(postId);
        showToast('Like removed', 'info', 1500);
      } else {
        await node.likePost(postId);
        showToast('Liked!', 'success', 1500);
      }
    } catch (e) {
      showToast(e.message, 'error');
    }
  },

  async repostPost(postId) {
    try {
      const reposts = node.blockchain.state.reposts.get(postId) || new Set();
      const isReposted = reposts.has(node.wallet?.address);
      await node.repostPost(postId);
      showToast(isReposted ? t('repost_removed') : t('reposted'), 'success', 1500);
    } catch (e) { showToast(e.message, 'error'); }
  },

  async deletePost(postId) {
    showConfirm('Delete Post', 'Are you sure you want to delete this post? This cannot be undone.', async () => {
      try {
        await node.deletePost(postId);
        showToast('Post deleted', 'success');
      } catch (e) { showToast(e.message, 'error'); }
    });
  },

  async submitPost() {
    const textarea = document.getElementById('compose-text');
    if (!textarea || !textarea.value.trim()) return;
    const balance = node.getBalance();
    if (balance < 1) { showToast('Not enough DDM! Need at least 1 DDM to post.', 'error'); return; }
    try {
      const media = _composeImageList.length > 0 ? _composeImageList[0] : (_composeImageData || null);
      const options = {};
      if (_composeImageList.length > 1) options.mediaList = _composeImageList;
      if (_composeSpoiler && (_composeImageList.length > 0 || _composeImageData)) options.spoilerMedia = true;
      await node.createPost(textarea.value.trim(), media, options);
      textarea.value = '';
      _composeImageData = null;
      _composeImageList = [];
      _composeSpoiler = false;
      const preview = document.getElementById('compose-image-preview');
      if (preview) preview.style.display = 'none';
      document.getElementById('compose-modal').classList.remove('active');
      showToast('Post created! (-1 DDM)', 'success');
      renderFeed();
    } catch (e) { showToast(e.message, 'error'); }
  },

  async doStake() {
    const amount = parseInt(document.getElementById('stake-amount')?.value || '0');
    if (amount < 100) { showToast('Minimum stake: 100 DDM', 'warning'); return; }
    try {
      await node.stake(amount);
      showToast(`Staked ${amount} DDM`, 'success');
      renderStaking();
    } catch (e) { showToast(e.message, 'error'); }
  },

  async doUnstake() {
    const amount = node.getStake().amount;
    showConfirm('Unstake DDM', `Unstake ${amount.toLocaleString()} DDM?`, async () => {
      try {
        await node.unstake(amount);
        showToast(`Unstaked ${amount} DDM`, 'success');
        renderStaking();
      } catch (e) { showToast(e.message, 'error'); }
    });
  },

  async doTransfer() {
    const to = document.getElementById('transfer-to')?.value;
    const amount = parseInt(document.getElementById('transfer-amount')?.value || '0');
    if (!to || amount <= 0) { showToast('Invalid address or amount', 'warning'); return; }
    try {
      await node.transfer(to, amount);
      document.getElementById('transfer-modal')?.classList.remove('active');
      showToast(`Sent ${amount} DDM`, 'success');
      renderWallet();
    } catch (e) { showToast(e.message, 'error'); }
  },

  showTransferModal() {
    document.getElementById('transfer-modal')?.classList.add('active');
  },

  async saveProfile() {
    const name = document.getElementById('edit-name')?.value;
    const handle = document.getElementById('edit-handle')?.value;
    const bio = document.getElementById('edit-bio')?.value;
    const profileData = { name, handle, bio };
    if (_pendingAvatarData) {
      profileData.avatar = _pendingAvatarData;
      _pendingAvatarData = null;
    }
    if (_pendingBannerData) {
      profileData.banner = _pendingBannerData;
      _pendingBannerData = null;
    }
    try {
      await node.updateProfile(profileData);
      showToast('Profile updated! (-0.5 DDM)', 'success');
      navigate('profile');
    } catch (e) { showToast(e.message, 'error'); }
  },

  async connectPeer() {
    const input = document.getElementById('peer-offer');
    if (!input?.value) {
      const { offerString, peerId, _pc } = await node.createOffer();
      window._pendingPC = _pc; window._pendingPeerId = peerId;
      showCopyDialog('Share this offer code', offerString);
    } else {
      const { answerString } = await node.acceptOffer(input.value);
      showCopyDialog('Send this answer back', answerString);
      input.value = '';
    }
  },

  async completeAnswer() {
    showPrompt('Complete Connection', 'Paste the answer code from the other peer:', 'Paste answer...', async (answer) => {
      if (answer && window._pendingPC) {
        await node.completeConnection(window._pendingPeerId, answer, window._pendingPC);
        window._pendingPC = null;
        showToast('Peer connected!', 'success');
      }
    });
  },

  viewPost(postId) {
    _currentPostId = postId;
    navigate('single-post/' + postId);
  },

  viewUser(address) {
    if (address === node.wallet?.address) { navigate('profile'); }
    else { _currentProfileAddr = address; navigate('other-profile/' + address); }
  },

  async followUser(address) {
    try {
      const following = node.blockchain.state.following.get(node.wallet?.address) || new Set();
      if (following.has(address)) {
        await node.unfollowUser(address);
        showToast(t('unfollowed') || 'Unfollowed', 'info', 2000);
      } else {
        await node.followUser(address);
        showToast(t('followed') || 'Followed!', 'success', 2000);
      }
    } catch (e) { showToast(e.message, 'error'); }
  },

  bookmarkPost(postId) {
    const bookmarks = JSON.parse(localStorage.getItem('diadem_bookmarks') || '[]');
    const idx = bookmarks.indexOf(postId);
    if (idx >= 0) bookmarks.splice(idx, 1);
    else bookmarks.push(postId);
    localStorage.setItem('diadem_bookmarks', JSON.stringify(bookmarks));
    // Re-render current page
    const hash = window.location.hash.slice(1);
    const basePage = hash.includes('/') ? hash.slice(0, hash.indexOf('/')) : hash;
    refreshPageData(basePage);
  },

  doSearch(query) {
    if (!query) return;
    navigate('search');
    setTimeout(() => renderSearch(query), 0);
  },

  filterTransactions(filter) {
    renderTransactions(filter);
  },

  async deleteReply(replyId, parentId) {
    showConfirm('Delete Reply', 'Are you sure you want to delete this reply?', async () => {
      try {
        await node.deleteReply(replyId, parentId);
        showToast('Reply deleted', 'success');
        if (_currentPostId) renderSinglePost(_currentPostId);
        else if (_currentProfileAddr || location.hash.startsWith('#profile')) {
          const addr = _currentProfileAddr || node.wallet?.address;
          if (addr) this._profileTab(addr, 'replies');
        }
      } catch (e) { showToast(e.message, 'error'); }
    });
  },

  async postReply(postId) {
    const input = document.getElementById('reply-input');
    if (!input?.value?.trim()) return;
    try {
      await node.replyToPost(postId, input.value.trim());
      input.value = '';
      setTimeout(() => renderSinglePost(postId), 100);
    } catch (e) { showToast(e.message, 'error'); }
  },

  async sendSavedMessage() {
    const input = document.getElementById('saved-msg-input');
    const text = input?.value?.trim() || '';
    const image = _dmImageData;
    if (!text && !image) return;
    try {
      const content = image ? (text ? text + '\n[img]' : '[img]') : text;
      await node.saveMessage(content);
      if (input) input.value = '';
      _dmImageData = null;
      const preview = document.getElementById('dm-image-preview');
      if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    } catch (e) { showToast(e.message, 'error'); }
  },

  async deleteSavedMessage(msgId) {
    try { await node.deleteSavedMessage(msgId); } catch (e) { console.error(e); }
  },

  openDM(addr) {
    _activeDMAddress = addr;
    _dmRenderedCount = 0; // force full render on chat switch
    if (addr && addr !== '__saved__') _markChatRead(addr);
    renderMessages();
  },

  async sendDM(toAddr) {
    const input = document.getElementById('dm-msg-input');
    const text = input?.value?.trim() || '';
    const image = _dmImageData;
    if (!text && !image) return;
    try {
      await node.sendDirectMessage(toAddr, text, image);
      if (input) input.value = '';
      _dmImageData = null;
      const preview = document.getElementById('dm-image-preview');
      if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
    } catch (e) { showToast(e.message, 'error'); }
  },

  async previewDMImage(input) {
    if (!input.files?.[0]) return;
    try {
      _dmImageData = await resizeImage(input.files[0], 800, 600);
      const preview = document.getElementById('dm-image-preview');
      if (preview) {
        preview.style.display = 'flex';
        preview.innerHTML = `
          <div style="position:relative;display:inline-block;">
            <img src="${_dmImageData}" alt="" style="max-height:100px;border-radius:8px;">
            <button onclick="window.diademUI._clearDMImage()" style="position:absolute;top:-6px;right:-6px;width:22px;height:22px;border-radius:50%;background:var(--danger);color:#FFF;border:none;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;">×</button>
          </div>`;
      }
    } catch (e) { showToast('Failed to load image', 'error'); }
  },

  dmPaymentDialog(toAddr) {
    const p = node.getProfile(toAddr) || {};
    const name = p.name || toAddr.slice(0, 10) + '...';
    const bal = node.getBalance();
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" style="max-width:420px;">
        <div style="display:flex;gap:0;margin-bottom:16px;border-radius:10px;overflow:hidden;border:1px solid var(--divider);">
          <button id="dm-pay-tab-send" class="dm-pay-tab active" onclick="window.diademUI._switchPayTab('send')" style="flex:1;padding:10px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:var(--accent);color:#FFF;transition:all 0.2s;"><i class="icon-wallet" style="font-size:13px;margin-right:4px;"></i>${t('dm_send_ddm')}</button>
          <button id="dm-pay-tab-request" class="dm-pay-tab" onclick="window.diademUI._switchPayTab('request')" style="flex:1;padding:10px;font-size:13px;font-weight:600;border:none;cursor:pointer;background:var(--bg-input);color:var(--text-body);transition:all 0.2s;"><i class="icon-arrow-down-circle" style="font-size:13px;margin-right:4px;"></i>${t('dm_request_ddm')}</button>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">${t('dm_send_to')} <strong>${escapeHtml(name)}</strong></div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">${t('dm_your_balance')}: <strong style="color:var(--accent);">${bal.toLocaleString()} DDM</strong></div>
        <input type="number" id="dm-pay-amount" class="input-field" placeholder="${t('dm_amount_placeholder')}" style="margin-bottom:8px;" min="0.1" step="0.1">
        <input type="text" id="dm-pay-memo" class="input-field" placeholder="${t('dm_memo_placeholder')}" style="margin-bottom:16px;">
        <div class="confirm-actions">
          <button class="btn btn-outline" onclick="this.closest('.confirm-overlay').remove()">${t('edit_cancel')}</button>
          <button class="btn btn-primary" id="dm-pay-submit" onclick="window.diademUI._confirmDmPayment('${toAddr}')"><i class="icon-wallet" style="font-size:14px;margin-right:6px;"></i>${t('dm_send_btn')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => document.getElementById('dm-pay-amount')?.focus(), 100);
  },

  _currentPayMode: 'send',

  _switchPayTab(mode) {
    this._currentPayMode = mode;
    const sendTab = document.getElementById('dm-pay-tab-send');
    const reqTab = document.getElementById('dm-pay-tab-request');
    const submitBtn = document.getElementById('dm-pay-submit');
    if (mode === 'send') {
      sendTab.style.background = 'var(--accent)'; sendTab.style.color = '#FFF';
      reqTab.style.background = 'var(--bg-input)'; reqTab.style.color = 'var(--text-body)';
      submitBtn.innerHTML = `<i class="icon-wallet" style="font-size:14px;margin-right:6px;"></i>${t('dm_send_btn')}`;
    } else {
      reqTab.style.background = 'var(--accent)'; reqTab.style.color = '#FFF';
      sendTab.style.background = 'var(--bg-input)'; sendTab.style.color = 'var(--text-body)';
      submitBtn.innerHTML = `<i class="icon-wallet" style="font-size:14px;margin-right:6px;"></i>${t('dm_request_btn')}`;
    }
  },

  async _confirmDmPayment(toAddr) {
    const amountInput = document.getElementById('dm-pay-amount');
    const memoInput = document.getElementById('dm-pay-memo');
    const amount = parseFloat(amountInput?.value);
    const memo = memoInput?.value?.trim() || '';
    if (!amount || amount <= 0) { showToast(t('dm_invalid_amount'), 'error'); return; }

    if (this._currentPayMode === 'request') {
      try {
        const reqContent = `__PAY_REQUEST__${amount}__${memo}`;
        await node.sendDirectMessage(toAddr, reqContent);
        document.querySelector('.confirm-overlay')?.remove();
        showToast(`${t('dm_request_sent')} ${amount} DDM`, 'success');
        _showPaymentAnimation('request');
      } catch (e) { showToast(e.message, 'error'); }
    } else {
      try {
        await node.sendDmPayment(toAddr, amount, memo);
        document.querySelector('.confirm-overlay')?.remove();
        showToast(`${t('dm_payment_sent')} ${amount} DDM`, 'success');
        _showPaymentAnimation('sent');
      } catch (e) { showToast(e.message, 'error'); }
    }
  },

  newDMDialog() {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    // Get all known profiles
    const profiles = [];
    for (const [addr, p] of node.blockchain.state.profiles) {
      if (addr === node.wallet?.address) continue;
      profiles.push({ addr, name: p.name || addr.slice(0, 10) + '...', avatar: p.avatar });
    }
    overlay.innerHTML = `
      <div class="confirm-box" style="max-width:420px;max-height:70vh;">
        <div class="confirm-title">${t('dm_new_chat')}</div>
        <input type="text" id="dm-search-user" class="input-field" placeholder="${t('dm_search_placeholder')}" style="margin-bottom:12px;" oninput="window.diademUI._filterDMUsers(this.value)">
        <div id="dm-user-list" style="max-height:300px;overflow-y:auto;">
          ${profiles.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--text-muted);">${t('dm_no_users')}</div>` :
            profiles.map(u => {
              const initials = u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
              return `<div class="dm-user-item" data-name="${escapeHtml(u.name.toLowerCase())}" data-addr="${u.addr}" onclick="document.querySelector('.confirm-overlay')?.remove();window.diademUI.openDM('${u.addr}');" style="display:flex;align-items:center;gap:12px;padding:10px;border-radius:10px;cursor:pointer;transition:background 0.15s;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='transparent'">
                ${u.avatar ? `<img src="${u.avatar}" alt="" style="width:40px;height:40px;border-radius:50%;object-fit:cover;">` :
                  `<div class="avatar" style="width:40px;height:40px;background:var(--avatar-fill);"><span class="avatar-initials">${initials}</span></div>`}
                <div>
                  <div style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(u.name)}</div>
                  <div style="font-size:11px;color:var(--text-muted);font-family:monospace;">${u.addr.slice(0, 8)}...${u.addr.slice(-4)}</div>
                </div>
              </div>`;
            }).join('')}
        </div>
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--divider);">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">${t('dm_or_paste_addr')}</div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="dm-manual-addr" class="input-field" placeholder="${t('dm_addr_placeholder')}" style="flex:1;font-size:12px;">
            <button class="btn btn-primary" style="padding:0 16px;" onclick="const a=document.getElementById('dm-manual-addr')?.value?.trim();if(a){document.querySelector('.confirm-overlay')?.remove();window.diademUI.openDM(a);}">${t('dm_open')}</button>
          </div>
        </div>
        <div class="confirm-actions" style="margin-top:12px;">
          <button class="btn btn-outline" onclick="this.closest('.confirm-overlay').remove()">${t('edit_cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    setTimeout(() => document.getElementById('dm-search-user')?.focus(), 100);
  },

  _filterDMUsers(query) {
    const items = document.querySelectorAll('.dm-user-item');
    const q = query.toLowerCase();
    items.forEach(item => {
      const name = item.dataset.name || '';
      const addr = item.dataset.addr || '';
      item.style.display = (name.includes(q) || addr.includes(q)) ? 'flex' : 'none';
    });
  },

  async _payRequest(toAddr, amount, memo) {
    try {
      await node.sendDmPayment(toAddr, amount, memo);
      showToast(`${t('dm_payment_sent')} ${amount} DDM`, 'success');
      _showPaymentAnimation('sent');
    } catch (e) { showToast(e.message, 'error'); }
  },

  _dmTyping(toAddr) {
    _sendTypingSignal(toAddr);
  },

  _clearDMImage() {
    _dmImageData = null;
    const preview = document.getElementById('dm-image-preview');
    if (preview) { preview.style.display = 'none'; preview.innerHTML = ''; }
  },

  startDMFromProfile(addr) {
    _activeDMAddress = addr;
    window.location.hash = 'messages';
  },

  changeLang(lang) {
    setLang(lang);
    document.documentElement.lang = lang === 'uk' ? 'uk' : 'en';
    updateSidebarLabels();
    updateStaticLabels();
    const hash = window.location.hash.slice(1);
    const basePage = hash.includes('/') ? hash.slice(0, hash.indexOf('/')) : hash;
    refreshPageData(basePage);
  },

  async buyDecor(itemId, slot, price) {
    const item = SHOP_ITEMS.find(i => i.id === itemId);
    showConfirm(t('shop_buy') + ' ' + (item?.name || itemId), `${t('shop_confirm_buy')} ${price} DDM?`, async () => {
      try {
        await node.buyProfileDecor(itemId, slot, price);
        showToast(`Purchased ${item?.name || itemId}!`, 'success');
        renderShop();
      } catch (e) { showToast(e.message, 'error'); }
    });
  },

  async equipDecor(itemId, slot) {
    try {
      await node.equipProfileDecor(slot, itemId);
      showToast(t('shop_equipped_label') + '!', 'success', 1500);
    } catch (e) { showToast(e.message, 'error'); }
  },

  async unequipDecor(slot) {
    try {
      await node.equipProfileDecor(slot, null);
      showToast(t('shop_unequip'), 'info', 1500);
    } catch (e) { showToast(e.message, 'error'); }
  },

  _showLikersList(postId) {
    const likers = node.blockchain.state.likes.get(postId) || new Set();
    const list = [...likers];
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" style="max-width:400px;max-height:70vh;overflow-y:auto;">
        <div class="confirm-title">${t('sp_liked_by')} (${list.length})</div>
        ${list.length === 0 ? '<div class="text-muted text-sm" style="padding:16px 0;">No likes yet</div>' :
          list.map(addr => {
            const p = node.getProfile(addr) || {};
            const n = p.name || addr.slice(0, 10) + '...';
            const initials = n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--divider);">
              ${p.avatar ? `<div class="avatar"><img src="${p.avatar}" alt=""></div>` : `<div class="avatar" style="background:var(--avatar-fill);"><span class="avatar-initials">${initials}</span></div>`}
              <div style="flex:1;cursor:pointer;" onclick="this.closest('.confirm-overlay').remove();window.diademUI.viewUser('${addr}')">
                <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escapeHtml(n)}</div>
                <div style="font-size:12px;color:var(--text-muted);font-family:monospace;">${addr.slice(0, 8)}...${addr.slice(-4)}</div>
              </div>
            </div>`;
          }).join('')}
        <div class="confirm-actions" style="margin-top:12px;">
          <button class="btn btn-outline" onclick="this.closest('.confirm-overlay').remove()">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  },

  _viewImage(src) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML = `<img src="${src}" alt="" style="max-width:90vw;max-height:90vh;border-radius:12px;object-fit:contain;">`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', () => overlay.remove());
  },

  // Image handlers
  async previewAvatar(input) {
    if (!input.files?.[0]) return;
    try {
      const result = await showImageEditor(input.files[0], { cropW: 256, cropH: 256, shape: 'circle', title: 'Edit Avatar' });
      if (!result) { input.value = ''; return; }
      _pendingAvatarData = result;
      const preview = document.getElementById('edit-avatar-preview');
      if (preview) preview.innerHTML = `<img src="${_pendingAvatarData}" alt="">`;
    } catch (e) { showToast('Failed to load image', 'error'); }
    input.value = '';
  },

  async previewBanner(input) {
    if (!input.files?.[0]) return;
    try {
      const result = await showImageEditor(input.files[0], { cropW: 1200, cropH: 400, shape: 'rect', title: 'Edit Banner' });
      if (!result) { input.value = ''; return; }
      _pendingBannerData = result;
      const preview = document.getElementById('edit-banner-preview');
      if (preview) {
        preview.style.backgroundImage = `url(${_pendingBannerData})`;
        preview.style.backgroundSize = 'cover';
        preview.style.backgroundPosition = 'center';
        const hint = document.getElementById('edit-banner-hint');
        if (hint) hint.style.display = 'none';
      }
    } catch (e) { showToast('Failed to load image', 'error'); }
    input.value = '';
  },

  async previewComposeImage(input) {
    if (!input.files) return;
    try {
      for (const file of input.files) {
        if (_composeImageList.length >= 4) break;
        const data = await resizeImage(file, 800, 600);
        _composeImageList.push(data);
      }
      _composeImageData = _composeImageList[0] || null;
      this._updateComposePreview();
    } catch (e) { showToast('Failed to load image', 'error'); }
  },

  _updateComposePreview() {
    const preview = document.getElementById('compose-image-preview');
    if (!preview) return;
    if (_composeImageList.length === 0) { preview.style.display = 'none'; return; }
    preview.style.display = 'block';
    preview.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${Math.min(_composeImageList.length, 2)}, 1fr);gap:6px;position:relative;">
        ${_composeImageList.map((src, i) => `
          <div style="position:relative;">
            <img src="${src}" style="width:100%;height:${_composeImageList.length === 1 ? '200' : '120'}px;object-fit:cover;border-radius:10px;border:1px solid var(--divider);">
            <button style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,.6);color:#fff;border:none;border-radius:50%;width:22px;height:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;" onclick="window.diademUI._removeComposeImageAt(${i})"><i class="icon-x" style="font-size:11px;"></i></button>
          </div>`).join('')}
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:8px;cursor:pointer;font-size:12px;color:var(--text-muted);">
        <input type="checkbox" ${_composeSpoiler ? 'checked' : ''} onchange="window.diademUI._toggleSpoiler(this.checked)"> Spoiler
      </label>
      ${_composeImageList.length < 4 ? `<button class="post-action" style="margin-top:4px;font-size:11px;" onclick="document.getElementById('compose-image-input').click()"><i class="icon-image" style="font-size:13px;"></i> +</button>` : ''}
    `;
  },

  _removeComposeImageAt(index) {
    _composeImageList.splice(index, 1);
    _composeImageData = _composeImageList[0] || null;
    this._updateComposePreview();
  },

  _toggleSpoiler(checked) {
    _composeSpoiler = checked;
  },

  _insertFormat(before, after) {
    const ta = document.getElementById('compose-text');
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.slice(start, end);
    const replacement = before + (selected || 'text') + after;
    ta.setRangeText(replacement, start, end, 'select');
    ta.focus();
  },

  removeComposeImage() {
    _composeImageData = null;
    _composeImageList = [];
    _composeSpoiler = false;
    const preview = document.getElementById('compose-image-preview');
    if (preview) preview.style.display = 'none';
  },

  // Reactions
  async reactToPost(postId, emoji) {
    try {
      await node.reactToPost(postId, emoji);
    } catch (e) { showToast(e.message, 'error'); }
  },

  showFollowList(address, type) {
    const set = type === 'following'
      ? (node.blockchain.state.following.get(address) || new Set())
      : (node.blockchain.state.followers.get(address) || new Set());
    const list = [...set];
    const title = type === 'following' ? t('profile_following') : t('profile_followers');
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box" style="max-width:400px;max-height:70vh;overflow-y:auto;">
        <div class="confirm-title">${title} (${list.length})</div>
        ${list.length === 0 ? '<div class="text-muted text-sm" style="padding:16px 0;">Empty</div>' :
          list.map(addr => {
            const p = node.getProfile(addr) || {};
            const n = p.name || addr.slice(0, 10) + '...';
            const initials = n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--divider);">
              ${p.avatar ? `<div class="avatar"><img src="${p.avatar}" alt=""></div>` : `<div class="avatar" style="background:var(--avatar-fill);"><span class="avatar-initials">${initials}</span></div>`}
              <div style="flex:1;cursor:pointer;" onclick="this.closest('.confirm-overlay').remove();window.diademUI.viewUser('${addr}')">
                <div style="font-weight:600;font-size:14px;color:var(--text-primary);">${escapeHtml(n)}</div>
                <div style="font-size:12px;color:var(--text-muted);font-family:monospace;">${addr.slice(0, 8)}...${addr.slice(-4)}</div>
              </div>
            </div>`;
          }).join('')}
        <div class="confirm-actions" style="margin-top:12px;">
          <button class="btn btn-outline" onclick="this.closest('.confirm-overlay').remove()">Close</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  },

  _profileTab(address, tab, btnEl) {
    _currentProfileTab = tab;
    // Update active tab button
    if (btnEl) {
      const tabsContainer = btnEl.closest('.tabs');
      if (tabsContainer) {
        tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btnEl.classList.add('active');
      }
    } else {
      // Called programmatically — find and highlight the right tab button
      const tabsContainer = document.querySelector('#page-profile .tabs, #page-other-profile .tabs');
      if (tabsContainer) {
        const buttons = tabsContainer.querySelectorAll('.tab');
        const tabNames = ['posts', 'replies', 'media', 'likes', 'stats', 'stories'];
        buttons.forEach((b, i) => b.classList.toggle('active', tabNames[i] === tab));
      }
    }
    const contentEl = document.getElementById('profile-tab-content');
    if (!contentEl) return;
    const myAddr = node.wallet?.address;

    if (tab === 'posts') {
      const posts = node.getUserPosts(address);
      contentEl.innerHTML = posts.length > 0
        ? posts.map(p => renderPost(p)).join('')
        : `<div class="text-muted" style="text-align:center;padding:40px;">${t('profile_no_posts')}</div>`;
    } else if (tab === 'replies') {
      // Collect all replies by this user
      const userReplies = [];
      for (const [postId, replies] of node.blockchain.state.replies) {
        for (const r of replies) {
          if (r.author === address) {
            const parentPost = node.blockchain.state.posts.get(postId);
            const rLikes = node.blockchain.state.likes.get(r.id) || new Set();
            userReplies.push({
              ...r,
              parentPostId: postId,
              parentAuthor: parentPost?.author,
              profile: node.getProfile(r.author),
              likesCount: rLikes.size,
              liked: myAddr && rLikes.has(myAddr) ? ' liked' : '',
            });
          }
        }
      }
      userReplies.sort((a, b) => b.timestamp - a.timestamp);
      if (userReplies.length === 0) {
        contentEl.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('sp_no_replies_profile')}</div>`;
      } else {
        contentEl.innerHTML = userReplies.map(r => {
          const rp = r.profile || {};
          const rn = rp.name || r.author.slice(0, 10);
          const rh = rp.handle || r.author.slice(0, 12);
          const parentProfile = r.parentAuthor ? (node.getProfile(r.parentAuthor) || {}) : {};
          const parentName = parentProfile.name || (r.parentAuthor ? r.parentAuthor.slice(0, 10) + '...' : '');
          return `
            <div class="post" style="cursor:pointer;" onclick="window.diademUI.viewPost('${r.parentPostId}')">
              <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;"><i class="icon-corner-up-left" style="font-size:12px;"></i> ${t('sp_replying_to')} ${escapeHtml(parentName)}</div>
              <div class="post-header">
                ${renderAvatar(rp)}
                <div style="flex:1;">
                  <span class="post-author">${escapeHtml(rn)}</span>
                  <div class="post-handle">${escapeHtml(rh)} · ${formatTimeAgo(r.timestamp)}</div>
                </div>
              </div>
              <div class="post-content">${escapeHtml(r.content)}</div>
              <div class="post-actions">
                <button class="post-action${r.liked}" onclick="event.stopPropagation();window.diademUI.likePost('${r.id}')"><i class="icon-heart"></i> ${r.likesCount}</button>
                ${r.author === myAddr ? `<button class="post-action" onclick="event.stopPropagation();window.diademUI.deleteReply('${r.id}','${r.parentPostId}')" title="Delete"><i class="icon-trash-2"></i></button>` : ''}
              </div>
            </div>`;
        }).join('');
      }
    } else if (tab === 'media') {
      // Show only posts with media
      const posts = node.getUserPosts(address).filter(p => p.media);
      if (posts.length === 0) {
        contentEl.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('sp_no_media')}</div>`;
      } else {
        contentEl.innerHTML = posts.map(p => renderPost(p)).join('');
      }
    } else if (tab === 'likes') {
      // Show posts this user has liked
      const likedPosts = [];
      for (const [postId, likers] of node.blockchain.state.likes) {
        if (likers.has(address)) {
          const post = node.blockchain.state.posts.get(postId);
          if (post) {
            likedPosts.push({
              ...post, id: postId,
              profile: node.getProfile(post.author),
              likesCount: likers.size,
              liked: myAddr && likers.has(myAddr) ? ' liked' : '',
            });
          }
        }
      }
      likedPosts.sort((a, b) => b.timestamp - a.timestamp);
      if (likedPosts.length === 0) {
        contentEl.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('sp_no_liked')}</div>`;
      } else {
        contentEl.innerHTML = likedPosts.map(p => renderPost(p)).join('');
      }
    } else if (tab === 'stats') {
      // ── Gather all statistics ──
      const allPosts = node.getUserPosts(address).filter(p => !p.repostedBy);
      const totalPosts = allPosts.length;

      // Total likes received
      let totalLikesReceived = 0;
      const postLikes = [];
      for (const p of allPosts) {
        const ls = node.blockchain.state.likes.get(p.id) || new Set();
        totalLikesReceived += ls.size;
        postLikes.push({ ...p, lc: ls.size });
      }

      // Total likes given
      let totalLikesGiven = 0;
      for (const [, likers] of node.blockchain.state.likes) {
        if (likers.has(address)) totalLikesGiven++;
      }

      // Replies count
      let totalReplies = 0;
      let repliesReceived = 0;
      for (const [postId, replies] of node.blockchain.state.replies) {
        for (const r of replies) {
          if (r.author === address) totalReplies++;
        }
        const parentPost = node.blockchain.state.posts.get(postId);
        if (parentPost && parentPost.author === address) {
          repliesReceived += replies.length;
        }
      }

      // Reposts
      let totalReposts = 0;
      for (const [, repostSet] of node.blockchain.state.reposts) {
        if (repostSet.has(address)) totalReposts++;
      }

      // Reposts received (others reposted this user's posts)
      let repostsReceived = 0;
      for (const p of allPosts) {
        const rs = node.blockchain.state.reposts.get(p.id);
        if (rs) repostsReceived += rs.size;
      }

      // Followers / following
      const followersSet = node.blockchain.state.followers.get(address) || new Set();
      const followingSet = node.blockchain.state.following.get(address) || new Set();

      // Reputation
      const rep = node.getReputation(address);
      const repProg = getRepProgress(rep.score);

      // Top posts by likes
      const topPosts = [...postLikes].sort((a, b) => b.lc - a.lc).slice(0, 5);

      // Top posts by reposts
      const topReposted = allPosts.map(p => {
        const rs = node.blockchain.state.reposts.get(p.id);
        return { ...p, rc: rs ? rs.size : 0 };
      }).filter(p => p.rc > 0).sort((a, b) => b.rc - a.rc).slice(0, 5);

      // Average likes per post
      const avgLikes = totalPosts > 0 ? (totalLikesReceived / totalPosts).toFixed(1) : '0';

      // Activity timeline (posts per day for last 7 days)
      const now = Date.now();
      const dayMs = 86400000;
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const dayStart = now - i * dayMs;
        const dayEnd = dayStart + dayMs;
        const count = allPosts.filter(p => p.timestamp >= dayStart && p.timestamp < dayEnd).length;
        const d = new Date(dayStart);
        days.push({ label: `${d.getDate()}.${d.getMonth() + 1}`, count });
      }
      const maxDay = Math.max(1, ...days.map(d => d.count));

      // Engagement rate (likes + replies received per post)
      const engRate = totalPosts > 0 ? ((totalLikesReceived + repliesReceived) / totalPosts).toFixed(1) : '0';

      // Build follower list with reputation
      const followersList = [...followersSet].map(addr => {
        const prof = node.getProfile(addr) || {};
        const fRep = node.getReputation(addr);
        const fProg = getRepProgress(fRep.score);
        return { address: addr, profile: prof, rep: fRep, level: fProg.cur.level };
      }).sort((a, b) => b.rep.score - a.rep.score);

      contentEl.innerHTML = `
        <div style="padding:20px 0;">
          <!-- Overview Cards -->
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px;">
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:var(--text-primary);">${totalPosts}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_total_posts')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#EF4444;">${totalLikesReceived}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_likes_received')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#3B82F6;">${totalLikesGiven}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_likes_given')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#8B5CF6;">${totalReplies}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_replies_sent')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#22C55E;">${repliesReceived}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_replies_received')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#F59E0B;">${totalReposts}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_reposts_made')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:#EC4899;">${repostsReceived}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('stats_reposts_received')}</div>
            </div>
            <div style="background:var(--bg-secondary);border-radius:12px;padding:16px;text-align:center;">
              <div style="font-size:24px;font-weight:700;color:var(--text-primary);">${followersSet.size}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${t('profile_followers')}</div>
            </div>
          </div>

          <!-- Engagement Stats -->
          <div style="background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:0 0 16px;">${t('stats_engagement')}</h3>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;">
              <div>
                <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">${t('stats_avg_likes')}</div>
                <div style="font-size:20px;font-weight:700;color:var(--text-primary);margin-top:4px;">${avgLikes}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">${t('stats_eng_rate')}</div>
                <div style="font-size:20px;font-weight:700;color:var(--text-primary);margin-top:4px;">${engRate}</div>
              </div>
              <div>
                <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;">${t('stats_reputation')}</div>
                <div style="font-size:20px;font-weight:700;margin-top:4px;color:${LEVEL_COLORS[repProg.cur.level] || '#888'};">${rep.score} · ${repProg.cur.level}</div>
              </div>
            </div>
          </div>

          <!-- Activity Chart (last 7 days) -->
          <div style="background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:0 0 16px;">${t('stats_activity')}</h3>
            <div style="display:flex;align-items:flex-end;gap:8px;height:100px;">
              ${days.map(d => `
                <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">
                  <div style="font-size:10px;color:var(--text-muted);">${d.count}</div>
                  <div style="width:100%;background:var(--btn-primary-bg);border-radius:4px;height:${Math.max(4, (d.count / maxDay) * 80)}px;transition:height 0.3s;"></div>
                  <div style="font-size:10px;color:var(--text-muted);">${d.label}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- Top Posts by Likes -->
          ${topPosts.length > 0 ? `
          <div style="background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:0 0 16px;">${t('stats_top_liked')}</h3>
            ${topPosts.map((p, i) => `
              <div style="display:flex;align-items:center;gap:12px;padding:10px 0;${i < topPosts.length - 1 ? 'border-bottom:1px solid var(--divider);' : ''}cursor:pointer;" onclick="window.diademUI.viewPost('${p.id}')">
                <div style="font-size:16px;font-weight:700;color:var(--text-muted);width:24px;text-align:center;">${i + 1}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.content?.slice(0, 80) || '')}</div>
                  <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${formatTimeAgo(p.timestamp)}</div>
                </div>
                <div style="display:flex;align-items:center;gap:4px;color:#EF4444;font-size:13px;font-weight:600;">
                  <i class="icon-heart" style="font-size:14px;"></i> ${p.lc}
                </div>
              </div>
            `).join('')}
          </div>` : ''}

          <!-- Top Reposted Posts -->
          ${topReposted.length > 0 ? `
          <div style="background:var(--bg-secondary);border-radius:12px;padding:20px;margin-bottom:24px;">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:0 0 16px;">${t('stats_top_shared')}</h3>
            ${topReposted.map((p, i) => `
              <div style="display:flex;align-items:center;gap:12px;padding:10px 0;${i < topReposted.length - 1 ? 'border-bottom:1px solid var(--divider);' : ''}cursor:pointer;" onclick="window.diademUI.viewPost('${p.id}')">
                <div style="font-size:16px;font-weight:700;color:var(--text-muted);width:24px;text-align:center;">${i + 1}</div>
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(p.content?.slice(0, 80) || '')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:4px;color:#22C55E;font-size:13px;font-weight:600;">
                  <i class="icon-repeat" style="font-size:14px;"></i> ${p.rc}
                </div>
              </div>
            `).join('')}
          </div>` : ''}

          <!-- Followers with Status -->
          <div style="background:var(--bg-secondary);border-radius:12px;padding:20px;">
            <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:0 0 16px;">${t('stats_followers_list')} (${followersList.length})</h3>
            ${followersList.length === 0 ? `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:20px 0;">${t('stats_no_followers')}</div>` :
              followersList.slice(0, 20).map(f => {
                const fn = f.profile.name || f.address.slice(0, 10) + '...';
                const fh = f.profile.handle || f.address.slice(0, 12);
                const fAvatar = f.profile.avatar ? `<img src="${f.profile.avatar}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;">` : `<div style="width:36px;height:36px;border-radius:50%;background:var(--divider);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;color:var(--text-muted);">${fn[0]?.toUpperCase() || '?'}</div>`;
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:8px 0;cursor:pointer;" onclick="location.hash='#profile/${f.address}'">
                  ${fAvatar}
                  <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${escapeHtml(fn)}</div>
                    <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(fh)}</div>
                  </div>
                  <div style="font-size:11px;font-weight:600;color:${LEVEL_COLORS[f.level] || '#888'};background:${LEVEL_COLORS[f.level] || '#888'}18;padding:3px 8px;border-radius:6px;">${f.level}</div>
                </div>`;
              }).join('')}
            ${followersList.length > 20 ? `<div style="text-align:center;color:var(--text-muted);font-size:12px;padding-top:12px;">+${followersList.length - 20} more</div>` : ''}
          </div>
        </div>
      `;
    } else if (tab === 'stories') {
      const allStories = node.getAllStories(address);
      const now = Date.now();
      const isOwn = address === myAddr;

      if (allStories.length === 0) {
        contentEl.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">
          ${isOwn ? `<i class="icon-camera" style="font-size:32px;display:block;margin-bottom:12px;opacity:0.4;"></i>
          <p>No stories yet</p>
          <button class="btn btn-primary" style="margin-top:12px;border-radius:18px;" onclick="window.diademUI.createStory()">${t('stories_add')}</button>` : 'No stories yet'}
        </div>`;
      } else {
        const active = allStories.filter(s => {
          if (s.duration === 0) return true;
          return now < s.timestamp + (s.duration || 24) * 3600000;
        });
        const archived = allStories.filter(s => {
          if (s.duration === 0) return false;
          return now >= s.timestamp + (s.duration || 24) * 3600000;
        });

        contentEl.innerHTML = `
          <div style="padding:20px 0;">
            ${isOwn ? `<div style="margin-bottom:16px;"><button class="btn btn-primary" style="border-radius:18px;" onclick="window.diademUI.createStory()"><i class="icon-plus" style="margin-right:6px;"></i>${t('stories_add')}</button></div>` : ''}

            ${active.length > 0 ? `
              <h3 style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:12px;">Active Stories (${active.length})</h3>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-bottom:24px;">
                ${active.map(s => `
                  <div class="story-grid-item" style="position:relative;aspect-ratio:9/16;border-radius:12px;overflow:hidden;cursor:pointer;background:#111;" onclick="window.diademUI.viewStory('${address}')">
                    <img src="${s.image}" style="width:100%;height:100%;object-fit:cover;">
                    ${s.text ? `<div style="position:absolute;bottom:8px;left:8px;right:8px;font-size:11px;color:#FFF;text-shadow:0 1px 4px rgba(0,0,0,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.text)}</div>` : ''}
                    <div style="position:absolute;top:6px;right:6px;font-size:10px;color:rgba(255,255,255,0.7);background:rgba(0,0,0,0.4);padding:2px 6px;border-radius:4px;">${formatTimeAgo(s.timestamp)}</div>
                    ${isOwn && !s.hidden ? `<button style="position:absolute;top:6px;left:6px;width:22px;height:22px;border-radius:50%;background:rgba(0,0,0,0.5);border:none;color:#FFF;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;" onclick="event.stopPropagation();window.diademUI.hideStory('${address}','${s.id}')" title="Hide"><i class="icon-eye-off" style="font-size:11px;"></i></button>` : ''}
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${archived.length > 0 ? `
              <h3 style="font-size:14px;font-weight:600;color:var(--text-muted);margin-bottom:12px;cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'grid':'none';this.querySelector('i').style.transform=this.nextElementSibling.style.display==='none'?'':'rotate(90deg)'">
                <i class="icon-chevron-right" style="font-size:14px;margin-right:4px;transition:transform 0.2s;"></i>
                Archive (${archived.length})
              </h3>
              <div style="display:none;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;">
                ${archived.map(s => `
                  <div class="story-grid-item" style="position:relative;aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:#111;opacity:0.6;">
                    <img src="${s.image}" style="width:100%;height:100%;object-fit:cover;">
                    <div style="position:absolute;top:6px;right:6px;font-size:10px;color:rgba(255,255,255,0.7);background:rgba(0,0,0,0.4);padding:2px 6px;border-radius:4px;">${t('stories_expired')}</div>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        `;
      }
    }
  },

  showReactionPicker(postId) {
    // Remove existing picker
    document.querySelectorAll('.reaction-picker').forEach(el => el.remove());
    const postEl = document.querySelector(`[data-post-id="${postId}"]`);
    if (!postEl) return;
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    picker.innerHTML = REACTION_EMOJIS.map(e =>
      `<button class="reaction-emoji" onclick="window.diademUI.reactToPost('${postId}','${e}');this.closest('.reaction-picker').remove()">${e}</button>`
    ).join('');
    postEl.appendChild(picker);
    // Close on outside click
    setTimeout(() => {
      const close = (e) => { if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 10);
  },

  // ── Stories ──
  createStory() {
    const FILTERS = [
      { name: 'None', css: '' },
      { name: 'Warm', css: 'sepia(0.3) saturate(1.4) brightness(1.1)' },
      { name: 'Cool', css: 'saturate(0.8) hue-rotate(20deg) brightness(1.05)' },
      { name: 'B&W', css: 'grayscale(1) contrast(1.1)' },
      { name: 'Vintage', css: 'sepia(0.5) contrast(0.9) brightness(1.1)' },
      { name: 'Drama', css: 'contrast(1.4) saturate(1.2) brightness(0.95)' },
      { name: 'Fade', css: 'contrast(0.8) brightness(1.15) saturate(0.7)' },
      { name: 'Vivid', css: 'saturate(1.8) contrast(1.1)' },
    ];
    const STICKERS = ['🔥', '❤️', '😂', '🎉', '💎', '🚀', '⭐', '🎵', '👑', '💰', '🌈', '✨', '🎯', '💪', '🌟', '🎮'];
    const TEXT_STYLES = [
      { name: 'Classic', bg: 'rgba(0,0,0,0.6)', color: '#FFF', font: 'inherit' },
      { name: 'Neon', bg: 'transparent', color: '#0FF', font: 'inherit', shadow: '0 0 10px #0FF,0 0 20px #0FF' },
      { name: 'Bold', bg: '#FFF', color: '#000', font: 'inherit', weight: '900' },
      { name: 'Retro', bg: 'linear-gradient(135deg,#f093fb,#f5576c)', color: '#FFF', font: 'inherit' },
      { name: 'Glitch', bg: 'rgba(255,0,0,0.3)', color: '#0F0', font: 'monospace' },
    ];

    const overlay = document.createElement('div');
    overlay.className = 'story-editor-overlay';
    overlay.innerHTML = `
      <div class="story-editor">
        <div class="story-editor-header">
          <button class="story-editor-btn" onclick="this.closest('.story-editor-overlay').remove()"><i class="icon-x"></i></button>
          <span style="font-weight:700;font-size:16px;">Create Story</span>
          <button class="story-editor-btn story-editor-publish" id="_se-publish" disabled><i class="icon-send"></i></button>
        </div>
        <div class="story-editor-canvas-wrap" id="_se-canvas-wrap">
          <canvas id="_se-canvas" width="1080" height="1920"></canvas>
          <div id="_se-placeholder" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#555;cursor:pointer;" onclick="document.getElementById('_se-file').click()">
            <div style="text-align:center;">
              <i class="icon-image" style="font-size:56px;display:block;margin-bottom:16px;"></i>
              <span style="font-size:15px;">Tap to add photo or video</span>
            </div>
          </div>
          <input type="file" id="_se-file" accept="image/*,video/*" style="display:none;">
          <div id="_se-text-layers" style="position:absolute;inset:0;pointer-events:none;"></div>
          <div id="_se-sticker-layers" style="position:absolute;inset:0;pointer-events:none;"></div>
        </div>
        <div class="story-editor-toolbar">
          <button class="story-tool" data-tool="text" title="Add Text"><i class="icon-type"></i></button>
          <button class="story-tool" data-tool="sticker" title="Stickers"><i class="icon-smile"></i></button>
          <button class="story-tool" data-tool="draw" title="Draw"><i class="icon-edit-3"></i></button>
          <button class="story-tool" data-tool="filter" title="Filters"><i class="icon-sliders"></i></button>
          <button class="story-tool" data-tool="music" title="Music"><i class="icon-music"></i></button>
          <button class="story-tool" data-tool="duration" title="Duration"><i class="icon-clock"></i></button>
        </div>
        <div class="story-editor-panel" id="_se-panel" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('#_se-canvas');
    const ctx = canvas.getContext('2d');
    const placeholder = overlay.querySelector('#_se-placeholder');
    const publishBtn = overlay.querySelector('#_se-publish');
    const panel = overlay.querySelector('#_se-panel');
    const textLayers = overlay.querySelector('#_se-text-layers');
    const stickerLayers = overlay.querySelector('#_se-sticker-layers');

    let baseImage = null;
    let currentFilter = 0;
    let textOverlays = [];
    let stickerOverlays = [];
    let drawingData = [];
    let isDrawing = false;
    let drawColor = '#FFFFFF';
    let drawWidth = 4;
    let storyDuration = 24; // hours, 0 = permanent

    function redrawCanvas() {
      ctx.clearRect(0, 0, 1080, 1920);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, 1080, 1920);
      if (baseImage) {
        ctx.filter = FILTERS[currentFilter].css || 'none';
        const scale = Math.max(1080 / baseImage.naturalWidth, 1920 / baseImage.naturalHeight);
        const w = baseImage.naturalWidth * scale;
        const h = baseImage.naturalHeight * scale;
        ctx.drawImage(baseImage, (1080 - w) / 2, (1920 - h) / 2, w, h);
        ctx.filter = 'none';
      }
      // Draw strokes
      for (const stroke of drawingData) {
        if (stroke.points.length < 2) continue;
        ctx.beginPath();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = stroke.width * 3;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.moveTo(stroke.points[0].x * 1080, stroke.points[0].y * 1920);
        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x * 1080, stroke.points[i].y * 1920);
        }
        ctx.stroke();
      }
      // Draw text overlays
      for (const t of textOverlays) {
        const style = TEXT_STYLES[t.styleIdx || 0];
        ctx.save();
        const fontSize = (t.size || 32) * 3;
        ctx.font = `${style.weight || '600'} ${fontSize}px ${style.font || 'sans-serif'}`;
        ctx.textAlign = 'center';
        const tx = t.x * 1080;
        const ty = t.y * 1920;
        const metrics = ctx.measureText(t.text);
        const tw = metrics.width + 40;
        const th = fontSize + 30;
        if (style.bg && style.bg !== 'transparent') {
          if (style.bg.startsWith('linear')) {
            ctx.fillStyle = style.color === '#000' ? '#FFF' : 'rgba(0,0,0,0.6)';
          } else {
            ctx.fillStyle = style.bg;
          }
          ctx.beginPath();
          ctx.roundRect(tx - tw / 2, ty - th / 2, tw, th, 12);
          ctx.fill();
        }
        if (style.shadow) {
          ctx.shadowColor = style.color;
          ctx.shadowBlur = 20;
        }
        ctx.fillStyle = style.color;
        ctx.fillText(t.text, tx, ty + fontSize / 3);
        ctx.restore();
      }
      // Draw stickers
      for (const s of stickerOverlays) {
        ctx.font = `${(s.size || 48) * 3}px serif`;
        ctx.textAlign = 'center';
        ctx.fillText(s.emoji, s.x * 1080, s.y * 1920);
      }
    }

    function updateOverlayElements() {
      const wrap = overlay.querySelector('#_se-canvas-wrap');
      const rect = wrap.getBoundingClientRect();
      textLayers.innerHTML = textOverlays.map((t, i) => {
        const style = TEXT_STYLES[t.styleIdx || 0];
        return `<div class="story-text-overlay" data-idx="${i}" style="left:${t.x * 100}%;top:${t.y * 100}%;transform:translate(-50%,-50%);pointer-events:auto;cursor:grab;
          background:${style.bg || 'rgba(0,0,0,0.6)'};color:${style.color};font-family:${style.font || 'inherit'};font-weight:${style.weight || '600'};
          ${style.shadow ? 'text-shadow:' + style.shadow + ';' : ''}
          padding:6px 14px;border-radius:8px;font-size:${t.size || 16}px;white-space:nowrap;user-select:none;position:absolute;">
          ${escapeHtml(t.text)}
          <button style="position:absolute;top:-8px;right:-8px;width:18px;height:18px;border-radius:50%;background:#F00;border:none;color:#FFF;font-size:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;pointer-events:auto;" onclick="event.stopPropagation();window._seRemoveText(${i})">×</button>
        </div>`;
      }).join('');
      stickerLayers.innerHTML = stickerOverlays.map((s, i) => {
        return `<div class="story-sticker-overlay" data-idx="${i}" style="left:${s.x * 100}%;top:${s.y * 100}%;transform:translate(-50%,-50%);pointer-events:auto;cursor:grab;font-size:${s.size || 32}px;position:absolute;user-select:none;">
          ${s.emoji}
          <button style="position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:50%;background:#F00;border:none;color:#FFF;font-size:9px;cursor:pointer;display:flex;align-items:center;justify-content:center;pointer-events:auto;" onclick="event.stopPropagation();window._seRemoveSticker(${i})">×</button>
        </div>`;
      }).join('');
      // Make text/sticker draggable
      textLayers.querySelectorAll('.story-text-overlay').forEach(el => makeDraggable(el, textOverlays, 'text'));
      stickerLayers.querySelectorAll('.story-sticker-overlay').forEach(el => makeDraggable(el, stickerOverlays, 'sticker'));
    }

    function makeDraggable(el, arr, type) {
      let startX, startY, origX, origY;
      const idx = parseInt(el.dataset.idx);
      const onMove = (e) => {
        e.preventDefault();
        const wrap = overlay.querySelector('#_se-canvas-wrap');
        const rect = wrap.getBoundingClientRect();
        const cx = (e.touches ? e.touches[0].clientX : e.clientX);
        const cy = (e.touches ? e.touches[0].clientY : e.clientY);
        arr[idx].x = Math.max(0.05, Math.min(0.95, (cx - rect.left) / rect.width));
        arr[idx].y = Math.max(0.05, Math.min(0.95, (cy - rect.top) / rect.height));
        el.style.left = arr[idx].x * 100 + '%';
        el.style.top = arr[idx].y * 100 + '%';
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp); redrawCanvas(); };
      el.addEventListener('mousedown', (e) => { if (e.target.tagName === 'BUTTON') return; e.preventDefault(); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); });
      el.addEventListener('touchstart', (e) => { if (e.target.tagName === 'BUTTON') return; document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp); });
    }

    window._seRemoveText = (i) => { textOverlays.splice(i, 1); updateOverlayElements(); redrawCanvas(); };
    window._seRemoveSticker = (i) => { stickerOverlays.splice(i, 1); updateOverlayElements(); redrawCanvas(); };

    // File input
    overlay.querySelector('#_se-file').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.type.startsWith('video/')) {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.addEventListener('loadeddata', () => {
          video.currentTime = 0;
          video.addEventListener('seeked', () => {
            const tmpCanvas = document.createElement('canvas');
            tmpCanvas.width = video.videoWidth;
            tmpCanvas.height = video.videoHeight;
            tmpCanvas.getContext('2d').drawImage(video, 0, 0);
            const img = new Image();
            img.onload = () => { baseImage = img; placeholder.style.display = 'none'; publishBtn.disabled = false; redrawCanvas(); };
            img.src = tmpCanvas.toDataURL('image/jpeg', 0.85);
          }, { once: true });
        });
      } else {
        const img = new Image();
        img.onload = () => { baseImage = img; placeholder.style.display = 'none'; publishBtn.disabled = false; redrawCanvas(); };
        img.src = URL.createObjectURL(file);
      }
    });

    // Tool buttons
    overlay.querySelectorAll('.story-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.dataset.tool;
        overlay.querySelectorAll('.story-tool').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (tool === 'text') {
          panel.style.display = 'block';
          panel.innerHTML = `
            <div style="padding:12px;">
              <input id="_se-text-input" class="form-input" placeholder="Enter text..." style="width:100%;box-sizing:border-box;margin-bottom:8px;">
              <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
                ${TEXT_STYLES.map((s, i) => `<button class="story-style-btn${i === 0 ? ' active' : ''}" data-style="${i}" style="background:${s.bg || '#333'};color:${s.color};border:2px solid ${i === 0 ? 'var(--btn-primary-bg)' : 'transparent'};border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;font-weight:${s.weight || '600'};">${s.name}</button>`).join('')}
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:12px;color:var(--text-muted);">Size</span>
                <input type="range" id="_se-text-size" min="12" max="48" value="20" style="flex:1;accent-color:var(--btn-primary-bg);">
                <button class="btn btn-primary" style="border-radius:8px;height:32px;font-size:12px;" id="_se-add-text">Add</button>
              </div>
            </div>`;
          let selStyle = 0;
          panel.querySelectorAll('.story-style-btn').forEach(sb => {
            sb.addEventListener('click', () => {
              panel.querySelectorAll('.story-style-btn').forEach(x => { x.classList.remove('active'); x.style.borderColor = 'transparent'; });
              sb.classList.add('active');
              sb.style.borderColor = 'var(--btn-primary-bg)';
              selStyle = parseInt(sb.dataset.style);
            });
          });
          panel.querySelector('#_se-add-text').addEventListener('click', () => {
            const val = panel.querySelector('#_se-text-input').value.trim();
            if (!val) return;
            const size = parseInt(panel.querySelector('#_se-text-size').value);
            textOverlays.push({ text: val, x: 0.5, y: 0.5, styleIdx: selStyle, size });
            updateOverlayElements();
            redrawCanvas();
            panel.querySelector('#_se-text-input').value = '';
          });
        } else if (tool === 'sticker') {
          panel.style.display = 'block';
          panel.innerHTML = `
            <div style="padding:12px;display:grid;grid-template-columns:repeat(8,1fr);gap:6px;">
              ${STICKERS.map(s => `<button style="font-size:28px;background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;transition:background 0.15s;" onmouseover="this.style.background='var(--bg-active)'" onmouseout="this.style.background='none'" onclick="window._seAddSticker('${s}')">${s}</button>`).join('')}
            </div>`;
          window._seAddSticker = (emoji) => {
            stickerOverlays.push({ emoji, x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4, size: 48 });
            updateOverlayElements();
            redrawCanvas();
          };
        } else if (tool === 'draw') {
          panel.style.display = 'block';
          panel.innerHTML = `
            <div style="padding:12px;">
              <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
                <span style="font-size:12px;color:var(--text-muted);">Color</span>
                ${['#FFFFFF','#FF0000','#00FF00','#0088FF','#FFD700','#FF00FF','#00FFFF','#FF8C00'].map(c => `<button style="width:28px;height:28px;border-radius:50%;background:${c};border:2px solid ${c === drawColor ? '#FFF' : 'transparent'};cursor:pointer;" onclick="window._seDrawColor='${c}';this.parentElement.querySelectorAll('button').forEach(b=>b.style.borderColor='transparent');this.style.borderColor='#FFF'"></button>`).join('')}
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:12px;color:var(--text-muted);">Size</span>
                <input type="range" min="2" max="20" value="${drawWidth}" style="flex:1;accent-color:var(--btn-primary-bg);" oninput="window._seDrawWidth=parseInt(this.value)">
                <button class="btn btn-outline" style="border-radius:8px;height:28px;font-size:11px;" onclick="window._seDrawData=[];window._seRedraw()">Clear</button>
              </div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">Draw on the canvas above</div>
            </div>`;
          window._seDrawColor = drawColor;
          window._seDrawWidth = drawWidth;
          window._seDrawData = drawingData;
          window._seRedraw = () => { drawingData = window._seDrawData; redrawCanvas(); };

          // Enable drawing on canvas wrap
          const wrap = overlay.querySelector('#_se-canvas-wrap');
          const drawHandler = (e) => {
            if (!btn.classList.contains('active')) return;
            const rect = wrap.getBoundingClientRect();
            const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
            const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
            const nx = cx / rect.width;
            const ny = cy / rect.height;
            if (e.type === 'mousedown' || e.type === 'touchstart') {
              isDrawing = true;
              drawingData.push({ color: window._seDrawColor, width: window._seDrawWidth, points: [{ x: nx, y: ny }] });
            } else if (isDrawing && (e.type === 'mousemove' || e.type === 'touchmove')) {
              e.preventDefault();
              drawingData[drawingData.length - 1].points.push({ x: nx, y: ny });
              redrawCanvas();
            } else if (e.type === 'mouseup' || e.type === 'touchend') {
              isDrawing = false;
            }
          };
          wrap.addEventListener('mousedown', drawHandler);
          wrap.addEventListener('mousemove', drawHandler);
          wrap.addEventListener('mouseup', drawHandler);
          wrap.addEventListener('touchstart', drawHandler);
          wrap.addEventListener('touchmove', drawHandler, { passive: false });
          wrap.addEventListener('touchend', drawHandler);
        } else if (tool === 'filter') {
          panel.style.display = 'block';
          panel.innerHTML = `
            <div style="padding:12px;display:flex;gap:8px;overflow-x:auto;">
              ${FILTERS.map((f, i) => `<button class="story-filter-btn${i === currentFilter ? ' active' : ''}" style="flex-shrink:0;padding:8px 14px;border-radius:8px;border:2px solid ${i === currentFilter ? 'var(--btn-primary-bg)' : 'transparent'};background:var(--bg-secondary);color:var(--text-primary);font-size:12px;cursor:pointer;" data-filter="${i}">${f.name}</button>`).join('')}
            </div>`;
          panel.querySelectorAll('.story-filter-btn').forEach(fb => {
            fb.addEventListener('click', () => {
              currentFilter = parseInt(fb.dataset.filter);
              panel.querySelectorAll('.story-filter-btn').forEach(x => { x.classList.remove('active'); x.style.borderColor = 'transparent'; });
              fb.classList.add('active');
              fb.style.borderColor = 'var(--btn-primary-bg)';
              redrawCanvas();
            });
          });
        } else if (tool === 'music') {
          panel.style.display = 'block';
          panel.innerHTML = `
            <div style="padding:12px;">
              <div style="font-size:12px;color:var(--text-muted);text-align:center;padding:20px;">
                <i class="icon-music" style="font-size:24px;display:block;margin-bottom:8px;"></i>
                Music will be available in future updates.<br>Stories are stored on blockchain.
              </div>
            </div>`;
        } else if (tool === 'duration') {
          panel.style.display = 'block';
          const durations = [
            { label: '6 hours', value: 6 },
            { label: '12 hours', value: 12 },
            { label: '24 hours', value: 24 },
            { label: '48 hours', value: 48 },
            { label: '7 days', value: 168 },
            { label: 'Permanent', value: 0 },
          ];
          panel.innerHTML = `
            <div style="padding:12px;">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Story Duration</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;">
                ${durations.map(d => `<button class="story-duration-btn${d.value === storyDuration ? ' active' : ''}" data-dur="${d.value}" style="padding:8px 14px;border-radius:8px;border:2px solid ${d.value === storyDuration ? 'var(--btn-primary-bg)' : 'transparent'};background:var(--bg-secondary);color:var(--text-primary);font-size:12px;cursor:pointer;">${d.label}</button>`).join('')}
              </div>
            </div>`;
          panel.querySelectorAll('.story-duration-btn').forEach(db => {
            db.addEventListener('click', () => {
              storyDuration = parseInt(db.dataset.dur);
              panel.querySelectorAll('.story-duration-btn').forEach(x => { x.classList.remove('active'); x.style.borderColor = 'transparent'; });
              db.classList.add('active');
              db.style.borderColor = 'var(--btn-primary-bg)';
            });
          });
        }
      });
    });

    // Publish
    publishBtn.addEventListener('click', async () => {
      if (!baseImage) return;
      publishBtn.disabled = true;
      redrawCanvas();
      const finalImage = canvas.toDataURL('image/jpeg', 0.8);
      const textData = textOverlays.map(t => ({ text: t.text, x: t.x, y: t.y, styleIdx: t.styleIdx, size: t.size }));
      try {
        await node.createStory({ image: finalImage, text: textData.length > 0 ? textData[0].text : '', textStyle: { overlays: textData, stickers: stickerOverlays, filter: currentFilter }, duration: storyDuration });
        showToast('Story published!', 'success');
        overlay.remove();
        renderFeed();
      } catch (err) { showToast(err.message, 'error'); publishBtn.disabled = false; }
    });

    // Cleanup global refs on close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        delete window._seRemoveText;
        delete window._seRemoveSticker;
        delete window._seAddSticker;
        overlay.remove();
      }
    });
  },

  hideStory(address, storyId) {
    const stories = node.blockchain.state.stories.get(address);
    if (stories) {
      const s = stories.find(s => s.id === storyId);
      if (s) { s.hidden = true; showToast('Story hidden', 'info'); renderFeed(); }
    }
  },

  viewStory(address) {
    const activeStories = node.getActiveStories();
    const userStory = activeStories.find(s => s.address === address);
    if (!userStory || userStory.stories.length === 0) return;

    let currentIdx = 0;
    const stories = userStory.stories;
    const profile = userStory.profile || {};
    const sName = profile.name || address.slice(0, 10);

    const overlay = document.createElement('div');
    overlay.className = 'story-viewer-overlay';

    function renderCurrentStory() {
      const s = stories[currentIdx];
      const timeAgo = formatTimeAgo(s.timestamp);
      const sAvatar = profile.avatar
        ? `<img src="${profile.avatar}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;">`
        : `<div style="width:32px;height:32px;border-radius:50%;background:#333;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;color:#FFF;">${sName[0]?.toUpperCase() || '?'}</div>`;

      overlay.innerHTML = `
        <div class="story-viewer">
          <div class="story-progress-bar">
            ${stories.map((_, i) => `<div class="story-progress-segment${i < currentIdx ? ' story-progress-done' : (i === currentIdx ? ' story-progress-active' : '')}"></div>`).join('')}
          </div>
          <div class="story-viewer-header">
            <div style="display:flex;align-items:center;gap:10px;">
              ${sAvatar}
              <div>
                <div style="font-size:13px;font-weight:600;color:#FFF;">${escapeHtml(sName)}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.6);">${timeAgo}</div>
              </div>
            </div>
            <button style="background:none;border:none;color:#FFF;font-size:24px;cursor:pointer;padding:4px;" onclick="this.closest('.story-viewer-overlay').remove()"><i class="icon-x"></i></button>
          </div>
          <img src="${s.image}" class="story-viewer-image">
          ${s.text ? `<div class="story-viewer-text">${escapeHtml(s.text)}</div>` : ''}
          <div class="story-nav-left" onclick="event.stopPropagation()"></div>
          <div class="story-nav-right" onclick="event.stopPropagation()"></div>
        </div>
      `;

      // Navigation
      overlay.querySelector('.story-nav-left').addEventListener('click', () => {
        if (currentIdx > 0) { currentIdx--; renderCurrentStory(); }
      });
      overlay.querySelector('.story-nav-right').addEventListener('click', () => {
        if (currentIdx < stories.length - 1) { currentIdx++; renderCurrentStory(); }
        else { overlay.remove(); }
      });

      // Auto-advance after 5s
      clearTimeout(overlay._timer);
      overlay._timer = setTimeout(() => {
        if (currentIdx < stories.length - 1) { currentIdx++; renderCurrentStory(); }
        else { overlay.remove(); }
      }, 5000);
    }

    renderCurrentStory();
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { clearTimeout(overlay._timer); overlay.remove(); }
    });
  },

  // Expose toast/confirm for inline onclick handlers
  _toast: showToast,
  _confirm: showConfirm,
};

// ─── Update static HTML labels with i18n ──────────────────

function updateStaticLabels() {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const setText = (sel, key) => { const e = $(sel); if (e) e.textContent = t(key); };
  const setPlaceholder = (sel, key) => { const e = $(sel); if (e) e.placeholder = t(key); };
  const setHtml = (sel, html) => { const e = $(sel); if (e) e.innerHTML = html; };

  // ─── Landing page ─────────────────────────────────
  setText('#page-landing .landing-hero .overline', 'landing_overline');
  setText('#page-landing .landing-hero h1', 'landing_title');
  setText('#page-landing .landing-hero .subtitle-italic', 'landing_subtitle');
  setText('#page-landing .landing-hero p', 'landing_desc');
  setText('#page-landing .landing-hero .btn-landing', 'landing_cta');
  // Stats
  const stats = $$('#page-landing .landing-stat .lbl');
  if (stats.length >= 4) {
    stats[0].textContent = t('landing_arch');
    stats[1].textContent = t('landing_client');
    stats[2].textContent = t('landing_servers');
    stats[3].textContent = t('landing_crypto');
  }
  // Feature cards
  const sections = $$('#page-landing .landing-section');
  if (sections[0]) {
    setText('#page-landing .landing-section:first-of-type .section-overline', 'landing_arch');
    setText('#page-landing .landing-section:first-of-type h2', 'landing_how');
    const cards = sections[0].querySelectorAll('.feature-card');
    if (cards[0]) { cards[0].querySelector('h3').textContent = t('landing_blockchain_title'); cards[0].querySelector('p').textContent = t('landing_blockchain_desc'); }
    if (cards[1]) { cards[1].querySelector('h3').textContent = t('landing_ipfs_title'); cards[1].querySelector('p').textContent = t('landing_ipfs_desc'); }
    if (cards[2]) { cards[2].querySelector('h3').textContent = t('landing_webrtc_title'); cards[2].querySelector('p').textContent = t('landing_webrtc_desc'); }
  }
  if (sections[1]) {
    sections[1].querySelector('.section-overline').textContent = t('landing_started');
    sections[1].querySelector('h2').innerHTML = t('landing_steps_title').replace('\n', '<br>');
    const steps = sections[1].querySelectorAll('.step');
    if (steps[0]) { steps[0].querySelector('h3').textContent = t('landing_step1_title'); steps[0].querySelector('p').textContent = t('landing_step1_desc'); }
    if (steps[1]) { steps[1].querySelector('h3').textContent = t('landing_step2_title'); steps[1].querySelector('p').textContent = t('landing_step2_desc'); }
    if (steps[2]) { steps[2].querySelector('h3').textContent = t('landing_step3_title'); steps[2].querySelector('p').textContent = t('landing_step3_desc'); }
  }
  setText('#page-landing .landing-cta h2', 'landing_every_tab');
  setText('#page-landing .landing-cta p', 'landing_no_backend');
  setText('#page-landing .landing-cta .btn-landing', 'landing_launch');
  setText('#page-landing .landing-footer', 'landing_footer');
  // Nav buttons
  const loginBtn = $('#page-landing .landing-nav-right .btn-outline');
  if (loginBtn) loginBtn.textContent = t('log_in');
  const createBtn = $('#page-landing .landing-nav-right .btn:not(.btn-outline)');
  if (createBtn) createBtn.textContent = t('create_wallet');

  // ─── Login page ───────────────────────────────────
  setText('#page-login .auth-right h2', 'login_title');
  setText('#page-login .auth-right .subtitle', 'login_subtitle');
  const loginOpenBtn = $('#btn-login-existing');
  if (loginOpenBtn) loginOpenBtn.textContent = t('login_open');
  setText('#page-login .or-divider', 'login_or');
  const createNewBtn = $('#page-login .auth-right .btn-outline');
  if (createNewBtn) createNewBtn.textContent = t('login_create');
  const loginPrivacy = $('#page-login .auth-right .text-xs.text-muted:last-child');
  if (loginPrivacy) loginPrivacy.textContent = t('login_private_key');
  // Left side
  const loginLeftH1 = $('#page-login .auth-left h1');
  if (loginLeftH1) loginLeftH1.innerHTML = `${t('landing_title').replace('.', '.<br>')}`;

  // ─── Signup page ──────────────────────────────────
  setText('#page-signup .auth-right h2', 'signup_title');
  setText('#page-signup .auth-right .subtitle', 'signup_subtitle');
  const signupLabel = $('#page-signup .auth-right .form-group label');
  if (signupLabel) signupLabel.textContent = t('signup_name');
  setPlaceholder('#signup-name', 'signup_name_placeholder');
  const signupBtn = $('#btn-create-wallet');
  if (signupBtn) signupBtn.textContent = t('signup_btn');
  const signupLeftH1 = $('#page-signup .auth-left h1');
  if (signupLeftH1) signupLeftH1.innerHTML = t('create_identity').replace(/(.+)\s(.+)$/, '$1<br>$2');

  // ─── Wallet Setup page ────────────────────────────
  const setupLeftH1 = $('#page-wallet-setup .setup-left h1');
  if (setupLeftH1) setupLeftH1.innerHTML = t('setup_title').replace(/(.+)\s(.+)$/, '$1<br>$2');
  const setupDesc = $('#page-wallet-setup .setup-left > p');
  if (setupDesc) setupDesc.textContent = t('setup_desc');
  const setupSteps = $$('#page-wallet-setup .setup-step');
  if (setupSteps[0]) { setupSteps[0].querySelector('h4').textContent = t('setup_step1'); setupSteps[0].querySelector('p').textContent = t('setup_step1_desc'); }
  if (setupSteps[1]) { setupSteps[1].querySelector('h4').textContent = t('setup_step2'); setupSteps[1].querySelector('p').textContent = t('setup_step2_desc'); }
  if (setupSteps[2]) { setupSteps[2].querySelector('h4').textContent = t('setup_step3'); setupSteps[2].querySelector('p').textContent = t('setup_step3_desc'); }
  setText('#page-wallet-setup .card h3', 'setup_your_wallet');
  const setupLabels = $$('#page-wallet-setup .form-group label');
  if (setupLabels[0]) setupLabels[0].textContent = t('setup_address');
  if (setupLabels[1]) setupLabels[1].textContent = t('setup_seed');
  if (setupLabels[2]) setupLabels[2].textContent = t('setup_balance');
  const setupEnterBtn = $('#page-wallet-setup .btn-primary');
  if (setupEnterBtn) setupEnterBtn.textContent = t('setup_enter');

  // ─── Compose modal ────────────────────────────────
  setText('#compose-modal .modal-header h3', 'compose_title');
  setPlaceholder('#compose-text', 'compose_placeholder');
  const composeBtn = $('#compose-modal .btn-primary');
  if (composeBtn) composeBtn.textContent = t('compose_submit');
  setText('#compose-modal .text-xs', 'compose_signed');

  // ─── Transfer modal ───────────────────────────────
  setText('#transfer-modal .modal-header h3', 'transfer_title');
  const transferLabels = $$('#transfer-modal .form-group label');
  if (transferLabels[0]) transferLabels[0].textContent = t('transfer_recipient');
  if (transferLabels[1]) transferLabels[1].textContent = t('transfer_amount');
  setPlaceholder('#transfer-to', '0x...');
  const transferBtn = $('#transfer-modal .btn-primary');
  if (transferBtn) transferBtn.textContent = t('transfer_submit');
  setText('#transfer-modal .text-xs', 'transfer_note');

  // ─── Edit profile ─────────────────────────────────
  setText('#page-edit-profile .page-header h2', 'edit_profile_title');
  const editLabels = $$('#page-edit-profile .form-group label');
  if (editLabels[0]) editLabels[0].textContent = t('edit_name');
  if (editLabels[1]) editLabels[1].textContent = t('edit_handle');
  if (editLabels[2]) editLabels[2].textContent = t('edit_bio');
  const editBtns = $$('#page-edit-profile .flex.gap-12 button');
  if (editBtns[0]) editBtns[0].textContent = t('edit_save');
  if (editBtns[1]) editBtns[1].textContent = t('edit_cancel');
  setText('#page-edit-profile .text-xs.text-muted', 'edit_note');

  // ─── Settings nav ─────────────────────────────────
  const settingsMap = { account: 'settings_account', appearance: 'settings_appearance', node: 'settings_node', security: 'settings_security', about: 'settings_about' };
  for (const [key, tkey] of Object.entries(settingsMap)) {
    const link = $(`.settings-nav a[data-settings="${key}"]`);
    if (link) {
      const icon = link.querySelector('i');
      link.textContent = '';
      if (icon) link.appendChild(icon);
      link.append(' ' + t(tkey));
    }
  }
  setText('.settings-nav h3', 'settings_title');

  // ─── Settings Account ─────────────────────────────
  setText('#settings-account h2', 'settings_account');
  const accountRows = $$('#settings-account .setting-row');
  if (accountRows[0]) { accountRows[0].querySelector('h4').textContent = t('settings_balance'); accountRows[0].querySelector('p').textContent = t('settings_balance_desc'); }
  if (accountRows[1]) { accountRows[1].querySelector('h4').textContent = t('settings_staked'); accountRows[1].querySelector('p').textContent = t('settings_staked_desc'); }
  if (accountRows[2]) { accountRows[2].querySelector('h4').textContent = t('settings_export_seed'); accountRows[2].querySelector('p').textContent = t('settings_export_desc'); }
  const accountLabel = $('#settings-account .text-sm.text-muted.mb-8');
  if (accountLabel) accountLabel.textContent = t('settings_wallet_addr');
  const exportBtn = $('#settings-account .btn-sm');
  if (exportBtn) exportBtn.textContent = t('settings_export_btn');

  // ─── Settings Appearance ──────────────────────────
  setText('#settings-appearance-title', 'settings_appearance');
  setText('#settings-theme-h4', 'settings_theme');
  setText('#settings-theme-p', 'settings_theme_desc');
  setText('#settings-lang-h4', 'settings_lang_title');
  setText('#settings-lang-p', 'settings_lang_desc');
  const themeLabel = $('.theme-label');
  if (themeLabel) themeLabel.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? t('settings_theme_dark') : t('settings_theme_light');

  // ─── Settings Node ────────────────────────────────
  setText('#settings-node h2', 'settings_node_title');
  const nodeRows = $$('#settings-node .setting-row');
  const nodeKeys = [
    ['settings_block_prod', 'settings_block_prod_desc'],
    ['settings_consensus', 'settings_consensus_desc'],
    ['settings_cas', 'settings_cas_desc'],
    ['settings_ipfs', 'settings_ipfs_desc'],
    ['settings_p2p', 'settings_p2p_desc'],
    ['settings_signaling', 'settings_signaling_desc'],
  ];
  nodeRows.forEach((row, i) => {
    if (nodeKeys[i]) {
      row.querySelector('h4').textContent = t(nodeKeys[i][0]);
      row.querySelector('p').textContent = t(nodeKeys[i][1]);
    }
  });

  // ─── Settings Security ────────────────────────────
  setText('#settings-security h2', 'settings_security');
  const secRows = $$('#settings-security .setting-row');
  const secKeys = [
    ['settings_key_algo', 'settings_key_algo_desc'],
    ['settings_hashing', 'settings_hashing_desc'],
    ['settings_key_storage', 'settings_key_storage_desc'],
    ['settings_reset', 'settings_reset_desc'],
  ];
  secRows.forEach((row, i) => {
    if (secKeys[i]) {
      row.querySelector('h4').textContent = t(secKeys[i][0]);
      row.querySelector('p').textContent = t(secKeys[i][1]);
    }
  });

  // ─── Settings About ───────────────────────────────
  setText('#settings-about h2', 'settings_about_title');
  const aboutNote = $('#settings-about .mt-24');
  if (aboutNote) aboutNote.textContent = t('settings_about_note');

  // ─── Peers page ───────────────────────────────────
  setText('#page-peers .page-header h2', 'peers_title');
  const peerCards = $$('#page-peers .card');
  if (peerCards[0]) {
    peerCards[0].querySelector('h4').textContent = t('peers_connect');
    const peerDesc = peerCards[0].querySelector('.text-sm.text-muted.mb-16');
    if (peerDesc) peerDesc.textContent = t('peers_desc');
    const peerLabel = peerCards[0].querySelector('.form-group label');
    if (peerLabel) peerLabel.textContent = t('peers_step1');
    setPlaceholder('#peer-offer', 'peers_offer_placeholder');
    const peerBtns = peerCards[0].querySelectorAll('.btn');
    if (peerBtns[0]) peerBtns[0].textContent = t('peers_create');
    if (peerBtns[1]) peerBtns[1].textContent = t('peers_complete');
  }
  if (peerCards[1]) {
    peerCards[1].querySelector('h4').textContent = t('peers_status');
  }
  if (peerCards[2]) {
    peerCards[2].querySelector('h4').textContent = t('peers_how');
  }

  // ─── Page headers ─────────────────────────────────
  const pageHeaders = {
    'page-home': 'feed_title',
    'page-explore': 'explore_title',
    'page-notifications': 'notif_title',
    'page-bookmarks': 'bookmarks_title',
  };
  for (const [pageId, key] of Object.entries(pageHeaders)) {
    const h2 = $(`#${pageId} .page-header h2`);
    if (h2) h2.textContent = t(key);
  }
}

// ─── Initialization ───────────────────────────────────────

export async function initUI() {
  node = await getNode();
  window.__diademNode = node; // expose for console debugging

  // Set HTML lang from saved preference
  document.documentElement.lang = getLang() === 'uk' ? 'uk' : 'en';

  // Відновити останню сторінку після перезавантаження
  const hashPage = window.location.hash.slice(1);
  let savedPage = '';
  try { savedPage = sessionStorage.getItem('diadem_last_page') || ''; } catch {}
  const restorePage = hashPage || savedPage;

  const restoreBasePage = restorePage.includes('/') ? restorePage.slice(0, restorePage.indexOf('/')) : restorePage;

  if (!node.wallet) {
    // Без гаманця — тільки standalone сторінки
    if (restorePage && standalonePages.includes(restoreBasePage)) {
      navigate(restorePage);
    } else {
      navigate('landing');
    }
  } else if (restorePage && document.getElementById('page-' + restoreBasePage)) {
    // Є гаманець і збережена сторінка існує — відновити
    navigate(restorePage);
  } else {
    navigate('home');
  }

  // Update sidebar labels with current language
  updateSidebarLabels();
  updateStaticLabels();

  node.on('stateChange', () => {
    const hash = window.location.hash.slice(1);
    const basePage = hash.includes('/') ? hash.slice(0, hash.indexOf('/')) : hash;
    refreshPageData(basePage);
  });

  // DM typing indicator from peers
  if (node.protocol) {
    node.protocol.onTyping = (fromAddr, toAddr) => {
      if (toAddr !== node.wallet?.address) return;
      if (_activeDMAddress !== fromAddr) return;
      _showTypingIndicator(fromAddr);
    };
  }

  // Sidebar nav
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); navigate(link.dataset.page); });
  });

  // Mobile bottom nav
  document.querySelectorAll('.mobile-bottom-nav a[data-page]').forEach(link => {
    link.addEventListener('click', (e) => { e.preventDefault(); navigate(link.dataset.page); });
  });

  // Settings sub-nav
  document.querySelectorAll('.settings-nav a[data-settings]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.settings-page').forEach(p => p.classList.add('hidden'));
      document.getElementById('settings-' + link.dataset.settings)?.classList.remove('hidden');
      document.querySelectorAll('.settings-nav a').forEach(l => l.classList.remove('active'));
      link.classList.add('active');
    });
  });

  // Compose modal
  document.getElementById('btn-compose')?.addEventListener('click', () => document.getElementById('compose-modal')?.classList.add('active'));
  document.getElementById('close-compose')?.addEventListener('click', () => document.getElementById('compose-modal')?.classList.remove('active'));

  // Hash navigation
  window.addEventListener('popstate', () => {
    const hash = window.location.hash.slice(1) || 'landing';
    showPage(hash);
  });

  // Restore saved theme
  const savedTheme = localStorage.getItem('diadem_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Theme toggle
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('diadem_theme', next);
      const label = document.querySelector('.theme-label');
      if (label) label.textContent = next === 'dark' ? t('settings_theme_dark') : t('settings_theme_light');
    });
  });

  // Tab click delegation
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab?.closest('.tabs')) {
      tab.closest('.tabs').querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    }
  });

  console.log('[UI] DiaDem UI initialized');
}
