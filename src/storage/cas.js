/**
 * DiaDem Content-Addressable Storage (CAS)
 * IPFS-like protocol: every piece of data is identified by its hash.
 * Data is stored locally and replicated across peers.
 *
 * Key concepts:
 * - Every object is stored as: hash(content) -> content
 * - Objects are immutable — once stored, never changed
 * - Mutable references (like "latest profile") use signed pointers
 * - Data is chunked for large content (images, files)
 * - Peers request objects by hash (content discovery)
 *
 * This replaces traditional databases entirely.
 * The blockchain stores transaction hashes, CAS stores the actual data.
 */

import { sha256 } from '../crypto/keys.js';

export const CAS_MSG_TYPES = {
  WANT: 'cas_want',       // Request data by hash
  HAVE: 'cas_have',       // Announce we have data
  BLOCK: 'cas_block',     // Send data block
  PIN: 'cas_pin',         // Pin important data
};

export class ContentAddressableStorage {
  constructor() {
    // hash -> { data, pinned, timestamp }
    this.objects = new Map();
    // Linked peers for data replication
    this.network = null;
    // Pending requests: hash -> [resolve callbacks]
    this.pending = new Map();
    // Stats
    this.stats = { stored: 0, totalSize: 0, pins: 0 };
  }

  /** Connect to the P2P network for data replication */
  attachNetwork(network) {
    this.network = network;

    // Handle data requests from peers
    network.on(CAS_MSG_TYPES.WANT, (peerId, payload) => {
      const { hash } = payload;
      const obj = this.objects.get(hash);
      if (obj) {
        network.send(peerId, CAS_MSG_TYPES.BLOCK, {
          hash,
          data: obj.data,
          type: obj.type,
        });
      }
    });

    // Handle data received from peers
    network.on(CAS_MSG_TYPES.BLOCK, (peerId, payload) => {
      const { hash, data, type } = payload;
      // Verify hash matches content
      this._verifyAndStore(hash, data, type);
    });

    // Handle pin announcements
    network.on(CAS_MSG_TYPES.HAVE, (peerId, payload) => {
      // Track what peers have (for future smart routing)
    });
  }

  /**
   * Store data and return its content hash (like ipfs.add())
   * @param {any} data - Data to store (will be JSON serialized)
   * @param {string} type - Content type: 'json', 'text', 'blob'
   * @param {boolean} pin - Whether to pin (prevent garbage collection)
   * @returns {string} Content hash (CID-like)
   */
  async put(data, type = 'json', pin = false) {
    const serialized = type === 'json' ? JSON.stringify(data) : String(data);
    const hash = await sha256(serialized);

    this.objects.set(hash, {
      data: serialized,
      type,
      pinned: pin,
      timestamp: Date.now(),
      size: serialized.length,
    });

    this.stats.stored++;
    this.stats.totalSize += serialized.length;
    if (pin) this.stats.pins++;

    // Announce to peers that we have this data
    if (this.network) {
      this.network.broadcast(CAS_MSG_TYPES.HAVE, { hash, type, size: serialized.length });
    }

    return hash;
  }

  /**
   * Retrieve data by its content hash (like ipfs.cat())
   * First checks local storage, then asks peers.
   * @param {string} hash - Content hash
   * @returns {any} The stored data
   */
  async get(hash) {
    // Check local first
    const local = this.objects.get(hash);
    if (local) {
      return local.type === 'json' ? JSON.parse(local.data) : local.data;
    }

    // Ask peers
    if (this.network) {
      return this._requestFromPeers(hash);
    }

    return null;
  }

  /**
   * Check if we have data locally
   */
  has(hash) {
    return this.objects.has(hash);
  }

  /**
   * Pin data to prevent garbage collection
   */
  pin(hash) {
    const obj = this.objects.get(hash);
    if (obj) {
      obj.pinned = true;
      this.stats.pins++;
    }
  }

