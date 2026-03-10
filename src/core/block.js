/**
 * DiaDem Block
 * Each block contains a set of validated transactions, a reference to the
 * previous block, and is signed by the block validator (Proof of Stake).
 */

import { sha256 } from '../crypto/keys.js';

export const BLOCK_TIME = 10000; // Target: 10 seconds per block
export const MAX_TX_PER_BLOCK = 100;

export class Block {
  constructor({
    index,
    timestamp,
    transactions,
    previousHash,
    validator,
    validatorPublicKey,
    signature,
    hash,
    stateRoot,
    nonce
  }) {
    this.index = index;
    this.timestamp = timestamp || Date.now();
    this.transactions = transactions || [];
    this.previousHash = previousHash || '0'.repeat(64);
    this.validator = validator || null;
    this.validatorPublicKey = validatorPublicKey || null;
    this.signature = signature || null;
    this.hash = hash || null;
    this.stateRoot = stateRoot || null;
    this.nonce = nonce || 0;
  }

  /** Compute block hash from header data */
  async computeHash() {
    const header = JSON.stringify({
      index: this.index,
      timestamp: this.timestamp,
      txHashes: this.transactions.map(tx => tx.hash || JSON.stringify(tx)),
      previousHash: this.previousHash,
      validator: this.validator,
      stateRoot: this.stateRoot,
      nonce: this.nonce,
    });
    return sha256(header);
  }

  /** Compute the merkle root of transactions */
  async computeStateRoot(state) {
    const stateStr = JSON.stringify(state);
    return sha256(stateStr);
  }

  /** Serialize to plain object */
  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map(tx => tx.toJSON ? tx.toJSON() : tx),
      previousHash: this.previousHash,
      validator: this.validator,
      validatorPublicKey: this.validatorPublicKey,
      signature: this.signature,
      hash: this.hash,
      stateRoot: this.stateRoot,
      nonce: this.nonce,
    };
  }

  static fromJSON(obj) {
    // Import Transaction lazily to avoid circular deps
    return new Block({
      ...obj,
      transactions: obj.transactions || [],
    });
  }
}

/** Create the genesis block with initial DDM distribution */
export function createGenesisBlock(initialAccounts = {}) {
  const genesisTxs = Object.entries(initialAccounts).map(([address, amount]) => ({
    type: 'reward',
    from: '0x0000000000000000000000000000000000000000',
    to: address,
    amount,
    data: { reason: 'genesis' },
    timestamp: 0,
    nonce: 0,
    hash: null,
    signature: null,
    publicKey: null,
  }));

  const block = new Block({
    index: 0,
    timestamp: 1709251200000, // Fixed genesis timestamp
    transactions: genesisTxs,
    previousHash: '0'.repeat(64),
    validator: '0x0000000000000000000000000000000000000000',
    nonce: 0,
  });

  return block;
}
