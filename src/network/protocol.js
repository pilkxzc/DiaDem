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

    this._setupHandlers();
  }

  _setupHandlers() {
    // When a peer says hello, sync chains
    this.network.on(MSG_TYPES.HELLO, (peerId, payload) => {
      console.log(`[Protocol] Hello from ${peerId}, height: ${payload.height}`);
      // If their chain is longer, request blocks
      if (payload.height > this.blockchain.getHeight()) {
        this.network.send(peerId, MSG_TYPES.SYNC_REQUEST, {
          fromIndex: this.blockchain.getHeight() + 1,
        });
      }
    });

    // Respond to sync requests
    this.network.on(MSG_TYPES.SYNC_REQUEST, (peerId, payload) => {
      const fromIndex = payload.fromIndex || 0;
      const blocks = [];
      for (let i = fromIndex; i < this.blockchain.chain.length; i++) {
        const block = this.blockchain.chain[i];
        blocks.push(block.toJSON ? block.toJSON() : block);
      }
      this.network.send(peerId, MSG_TYPES.SYNC_RESPONSE, { blocks });
    });

    // Handle sync response
    this.network.on(MSG_TYPES.SYNC_RESPONSE, async (peerId, payload) => {
      const blocks = payload.blocks || [];
      console.log(`[Protocol] Received ${blocks.length} blocks from ${peerId}`);

      for (const blockData of blocks) {
        try {
          const block = Block.fromJSON(blockData);
          if (block.index === this.blockchain.getHeight() + 1) {
            await this.blockchain.addBlock(block);
          }
        } catch (err) {
          console.warn(`[Protocol] Failed to add synced block:`, err.message);
          break;
        }
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

    // When a peer connects, say hello
    this.network.onPeerConnect = (peerId) => {
      this.network.send(peerId, MSG_TYPES.HELLO, {
        height: this.blockchain.getHeight(),
        nodeId: this.network.nodeId,
      });
    };
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
