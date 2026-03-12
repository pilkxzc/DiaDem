/**
 * DiaDem Network Protocol
 * Handles blockchain synchronization between peers:
 * - New block propagation
 * - New transaction propagation
 * - Chain sync on connect
 * - Peer discovery
 */

import { MSG_TYPES } from './peer.js';
import { Block } from '../core/block.js';
import { Transaction } from '../core/transaction.js';

export class Protocol {
  constructor(network, blockchain) {
    this.network = network;
    this.blockchain = blockchain;
    this._syncingFullChain = false; // prevent duplicate full-chain requests
    this._lastSyncHeight = 0; // track last synced height

    this._setupHandlers();
  }

  _setupHandlers() {
    // When a peer says hello, sync chains
    this.network.on(MSG_TYPES.HELLO, (peerId, payload) => {
      console.log(`[Protocol] Hello from ${peerId}, height: ${payload.height}`);
      if (payload.height > this.blockchain.getHeight()) {
        // Their chain is longer — request blocks from THAT peer only
        this.network.send(peerId, MSG_TYPES.SYNC_REQUEST, {
          fromIndex: this.blockchain.getHeight() + 1,
        });
      } else if (payload.height < this.blockchain.getHeight()) {
        // Our chain is longer — send THAT peer the blocks they need
        const blocks = [];
        for (let i = payload.height + 1; i < this.blockchain.chain.length; i++) {
          const block = this.blockchain.chain[i];
          blocks.push(block.toJSON ? block.toJSON() : block);
        }
        if (blocks.length > 0) {
          this.network.send(peerId, MSG_TYPES.SYNC_RESPONSE, { blocks });
        }
      }
      // Always share full state (includes mempool-applied changes)
      this.broadcastState();
    });

    // Respond to sync requests (broadcast response — works for both WebRTC and BroadcastChannel)
    this.network.on(MSG_TYPES.SYNC_REQUEST, (peerId, payload) => {
      const fromIndex = payload.fromIndex || 0;
      const blocks = [];
      for (let i = fromIndex; i < this.blockchain.chain.length; i++) {
        const block = this.blockchain.chain[i];
        blocks.push(block.toJSON ? block.toJSON() : block);
      }
      const responsePayload = { blocks };
      // If full chain was requested (fork resolution), mark it
      if (payload.fullChain || fromIndex === 0) {
        responsePayload.fullChain = true;
      }
      // Try direct send first, fallback to broadcast
      const sent = this.network.send(peerId, MSG_TYPES.SYNC_RESPONSE, responsePayload);
      if (!sent) {
        this.network.broadcast(MSG_TYPES.SYNC_RESPONSE, responsePayload);
      }
    });

    // Handle sync response
    this.network.on(MSG_TYPES.SYNC_RESPONSE, async (peerId, payload) => {
      const blocks = payload.blocks || [];
      if (blocks.length === 0) return;
      console.log(`[Protocol] Received ${blocks.length} blocks from ${peerId}`);

      // If this is a full chain response (fork resolution), try replaceChain
      if (payload.fullChain) {
        if (blocks.length > this.blockchain.chain.length) {
          const replaced = await this.blockchain.replaceChain(blocks);
          if (replaced) {
            this._syncingFullChain = false;
            this._lastSyncHeight = this.blockchain.getHeight();
            console.log(`[Protocol] Chain replaced from ${peerId}, height: ${this.blockchain.getHeight()}`);
            if (this.onStateSync) this.onStateSync();
          }
        } else {
          this._syncingFullChain = false;
        }
        return;
      }

      // Skip if we already synced to this height or beyond
      if (this._lastSyncHeight >= this.blockchain.getHeight() + blocks.length) return;

      let forked = false;
      for (const blockData of blocks) {
        try {
          const block = Block.fromJSON(blockData);
          if (block.index === this.blockchain.getHeight() + 1) {
            await this.blockchain.addBlock(block);
            this._lastSyncHeight = block.index;
          }
        } catch (err) {
          if (err.message === 'Invalid previous hash') {
            forked = true;
          } else {
            console.warn(`[Protocol] Failed to add synced block:`, err.message);
          }
          break;
        }
      }

      // Fork detected — request full chain (only once)
      if (forked && !this._syncingFullChain) {
        this._syncingFullChain = true;
        console.warn(`[Protocol] Fork detected at block ${this.blockchain.getHeight() + 1}, requesting full chain from ${peerId.slice(0, 12)}`);
        this.network.send(peerId, MSG_TYPES.SYNC_REQUEST, {
          fromIndex: 0,
          fullChain: true,
        });
      }
    });

    // Handle new block announcement
    this.network.on(MSG_TYPES.NEW_BLOCK, async (peerId, payload) => {
      try {
        const block = Block.fromJSON(payload.block);
        if (block.index === this.blockchain.getHeight() + 1) {
          await this.blockchain.addBlock(block);
          console.log(`[Protocol] Accepted block #${block.index} from ${peerId}`);
          // Re-broadcast to other peers
          this._rebroadcastBlock(block, peerId);
        } else if (block.index > this.blockchain.getHeight() + 1) {
          // We're behind, request full sync
          this.network.send(peerId, MSG_TYPES.SYNC_REQUEST, {
            fromIndex: this.blockchain.getHeight() + 1,
          });
        }
      } catch (err) {
        console.warn(`[Protocol] Rejected block from ${peerId}:`, err.message);
      }
    });

    // Handle new transaction announcement
    this.network.on(MSG_TYPES.NEW_TX, async (peerId, payload) => {
      try {
        const tx = Transaction.fromJSON(payload.tx);
        await this.blockchain.addTransaction(tx);
        // Re-broadcast
        this._rebroadcastTx(tx, peerId);
      } catch (err) {
        // Duplicate or invalid — ignore silently
      }
    });

    // Handle full state sync (for data that lives in state but not in blocks yet)
    this.network.on(MSG_TYPES.STATE_SYNC, async (peerId, payload) => {
      if (!payload.state) return;
      try {
        const { WorldState } = await import('../core/state.js');
        const remoteState = WorldState.fromJSON(payload.state);
        // Merge: take remote posts/saved messages/follows that we don't have
        const hadChanges = this._mergeState(remoteState);
        if (hadChanges && this.onStateSync) this.onStateSync();
      } catch (err) {
        console.warn('[Protocol] State sync failed:', err.message);
      }
    });

    // Handle instant DM delivery (optimistic — applied before block)
    this.network.on(MSG_TYPES.DM_INSTANT, (peerId, payload) => {
      if (!payload.msg) return;
      const m = payload.msg;
      // Only accept if we are the recipient (or sender on another tab)
      const key = [m.from, m.to].sort().join(':');
      const dm = this.blockchain.state.directMessages;
      if (!dm.has(key)) dm.set(key, []);
      const existing = dm.get(key);
      if (existing.some(e => e.id === m.id)) return; // deduplicate
      existing.push(m);
      // Apply payment balance change optimistically
      if (m.payment && m.payment.amount > 0) {
        const fromBal = this.blockchain.state.getBalance(m.from);
        const toBal = this.blockchain.state.getBalance(m.to);
        if (fromBal >= m.payment.amount) {
          this.blockchain.state.balances.set(m.from, fromBal - m.payment.amount);
          this.blockchain.state.balances.set(m.to, toBal + m.payment.amount);
        }
      }
      if (this.onStateSync) this.onStateSync();
    });

    // Handle DM typing indicator (ephemeral, not on-chain)
    this.network.on(MSG_TYPES.DM_TYPING, (peerId, payload) => {
      if (this.onTyping) this.onTyping(payload.from, payload.to);
    });

    // When a peer connects, say hello
    this.network.onPeerConnect = (peerId) => {
      this.network.send(peerId, MSG_TYPES.HELLO, {
        height: this.blockchain.getHeight(),
        nodeId: this.network.nodeId,
      });
    };

    // Announce presence on BroadcastChannel for same-browser tab sync
    setTimeout(() => {
      this.network.announceBroadcastChannel(MSG_TYPES.HELLO, {
        height: this.blockchain.getHeight(),
        nodeId: this.network.nodeId,
      });
    }, 800);
  }

