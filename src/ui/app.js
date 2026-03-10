/**
 * DiaDem UI Controller
 * Connects the blockchain node to the HTML frontend.
 * All data displayed comes from the blockchain state.
 */

import { getNode } from '../diadem.js';
import { t, getLang, setLang, getLanguages } from '../i18n.js';

let node = null;

// ─── Navigation ───────────────────────────────────────────

const standalonePages = ['landing', 'login', 'signup', 'wallet-setup'];

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const appShell = document.getElementById('app-shell');

  if (standalonePages.includes(pageId)) {
    appShell.style.display = 'none';
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.remove('hidden');
  } else {
    appShell.style.display = 'flex';
    const page = document.getElementById('page-' + pageId);
    if (page) page.classList.remove('hidden');
    document.querySelectorAll('.sidebar-nav a').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`.sidebar-nav a[data-page="${pageId}"]`);
    if (link) link.classList.add('active');
  }
  refreshPageData(pageId);
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
    settings: 'nav_settings', peers: 'nav_peers',
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
    case 'wallet': renderWallet(); break;
    case 'notifications': renderNotifications(); break;
    case 'staking': renderStaking(); break;
    case 'governance': renderGovernance(); break;
    case 'transactions': renderTransactions(); break;
    case 'messages': renderMessages(); break;
    case 'bookmarks': renderBookmarks(); break;
    case 'search': renderSearch(); break;
    case 'settings': renderSettingsData(); break;
  }
  updateSidebarInfo();
}

