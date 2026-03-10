/**
 * DiaDem World State
 * Maintains the current state of all accounts, balances, stakes,
 * social data (posts, follows, likes), and governance proposals.
 * State is derived deterministically from the blockchain.
 */

import { TX_TYPES } from './transaction.js';

export const GENESIS_SUPPLY = 100_000_000; // 100M DDM total supply
export const STAKING_APY = 0.142; // 14.2% annual
export const MIN_STAKE = 100; // Minimum stake amount
export const BLOCK_REWARD = 10; // DDM per block for validator

export class WorldState {
  constructor() {
    // Account balances: address -> balance
    this.balances = new Map();
    // Staking: address -> { amount, since, validator }
    this.stakes = new Map();
    // Profiles: address -> { name, handle, bio, avatar, ddmName }
    this.profiles = new Map();
    // Posts: postId -> { author, content, media, timestamp, hash }
    this.posts = new Map();
    // Post index by author: address -> [postId, ...]
    this.postsByAuthor = new Map();
    // Follows: address -> Set of followed addresses
    this.following = new Map();
    // Followers: address -> Set of follower addresses
    this.followers = new Map();
    // Likes: postId -> Set of addresses
    this.likes = new Map();
    // Governance proposals: proposalId -> { ... }
    this.proposals = new Map();
    // Votes: proposalId -> { for: Map(addr->power), against: Map(addr->power) }
    this.votes = new Map();
    // Transaction history: address -> [tx, ...]
    this.txHistory = new Map();
    // Validators: address -> { stake, blocks_produced }
    this.validators = new Map();
    // Total staked across all accounts
    this.totalStaked = 0;
    // Current block height
    this.blockHeight = 0;
    // Processed transaction hashes (to prevent replay)
    this.processedTxs = new Set();
  }

  /** Get balance for an address */
  getBalance(address) {
    return this.balances.get(address) || 0;
  }

  /** Get stake info for an address */
  getStake(address) {
    return this.stakes.get(address) || { amount: 0, since: 0, validator: null };
  }

  /** Get profile for an address */
  getProfile(address) {
    return this.profiles.get(address) || null;
  }

  /** Apply a block's transactions to the state */
  applyBlock(block) {
    for (const tx of block.transactions) {
      this.applyTransaction(tx, block.timestamp);
    }

    // Block reward to validator
    if (block.validator && block.validator !== '0x0000000000000000000000000000000000000000') {
      const current = this.getBalance(block.validator);
      this.balances.set(block.validator, current + BLOCK_REWARD);
    }

    this.blockHeight = block.index;
  }

  /** Apply a single transaction to the state */
  applyTransaction(tx, blockTimestamp) {
    // Prevent replay
    if (tx.hash && this.processedTxs.has(tx.hash)) return false;
    if (tx.hash) this.processedTxs.add(tx.hash);

    switch (tx.type) {
      case TX_TYPES.TRANSFER:
      case 'transfer':
        return this._applyTransfer(tx);
      case TX_TYPES.STAKE:
      case 'stake':
        return this._applyStake(tx, blockTimestamp);
      case TX_TYPES.UNSTAKE:
      case 'unstake':
        return this._applyUnstake(tx);
      case TX_TYPES.POST:
      case 'post':
        return this._applyPost(tx);
      case TX_TYPES.FOLLOW:
      case 'follow':
        return this._applyFollow(tx);
      case TX_TYPES.UNFOLLOW:
      case 'unfollow':
        return this._applyUnfollow(tx);
      case TX_TYPES.LIKE:
      case 'like':
        return this._applyLike(tx);
      case TX_TYPES.VOTE:
      case 'vote':
        return this._applyVote(tx);
      case TX_TYPES.PROFILE_UPDATE:
      case 'profile_update':
        return this._applyProfileUpdate(tx);
      case TX_TYPES.REWARD:
      case 'reward':
        return this._applyReward(tx);
      default:
        return false;
    }
  }

  _applyTransfer(tx) {
    const fromBal = this.getBalance(tx.from);
    if (fromBal < tx.amount) return false;
    this.balances.set(tx.from, fromBal - tx.amount);
    this.balances.set(tx.to, this.getBalance(tx.to) + tx.amount);
    this._recordTx(tx.from, tx);
    this._recordTx(tx.to, tx);
    return true;
  }