  /** Broadcast a new block we produced */
  broadcastBlock(block) {
    this.network.broadcast(MSG_TYPES.NEW_BLOCK, {
      block: block.toJSON ? block.toJSON() : block,
    });
  }

  /** Broadcast a new transaction we created */
  broadcastTransaction(tx) {
    this.network.broadcast(MSG_TYPES.NEW_TX, {
      tx: tx.toJSON ? tx.toJSON() : tx,
    });
  }

  /** Re-broadcast a block to all peers except the sender */
  _rebroadcastBlock(block, excludePeerId) {
    const msg = {
      type: MSG_TYPES.NEW_BLOCK,
      payload: { block: block.toJSON ? block.toJSON() : block },
      from: this.network.nodeId,
      timestamp: Date.now(),
    };

    for (const [peerId, peer] of this.network.peers) {
      if (peerId === excludePeerId) continue;
      if (peer.channel && peer.channel.readyState === 'open') {
        try { peer.channel.send(JSON.stringify(msg)); } catch {}
      }
    }
  }

  /** Broadcast full state for sync (posts, follows, saved messages etc.) */
  broadcastState() {
    // Send a slim version without txHistory/processedTxs (too large, per-account)
    const full = this.blockchain.state.toJSON();
    const { txHistory, processedTxs, ...slim } = full;
    this.network.broadcast(MSG_TYPES.STATE_SYNC, { state: slim });
  }

