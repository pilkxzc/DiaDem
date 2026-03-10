/**
 * DiaDem Node
 * Full blockchain node running in the browser.
 * No servers, no databases — only blockchain + IPFS-like CAS + P2P.
 *
 * Architecture:
 * ┌─────────────────────────────────────────────┐
 * │                  DiaDem Node                 │
 * ├─────────┬──────────┬──────────┬──────────────┤
 * │ Wallet  │  Chain   │   CAS    │   Network    │
 * │ (keys)  │ (blocks) │ (data)   │   (P2P)      │
 * │ ECDSA   │  PoS     │ hash→obj │  WebRTC      │
 * │ P-256   │  DDM     │ merkle   │  BroadcastCh │
 * └─────────┴──────────┴──────────┴──────────────┘
 *
 * Data flow:
 * 1. User action → create Transaction → sign with wallet
 * 2. Transaction data → store in CAS (content-addressable)
 * 3. Transaction hash → add to mempool → broadcast to peers
 * 4. Validator collects txs → creates Block → adds to chain
 * 5. Block propagates to all peers → state updates
 */

import { generateKeyPair, sign, generateSeedPhrase, deriveKeyFromSeed, validateSeedPhrase, generateAccessKey, parseAccessKey } from './crypto/keys.js';
import { Blockchain } from './core/blockchain.js';
import { Transaction, TX_TYPES, createTransfer, createPost, createStake,
         createFollow, createLike, createProfileUpdate, createVote } from './core/transaction.js';
import { ProofOfStake } from './consensus/pos.js';
import { PeerNetwork, MSG_TYPES } from './network/peer.js';
import { Protocol } from './network/protocol.js';
import { SignalingClient } from './network/signaling.js';
import { IPFSBridge } from './network/ipfs.js';
import { ContentAddressableStorage } from './storage/cas.js';
import { KeyStore } from './storage/db.js';

export class DiaDemNode {
  constructor() {
    this.blockchain = null;
    this.wallet = null;
    this.network = null;
    this.protocol = null;
    this.consensus = null;
    this.cas = null; // Content-Addressable Storage (IPFS-like)
    this.signaling = null; // WebSocket signaling for peer discovery
    this.ipfs = null; // IPFS bridge for content-addressable network
    this.ready = false;
    this._listeners = {};
  }

  /** Initialize the full node */
  async init() {
    console.log('[DiaDem] Initializing node...');

    // 1. Content-Addressable Storage
    this.cas = new ContentAddressableStorage();

    // Load cached CAS data from previous session
    const cachedCAS = KeyStore.loadCASCache();
    if (cachedCAS) {
      this.cas.importData(cachedCAS);
      console.log('[DiaDem] CAS cache loaded:', this.cas.getStats().objects, 'objects');
    }

    // 2. Load wallet (only private keys stored locally)
    const savedWallet = KeyStore.loadWallet();
    if (savedWallet) {
      this.wallet = savedWallet;
      console.log('[DiaDem] Wallet loaded:', this.wallet.address);
    }

    // 3. Blockchain — always starts fresh from genesis, syncs from peers
    this.blockchain = new Blockchain();
    await this.blockchain.init(this.wallet?.address);

    // Try to rebuild from CAS cache
    await this._rebuildFromCAS();

    // Restore persisted state (includes immediate tx changes + saved messages)
    await this._loadState();

    // Claim faucet DDM if new wallet with 0 balance
    if (this.wallet && this.blockchain.state.getBalance(this.wallet.address) === 0) {
      await this.blockchain.claimFaucet(this.wallet);
    }

    // Listen for new blocks
    this.blockchain.onBlock(async (block) => {
      // Store block data in CAS
      await this.cas.put(block.toJSON ? block.toJSON() : block, 'json', true);
      // Cache CAS to localStorage for offline restart
      this._saveCASCache();
      this.emit('block', block);
      this.emit('stateChange');
    });

    this.blockchain.onTransaction((tx) => {
      this.emit('transaction', tx);
    });

    // 4. P2P Network
    const nodeId = this.wallet?.address || crypto.randomUUID();
    this.network = new PeerNetwork(nodeId);

    // Attach CAS to network for data replication
    this.cas.attachNetwork(this.network);

    // 5. Protocol (blockchain sync)
    this.protocol = new Protocol(this.network, this.blockchain);
    // When state syncs from another tab, update UI (without re-broadcasting)
    this.protocol.onStateSync = () => {
      this._syncing = true;
      this._saveState();
      // Notify UI listeners directly without triggering another broadcast
      for (const h of (this._listeners['stateChange'] || [])) {
        try { h(); } catch (e) { console.error('[stateSync]', e); }
      }
      this._syncing = false;
    };

    // 6. IPFS Bridge — connect CAS to the IPFS network
    this.ipfs = new IPFSBridge(this.cas);

    // 7. Signaling — automatic peer discovery via WebSocket
    this.signaling = new SignalingClient(this.network, {
      onStatusChange: (status) => {
        console.log(`[DiaDem] Signaling: ${status}`);
        this.emit('signalingStatus', status);
        this.emit('stateChange');
      },
    });
    // Link signaling to peer network for WS relay fallback
    this.network.signalingClient = this.signaling;
    // Connect to signaling server (non-blocking, auto-reconnects)
    this.signaling.connect();

    // 8. Consensus (Proof of Stake)
    this.consensus = new ProofOfStake(this.blockchain);
    if (this.wallet) {
      this._startConsensus();
    }

    // Update signaling server with chain height on new blocks
    this.blockchain.onBlock((block) => {
      this.signaling.updateHeight(block.index);
    });

    // 9. Persist state on every state change (survives reload)
    this.blockchain.onBlock(() => this._saveState());
    this.blockchain.onTransaction(() => this._saveState());

    // 10. Announce via BroadcastChannel so other tabs sync
    setTimeout(() => this._broadcastHello(), 500);

    this.ready = true;
    console.log('[DiaDem] Node ready!');
    console.log('[DiaDem] Chain height:', this.blockchain.getHeight());
    console.log('[DiaDem] CAS objects:', this.cas.getStats().objects);
    this.emit('ready');

    return this;
  }

