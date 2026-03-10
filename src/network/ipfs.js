/**
 * DiaDem IPFS Bridge
 * Connects the local CAS (Content-Addressable Storage) to the IPFS network.
 *
 * Uses public IPFS HTTP gateways for content retrieval and
 * the IPFS HTTP API for pinning/publishing when a local IPFS node is available.
 *
 * Architecture:
 * ┌──────────────┐     ┌────────────────┐     ┌──────────────┐
 * │   DiaDem CAS │────▶│   IPFS Bridge   │────▶│  IPFS Network │
 * │  (in-memory) │◀────│ (gateway+API)   │◀────│  (gateways)   │
 * └──────────────┘     └────────────────┘     └──────────────┘
 *
 * Content flow:
 * 1. CAS.put() → store locally → optionally pin to IPFS
 * 2. CAS.get() → check local → check IPFS gateways → ask peers
 */

const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
];

// IPFS HTTP API endpoint (local kubo node)
const DEFAULT_API = 'http://127.0.0.1:5001/api/v0';

export class IPFSBridge {
  constructor(cas, options = {}) {
    this.cas = cas;
    this.apiUrl = options.apiUrl || DEFAULT_API;
    this.localNodeAvailable = false;
    this.gatewayIndex = 0;

    // CID mapping: local SHA-256 hash → IPFS CID
    this.cidMap = new Map();
    // Reverse: IPFS CID → local hash
    this.reverseCidMap = new Map();

    // Check if local IPFS node is running
    this._checkLocalNode();
  }

  /** Check if a local IPFS/Kubo node is available */
  async _checkLocalNode() {
    try {
      const res = await fetch(`${this.apiUrl}/id`, {
        method: 'POST',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        this.localNodeAvailable = true;
        console.log('[IPFS] Local node detected:', data.ID?.slice(0, 16) + '...');
      }
    } catch {
      this.localNodeAvailable = false;
      console.log('[IPFS] No local IPFS node — using gateways for reads');
    }
  }

  /**
   * Publish data to IPFS.
   * If a local IPFS node is available, uses the API to add & pin.
   * Returns the IPFS CID or null if not available.
   */
  async publish(data, localHash) {
    if (!this.localNodeAvailable) return null;

    try {
      const serialized = typeof data === 'string' ? data : JSON.stringify(data);
      const blob = new Blob([serialized], { type: 'application/octet-stream' });
      const formData = new FormData();
      formData.append('file', blob);

      const res = await fetch(`${this.apiUrl}/add?pin=true`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(10000),
      });

      if (res.ok) {
        const result = await res.json();
        const cid = result.Hash;
        console.log(`[IPFS] Published: ${cid}`);

        // Map local hash to IPFS CID
        if (localHash) {
          this.cidMap.set(localHash, cid);
          this.reverseCidMap.set(cid, localHash);
        }

        return cid;
      }
    } catch (err) {
      console.warn('[IPFS] Publish failed:', err.message);
    }

    return null;
  }

  /**
   * Retrieve data from IPFS by CID.
   * Tries gateways in round-robin fashion.
   */
  async retrieve(cid) {
    // Try each gateway
    for (let i = 0; i < IPFS_GATEWAYS.length; i++) {
      const idx = (this.gatewayIndex + i) % IPFS_GATEWAYS.length;
      const gateway = IPFS_GATEWAYS[idx];

      try {
        const res = await fetch(`${gateway}${cid}`, {
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          this.gatewayIndex = idx; // Remember fastest gateway
          const text = await res.text();

          // Try to parse as JSON
          try {
            return JSON.parse(text);
          } catch {
            return text;
          }
        }
      } catch {
        continue;
      }
    }

    // Try local node API
    if (this.localNodeAvailable) {
      try {
        const res = await fetch(`${this.apiUrl}/cat?arg=${cid}`, {
          method: 'POST',
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const text = await res.text();
          try { return JSON.parse(text); } catch { return text; }
        }
      } catch {}
    }

    return null;
  }

  /**
   * Resolve a local CAS hash to an IPFS CID
   */
  getCID(localHash) {
    return this.cidMap.get(localHash) || null;
  }

  /**
   * Resolve an IPFS CID to a local CAS hash
   */
  getLocalHash(cid) {
    return this.reverseCidMap.get(cid) || null;
  }

  /**
   * Pin content on the local IPFS node
   */
  async pin(cid) {
    if (!this.localNodeAvailable) return false;

    try {
      const res = await fetch(`${this.apiUrl}/pin/add?arg=${cid}`, {
        method: 'POST',
        signal: AbortSignal.timeout(30000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sync all pinned CAS objects to IPFS
   */
  async syncToIPFS() {
    if (!this.localNodeAvailable) return { synced: 0, errors: 0 };

    let synced = 0;
    let errors = 0;

    for (const [hash, obj] of this.cas.objects) {
      if (obj.pinned && !this.cidMap.has(hash)) {
        const cid = await this.publish(obj.data, hash);
        if (cid) {
          synced++;
        } else {
          errors++;
        }
      }
    }

    console.log(`[IPFS] Synced ${synced} objects to IPFS (${errors} errors)`);
    return { synced, errors };
  }

  /**
   * Get IPFS bridge status
   */
  getStatus() {
    return {
      localNode: this.localNodeAvailable,
      apiUrl: this.apiUrl,
      mappedObjects: this.cidMap.size,
      gateways: IPFS_GATEWAYS.length,
    };
  }

  /**
   * Generate an IPFS URL for content
   */
  getIPFSUrl(hashOrCid) {
    const cid = this.cidMap.get(hashOrCid) || hashOrCid;
    return `${IPFS_GATEWAYS[0]}${cid}`;
  }
}
