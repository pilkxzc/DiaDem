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

import { generateKeyPair, sign, generateSeedPhrase } from './crypto/keys.js';
import { Blockchain } from './core/blockchain.js';
import { Transaction, TX_TYPES, createTransfer, createPost, createStake,
         createFollow, createLike, createProfileUpdate, createVote } from './core/transaction.js';
import { ProofOfStake } from './consensus/pos.js';
import { PeerNetwork } from './network/peer.js';
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

    // Store profile in CAS
    if (name) {
      const profileHash = await this.cas.putProfile({
        address: this.wallet.address,
        name,
        handle: '@' + name.toLowerCase().replace(/\s+/g, '_'),
      });
      // Update profile via transaction
      await this.updateProfile({
        name,
        handle: '@' + name.toLowerCase().replace(/\s+/g, '_'),
        profileHash,
      });
    }

    // Reconnect network, protocol, signaling, IPFS, consensus
    if (this.signaling) this.signaling.disconnect();
    this.network = new PeerNetwork(this.wallet.address);
    this.cas.attachNetwork(this.network);
    this.protocol = new Protocol(this.network, this.blockchain);
    this.ipfs = new IPFSBridge(this.cas);
    this.consensus = new ProofOfStake(this.blockchain);

    // Reconnect signaling
    this.signaling = new SignalingClient(this.network, {
      onStatusChange: (status) => {
        this.emit('signalingStatus', status);
        this.emit('stateChange');
      },
    });
    this.signaling.connect();

    this.blockchain.onBlock(async (block) => {
      await this.cas.put(block.toJSON ? block.toJSON() : block, 'json', true);
      this._saveCASCache();
      this.emit('block', block);
      this.emit('stateChange');
    });

    this._startConsensus();

    this.emit('walletCreated', this.wallet);
    this.emit('stateChange');
    console.log('[DiaDem] Wallet created:', this.wallet.address);
    return this.wallet;
  }

  // ─── Social Actions (all go through blockchain + CAS) ───

  /** Create a post (content stored in CAS + IPFS, hash stored on-chain) */
  async createPost(content, media = null) {
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

  /** Follow a user */
  async followUser(address) {
    this._requireWallet();
    const tx = await createFollow(this.wallet, address);
    await this.blockchain.addTransaction(tx);
    this.protocol.broadcastTransaction(tx);
    this.emit('stateChange');
    return tx;
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
    return this.blockchain.state.getAllPosts(limit);
  }

  getUserPosts(address) {
    const postIds = this.blockchain.state.postsByAuthor.get(address) || [];
    return postIds.map(pid => {
      const post = this.blockchain.state.posts.get(pid);
      return post ? {
        ...post,
        profile: this.blockchain.state.getProfile(post.author),
        likesCount: (this.blockchain.state.likes.get(pid) || new Set()).size,
      } : null;
    }).filter(Boolean).reverse();
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
    this.consensus.startProduction(
      this.wallet.address,
      this.wallet.publicKey,
      async (data) => sign(data, this.wallet.privateKey)
    );
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