  /** Create a new wallet */
  async createWallet(name = null) {
    const keyPair = await generateKeyPair();
    const seedPhrase = generateSeedPhrase();

    this.wallet = {
      address: keyPair.address,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      seedPhrase,
      createdAt: Date.now(),
    };

    // Save ONLY the keys locally (not a database — just a keychain)
    KeyStore.saveWallet(this.wallet);

    // Re-init blockchain with initial balance for this address
    this.blockchain = new Blockchain();
    await this.blockchain.init(this.wallet.address);

    // Reconnect network, protocol, signaling, IPFS, consensus
    if (this.signaling) this.signaling.disconnect();
    this.network = new PeerNetwork(this.wallet.address);
    this.cas.attachNetwork(this.network);
    this.protocol = new Protocol(this.network, this.blockchain);
    this.protocol.onStateSync = () => {
      this._syncing = true;
      this._saveState();
      for (const h of (this._listeners['stateChange'] || [])) {
        try { h(); } catch (e) { console.error('[stateSync]', e); }
      }
      this._syncing = false;
    };
    this.ipfs = new IPFSBridge(this.cas);
    this.consensus = new ProofOfStake(this.blockchain);

    // Reconnect signaling
    this.signaling = new SignalingClient(this.network, {
      onStatusChange: (status) => {
        this.emit('signalingStatus', status);
        this.emit('stateChange');
      },
    });
    this.network.signalingClient = this.signaling;
    this.signaling.connect();

    this.blockchain.onBlock(async (block) => {
      await this.cas.put(block.toJSON ? block.toJSON() : block, 'json', true);
      this._saveCASCache();
      this._saveState();
      this.emit('block', block);
      this.emit('stateChange');
    });

    this.blockchain.onTransaction(() => this._saveState());

    this._startConsensus();

    // Claim faucet DDM for new wallet
    await this.blockchain.claimFaucet(this.wallet);

    // Store profile name (must be after claimFaucet so balance > 0 for PROFILE_UPDATE_FEE)
    if (name) {
      const profileHash = await this.cas.putProfile({
        address: this.wallet.address,
        name,
        handle: '@' + name.toLowerCase().replace(/\s+/g, '_'),
      });
      await this.updateProfile({
        name,
        handle: '@' + name.toLowerCase().replace(/\s+/g, '_'),
        profileHash,
      });
    }

    this._saveState();

    // Announce to other tabs
    setTimeout(() => this._broadcastHello(), 500);

    this.emit('walletCreated', this.wallet);
    this.emit('stateChange');
    console.log('[DiaDem] Wallet created:', this.wallet.address);
    return this.wallet;
  }