  /** Merge remote state into local state (additive merge). Returns true if changes were made. */
  _mergeState(remoteState) {
    const local = this.blockchain.state;
    let changed = false;

    // Helper: merge Set-valued Maps (additive)
    const mergeSets = (localMap, remoteMap) => {
      if (!remoteMap) return;
      for (const [k, set] of remoteMap) {
        if (!localMap.has(k)) localMap.set(k, new Set());
        const s = localMap.get(k);
        for (const v of set) { if (!s.has(v)) { s.add(v); changed = true; } }
      }
    };

    // Helper: merge array-valued Maps by id (additive, dedup by id)
    const mergeArraysById = (localMap, remoteMap, idField = 'id') => {
      if (!remoteMap) return;
      for (const [k, arr] of remoteMap) {
        if (!localMap.has(k)) { localMap.set(k, [...arr]); changed = true; continue; }
        const existing = localMap.get(k);
        const ids = new Set(existing.map(m => m[idField]));
        for (const item of arr) {
          if (!ids.has(item[idField])) { existing.push(item); changed = true; }
        }
      }
    };

    // 1. Deleted posts first
    if (remoteState.deletedPosts) {
      for (const pid of remoteState.deletedPosts) {
        if (!local.deletedPosts.has(pid)) {
          local.deletedPosts.add(pid);
          if (local.posts.has(pid)) {
            const post = local.posts.get(pid);
            local.posts.delete(pid);
            if (post && local.postsByAuthor.has(post.author)) {
              const arr = local.postsByAuthor.get(post.author);
              const idx = arr.indexOf(pid);
              if (idx >= 0) arr.splice(idx, 1);
            }
            local.likes.delete(pid);
          }
          changed = true;
        }
      }
    }

    // 2. Posts
    if (remoteState.posts) {
      for (const [pid, post] of remoteState.posts) {
        if (local.deletedPosts.has(pid)) continue;
        if (!local.posts.has(pid)) {
          local.posts.set(pid, post);
          const author = post.author;
          if (!local.postsByAuthor.has(author)) local.postsByAuthor.set(author, []);
          if (!local.postsByAuthor.get(author).includes(pid)) local.postsByAuthor.get(author).push(pid);
          changed = true;
        }
      }
    }

    // 3. Follows / Followers
    mergeSets(local.following, remoteState.following);
    mergeSets(local.followers, remoteState.followers);

    // 4. Likes
    mergeSets(local.likes, remoteState.likes);

    // 5. Replies
    mergeArraysById(local.replies, remoteState.replies);

    // 6. Profiles (take remote if we don't have OR if remote has avatar and we don't)
    if (remoteState.profiles) {
      for (const [addr, profile] of remoteState.profiles) {
        const localP = local.profiles.get(addr);
        if (!localP) { local.profiles.set(addr, profile); changed = true; }
        else if (profile.avatar && !localP.avatar) { local.profiles.set(addr, { ...localP, ...profile }); changed = true; }
      }
    }

    // 7. Balances (take higher)
    if (remoteState.balances) {
      for (const [addr, balance] of remoteState.balances) {
        if (balance > local.getBalance(addr)) { local.balances.set(addr, balance); changed = true; }
      }
    }

    // 8. Stakes (take higher stake amount)
    if (remoteState.stakes) {
      for (const [addr, stake] of remoteState.stakes) {
        const localStake = local.getStake(addr);
        if (stake.amount > localStake.amount) {
          local.stakes.set(addr, stake);
          changed = true;
        }
      }
    }

    // 9. Validators (take higher stake / blocksProduced)
    if (remoteState.validators) {
      for (const [addr, info] of remoteState.validators) {
        const localInfo = local.validators.get(addr) || { stake: 0, blocksProduced: 0 };
        if (info.stake > localInfo.stake || info.blocksProduced > localInfo.blocksProduced) {
          local.validators.set(addr, {
            stake: Math.max(info.stake, localInfo.stake),
            blocksProduced: Math.max(info.blocksProduced, localInfo.blocksProduced),
          });
          changed = true;
        }
      }
    }

    // 10. TotalStaked (take higher)
    if (remoteState.totalStaked != null && remoteState.totalStaked > local.totalStaked) {
      local.totalStaked = remoteState.totalStaked;
      changed = true;
    }

    // 11. Proposals (merge missing)
    if (remoteState.proposals) {
      for (const [pid, proposal] of remoteState.proposals) {
        if (!local.proposals.has(pid)) { local.proposals.set(pid, proposal); changed = true; }
        else {
          // Update vote counts if remote has more
          const lp = local.proposals.get(pid);
          if ((proposal.votesFor || 0) > (lp.votesFor || 0) || (proposal.votesAgainst || 0) > (lp.votesAgainst || 0)) {
            local.proposals.set(pid, { ...lp, ...proposal });
            changed = true;
          }
        }
      }
    }

    // 12. Votes
    if (remoteState.votes) {
      for (const [pid, voteData] of remoteState.votes) {
        if (!local.votes.has(pid)) { local.votes.set(pid, voteData); changed = true; }
        else {
          const lv = local.votes.get(pid);
          // Merge for/against vote Maps
          if (voteData.for) {
            if (!lv.for) lv.for = new Map();
            for (const [addr, power] of voteData.for) {
              if (!lv.for.has(addr)) { lv.for.set(addr, power); changed = true; }
            }
          }
          if (voteData.against) {
            if (!lv.against) lv.against = new Map();
            for (const [addr, power] of voteData.against) {
              if (!lv.against.has(addr)) { lv.against.set(addr, power); changed = true; }
            }
          }
        }
      }
    }

    // 13. Saved messages
    mergeArraysById(local.savedMessages, remoteState.savedMessages);

    // 14. Reactions (emoji -> Set)
    if (remoteState.reactions) {
      for (const [pid, emojiMap] of remoteState.reactions) {
        if (!local.reactions.has(pid)) local.reactions.set(pid, new Map());
        const localMap = local.reactions.get(pid);
        for (const [emoji, users] of emojiMap) {
          if (!localMap.has(emoji)) localMap.set(emoji, new Set());
          const s = localMap.get(emoji);
          for (const u of users) { if (!s.has(u)) { s.add(u); changed = true; } }
        }
      }
    }

    // 15. Reputation (take higher score)
    if (remoteState.reputation) {
      for (const [addr, rep] of remoteState.reputation) {
        const localRep = local.getReputation(addr);
        if (rep.score > localRep.score) { local.reputation.set(addr, rep); changed = true; }
      }
    }

    // 16. Profile decorations
    if (remoteState.profileDecor) {
      for (const [addr, decor] of remoteState.profileDecor) {
        if (!local.profileDecor.has(addr)) { local.profileDecor.set(addr, { ...decor }); changed = true; }
        else {
          const ld = local.profileDecor.get(addr);
          if (decor.purchased) {
            for (const item of decor.purchased) {
              if (!ld.purchased.has(item)) { ld.purchased.add(item); changed = true; }
            }
          }
        }
      }
    }

    // 17. Reposts
    mergeSets(local.reposts, remoteState.reposts);

    // 18. Stories
    if (remoteState.stories) {
      for (const [addr, stories] of remoteState.stories) {
        if (!local.stories.has(addr)) {
          local.stories.set(addr, stories.map(s => ({ ...s, views: s.views instanceof Set ? s.views : new Set(s.views || []) })));
          changed = true;
        } else {
          const existing = local.stories.get(addr);
          const ids = new Set(existing.map(s => s.id));
          for (const story of stories) {
            if (!ids.has(story.id)) {
              existing.push({ ...story, views: story.views instanceof Set ? story.views : new Set(story.views || []) });
              changed = true;
            }
          }
        }
      }
    }

    // 19. Direct messages
    mergeArraysById(local.directMessages, remoteState.directMessages);

    // 20. Block height (take higher)
    if (remoteState.blockHeight > local.blockHeight) {
      local.blockHeight = remoteState.blockHeight;
      changed = true;
    }

    return changed;
  }

  /** Re-broadcast a transaction to all peers except sender */
  _rebroadcastTx(tx, excludePeerId) {
    const msg = {
      type: MSG_TYPES.NEW_TX,
      payload: { tx: tx.toJSON ? tx.toJSON() : tx },
      from: this.network.nodeId,
      timestamp: Date.now(),
    };

    for (const [peerId, peer] of this.network.peers) {
      if (peerId === excludePeerId) continue;
      if (peer.channel && peer.channel.readyState === 'open') {
        try { peer.channel.send(JSON.stringify(msg)); } catch {}
      }
    }
  }
}
