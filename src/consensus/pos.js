/**
 * DiaDem Proof of Stake Consensus
 * Validators are selected based on their stake weight.
 * Higher stake = higher probability of being selected to produce the next block.
 */

import { sha256 } from '../crypto/keys.js';

export const BLOCK_INTERVAL = 10000; // 10 seconds
export const MIN_VALIDATOR_STAKE = 100; // Minimum DDM to be a validator

export class ProofOfStake {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.isProducing = false;
    this.timer = null;
  }

  /**
   * Select a validator for the next block based on stake-weighted random selection.
   * Uses the previous block hash as seed for deterministic selection.
   */
  async selectValidator(previousHash, validators) {
    if (validators.length === 0) return null;

    const totalStake = validators.reduce((sum, v) => sum + v.stake, 0);
    if (totalStake === 0) return null;

    // Deterministic random based on previous block hash
    const seed = await sha256(previousHash + this.blockchain.getHeight());
    const seedNum = parseInt(seed.slice(0, 8), 16);
    let target = seedNum % totalStake;

    for (const validator of validators) {
      target -= validator.stake;
      if (target < 0) {
        return validator;
      }
    }

    return validators[0]; // Fallback
  }

  /**
   * Start block production if this node is a validator.
   * @param {string} address - This node's validator address
   * @param {string} publicKey - Validator's public key hex
   * @param {Function} signFn - Function to sign data with validator's private key
   */
  startProduction(address, publicKey, signFn) {
    if (this.isProducing) return;
    this.isProducing = true;

    const produce = async () => {
      if (!this.isProducing) return;

      try {
        const validators = this.blockchain.state.getValidators();
        const latestBlock = this.blockchain.getLatestBlock();
        const selected = await this.selectValidator(latestBlock.hash, validators);

        // Check if we are the selected validator OR there are no validators yet
        const isOurTurn = !selected || selected.address === address;
        const hasPendingTxs = this.blockchain.mempool.length > 0;

        if (isOurTurn && hasPendingTxs) {
          const block = await this.blockchain.createBlock(address, publicKey, signFn);
          await this.blockchain.addBlock(block);
          console.log(`[PoS] Block #${block.index} produced with ${block.transactions.length} txs`);
        }
      } catch (err) {
        console.error('[PoS] Block production error:', err);
      }

      this.timer = setTimeout(produce, BLOCK_INTERVAL);
    };

    this.timer = setTimeout(produce, BLOCK_INTERVAL);
    console.log(`[PoS] Block production started for ${address}`);
  }

  /** Stop block production */
  stopProduction() {
    this.isProducing = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Calculate estimated rewards for a given stake amount
   * @param {number} stakeAmount - Amount staked
   * @param {number} days - Duration in days
   * @returns {number} Estimated rewards
   */
  calculateRewards(stakeAmount, days = 365) {
    const annualRate = 0.142; // 14.2% APY
    const dailyRate = annualRate / 365;
    // Compound daily
    const total = stakeAmount * Math.pow(1 + dailyRate, days);
    return total - stakeAmount;
  }
}
