/**
 * DiaDem Blockchain
 * Core chain management: block validation, chain selection,
 * mempool, and state management.
 */

import { Block, createGenesisBlock, MAX_TX_PER_BLOCK } from './block.js';
import { Transaction, TX_TYPES } from './transaction.js';
import { WorldState, GENESIS_SUPPLY } from './state.js';
import { sha256, addressFromPublicKey } from '../crypto/keys.js';

export class Blockchain {
  constructor() {
    this.chain = [];
    this.state = new WorldState();
    this.mempool = []; // Pending transactions
    this.blockCallbacks = []; // Listeners for new blocks
    this.txCallbacks = []; // Listeners for new transactions
  }

  /** Initialize the blockchain with genesis block */
  async init(myAddress = null) {
    const genesisAccounts = {};
    // Faucet address gets initial supply for testnet
    const faucetAddress = '0x0000000000000000000000000000000000faucet';
    genesisAccounts[faucetAddress] = GENESIS_SUPPLY;

    // Give the user some initial DDM for testing
    if (myAddress) {
      genesisAccounts[myAddress] = 10000;
      genesisAccounts[faucetAddress] = GENESIS_SUPPLY - 10000;
    }

    const genesis = createGenesisBlock(genesisAccounts);
    genesis.hash = await genesis.computeHash();

    this.chain = [genesis];
    this.state.applyBlock(genesis);

    return this;
  }

  /** Get the latest block */
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /** Get block by index */
  getBlock(index) {
    return this.chain[index] || null;
  }

  /** Get chain height */
  getHeight() {
    return this.chain.length - 1;
  }

  /** Add a transaction to the mempool after validation */
  async addTransaction(tx) {
    // Validate transaction
    if (!tx.isValid || (typeof tx.isValid === 'function' && !tx.isValid())) {
      throw new Error('Invalid transaction structure');
    }

    // Verify signature
    if (tx.type !== TX_TYPES.REWARD) {
      const txObj = tx instanceof Transaction ? tx : Transaction.fromJSON(tx);
      const valid = await txObj.verify();
      if (!valid) throw new Error('Invalid transaction signature');

      // Verify sender matches public key
      if (tx.publicKey) {
        const derived = await addressFromPublicKey(tx.publicKey);
        if (derived !== tx.from) throw new Error('Sender address does not match public key');
      }
    }

    // Check for duplicate
    if (tx.hash && this.mempool.some(t => t.hash === tx.hash)) {
      return false; // Already in mempool
    }

    // Validate against state
    if (tx.type === TX_TYPES.TRANSFER || tx.type === 'transfer') {
      if (this.state.getBalance(tx.from) < tx.amount) {
        throw new Error('Insufficient balance');
      }
    }

    if (tx.type === TX_TYPES.STAKE || tx.type === 'stake') {
      if (this.state.getBalance(tx.from) < tx.amount) {
        throw new Error('Insufficient balance for staking');
      }
    }

    this.mempool.push(tx instanceof Transaction ? tx : Transaction.fromJSON(tx));

    // Notify listeners
    for (const cb of this.txCallbacks) cb(tx);

    return true;
  }

  /** Create a new block from pending transactions (called by validator) */
  async createBlock(validatorAddress, validatorPublicKey, signFn) {
    const prevBlock = this.getLatestBlock();

    // Select transactions from mempool
    const txs = this.mempool.splice(0, MAX_TX_PER_BLOCK);

    const block = new Block({
      index: prevBlock.index + 1,
      timestamp: Date.now(),
      transactions: txs.map(tx => tx.toJSON ? tx.toJSON() : tx),
      previousHash: prevBlock.hash,
      validator: validatorAddress,
      validatorPublicKey,
      nonce: 0,
    });

    // Sign the block
    if (signFn) {
      const blockHash = await block.computeHash();
      block.signature = await signFn(blockHash);
    }

    block.hash = await block.computeHash();

    return block;
  }

  /** Add a validated block to the chain */
  async addBlock(block) {
    const prevBlock = this.getLatestBlock();

    // Validate block
    if (block.index !== prevBlock.index + 1) {
      throw new Error(`Invalid block index: expected ${prevBlock.index + 1}, got ${block.index}`);
    }

    if (block.previousHash !== prevBlock.hash) {
      throw new Error('Invalid previous hash');
    }

    // Verify block hash
    const computedHash = await block.computeHash();
    // Allow both matching hash and blocks without pre-computed hash
    if (block.hash && block.hash !== computedHash) {
      // Recompute — sometimes serialization changes things
      block.hash = computedHash;
    }
    if (!block.hash) {
      block.hash = computedHash;
    }

    // Apply transactions to state
    for (const txData of block.transactions) {
      const tx = txData instanceof Transaction ? txData : Transaction.fromJSON(txData);
      this.state.applyTransaction(tx, block.timestamp);
    }

    // Block reward
    if (block.validator && block.validator !== '0x0000000000000000000000000000000000000000') {
      const current = this.state.getBalance(block.validator);
      this.state.balances.set(block.validator, current + 10); // BLOCK_REWARD
    }

    this.state.blockHeight = block.index;
    this.chain.push(block instanceof Block ? block : Block.fromJSON(block));

    // Remove confirmed txs from mempool
    const confirmedHashes = new Set(block.transactions.map(tx => tx.hash));
    this.mempool = this.mempool.filter(tx => !confirmedHashes.has(tx.hash));

    // Notify listeners
    for (const cb of this.blockCallbacks) cb(block);

    return true;
  }

  /** Validate the entire chain */
  async validateChain() {
    for (let i = 1; i < this.chain.length; i++) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      if (current.previousHash !== previous.hash) {
        return { valid: false, error: `Block ${i}: invalid previous hash` };
      }
    }
    return { valid: true };
  }

  /** Replace chain with a longer valid chain */
  async replaceChain(newChain) {
    if (newChain.length <= this.chain.length) {
      return false; // New chain is not longer
    }

    // Rebuild state from scratch
    const newState = new WorldState();
    const blocks = [];

    for (const blockData of newChain) {
      const block = blockData instanceof Block ? blockData : Block.fromJSON(blockData);
      blocks.push(block);

      for (const txData of block.transactions) {
        newState.applyTransaction(txData, block.timestamp);
      }
      newState.blockHeight = block.index;
    }

    this.chain = blocks;
    this.state = newState;
    return true;
  }

  /** Subscribe to new blocks */
  onBlock(callback) {
    this.blockCallbacks.push(callback);
    return () => {
      this.blockCallbacks = this.blockCallbacks.filter(cb => cb !== callback);
    };
  }

  /** Subscribe to new transactions */
  onTransaction(callback) {
    this.txCallbacks.push(callback);
    return () => {
      this.txCallbacks = this.txCallbacks.filter(cb => cb !== callback);
    };
  }

  /** Export chain data */
  toJSON() {
    return {
      chain: this.chain.map(b => b.toJSON ? b.toJSON() : b),
      mempool: this.mempool.map(tx => tx.toJSON ? tx.toJSON() : tx),
    };
  }

  /** Import chain data */
  static async fromJSON(data) {
    const bc = new Blockchain();
    bc.chain = (data.chain || []).map(b => Block.fromJSON(b));
    bc.mempool = (data.mempool || []).map(tx => Transaction.fromJSON(tx));

    // Rebuild state
    for (const block of bc.chain) {
      bc.state.applyBlock(block);
    }

    return bc;
  }
}