  _applyStake(tx, timestamp) {
    const fromBal = this.getBalance(tx.from);
    if (fromBal < tx.amount || tx.amount < MIN_STAKE) return false;
    this.balances.set(tx.from, fromBal - tx.amount);
    const existing = this.getStake(tx.from);
    this.stakes.set(tx.from, {
      amount: existing.amount + tx.amount,
      since: timestamp || Date.now(),
      validator: tx.to || tx.from,
    });
    this.totalStaked += tx.amount;
    // Register as validator
    const valInfo = this.validators.get(tx.to || tx.from) || { stake: 0, blocksProduced: 0 };
    valInfo.stake += tx.amount;
    this.validators.set(tx.to || tx.from, valInfo);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyUnstake(tx) {
    const stake = this.getStake(tx.from);
    const amount = tx.amount || stake.amount;
    if (stake.amount < amount) return false;
    this.stakes.set(tx.from, {
      ...stake,
      amount: stake.amount - amount,
    });
    this.balances.set(tx.from, this.getBalance(tx.from) + amount);
    this.totalStaked -= amount;
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyPost(tx) {
    const postId = tx.data.id || tx.hash;
    this.posts.set(postId, {
      id: postId,
      author: tx.from,
      content: tx.data.content,
      media: tx.data.media || null,
      timestamp: tx.timestamp,
      hash: tx.hash,
    });
    if (!this.postsByAuthor.has(tx.from)) {
      this.postsByAuthor.set(tx.from, []);
    }
    this.postsByAuthor.get(tx.from).push(postId);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyFollow(tx) {
    if (!this.following.has(tx.from)) this.following.set(tx.from, new Set());
    if (!this.followers.has(tx.to)) this.followers.set(tx.to, new Set());
    this.following.get(tx.from).add(tx.to);
    this.followers.get(tx.to).add(tx.from);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyUnfollow(tx) {
    if (this.following.has(tx.from)) this.following.get(tx.from).delete(tx.to);
    if (this.followers.has(tx.to)) this.followers.get(tx.to).delete(tx.from);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyLike(tx) {
    const postHash = tx.data.postHash;
    if (!this.likes.has(postHash)) this.likes.set(postHash, new Set());
    this.likes.get(postHash).add(tx.from);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyVote(tx) {
    const { proposalId, vote } = tx.data;
    if (!this.votes.has(proposalId)) {
      this.votes.set(proposalId, { for: new Map(), against: new Map() });
    }
    const votePower = this.getStake(tx.from).amount || this.getBalance(tx.from);
    const voteData = this.votes.get(proposalId);
    if (vote === 'for') {
      voteData.for.set(tx.from, votePower);
      voteData.against.delete(tx.from);
    } else {
      voteData.against.set(tx.from, votePower);
      voteData.for.delete(tx.from);
    }
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyProfileUpdate(tx) {
    const existing = this.profiles.get(tx.from) || {};
    this.profiles.set(tx.from, { ...existing, ...tx.data.profile });
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyReward(tx) {
    const to = tx.to;
    this.balances.set(to, this.getBalance(to) + tx.amount);
    this._recordTx(to, tx);
    return true;
  }

  _recordTx(address, tx) {
    if (!this.txHistory.has(address)) this.txHistory.set(address, []);
    this.txHistory.get(address).push(tx.hash || tx);
  }

  /** Get the feed for an address (posts from followed accounts + own) */
  getFeed(address, limit = 50) {
    const followedSet = this.following.get(address) || new Set();
    const authors = [address, ...followedSet];

    const posts = [];
    for (const author of authors) {
      const authorPosts = this.postsByAuthor.get(author) || [];
      for (const pid of authorPosts) {
        const post = this.posts.get(pid);
        if (post) {
          posts.push({
            ...post,
            profile: this.getProfile(post.author),
            likesCount: (this.likes.get(pid) || new Set()).size,
            liked: (this.likes.get(pid) || new Set()).has(address),
          });
        }
      }
    }

    // Sort by timestamp descending
    posts.sort((a, b) => b.timestamp - a.timestamp);
    return posts.slice(0, limit);
  }

  /** Get all posts (explore) */
  getAllPosts(limit = 100) {
    const posts = [];
    for (const [pid, post] of this.posts) {
      posts.push({
        ...post,
        profile: this.getProfile(post.author),
        likesCount: (this.likes.get(pid) || new Set()).size,
      });
    }
    posts.sort((a, b) => b.timestamp - a.timestamp);
    return posts.slice(0, limit);
  }

  /** Get transaction history for an address */
  getTransactions(address, limit = 50) {
    return (this.txHistory.get(address) || []).slice(-limit).reverse();
  }

  /** Get all validators sorted by stake */
  getValidators() {
    const vals = [];
    for (const [addr, info] of this.validators) {
      if (info.stake > 0) {
        vals.push({
          address: addr,
          stake: info.stake,
          blocksProduced: info.blocksProduced,
          profile: this.getProfile(addr),
        });
      }
    }
    vals.sort((a, b) => b.stake - a.stake);
    return vals;
  }

  /** Export state snapshot */
  toJSON() {
    return {
      balances: Object.fromEntries(this.balances),
      stakes: Object.fromEntries(
        Array.from(this.stakes).map(([k, v]) => [k, v])
      ),
      profiles: Object.fromEntries(this.profiles),
      posts: Object.fromEntries(this.posts),
      postsByAuthor: Object.fromEntries(
        Array.from(this.postsByAuthor).map(([k, v]) => [k, [...v]])
      ),
      following: Object.fromEntries(
        Array.from(this.following).map(([k, v]) => [k, [...v]])
      ),
      followers: Object.fromEntries(
        Array.from(this.followers).map(([k, v]) => [k, [...v]])
      ),
      likes: Object.fromEntries(
        Array.from(this.likes).map(([k, v]) => [k, [...v]])
      ),
      totalStaked: this.totalStaked,
      blockHeight: this.blockHeight,
    };
  }

  /** Restore state from snapshot */
  static fromJSON(data) {
    const state = new WorldState();
    if (data.balances) {
      state.balances = new Map(Object.entries(data.balances));
    }
    if (data.stakes) {
      state.stakes = new Map(Object.entries(data.stakes));
    }
    if (data.profiles) {
      state.profiles = new Map(Object.entries(data.profiles));
    }
    if (data.posts) {
      state.posts = new Map(Object.entries(data.posts));
    }
    if (data.postsByAuthor) {
      state.postsByAuthor = new Map(
        Object.entries(data.postsByAuthor).map(([k, v]) => [k, v])
      );
    }
    if (data.following) {
      state.following = new Map(
        Object.entries(data.following).map(([k, v]) => [k, new Set(v)])
      );
    }
    if (data.followers) {
      state.followers = new Map(
        Object.entries(data.followers).map(([k, v]) => [k, new Set(v)])
      );
    }
    if (data.likes) {
      state.likes = new Map(
        Object.entries(data.likes).map(([k, v]) => [k, new Set(v)])
      );
    }
    state.totalStaked = data.totalStaked || 0;
    state.blockHeight = data.blockHeight || 0;
    return state;
  }
}