  /**
   * Unpin data
   */
  unpin(hash) {
    const obj = this.objects.get(hash);
    if (obj && obj.pinned) {
      obj.pinned = false;
      this.stats.pins--;
    }
  }

  /**
   * Store a DAG node (like IPFS DAG)
   * A DAG node can link to other content hashes, forming a merkle DAG.
   */
  async putDAG(node) {
    return this.put(node, 'json', true);
  }

  /**
   * Store a post with all its data
   * Returns: { hash, contentHash, ... }
   */
  async putPost(post) {
    // Store the post content
    const contentHash = await this.put({
      content: post.content,
      media: post.media || null,
      timestamp: post.timestamp,
    }, 'json', true);

    // Store the post metadata (links to content)
    const postNode = {
      type: 'post',
      author: post.author,
      contentHash,
      timestamp: post.timestamp,
      links: post.media ? [post.media] : [],
    };

    const postHash = await this.put(postNode, 'json', true);
    return { hash: postHash, contentHash };
  }

  /**
   * Store a profile
   */
  async putProfile(profile) {
    const hash = await this.put({
      type: 'profile',
      ...profile,
      updatedAt: Date.now(),
    }, 'json', true);
    return hash;
  }

  /**
   * Request data from peers
   */
  async _requestFromPeers(hash, timeout = 5000) {
    return new Promise((resolve) => {
      // Set up response handler
      if (!this.pending.has(hash)) {
        this.pending.set(hash, []);
      }
      this.pending.get(hash).push(resolve);

      // Ask all peers
      this.network.broadcast(CAS_MSG_TYPES.WANT, { hash });

      // Timeout
      setTimeout(() => {
        const callbacks = this.pending.get(hash) || [];
        this.pending.delete(hash);
        for (const cb of callbacks) cb(null);
      }, timeout);
    });
  }

  /**
   * Verify received data matches hash and store it
   */
  async _verifyAndStore(expectedHash, data, type) {
    const actualHash = await sha256(data);
    if (actualHash !== expectedHash) {
      console.warn(`[CAS] Hash mismatch! Expected ${expectedHash}, got ${actualHash}`);
      return false;
    }

    this.objects.set(expectedHash, {
      data,
      type,
      pinned: false,
      timestamp: Date.now(),
      size: data.length,
    });

    // Resolve any pending requests
    const callbacks = this.pending.get(expectedHash) || [];
    this.pending.delete(expectedHash);
    const parsed = type === 'json' ? JSON.parse(data) : data;
    for (const cb of callbacks) cb(parsed);

    return true;
  }

  /**
   * Garbage collection — remove unpinned old data
   */
  gc(maxAge = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let removed = 0;
    for (const [hash, obj] of this.objects) {
      if (!obj.pinned && now - obj.timestamp > maxAge) {
        this.objects.delete(hash);
        this.stats.totalSize -= obj.size;
        removed++;
      }
    }
    this.stats.stored -= removed;
    return removed;
  }

  /**
   * Export all pinned data (for persistence/backup)
   */
  exportPinned() {
    const data = {};
    for (const [hash, obj] of this.objects) {
      if (obj.pinned) {
        data[hash] = { data: obj.data, type: obj.type };
      }
    }
    return data;
  }

  /**
   * Import data
   */
  importData(data) {
    for (const [hash, obj] of Object.entries(data)) {
      if (!this.objects.has(hash)) {
        this.objects.set(hash, {
          data: obj.data,
          type: obj.type,
          pinned: true,
          timestamp: Date.now(),
          size: obj.data.length,
        });
        this.stats.stored++;
        this.stats.totalSize += obj.data.length;
        this.stats.pins++;
      }
    }
  }

  /**
   * Get storage stats
   */
  getStats() {
    return {
      ...this.stats,
      objects: this.objects.size,
      sizeHuman: this._formatSize(this.stats.totalSize),
    };
  }

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
