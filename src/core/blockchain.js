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
    this.processedTxHashes = new Set(); // Track processed tx hashes to prevent double application
  }

  /** Initialize the blockchain with genesis block */
  async init(myAddress = null) {
    // Genesis is ALWAYS the same for all nodes — this is critical for chain sync!
    const faucetAddress = '0x0000000000000000000000000000000000faucet';
    const genesisAccounts = { [faucetAddress]: GENESIS_SUPPLY };

    const genesis = createGenesisBlock(genesisAccounts);
    genesis.hash = await genesis.computeHash();

    this.chain = [genesis];
    this.state.applyBlock(genesis);

    // Track who needs a faucet grant
    this._pendingFaucetGrant = myAddress;

    return this;
  }

  /** Claim initial DDM from faucet (called once per wallet, ever) */
  async claimFaucet(wallet) {
    const faucetAddress = '0x0000000000000000000000000000000000faucet';
    if (!this.state.faucetClaims) this.state.faucetClaims = new Set();

    // Already claimed — never give twice, even if balance is 0 (user spent it)
    if (this.state.faucetClaims.has(wallet.address)) return;

    // Already has balance — another session or state sync already gave funds
    if (this.state.getBalance(wallet.address) > 0) {
      // Mark as claimed so we don't re-check
      this.state.faucetClaims.add(wallet.address);
      return;
    }

    const { Transaction, TX_TYPES } = await import('./transaction.js');
    // Deterministic hash based on address — ensures same tx hash across devices
    // This prevents double-application via processedTxHashes dedup
    const tx = new Transaction({
      type: TX_TYPES.REWARD,
      from: faucetAddress,
      to: wallet.address,
      amount: 10000,
      data: { reason: 'faucet_claim' },
      nonce: 0, // deterministic nonce for faucet
      timestamp: 0, // deterministic timestamp for faucet
    });
    tx.hash = await tx.computeHash();

    // Check if this exact tx was already processed (cross-device dedup)
    if (this.processedTxHashes.has(tx.hash)) {
      this.state.faucetClaims.add(wallet.address);
      return;
    }

    // Track the claim
    this.state.faucetClaims.add(wallet.address);

    // Apply directly to state (bypass addTransaction's REWARD rejection)
    this.state.applyTransaction(tx, Date.now());
    if (tx.hash) this.processedTxHashes.add(tx.hash);
    this.mempool.push(tx);
    for (const cb of this.txCallbacks) cb(tx);

    return tx;
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

    // Reject REWARD transactions from the network — they are system-only
    // (faucet claims go through claimFaucet(), block rewards through applyBlock())
    if (tx.type === TX_TYPES.REWARD || tx.type === 'reward') {
      throw new Error('REWARD transactions cannot be submitted directly');
    }

    // Verify signature
    const txObj = tx instanceof Transaction ? tx : Transaction.fromJSON(tx);
    const valid = await txObj.verify();
    if (!valid) throw new Error('Invalid transaction signature');

    // Verify sender matches public key
    if (tx.publicKey) {
      const derived = await addressFromPublicKey(tx.publicKey);
      if (derived !== tx.from) throw new Error('Sender address does not match public key');
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

    // Check balance for post fee
    if (tx.type === TX_TYPES.POST || tx.type === 'post') {
      const { POST_FEE } = await import('./state.js');
      if (this.state.getBalance(tx.from) < POST_FEE) {
        throw new Error('Insufficient balance to create post (need 1 DDM)');
      }
    }

    this.mempool.push(txObj);

    // Apply transaction to state immediately for instant UI feedback
    // (will be re-validated when included in a block)
    this.state.applyTransaction(txObj, Date.now());
    // Keep processedTxHashes in sync with state.processedTxs
    if (txObj.hash) this.processedTxHashes.add(txObj.hash);

    // Notify listeners
    for (const cb of this.txCallbacks) cb(txObj);

    return true;
  }

  /** Create a new block from pending transactions (called by validator) */
  async createBlock(validatorAddress, validatorPublicKey, signFn) {
    const prevBlock = this.getLatestBlock();

    // Select transactions from mempool (don't remove yet — remove after block is confirmed)
    const txs = this.mempool.slice(0, MAX_TX_PER_BLOCK);

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
    if (!block.hash) {
      block.hash = computedHash;
    } else if (block.hash !== computedHash) {
      throw new Error(`Block hash mismatch: expected ${computedHash.slice(0, 16)}, got ${block.hash.slice(0, 16)}`);
    }

    // Timestamp validation: block must not be more than 60s in the future
    if (block.timestamp > Date.now() + 60000) {
      throw new Error('Block timestamp is too far in the future');
    }
    // Block timestamp must not be before the previous block's timestamp
    if (block.timestamp < prevBlock.timestamp) {
      throw new Error('Block timestamp is before previous block timestamp');
    }

    // Apply transactions to state (skip already-processed ones)
    for (const txData of block.transactions) {
      const tx = txData instanceof Transaction ? txData : Transaction.fromJSON(txData);
      if (tx.hash && this.processedTxHashes.has(tx.hash)) continue;
      this.state.applyTransaction(tx, block.timestamp);
      if (tx.hash) this.processedTxHashes.add(tx.hash);
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

    // Prune processedTxHashes to prevent unbounded memory growth
    // Keep only hashes from the last 1000 blocks
    const MAX_TRACKED_HASHES = 50000;
    if (this.processedTxHashes.size > MAX_TRACKED_HASHES) {
      const arr = [...this.processedTxHashes];
      this.processedTxHashes = new Set(arr.slice(arr.length - MAX_TRACKED_HASHES));
    }
    if (this.state.processedTxs.size > MAX_TRACKED_HASHES) {
      const arr = [...this.state.processedTxs];
      this.state.processedTxs = new Set(arr.slice(arr.length - MAX_TRACKED_HASHES));
    }

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

  /** Replace chain with a longer valid chain (fork resolution) */
  async replaceChain(newChain) {
    if (newChain.length <= this.chain.length) {
      return false; // New chain is not longer
    }

    // Validate chain continuity
    const blocks = [];
    for (const blockData of newChain) {
      const block = blockData instanceof Block ? blockData : Block.fromJSON(blockData);
      blocks.push(block);
    }

    // Long-range attack prevention: reject chains that diverge more than 100 blocks
    // from our current chain (unless we're bootstrapping with < 10 blocks)
    if (this.chain.length > 10) {
      const maxDivergence = 100;
      let commonAncestor = -1;
      const checkLimit = Math.min(this.chain.length, blocks.length);
      for (let i = 0; i < checkLimit; i++) {
        if (this.chain[i].hash === blocks[i].hash) {
          commonAncestor = i;
        } else {
          break;
        }
      }
      const divergence = this.chain.length - (commonAncestor + 1);
      if (divergence > maxDivergence) {
        console.warn(`[Blockchain] replaceChain: rejected — diverges ${divergence} blocks (max ${maxDivergence})`);
        return false;
      }
    }

    for (let i = 1; i < blocks.length; i++) {
      if (blocks[i].previousHash !== blocks[i - 1].hash) {
        console.warn(`[Blockchain] replaceChain: invalid link at block ${i}`);
        return false;
      }

      // Validate block timestamps (no future blocks, no extreme time jumps)
      if (blocks[i].timestamp > Date.now() + 60000) {
        console.warn(`[Blockchain] replaceChain: block ${i} has future timestamp`);
        return false;
      }
    }

    // Rebuild state from scratch
    const newState = new WorldState();
    // Preserve non-chain data (DMs, saved messages) from current state
    const oldDMs = this.state.directMessages;
    const oldSaved = this.state.savedMessages;

    for (const block of blocks) {
      for (const txData of block.transactions) {
        const tx = txData instanceof Transaction ? txData : Transaction.fromJSON(txData);
        newState.applyTransaction(tx, block.timestamp);
      }
      // Apply block reward
      if (block.validator && block.validator !== '0x0000000000000000000000000000000000000000') {
        const current = newState.getBalance(block.validator);
        newState.balances.set(block.validator, current + 10);
      }
      newState.blockHeight = block.index;
    }

    // Restore non-chain data
    for (const [k, v] of oldDMs) {
      if (!newState.directMessages.has(k)) newState.directMessages.set(k, v);
      else {
        const existing = newState.directMessages.get(k);
        for (const msg of v) {
          if (!existing.some(m => m.id === msg.id)) existing.push(msg);
        }
      }
    }
    for (const [k, v] of oldSaved) {
      if (!newState.savedMessages.has(k)) newState.savedMessages.set(k, v);
    }

    this.chain = blocks;
    this.state = newState;
    // Rebuild processedTxHashes to match new chain
    this.processedTxHashes = new Set();
    for (const block of blocks) {
      for (const txData of block.transactions) {
        const tx = txData instanceof Transaction ? txData : Transaction.fromJSON(txData);
        if (tx.hash) this.processedTxHashes.add(tx.hash);
      }
    }
    // Clear mempool — txs may already be in the new chain
    this.mempool = [];

    console.log(`[Blockchain] Chain replaced, new height: ${this.getHeight()}`);
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

    // Rebuild state and processedTxHashes
    for (const block of bc.chain) {
      bc.state.applyBlock(block);
      for (const txData of block.transactions) {
        const tx = txData instanceof Transaction ? txData : Transaction.fromJSON(txData);
        if (tx.hash) bc.processedTxHashes.add(tx.hash);
      }
    }

    return bc;
  }
}
