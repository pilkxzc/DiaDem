/**
 * DiaDem Transaction System
 * All state changes on the DiaDem blockchain are transactions.
 * Types: transfer, stake, unstake, post, follow, unfollow, like, vote, profile_update
 */

import { sha256, sign, verify } from '../crypto/keys.js';

export const TX_TYPES = {
  TRANSFER: 'transfer',
  STAKE: 'stake',
  UNSTAKE: 'unstake',
  POST: 'post',
  FOLLOW: 'follow',
  UNFOLLOW: 'unfollow',
  LIKE: 'like',
  VOTE: 'vote',
  REPLY: 'reply',
  UNLIKE: 'unlike',
  DELETE_POST: 'delete_post',
  SAVED_MESSAGE: 'saved_message',
  DELETE_SAVED_MESSAGE: 'delete_saved_message',
  DELETE_REPLY: 'delete_reply',
  PROFILE_DECOR: 'profile_decor',
  EQUIP_DECOR: 'equip_decor',
  REACTION: 'reaction',
  PROFILE_UPDATE: 'profile_update',
  REWARD: 'reward', // system-generated staking reward
  REPOST: 'repost',
  DIRECT_MESSAGE: 'direct_message',
  DM_PAYMENT: 'dm_payment',
  STORY: 'story',
};

export class Transaction {
  constructor({ type, from, to, amount, data, timestamp, nonce, publicKey, signature, hash }) {
    this.type = type;
    this.from = from;
    this.to = to || null;
    this.amount = amount || 0;
    this.data = data || {};
    this.timestamp = timestamp || Date.now();
    this.nonce = nonce || 0;
    this.publicKey = publicKey || null;
    this.signature = signature || null;
    this.hash = hash || null;
  }

  /** Get the payload to be signed (everything except signature and hash) */
  getSignPayload() {
    return JSON.stringify({
      type: this.type,
      from: this.from,
      to: this.to,
      amount: this.amount,
      data: this.data,
      timestamp: this.timestamp,
      nonce: this.nonce,
    });
  }

  /** Compute transaction hash */
  async computeHash() {
    return sha256(this.getSignPayload() + (this.signature || ''));
  }

  /** Sign this transaction with a private key */
  async sign(privateKeyJwk, publicKeyHex) {
    this.publicKey = publicKeyHex;
    const payload = this.getSignPayload();
    this.signature = await sign(payload, privateKeyJwk);
    this.hash = await this.computeHash();
    return this;
  }

  /** Verify the transaction signature */
  async verify() {
    if (!this.signature || !this.publicKey) return false;
    // System transactions (rewards) have no signature
    if (this.type === TX_TYPES.REWARD) return true;
    const payload = this.getSignPayload();
    return verify(payload, this.signature, this.publicKey);
  }

  /** Validate transaction structure */
  isValid() {
    if (!this.type || !Object.values(TX_TYPES).includes(this.type)) return false;
    if (!this.from && this.type !== TX_TYPES.REWARD) return false;
    if (this.type === TX_TYPES.TRANSFER && (!this.to || this.amount <= 0)) return false;
    if (this.type === TX_TYPES.STAKE && this.amount <= 0) return false;
    if (this.type === TX_TYPES.POST && (!this.data || !this.data.content)) return false;
    if (this.type === TX_TYPES.REPLY && (!this.data || !this.data.parentId || !this.data.content)) return false;
    if (this.type === TX_TYPES.SAVED_MESSAGE && (!this.data || !this.data.content)) return false;
    return true;
  }

  /** Serialize to plain object */
  toJSON() {
    return {
      type: this.type,
      from: this.from,
      to: this.to,
      amount: this.amount,
      data: this.data,
      timestamp: this.timestamp,
      nonce: this.nonce,
      publicKey: this.publicKey,
      signature: this.signature,
      hash: this.hash,
    };
  }

  /** Deserialize from plain object */
  static fromJSON(obj) {
    return new Transaction(obj);
  }
}

/** Helper to create and sign a transfer transaction */
export async function createTransfer(wallet, to, amount) {
  const tx = new Transaction({
    type: TX_TYPES.TRANSFER,
    from: wallet.address,
    to,
    amount,
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}

/** Helper to create and sign a post transaction */
export async function createPost(wallet, content, media = null) {
  const tx = new Transaction({
    type: TX_TYPES.POST,
    from: wallet.address,
    data: { content, media, id: crypto.randomUUID() },
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}

/** Helper to create and sign a stake transaction */
export async function createStake(wallet, amount, validatorAddress = null) {
  const tx = new Transaction({
    type: TX_TYPES.STAKE,
    from: wallet.address,
    to: validatorAddress,
    amount,
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}

/** Helper to create and sign a follow transaction */
export async function createFollow(wallet, targetAddress) {
  const tx = new Transaction({
    type: TX_TYPES.FOLLOW,
    from: wallet.address,
    to: targetAddress,
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}

/** Helper to create and sign a like transaction */
export async function createLike(wallet, postHash) {
  const tx = new Transaction({
    type: TX_TYPES.LIKE,
    from: wallet.address,
    data: { postHash },
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}

/** Helper to create and sign a profile update */
export async function createProfileUpdate(wallet, profile) {
  const tx = new Transaction({
    type: TX_TYPES.PROFILE_UPDATE,
    from: wallet.address,
    data: { profile },
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}

/** Helper to create a vote transaction */
export async function createVote(wallet, proposalId, vote) {
  const tx = new Transaction({
    type: TX_TYPES.VOTE,
    from: wallet.address,
    data: { proposalId, vote },
    nonce: Date.now(),
  });
  await tx.sign(wallet.privateKey, wallet.publicKey);
  return tx;
}