function updateSidebarInfo() {
  if (!node?.wallet) return;
  const info = node.getNodeInfo();
  const el = document.getElementById('node-status');
  if (el) {
    el.innerHTML = `
      <div class="text-xs text-muted">Block #${info.chain.height}</div>
      <div class="text-xs text-muted">${info.network.peers} peers · ${info.cas.objects} obj</div>
      <div class="text-xs" style="font-family:monospace;color:var(--text-muted);">${node.wallet.address.slice(0, 8)}...${node.wallet.address.slice(-4)}</div>
    `;
  }
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

// ─── Feed ──────────────────────────────────────────────────

function renderFeed() {
  const feed = node.getFeed(50);
  const container = document.getElementById('feed-posts');
  if (!container) return;
  const header = container.closest('.content-area')?.querySelector('.page-header h2');
  if (header) header.textContent = t('feed_title');

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

function renderPost(post, expanded = false) {
  const profile = post.profile || {};
  const name = profile.name || post.author.slice(0, 10) + '...';
  const handle = profile.handle || post.author.slice(0, 12);
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
  const timeAgo = formatTimeAgo(post.timestamp);
  const postId = post.id || post.hash;
  const liked = post.liked ? ' liked' : '';
  const bookmarks = JSON.parse(localStorage.getItem('diadem_bookmarks') || '[]');
  const isBookmarked = bookmarks.includes(postId);

  return `
    <div class="post${expanded ? ' single-post' : ''}" data-post-id="${postId}">
      <div class="post-header">
        <div class="avatar${expanded ? ' avatar-lg' : ''}" style="background:var(--avatar-fill);"><span class="avatar-initials">${initials}</span></div>
        <div style="flex:1;">
          <span class="post-author" style="cursor:pointer;" onclick="window.diademUI.viewUser('${post.author}')">${escapeHtml(name)}</span>
          <div class="post-handle">${escapeHtml(handle)} · ${timeAgo}</div>
        </div>
      </div>
      <div class="post-content" style="${expanded ? 'font-size:16px;line-height:1.6;' : ''}">${escapeHtml(post.content)}</div>
      ${post.media ? `<div class="post-image"><img src="${escapeHtml(post.media)}" alt=""></div>` : ''}
      <div class="post-actions">
        <button class="post-action${liked}" onclick="window.diademUI.likePost('${postId}')">
          <i class="icon-heart"></i> ${post.likesCount || 0}
        </button>
        <button class="post-action" onclick="window.diademUI.viewPost('${postId}')"><i class="icon-message-circle"></i> 0</button>
        <button class="post-action"><i class="icon-share"></i> ${t('post_share')}</button>
        <button class="post-action${isBookmarked ? ' liked' : ''}" onclick="window.diademUI.bookmarkPost('${postId}')"><i class="icon-bookmark"></i></button>
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

  const el = isOwnProfile ? document.getElementById('profile-data') : document.getElementById('other-profile-data');
  if (!el) return;

  const name = profile.name || (isOwnProfile ? 'Anonymous' : addr.slice(0, 10) + '...');
  const handle = profile.handle || addr.slice(0, 12);
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const shortAddr = addr.slice(0, 6) + '...' + addr.slice(-4);
  const following = node.blockchain.state.following.get(node.wallet?.address) || new Set();
  const isFollowing = following.has(addr);

  el.innerHTML = `
    <div class="profile-cover"></div>
    <div style="padding:0 40px 24px 40px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:-48px;">
        <div class="avatar avatar-xl" style="border:4px solid var(--bg);"><span class="avatar-initials" style="font-size:28px;">${initials}</span></div>
        ${isOwnProfile
          ? `<button class="btn btn-outline" style="border-radius:18px;height:36px;" onclick="window.diademUI.navigate('edit-profile')">${t('profile_edit')}</button>`
          : `<button class="btn ${isFollowing ? 'btn-outline' : 'btn-primary'}" style="border-radius:18px;height:36px;padding:0 24px;" onclick="window.diademUI.followUser('${addr}')">${isFollowing ? t('profile_following') : t('profile_follow')}</button>`
        }
      </div>
      <div style="margin-top:12px;">
        <div class="profile-name">${escapeHtml(name)}</div>
        <div class="profile-handle">${escapeHtml(handle)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;">
          <i class="icon-wallet" style="font-size:14px;color:var(--text-muted);"></i>
          <span style="font-family:monospace;font-size:12px;color:var(--text-muted);">${shortAddr}</span>
          <span style="background:var(--bg-input);border-radius:10px;padding:2px 8px;font-size:11px;font-weight:600;color:var(--text-body);">${balance.toLocaleString()} DDM</span>
        </div>
        <div class="profile-bio" style="margin-top:12px;">${escapeHtml(profile.bio || '')}</div>
        <div class="profile-stats" style="margin-top:12px;">
          <div><strong>${stats.following}</strong> <span>${t('profile_following')}</span></div>
          <div><strong>${stats.followers}</strong> <span>${t('profile_followers')}</span></div>
        </div>
      </div>
    </div>
    <div style="height:1px;background:var(--divider);"></div>
    <div class="tabs" style="padding:0 40px;">
      <button class="tab active">${t('profile_posts')}</button>
      <button class="tab">${t('profile_replies')}</button>
      <button class="tab">${t('profile_media')}</button>
      <button class="tab">${t('profile_likes')}</button>
      <button class="tab">${t('profile_onchain')}</button>
    </div>
    <div style="padding:0 40px;">
      ${posts.length > 0 ? posts.map(p => renderPost(p)).join('') :
        `<div class="text-muted" style="text-align:center;padding:40px;">${t('profile_no_posts')}</div>`}
    </div>
  `;
}

// ─── Single Post View ─────────────────────────────────────

function renderSinglePost(postId) {
  const el = document.getElementById('single-post-data');
  if (!el) return;

  const post = node.blockchain.state.posts.get(postId);
  if (!post) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('search_empty')}</div>`;
    return;
  }

  const profile = node.getProfile(post.author) || {};
  const name = profile.name || post.author.slice(0, 10) + '...';
  const handle = profile.handle || post.author.slice(0, 12);
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
  const timeAgo = formatTimeAgo(post.timestamp);
  const likesCount = (node.blockchain.state.likes.get(postId) || new Set()).size;
  const myProfile = node.getProfile() || {};
  const myInitials = (myProfile.name || 'A').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  // Find replies
  const replies = [];
  for (const [pid, p] of node.blockchain.state.posts) {
    if (p.content && p.content.startsWith(`@reply:${postId} `)) {
      replies.push({ ...p, id: pid, profile: node.getProfile(p.author), likesCount: (node.blockchain.state.likes.get(pid) || new Set()).size });
    }
  }
  replies.sort((a, b) => a.timestamp - b.timestamp);

  el.innerHTML = `
    <div class="page-header" style="gap:12px;">
      <button class="post-action" onclick="window.diademUI.navigate('home')" style="padding:4px;"><i class="icon-arrow-left" style="font-size:20px;color:var(--text-primary);"></i></button>
      <h2>${t('post_title')}</h2>
    </div>
    <div style="height:1px;background:var(--divider);"></div>
    <div style="padding:20px 0;" class="single-post">
      <div class="post-header" style="gap:12px;margin-bottom:16px;">
        <div class="avatar" style="width:48px;height:48px;"><span class="avatar-initials">${initials}</span></div>
        <div style="flex:1;">
          <span class="post-author" style="font-size:16px;cursor:pointer;" onclick="window.diademUI.viewUser('${post.author}')">${escapeHtml(name)}</span>
          <div class="post-handle">${escapeHtml(handle)} · ${timeAgo}</div>
        </div>
      </div>
      <div class="post-content" style="font-size:16px;line-height:1.6;margin-bottom:16px;">${escapeHtml(post.content)}</div>
      <div class="post-actions" style="padding:8px 0;gap:24px;">
        <button class="post-action" onclick="window.diademUI.likePost('${postId}')"><i class="icon-heart"></i> ${likesCount}</button>
        <button class="post-action"><i class="icon-message-circle"></i> ${replies.length}</button>
        <button class="post-action"><i class="icon-share"></i></button>
      </div>
    </div>
    <div style="height:1px;background:var(--divider);"></div>
    <div style="display:flex;gap:12px;align-items:center;padding:16px 0;border-bottom:1px solid var(--divider);">
      <div class="avatar" style="width:36px;height:36px;"><span class="avatar-initials" style="font-size:12px;">${myInitials}</span></div>
      <div style="flex:1;background:var(--bg-input);border-radius:20px;height:40px;display:flex;align-items:center;padding:0 16px;">
        <input type="text" id="reply-input" placeholder="${t('post_reply_placeholder')}" style="background:none;border:none;outline:none;width:100%;font-size:14px;color:var(--text-primary);">
      </div>
      <button class="btn btn-primary" style="border-radius:17px;height:34px;padding:0 16px;font-size:13px;" onclick="window.diademUI.postReply('${postId}')">${t('post_reply_btn')}</button>
    </div>
    <div style="padding:12px 0 8px;">
      <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${t('post_replies')} (${replies.length})</span>
    </div>
    ${replies.length === 0
      ? `<div class="text-muted text-sm" style="padding:20px 0;text-align:center;">${t('post_no_replies')}</div>`
      : replies.map(r => {
          const rp = r.profile || {};
          const rn = rp.name || r.author.slice(0, 10);
          const rh = rp.handle || r.author.slice(0, 12);
          const ri = rn.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
          const content = r.content.replace(`@reply:${postId} `, '');
          return `
            <div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--divider);">
              <div class="avatar" style="width:36px;height:36px;background:var(--avatar-fill-2);"><span class="avatar-initials" style="font-size:12px;">${ri}</span></div>
              <div style="flex:1;">
                <div style="display:flex;gap:8px;align-items:center;">
                  <span style="font-size:14px;font-weight:600;color:var(--text-primary);">${escapeHtml(rn)}</span>
                  <span style="font-size:12px;color:var(--text-muted);">${escapeHtml(rh)} · ${formatTimeAgo(r.timestamp)}</span>
                </div>
                <div style="font-size:14px;color:var(--text-body);line-height:1.5;margin-top:4px;">${escapeHtml(content)}</div>
                <div style="display:flex;gap:16px;padding-top:4px;">
                  <button class="post-action" onclick="window.diademUI.likePost('${r.id}')"><i class="icon-heart"></i> ${r.likesCount}</button>
                </div>
              </div>
            </div>`;
        }).join('')
    }
  `;
}

// ─── Wallet ───────────────────────────────────────────────

function renderWallet() {
  const balance = node.getBalance();
  const stake = node.getStake();
  const info = node.getNodeInfo();
  const el = document.getElementById('wallet-data');
  if (!el) return;

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
      <h2 style="color:#F0F0F0;">${t('wallet_title')}</h2>
      <div class="flex gap-8">
        <button class="btn btn-sm" style="background:#22C55E;color:#FFF;border:none;" onclick="window.diademUI.showTransferModal()">${t('wallet_send')}</button>
        <button class="btn btn-sm" style="background:#2A2A2A;color:#F0F0F0;border:1px solid #444;" onclick="navigator.clipboard.writeText('${node.wallet.address}').then(()=>alert('${t('copied')}'))">${t('wallet_copy')}</button>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:32px;">
      <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:20px;">
        <div style="font-size:12px;color:#707070;margin-bottom:8px;">${t('wallet_total')}</div>
        <div style="font-size:28px;font-weight:700;color:#F0F0F0;">${balance.toLocaleString()} DDM</div>
      </div>
      <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:20px;">
        <div style="font-size:12px;color:#707070;margin-bottom:8px;">${t('wallet_staked')}</div>
        <div style="font-size:28px;font-weight:700;color:#F0F0F0;">${stake.amount.toLocaleString()} DDM</div>
        <div style="font-size:13px;color:#707070;margin-top:4px;">APY 14.2%</div>
      </div>
      <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:20px;">
        <div style="font-size:12px;color:#707070;margin-bottom:8px;">${t('wallet_network')}</div>
        <div style="font-size:28px;font-weight:700;color:#F0F0F0;">Block #${info.chain.height}</div>
        <div style="font-size:13px;color:#707070;margin-top:4px;">${info.network.peers} ${t('wallet_peers')}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:24px;">
        <h4 style="color:#F0F0F0;margin-bottom:16px;">${t('wallet_cas')}</h4>
        <div style="color:#A0A0A0;font-size:14px;">
          <div class="flex justify-between mb-8"><span>${t('wallet_objects')}:</span><span style="color:#F0F0F0;">${info.cas.objects}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_size')}:</span><span style="color:#F0F0F0;">${info.cas.size}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_pinned')}:</span><span style="color:#F0F0F0;">${info.cas.pins}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_ipfs_mapped')}:</span><span style="color:#F0F0F0;">${info.ipfs?.mappedObjects || 0}</span></div>
          <div class="flex justify-between"><span>${t('wallet_accounts')}:</span><span style="color:#F0F0F0;">${info.state.totalAccounts}</span></div>
        </div>
      </div>
      <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:24px;">
        <h4 style="color:#F0F0F0;margin-bottom:16px;">${t('wallet_blockchain')}</h4>
        <div style="color:#A0A0A0;font-size:14px;">
          <div class="flex justify-between mb-8"><span>${t('wallet_height')}:</span><span style="color:#F0F0F0;">#${info.chain.height}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_blocks')}:</span><span style="color:#F0F0F0;">${info.chain.blocks}</span></div>
          <div class="flex justify-between mb-8"><span>${t('wallet_pending')}:</span><span style="color:#F0F0F0;">${info.chain.pendingTxs}</span></div>
          <div class="flex justify-between"><span>${t('wallet_total_staked')}:</span><span style="color:#F0F0F0;">${info.state.totalStaked.toLocaleString()} DDM</span></div>
        </div>
      </div>
    </div>
    <div style="background:#1A1A1A;border:1px solid #2A2A2A;border-radius:12px;padding:24px;margin-top:24px;">
      <h4 style="color:#F0F0F0;margin-bottom:16px;">${t('wallet_quick')}</h4>
      <div class="flex gap-12">
        <button class="btn" style="background:#8B5CF6;color:#FFF;border:none;" onclick="window.diademUI.navigate('staking')">${t('wallet_stake_btn')}</button>
        <button class="btn" style="background:#2A2A2A;color:#F0F0F0;border:1px solid #444;" onclick="window.diademUI.navigate('transactions')">${t('wallet_view_tx')}</button>
        <button class="btn" style="background:#2A2A2A;color:#F0F0F0;border:1px solid #444;" onclick="window.diademUI.navigate('governance')">${t('governance_title')}</button>
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
  const txs = node.getTransactions(20);
  if (txs.length === 0) {
    el.innerHTML = `<div class="text-muted" style="text-align:center;padding:40px;">${t('notif_empty')}</div>`;
    return;
  }
  el.innerHTML = `<div class="notif-section-title">${t('notif_recent')}</div>` +
    txs.map(tx => {
      const txObj = typeof tx === 'string' ? { type: 'unknown' } : tx;
      const type = txObj.type || 'unknown';
      let icon = 'icon-bell', text = t('notif_activity');
      if (type === 'like') { icon = 'icon-heart'; text = t('notif_like'); }
      else if (type === 'follow') { icon = 'icon-user-plus'; text = t('notif_follow'); }
      else if (type === 'transfer') { icon = 'icon-arrow-left-right'; text = `${t('notif_transfer')} ${txObj.amount || '?'} DDM`; }
      else if (type === 'post') { icon = 'icon-edit'; text = t('notif_post'); }
      else if (type === 'stake') { icon = 'icon-landmark'; text = t('notif_stake'); }
      return `<div class="notif-item"><div class="notif-icon"><i class="${icon}"></i></div><div class="notif-text">${text}${txObj.timestamp ? `<div class="notif-time">${formatTimeAgo(txObj.timestamp)}</div>` : ''}</div></div>`;
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
    { id: 'stake', label: t('tx_staking') },
    { id: 'vote', label: t('tx_governance') },
  ];

  const filtered = filter === 'all' ? txItems : txItems.filter(tx => {
    if (filter === 'transfer') return tx.type === 'transfer' && tx.from === node.wallet.address;
    if (filter === 'received') return tx.type === 'transfer' && tx.to === node.wallet.address;
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
    case 'post': title = t('tx_post_created'); break;
    case 'like': title = t('tx_liked'); bgColor = '#FEF2F2'; iconColor = '#EF4444'; break;
    case 'follow': title = t('tx_followed'); bgColor = '#EFF6FF'; iconColor = '#3B82F6'; break;
    case 'profile_update': title = t('tx_profile_update'); break;
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

function renderMessages() {
  const el = document.getElementById('messages-data');
  if (!el) return;
  el.innerHTML = `
    <div class="messages-layout">
      <div class="messages-list">
        <div class="messages-list-header">
          <h3 style="font-size:18px;">${t('msg_title')}</h3>
          <button class="post-action"><i class="icon-edit" style="font-size:18px;"></i></button>
        </div>
        <div class="search-box" style="padding:12px 16px;">
          <i class="icon-search"></i>
          <input type="text" class="input-field" placeholder="${t('msg_search')}" style="padding-left:36px;border-radius:19px;height:38px;">
        </div>
        <div class="text-muted text-sm" style="text-align:center;padding:40px;">
          ${t('msg_empty')}<br><span style="font-size:12px;">${t('msg_connect')}</span>
        </div>
      </div>
      <div class="chat-area">
        <div class="chat-header"><div style="font-size:15px;font-weight:600;color:var(--text-primary);">${t('msg_select')}</div></div>
        <div class="chat-messages">
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);">
            <i class="icon-message-circle" style="font-size:48px;margin-bottom:16px;"></i>
            <div style="font-size:15px;">${t('msg_encrypted')}</div>
            <div style="font-size:13px;margin-top:4px;">${t('msg_via')}</div>
          </div>
        </div>
        <div class="chat-input-area">
          <input type="text" class="input-field" placeholder="${t('msg_placeholder')}" style="border-radius:20px;">
          <button class="send-btn"><i class="icon-send" style="font-size:18px;"></i></button>
        </div>
      </div>
    </div>
  `;
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

  async likePost(postId) {
    try { await node.likePost(postId); } catch (e) { console.error(e); }
  },

  async submitPost() {
    const textarea = document.getElementById('compose-text');
    if (!textarea || !textarea.value.trim()) return;
    try {
      await node.createPost(textarea.value.trim());
      textarea.value = '';
      document.getElementById('compose-modal').classList.remove('active');
      renderFeed();
    } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  async doStake() {
    const amount = parseInt(document.getElementById('stake-amount')?.value || '0');
    if (amount < 100) { alert('Minimum stake: 100 DDM'); return; }
    try { await node.stake(amount); renderStaking(); } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  async doUnstake() {
    try { await node.unstake(node.getStake().amount); renderStaking(); } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  async doTransfer() {
    const to = document.getElementById('transfer-to')?.value;
    const amount = parseInt(document.getElementById('transfer-amount')?.value || '0');
    if (!to || amount <= 0) { alert('Invalid transfer'); return; }
    try {
      await node.transfer(to, amount);
      document.getElementById('transfer-modal')?.classList.remove('active');
      renderWallet();
    } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  showTransferModal() {
    document.getElementById('transfer-modal')?.classList.add('active');
  },

  async saveProfile() {
    const name = document.getElementById('edit-name')?.value;
    const handle = document.getElementById('edit-handle')?.value;
    const bio = document.getElementById('edit-bio')?.value;
    try { await node.updateProfile({ name, handle, bio }); navigate('profile'); } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  async connectPeer() {
    const input = document.getElementById('peer-offer');
    if (!input?.value) {
      const { offerString, peerId, _pc } = await node.createOffer();
      window._pendingPC = _pc; window._pendingPeerId = peerId;
      prompt('Share this offer code:', offerString);
    } else {
      const { answerString } = await node.acceptOffer(input.value);
      prompt('Send this answer back:', answerString);
      input.value = '';
    }
  },

  async completeAnswer() {
    const answer = prompt('Paste the answer code:');
    if (answer && window._pendingPC) {
      await node.completeConnection(window._pendingPeerId, answer, window._pendingPC);
      window._pendingPC = null;
    }
  },

  viewPost(postId) {
    navigate('single-post');
    setTimeout(() => renderSinglePost(postId), 0);
  },

  viewUser(address) {
    if (address === node.wallet?.address) { navigate('profile'); }
    else { navigate('other-profile'); setTimeout(() => renderProfile(address), 0); }
  },

  async followUser(address) {
    try { await node.followUser(address); } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  bookmarkPost(postId) {
    const bookmarks = JSON.parse(localStorage.getItem('diadem_bookmarks') || '[]');
    const idx = bookmarks.indexOf(postId);
    if (idx >= 0) bookmarks.splice(idx, 1);
    else bookmarks.push(postId);
    localStorage.setItem('diadem_bookmarks', JSON.stringify(bookmarks));
    // Re-render current page
    const hash = window.location.hash.slice(1);
    refreshPageData(hash);
  },

  doSearch(query) {
    if (!query) return;
    navigate('search');
    setTimeout(() => renderSearch(query), 0);
  },

  filterTransactions(filter) {
    renderTransactions(filter);
  },

  async postReply(postId) {
    const input = document.getElementById('reply-input');
    if (!input?.value?.trim()) return;
    try {
      await node.createPost(`@reply:${postId} ${input.value.trim()}`);
      input.value = '';
      setTimeout(() => renderSinglePost(postId), 500);
    } catch (e) { alert(t('error') + ': ' + e.message); }
  },

  changeLang(lang) {
    setLang(lang);
    document.documentElement.lang = lang === 'uk' ? 'uk' : 'en';
    updateSidebarLabels();
    updateStaticLabels();
    // Re-render current page
    const hash = window.location.hash.slice(1);
    refreshPageData(hash);
  },
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

  // Set HTML lang from saved preference
  document.documentElement.lang = getLang() === 'uk' ? 'uk' : 'en';

  if (node.wallet) navigate('home');
  else navigate('landing');

  // Update sidebar labels with current language
  updateSidebarLabels();
  updateStaticLabels();

  node.on('stateChange', () => {
    const hash = window.location.hash.slice(1);
    refreshPageData(hash);
  });

  // Sidebar nav
  document.querySelectorAll('.sidebar-nav a[data-page]').forEach(link => {
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
  window.addEventListener('popstate', () => showPage(window.location.hash.slice(1) || 'landing'));

  // Theme toggle
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
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