  /** Import wallet from seed phrase */
  async importFromSeed(seedPhrase) {
    const phrase = Array.isArray(seedPhrase) ? seedPhrase : seedPhrase.trim().split(/\s+/);
    if (!validateSeedPhrase(phrase)) throw new Error('Invalid seed phrase (must be 12 valid words)');

    const keys = await deriveKeyFromSeed(phrase);
    this.wallet = {
      address: keys.address,
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      seedPhrase: phrase,
      createdAt: Date.now(),
    };
    KeyStore.saveWallet(this.wallet);
    await this._reinitAfterImport();
    return this.wallet;
  }

  /** Import wallet from access key */
  async importFromAccessKey(accessKey) {
    const data = parseAccessKey(accessKey);
    if (!data) throw new Error('Invalid access key');

    this.wallet = {
      address: data.address,
      publicKey: data.publicKey,
      privateKey: data.privateKey,
      seedPhrase: data.seedPhrase || [],
      createdAt: data.createdAt || Date.now(),
    };
    KeyStore.saveWallet(this.wallet);
    await this._reinitAfterImport();
    return this.wallet;
  }

  /** Get access key for current wallet */
  async getAccessKey() {
    this._requireWallet();
    return generateAccessKey(this.wallet);
  }

  /** Get seed phrase for current wallet */
  getSeedPhrase() {
    this._requireWallet();
    return this.wallet.seedPhrase || [];
  }

  /** Reinitialize node after wallet import (shared by importFromSeed and importFromAccessKey) */
  async _reinitAfterImport() {
    this.blockchain = new Blockchain();
    await this.blockchain.init(this.wallet.address);

    if (this.signaling) this.signaling.disconnect();
    this.network = new PeerNetwork(this.wallet.address);
    this.cas.attachNetwork(this.network);
    this.protocol = new Protocol(this.network, this.blockchain);
    this.protocol.onStateSync = () => {
      this._syncing = true;
      this._saveState();
      for (const h of (this._listeners['stateChange'] || [])) {
        try { h(); } catch (e) { console.error('[stateSync]', e); }
      }
      this._syncing = false;
    };
    this.ipfs = new IPFSBridge(this.cas);
    this.consensus = new ProofOfStake(this.blockchain);
    this.signaling = new SignalingClient(this.network, {
      onStatusChange: (status) => {
        this.emit('signalingStatus', status);
        this.emit('stateChange');
      },
    });
    this.network.signalingClient = this.signaling;
    this.signaling.connect();

    this.blockchain.onBlock(async (block) => {
      await this.cas.put(block.toJSON ? block.toJSON() : block, 'json', true);
      this._saveCASCache();
      this._saveState();
      this.emit('block', block);
      this.emit('stateChange');
    });
    this.blockchain.onTransaction(() => this._saveState());
    this._startConsensus();

    await this.blockchain.claimFaucet(this.wallet);
    this._saveState();

    setTimeout(() => this._broadcastHello(), 500);
    this.emit('walletCreated', this.wallet);
    this.emit('stateChange');
    console.log('[DiaDem] Wallet imported:', this.wallet.address);
  }

  // ─── Social Actions (all go through blockchain + CAS) ───

  /** Create a post (content stored in CAS + IPFS, hash stored on-chain) */
  async createPost(content, media = null, options = {}) {
    this._requireWallet();
    // Store content in CAS first
    const casResult = await this.cas.putPost({
      content,
      media,
      author: this.wallet.address,
      timestamp: Date.now(),
    });
    // Create blockchain transaction with CAS hash reference
    const tx = await createPost(this.wallet, content, media);
    tx.data.casHash = casResult.hash; // Link to CAS
    if (options.mediaList) tx.data.mediaList = options.mediaList;
    if (options.spoilerMedia) tx.data.spoilerMedia = true;
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);

    // Async: also publish to IPFS if available
    if (this.ipfs) {
      this.ipfs.publish({ content, media, author: this.wallet.address, timestamp: Date.now() }, casResult.hash)
        .then(cid => { if (cid) tx.data.ipfsCid = cid; })
        .catch(() => {});
    }

    this.emit('stateChange');
    return tx;
  }

  /** Like a post */
  async likePost(postId) {
    this._requireWallet();
    const tx = await createLike(this.wallet, postId);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** React to a post with emoji */
  async reactToPost(postId, emoji) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.REACTION,
      from: this.wallet.address,
      data: { postId, emoji },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Unlike a post */
  async unlikePost(postId) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.UNLIKE,
      from: this.wallet.address,
      data: { postHash: postId },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Repost/unrepost a post */
  async repostPost(postId) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.REPOST,
      from: this.wallet.address,
      data: { postId },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Delete own post */
  async deletePost(postId) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.DELETE_POST,
      from: this.wallet.address,
      data: { postId },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Reply to a post (free, no DDM cost) */
  async replyToPost(parentId, content) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.REPLY,
      from: this.wallet.address,
      data: { parentId, content, id: crypto.randomUUID() },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Buy profile decoration */
  async buyProfileDecor(itemId, slot, price) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.PROFILE_DECOR,
      from: this.wallet.address,
      data: { itemId, slot, price },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Equip or unequip a decoration (itemId=null to unequip) */
  async equipProfileDecor(slot, itemId) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.EQUIP_DECOR,
      from: this.wallet.address,
      data: { slot, itemId },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Get profile decorations */
  getProfileDecor(address = null) {
    return this.blockchain.state.profileDecor.get(address || this.wallet?.address) || { purchased: new Set() };
  }

  /** Delete a reply */
  async deleteReply(replyId, parentId) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.DELETE_REPLY,
      from: this.wallet.address,
      data: { replyId, parentId },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Save a message (like Telegram Saved Messages - only for you) */
  async saveMessage(content) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.SAVED_MESSAGE,
      from: this.wallet.address,
      data: { content, id: crypto.randomUUID() },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Delete a saved message */
  async deleteSavedMessage(messageId) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.DELETE_SAVED_MESSAGE,
      from: this.wallet.address,
      data: { messageId },
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Get saved messages */
  getSavedMessages() {
    if (!this.wallet) return [];
    return (this.blockchain.state.savedMessages.get(this.wallet.address) || []).slice().reverse();
  }

  /** Send a direct message — instant delivery via P2P, then persisted on-chain */
  async sendDirectMessage(toAddress, content, image = null) {
    this._requireWallet();
    const msgId = crypto.randomUUID();
    const msg = {
      id: msgId,
      from: this.wallet.address,
      to: toAddress,
      content: content || '',
      image: image || null,
      timestamp: Date.now(),
    };

    // 1) Instant local apply
    const key = [this.wallet.address, toAddress].sort().join(':');
    const dm = this.blockchain.state.directMessages;
    if (!dm.has(key)) dm.set(key, []);
    dm.get(key).push(msg);
    this.emit('stateChange');

    // 2) Instant P2P broadcast (no block wait)
    this.network.broadcast(MSG_TYPES.DM_INSTANT, { msg });

    // 3) Persist on-chain (async, no await needed for UI)
    const tx = new Transaction({
      type: TX_TYPES.DIRECT_MESSAGE,
      from: this.wallet.address,
      to: toAddress,
      data: { content, image, id: msgId },
      nonce: Date.now(),
    });
    tx.sign(this.wallet.privateKey, this.wallet.publicKey).then(async () => {
      await this.blockchain.addTransaction(tx);
      this.protocol.broadcastTransaction(tx);
    }).catch(() => {});

    return msg;
  }

  /** Send DDM tokens through DM chat — instant delivery */
  async sendDmPayment(toAddress, amount, memo = '') {
    this._requireWallet();
    if (amount <= 0) throw new Error('Amount must be positive');
    if (this.getBalance() < amount) throw new Error('Insufficient balance');
    const msgId = crypto.randomUUID();
    const msg = {
      id: msgId,
      from: this.wallet.address,
      to: toAddress,
      content: '',
      payment: { amount, memo },
      timestamp: Date.now(),
    };

    // 1) Instant local apply (message + balance)
    const key = [this.wallet.address, toAddress].sort().join(':');
    const dm = this.blockchain.state.directMessages;
    if (!dm.has(key)) dm.set(key, []);
    dm.get(key).push(msg);
    const fromBal = this.blockchain.state.getBalance(this.wallet.address);
    const toBal = this.blockchain.state.getBalance(toAddress);
    this.blockchain.state.balances.set(this.wallet.address, fromBal - amount);
    this.blockchain.state.balances.set(toAddress, toBal + amount);
    this.emit('stateChange');

    // 2) Instant P2P broadcast
    this.network.broadcast(MSG_TYPES.DM_INSTANT, { msg });

    // 3) Persist on-chain (background)
    const tx = new Transaction({
      type: TX_TYPES.DM_PAYMENT,
      from: this.wallet.address,
      to: toAddress,
      amount,
      data: { memo, id: msgId },
      nonce: Date.now(),
    });
    tx.sign(this.wallet.privateKey, this.wallet.publicKey).then(async () => {
      await this.blockchain.addTransaction(tx);
      this.protocol.broadcastTransaction(tx);
    }).catch(() => {});

    return msg;
  }

  /** Get all DM chats for current user */
  getDMChats() {
    if (!this.wallet) return [];
    const myAddr = this.wallet.address;
    const chats = [];
    for (const [key, msgs] of this.blockchain.state.directMessages) {
      const [a, b] = key.split(':');
      if (a !== myAddr && b !== myAddr) continue;
      const otherAddr = a === myAddr ? b : a;
      const sorted = msgs.slice().sort((x, y) => x.timestamp - y.timestamp);
      const last = sorted[sorted.length - 1];
      chats.push({
        chatKey: key,
        otherAddress: otherAddr,
        lastMessage: last,
        messages: sorted,
        unread: 0,
      });
    }
    chats.sort((a, b) => (b.lastMessage?.timestamp || 0) - (a.lastMessage?.timestamp || 0));
    return chats;
  }

  /** Get DM messages for a specific chat */
  getDMMessages(otherAddress) {
    if (!this.wallet) return [];
    const key = [this.wallet.address, otherAddress].sort().join(':');
    return (this.blockchain.state.directMessages.get(key) || []).slice().sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Send typing indicator (ephemeral, not on-chain) */
  sendTypingIndicator(toAddress) {
    if (!this.wallet || !this.network) return;
    this.network.broadcast(MSG_TYPES.DM_TYPING, {
      from: this.wallet.address,
      to: toAddress,
    });
  }

  /** Follow a user */
  async followUser(address) {
    this._requireWallet();
    const tx = await createFollow(this.wallet, address);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Unfollow a user */
  async unfollowUser(address) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.UNFOLLOW,
      from: this.wallet.address,
      to: address,
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Create a story (24h ephemeral content) */
  async createStory(storyData) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.STORY,
      from: this.wallet.address,
      data: storyData,
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  /** Get active stories (respects per-story duration, excludes hidden) */
  getActiveStories() {
    const now = Date.now();
    const result = [];
    for (const [addr, stories] of this.blockchain.state.stories) {
      const active = stories.filter(s => {
        if (s.hidden) return false;
        if (s.duration === 0) return true; // permanent
        const expiresAt = s.timestamp + (s.duration || 24) * 60 * 60 * 1000;
        return now < expiresAt;
      });
      if (active.length > 0) {
        result.push({
          address: addr,
          profile: this.getProfile(addr),
          stories: active,
        });
      }
    }
    const myAddr = this.wallet?.address;
    result.sort((a, b) => {
      if (a.address === myAddr) return -1;
      if (b.address === myAddr) return 1;
      return b.stories[b.stories.length - 1].timestamp - a.stories[a.stories.length - 1].timestamp;
    });
    return result;
  }

  /** Get all stories (including expired) for archive */
  getAllStories(address) {
    return this.blockchain.state.stories.get(address) || [];
  }

  /** Update profile (stored in CAS, hash on-chain) */
  async updateProfile(profileData) {
    this._requireWallet();
    const profileHash = await this.cas.putProfile({
      address: this.wallet.address,
      ...profileData,
    });
    const tx = await createProfileUpdate(this.wallet, {
      ...profileData,
      casHash: profileHash,
    });
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  // ─── Token Actions ──────────────────────────────────────

  async transfer(toAddress, amount) {
    this._requireWallet();
    const tx = await createTransfer(this.wallet, toAddress, amount);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  async stake(amount, validatorAddress = null) {
    this._requireWallet();
    const tx = await createStake(this.wallet, amount, validatorAddress || this.wallet.address);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  async unstake(amount) {
    this._requireWallet();
    const tx = new Transaction({
      type: TX_TYPES.UNSTAKE,
      from: this.wallet.address,
      amount,
      nonce: Date.now(),
    });
    await tx.sign(this.wallet.privateKey, this.wallet.publicKey);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  async vote(proposalId, voteChoice) {
    this._requireWallet();
    const tx = await createVote(this.wallet, proposalId, voteChoice);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
  }

  // ─── Read State (from blockchain world state) ───────────

  getBalance() {
    if (!this.wallet) return 0;
    return this.blockchain.state.getBalance(this.wallet.address);
  }

  getStake() {
    if (!this.wallet) return { amount: 0 };
    return this.blockchain.state.getStake(this.wallet.address);
  }

  getProfile(address = null) {
    return this.blockchain.state.getProfile(address || this.wallet?.address);
  }

  getFeed(limit = 50) {
    if (!this.wallet) return this.blockchain.state.getAllPosts(limit);
    return this.blockchain.state.getFeed(this.wallet.address, limit);
  }

  getExplorePosts(limit = 100) {
    return this.blockchain.state.getAllPosts(limit, this.wallet?.address);
  }

  getUserPosts(address) {
    const myAddr = this.wallet?.address;
    const postIds = this.blockchain.state.postsByAuthor.get(address) || [];
    const posts = postIds.map(pid => {
      const post = this.blockchain.state.posts.get(pid);
      if (!post) return null;
      const likesSet = this.blockchain.state.likes.get(pid) || new Set();
      return {
        ...post,
        profile: this.blockchain.state.getProfile(post.author),
        likesCount: likesSet.size,
        liked: myAddr ? likesSet.has(myAddr) : false,
      };
    }).filter(Boolean);

    // Add reposts — posts this user reposted
    for (const [pid, repostSet] of this.blockchain.state.reposts) {
      if (repostSet.has(address)) {
        const post = this.blockchain.state.posts.get(pid);
        if (post && post.author !== address) {
          const likesSet = this.blockchain.state.likes.get(pid) || new Set();
          posts.push({
            ...post,
            profile: this.blockchain.state.getProfile(post.author),
            likesCount: likesSet.size,
            liked: myAddr ? likesSet.has(myAddr) : false,
            repostedBy: address,
            repostedByProfile: this.blockchain.state.getProfile(address),
          });
        }
      }
    }

    posts.sort((a, b) => b.timestamp - a.timestamp);
    return posts;
  }

  getSocialStats(address = null) {
    const addr = address || this.wallet?.address;
    if (!addr) return { following: 0, followers: 0 };
    return {
      following: (this.blockchain.state.following.get(addr) || new Set()).size,
      followers: (this.blockchain.state.followers.get(addr) || new Set()).size,
    };
  }

  getTransactions(limit = 50) {
    if (!this.wallet) return [];
    return this.blockchain.state.getTransactions(this.wallet.address, limit);
  }

  getValidators() {
    return this.blockchain.state.getValidators();
  }

  getReputation(address = null) {
    return this.blockchain.state.getReputation(address || this.wallet?.address);
  }

  /** Get data from CAS by hash */
  async getFromCAS(hash) {
    return this.cas.get(hash);
  }

  /** Get comprehensive node info */
  getNodeInfo() {
    const casStats = this.cas.getStats();
    const signalingStatus = this.signaling?.getStatus() || { connected: false };
    const ipfsStatus = this.ipfs?.getStatus() || { localNode: false };
    return {
      chain: {
        height: this.blockchain.getHeight(),
        blocks: this.blockchain.chain.length,
        pendingTxs: this.blockchain.mempool.length,
      },
      network: {
        peers: this.network.getPeerCount(),
        nodeId: this.network.nodeId,
        signaling: signalingStatus.connected ? 'connected' : 'disconnected',
      },
      cas: {
        objects: casStats.objects,
        size: casStats.sizeHuman,
        pins: casStats.pins,
      },
      ipfs: {
        localNode: ipfsStatus.localNode,
        mappedObjects: ipfsStatus.mappedObjects || 0,
        gateways: ipfsStatus.gateways || 0,
      },
      state: {
        totalStaked: this.blockchain.state.totalStaked,
        totalPosts: this.blockchain.state.posts.size,
        totalAccounts: this.blockchain.state.balances.size,
      },
      wallet: this.wallet ? {
        address: this.wallet.address,
        balance: this.getBalance(),
        stake: this.getStake().amount,
      } : null,
    };
  }

  // ─── P2P ────────────────────────────────────────────────

  async createOffer() { return this.network.createOffer(); }
  async acceptOffer(str) { return this.network.acceptOffer(str); }
  async completeConnection(id, str, pc) { return this.network.completeConnection(id, str, pc); }

  // ─── Internal ───────────────────────────────────────────

  _requireWallet() {
    if (!this.wallet) throw new Error('No wallet. Create or import a wallet first.');
  }

  _startConsensus() {
    if (!this.wallet) return;
    // Wrap consensus to broadcast produced blocks to all peers
    const protocol = this.protocol;
    this.consensus.startProduction(
      this.wallet.address,
      this.wallet.publicKey,
      async (data) => sign(data, this.wallet.privateKey),
      // onBlockProduced callback — broadcast to peers
      (block) => {
        protocol.broadcastBlock(block);
      }
    );
  }

  /** Announce presence via BroadcastChannel so other tabs sync */
  _broadcastHello() {
    if (this.network) {
      this.network.broadcast(MSG_TYPES.HELLO, {
        height: this.blockchain.getHeight(),
        nodeId: this.network.nodeId,
      });
      // Also broadcast full state for immediate sync
      this.protocol.broadcastState();
    }
  }

  /** Save full state + mempool to localStorage for persistence across reloads */
  _saveState() {
    try {
      const stateData = {
        state: this.blockchain.state.toJSON(),
        mempool: this.blockchain.mempool.map(tx => tx.toJSON ? tx.toJSON() : tx),
        chainLength: this.blockchain.chain.length,
      };
      localStorage.setItem('diadem_state_cache', JSON.stringify(stateData));
    } catch (e) {
      console.warn('[DiaDem] State save failed:', e.message);
    }
  }

  /** Load persisted state from localStorage */
  async _loadState() {
    try {
      const raw = localStorage.getItem('diadem_state_cache');
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.state) {
        const { WorldState } = await import('./core/state.js');
        this.blockchain.state = WorldState.fromJSON(data.state);
        console.log('[DiaDem] State restored from cache');
      }
      return true;
    } catch (e) {
      console.warn('[DiaDem] State load failed:', e.message);
      return false;
    }
  }

  /** Try to rebuild chain from CAS cached blocks */
  async _rebuildFromCAS() {
    // CAS stores blocks as pinned objects, try to find and replay them
    const cached = KeyStore.loadCASCache();
    if (!cached) return;

    const blocks = [];
    for (const [hash, obj] of Object.entries(cached)) {
      try {
        const data = JSON.parse(obj.data);
        if (data.index !== undefined && data.transactions !== undefined) {
          blocks.push(data);
        }
      } catch {}
    }

    // Sort by index and replay
    blocks.sort((a, b) => a.index - b.index);
    for (const blockData of blocks) {
      if (blockData.index === this.blockchain.getHeight() + 1) {
        try {
          const { Block } = await import('./core/block.js');
          await this.blockchain.addBlock(Block.fromJSON(blockData));
        } catch {}
      }
    }
  }

  _saveCASCache() {
    try {
      KeyStore.saveCASCache(this.cas.exportPinned());
    } catch {}
  }

  // ─── Events ─────────────────────────────────────────────

  on(event, handler) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(handler);
    return () => {
      this._listeners[event] = this._listeners[event].filter(h => h !== handler);
    };
  }

  emit(event, data) {
    for (const h of (this._listeners[event] || [])) {
      try { h(data); } catch (e) { console.error(`[Event:${event}]`, e); }
    }
    // Auto-sync state to other tabs on state change (throttled, not on sync-triggered events)
    if (event === 'stateChange' && this.protocol && this.network && !this._syncing) {
      this._saveState();
      // Throttle broadcasting to max once per second
      if (!this._syncTimer) {
        this._syncTimer = setTimeout(() => {
          this._syncTimer = null;
          if (this.protocol) this.protocol.broadcastState();
        }, 1000);
      }
    }
  }

  /** Factory reset — clears only local keys, blockchain is on the network */
  async reset() {
    this.consensus.stopProduction();
    if (this.signaling) this.signaling.disconnect();
    this.network.disconnect();
    KeyStore.clearAll();
    this.wallet = null;
    this.cas = new ContentAddressableStorage();
    this.blockchain = new Blockchain();
    await this.blockchain.init();
    this.emit('stateChange');
  }
}

// Singleton
let _node = null;
export async function getNode() {
  if (!_node) {
    _node = new DiaDemNode();
    await _node.init();
  }
  return _node;
}
