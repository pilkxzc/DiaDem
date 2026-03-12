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

// ─── Fee & Reward Constants ─────────────────────────────
export const POST_FEE = 1; // 1 DDM to create a post
export const LIKE_REWARD = 0.1; // 0.1 DDM reward to post author per like
export const FOLLOW_FEE = 0; // Free to follow
export const PROFILE_UPDATE_FEE = 0.5; // 0.5 DDM to update profile

// ─── Canonical Decoration Prices (server-side validation) ──
// These MUST match the prices in SHOP_ITEMS (ui/app.js).
// Client-supplied prices are NEVER trusted.
export const DECOR_PRICES = {
  'frame-gold': 50, 'frame-diamond': 150, 'frame-fire': 100, 'frame-neon': 80,
  'frame-rainbow': 120, 'frame-ice': 70, 'frame-plasma': 130, 'frame-matrix': 90,
  'frame-shadow': 60, 'frame-sakura': 85, 'frame-lava': 110, 'frame-emerald': 95,
  'banner-galaxy': 75, 'banner-sunset': 40, 'banner-ocean': 40, 'banner-forest': 60,
  'banner-aurora': 100, 'banner-cyberpunk': 90, 'banner-retrowave': 85, 'banner-volcano': 70,
  'banner-arctic': 55, 'banner-nebula': 110, 'banner-midnight': 45, 'banner-cherry': 55,
  'banner-matrix': 80, 'banner-gold': 120,
  'badge-verified': 200, 'badge-star': 100, 'badge-crown': 300, 'badge-bolt': 75,
  'badge-gem': 250, 'badge-shield': 150, 'badge-flame': 80, 'badge-heart': 60,
  'badge-globe': 120, 'badge-code': 180, 'badge-palette': 160, 'badge-music': 140,
  'badge-camera': 130, 'badge-rocket': 200, 'badge-trophy': 350, 'badge-eye': 175,
  'badge-infinity': 500,
  'anim-glow': 60, 'anim-sparkle': 90, 'anim-gradient-name': 80, 'anim-pulse': 70,
  'anim-float': 85, 'anim-glitch': 120, 'anim-typing': 55, 'anim-rainbow-border': 150,
  'bio-italic': 20, 'bio-glow': 45, 'bio-mono': 25, 'bio-bold': 15, 'bio-gradient': 65,
  'name-red': 30, 'name-purple': 30, 'name-gold': 50, 'name-cyan': 30,
  'name-gradient': 100, 'name-emerald': 35, 'name-rose': 35, 'name-amber': 35,
  'name-ice': 40, 'name-fire-gradient': 120, 'name-ocean-gradient': 110, 'name-rainbow': 200,
  'title-creator': 50, 'title-developer': 50, 'title-artist': 50, 'title-musician': 50,
  'title-trader': 50, 'title-gamer': 50, 'title-influencer': 75, 'title-whale': 100,
  'title-og': 150, 'title-degen': 40, 'title-hodler': 60, 'title-builder': 75,
  'title-validator': 100, 'title-legend': 500,
  'poststyle-glow': 80, 'poststyle-border': 40, 'poststyle-dark': 35,
  'poststyle-gradient-bg': 70, 'poststyle-neon-border': 95, 'poststyle-gold-border': 110,
  'font-playfair': 30, 'font-oswald': 25, 'font-lobster': 35, 'font-pacifico': 35,
  'font-dancing': 30, 'font-righteous': 30, 'font-bebas': 25, 'font-permanent': 40,
  'font-caveat': 25, 'font-monoton': 50, 'font-orbitron': 40, 'font-press-start': 45,
  'font-cinzel': 35, 'font-comfortaa': 25, 'font-abril': 35, 'font-russo': 30,
  'font-sacramento': 30, 'font-quicksand': 20, 'font-audiowide': 35, 'font-bangers': 30,
  'font-creepster': 40, 'font-fredoka': 25, 'font-satisfy': 30, 'font-special-elite': 35,
};

// ─── Reputation Constants ───────────────────────────────
export const REP_POST = 1; // +1 rep for posting
export const REP_LIKE_RECEIVED = 2; // +2 rep when your post gets liked
export const REP_LIKE_GIVEN = 0.5; // +0.5 rep for liking someone else's post
export const REP_FOLLOW_RECEIVED = 3; // +3 rep when someone follows you
export const REP_FOLLOW_GIVEN = 0.5; // +0.5 rep for following
export const REP_STAKE = 5; // +5 rep for staking

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
    // Replies: postId -> [{ id, author, content, timestamp }, ...]
    this.replies = new Map();
    // Saved messages (like Telegram "Saved"): address -> [{ id, content, timestamp }, ...]
    this.savedMessages = new Map();
    // Reactions: postId -> Map(emoji -> Set(address))
    this.reactions = new Map();
    // Reputation: address -> { score, posts, likesReceived, likesGiven, followersGained, level }
    this.reputation = new Map();
    // Total staked across all accounts
    this.totalStaked = 0;
    // Current block height
    this.blockHeight = 0;
    // Processed transaction hashes (to prevent replay)
    this.processedTxs = new Set();
    // Deleted post IDs (to prevent re-adding via merge)
    this.deletedPosts = new Set();
    // Profile decorations: address -> { theme, badge, frame, banner, animation, bio_style, purchased: Set }
    this.profileDecor = new Map();
    // Reposts: postId -> Set of addresses who reposted
    this.reposts = new Map();
    // Direct messages: chatKey -> [{ id, from, to, content, image, payment, timestamp }]
    this.directMessages = new Map();
    // Stories: address -> [{ id, author, image, text, textStyle, timestamp, views: Set }]
    this.stories = new Map();
    // Faucet claims: Set of addresses that have claimed faucet (prevents re-claiming after spending)
    this.faucetClaims = new Set();
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

  /** Get reputation for an address */
  getReputation(address) {
    return this.reputation.get(address) || { score: 0, posts: 0, likesReceived: 0, likesGiven: 0, followersGained: 0, level: 'Newcomer' };
  }

  /** Add reputation points */
  _addReputation(address, points, field) {
    const rep = this.getReputation(address);
    rep.score = Math.max(0, rep.score + points);
    if (field) rep[field] = (rep[field] || 0) + 1;
    // Calculate level
    const s = rep.score;
    if (s >= 1000000) rep.level = 'Immortal';
    else if (s >= 750000) rep.level = 'Transcendent';
    else if (s >= 500000) rep.level = 'Mythic';
    else if (s >= 300000) rep.level = 'Celestial';
    else if (s >= 200000) rep.level = 'Sovereign';
    else if (s >= 150000) rep.level = 'Overlord';
    else if (s >= 100000) rep.level = 'Titan';
    else if (s >= 70000) rep.level = 'Legend';
    else if (s >= 50000) rep.level = 'Grandmaster';
    else if (s >= 30000) rep.level = 'Master';
    else if (s >= 20000) rep.level = 'Diamond';
    else if (s >= 10000) rep.level = 'Platinum';
    else if (s >= 5000) rep.level = 'Gold';
    else if (s >= 2000) rep.level = 'Silver';
    else if (s >= 1000) rep.level = 'Bronze';
    else if (s >= 500) rep.level = 'Expert';
    else if (s >= 200) rep.level = 'Veteran';
    else if (s >= 100) rep.level = 'Active';
    else if (s >= 30) rep.level = 'Member';
    else if (s >= 5) rep.level = 'Beginner';
    else rep.level = 'Newcomer';
    this.reputation.set(address, rep);
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
      case TX_TYPES.REPLY:
      case 'reply':
        return this._applyReply(tx);
      case TX_TYPES.UNLIKE:
      case 'unlike':
        return this._applyUnlike(tx);
      case TX_TYPES.DELETE_POST:
      case 'delete_post':
        return this._applyDeletePost(tx);
      case TX_TYPES.DELETE_REPLY:
      case 'delete_reply':
        return this._applyDeleteReply(tx);
      case TX_TYPES.PROFILE_DECOR:
      case 'profile_decor':
        return this._applyProfileDecor(tx);
      case TX_TYPES.EQUIP_DECOR:
      case 'equip_decor':
        return this._applyEquipDecor(tx);
      case TX_TYPES.REACTION:
      case 'reaction':
        return this._applyReaction(tx);
      case TX_TYPES.SAVED_MESSAGE:
      case 'saved_message':
        return this._applySavedMessage(tx);
      case TX_TYPES.DELETE_SAVED_MESSAGE:
      case 'delete_saved_message':
        return this._applyDeleteSavedMessage(tx);
      case TX_TYPES.VOTE:
      case 'vote':
        return this._applyVote(tx);
      case TX_TYPES.PROFILE_UPDATE:
      case 'profile_update':
        return this._applyProfileUpdate(tx);
      case TX_TYPES.REPOST:
      case 'repost':
        return this._applyRepost(tx);
      case TX_TYPES.STORY:
      case 'story':
        return this._applyStory(tx);
      case TX_TYPES.DELETE_STORY:
      case 'delete_story':
        return this._applyDeleteStory(tx);
      case TX_TYPES.DIRECT_MESSAGE:
      case 'direct_message':
        return this._applyDirectMessage(tx);
      case TX_TYPES.DM_PAYMENT:
      case 'dm_payment':
        return this._applyDmPayment(tx);
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
    this._addReputation(tx.from, REP_STAKE, null);
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
    // Charge post fee
    const fromBal = this.getBalance(tx.from);
    if (fromBal < POST_FEE) return false;
    this.balances.set(tx.from, fromBal - POST_FEE);

    const postId = tx.data.id || tx.hash;
    this.posts.set(postId, {
      id: postId,
      author: tx.from,
      content: tx.data.content,
      media: tx.data.media || null,
      mediaList: tx.data.mediaList || null,
      spoilerMedia: tx.data.spoilerMedia || false,
      timestamp: tx.timestamp,
      hash: tx.hash,
    });
    if (!this.postsByAuthor.has(tx.from)) {
      this.postsByAuthor.set(tx.from, []);
    }
    this.postsByAuthor.get(tx.from).push(postId);
    this._addReputation(tx.from, REP_POST, 'posts');
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyFollow(tx) {
    if (!this.following.has(tx.from)) this.following.set(tx.from, new Set());
    if (!this.followers.has(tx.to)) this.followers.set(tx.to, new Set());

    // Prevent double-follow
    if (this.following.get(tx.from).has(tx.to)) return false;
    // Can't follow yourself
    if (tx.from === tx.to) return false;

    this.following.get(tx.from).add(tx.to);
    this.followers.get(tx.to).add(tx.from);
    this._addReputation(tx.from, REP_FOLLOW_GIVEN, null);
    this._addReputation(tx.to, REP_FOLLOW_RECEIVED, 'followersGained');
    this._recordTx(tx.from, tx);
    this._recordTx(tx.to, tx);
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

    // Prevent double-liking
    if (this.likes.get(postHash).has(tx.from)) return false;

    this.likes.get(postHash).add(tx.from);

    // Reward the post/reply author (not self-likes)
    let author = null;
    const post = this.posts.get(postHash);
    if (post) { author = post.author; }
    else {
      // Check if it's a reply
      for (const [, replies] of this.replies) {
        const r = replies.find(r => r.id === postHash);
        if (r) { author = r.author; break; }
      }
    }
    if (author && author !== tx.from) {
      const authorBal = this.getBalance(author);
      this.balances.set(author, authorBal + LIKE_REWARD);
      this._addReputation(author, REP_LIKE_RECEIVED, 'likesReceived');
    }
    this._addReputation(tx.from, REP_LIKE_GIVEN, 'likesGiven');
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyUnlike(tx) {
    const postHash = tx.data.postHash;
    if (!this.likes.has(postHash)) return false;
    if (!this.likes.get(postHash).has(tx.from)) return false;
    this.likes.get(postHash).delete(tx.from);

    // Reverse the like reward if it was given
    let author = null;
    const post = this.posts.get(postHash);
    if (post) { author = post.author; }
    else {
      for (const [, replies] of this.replies) {
        const r = replies.find(r => r.id === postHash);
        if (r) { author = r.author; break; }
      }
    }
    if (author && author !== tx.from) {
      const authorBal = this.getBalance(author);
      this.balances.set(author, Math.max(0, authorBal - LIKE_REWARD));
    }
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyReaction(tx) {
    const postId = tx.data.postId;
    const emoji = tx.data.emoji;
    if (!postId || !emoji) return false;
    if (!this.reactions.has(postId)) this.reactions.set(postId, new Map());
    const postReactions = this.reactions.get(postId);
    if (!postReactions.has(emoji)) postReactions.set(emoji, new Set());
    const emojiSet = postReactions.get(emoji);
    // Toggle: if already reacted with this emoji, remove it
    if (emojiSet.has(tx.from)) {
      emojiSet.delete(tx.from);
      if (emojiSet.size === 0) postReactions.delete(emoji);
    } else {
      emojiSet.add(tx.from);
    }
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyRepost(tx) {
    const postId = tx.data.postId;
    if (!postId || !this.posts.has(postId)) return false;
    if (!this.reposts.has(postId)) this.reposts.set(postId, new Set());
    const set = this.reposts.get(postId);
    // Toggle: repost/unrepost
    if (set.has(tx.from)) {
      set.delete(tx.from);
    } else {
      set.add(tx.from);
    }
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyDeletePost(tx) {
    const postId = tx.data.postId;
    const post = this.posts.get(postId);
    if (!post) return false;
    // Only author can delete their own post
    if (post.author !== tx.from) return false;

    this.posts.delete(postId);
    this.deletedPosts.add(postId);
    // Remove from author index
    if (this.postsByAuthor.has(tx.from)) {
      const arr = this.postsByAuthor.get(tx.from);
      const idx = arr.indexOf(postId);
      if (idx >= 0) arr.splice(idx, 1);
    }
    // Remove likes for this post
    this.likes.delete(postId);
    // Clean up orphaned reactions
    this.reactions.delete(postId);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyDeleteReply(tx) {
    const replyId = tx.data.replyId;
    const parentId = tx.data.parentId;
    // Search in all reply lists if parentId not provided
    const searchIds = parentId ? [parentId] : [...this.replies.keys()];
    for (const pid of searchIds) {
      const replies = this.replies.get(pid);
      if (!replies) continue;
      const idx = replies.findIndex(r => r.id === replyId);
      if (idx >= 0) {
        // Only author can delete their own reply
        if (replies[idx].author !== tx.from) return false;
        replies.splice(idx, 1);
        this.likes.delete(replyId);
        this._recordTx(tx.from, tx);
        return true;
      }
    }
    return false;
  }

  _applyReply(tx) {
    const parentId = tx.data.parentId;
    const replyId = tx.data.id || tx.hash;
    // Replies are free (no DDM fee)
    if (!this.replies.has(parentId)) this.replies.set(parentId, []);
    this.replies.get(parentId).push({
      id: replyId,
      author: tx.from,
      content: tx.data.content,
      timestamp: tx.timestamp,
      hash: tx.hash,
    });
    this._addReputation(tx.from, 0.5, null);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applySavedMessage(tx) {
    const addr = tx.from;
    if (!this.savedMessages.has(addr)) this.savedMessages.set(addr, []);
    this.savedMessages.get(addr).push({
      id: tx.data.id || tx.hash,
      content: tx.data.content,
      timestamp: tx.timestamp,
    });
    return true;
  }

  _applyDeleteSavedMessage(tx) {
    const addr = tx.from;
    const msgId = tx.data.messageId;
    if (!this.savedMessages.has(addr)) return false;
    const msgs = this.savedMessages.get(addr);
    const idx = msgs.findIndex(m => m.id === msgId);
    if (idx >= 0) msgs.splice(idx, 1);
    return true;
  }

  _getChatKey(a, b) {
    return [a, b].sort().join(':');
  }

  _applyDirectMessage(tx) {
    if (!tx.to || !tx.data?.content && !tx.data?.image) return false;
    const key = this._getChatKey(tx.from, tx.to);
    if (!this.directMessages.has(key)) this.directMessages.set(key, []);
    const msgs = this.directMessages.get(key);
    const msgId = tx.data.id || tx.hash;
    // Deduplicate — message may already exist from instant delivery
    if (msgs.some(m => m.id === msgId)) { this._recordTx(tx.from, tx); return true; }
    msgs.push({
      id: msgId,
      from: tx.from,
      to: tx.to,
      content: tx.data.content || '',
      image: tx.data.image || null,
      timestamp: tx.timestamp,
    });
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyDmPayment(tx) {
    if (!tx.to || !tx.amount || tx.amount <= 0) return false;
    const key = this._getChatKey(tx.from, tx.to);
    if (!this.directMessages.has(key)) this.directMessages.set(key, []);
    const msgs = this.directMessages.get(key);
    const msgId = tx.data?.id || tx.hash;
    const alreadyExists = msgs.some(m => m.id === msgId);
    // Balance: only apply if not already done by instant delivery
    if (!alreadyExists) {
      const fromBal = this.getBalance(tx.from);
      if (fromBal < tx.amount) return false;
      this.balances.set(tx.from, fromBal - tx.amount);
      const toBal = this.getBalance(tx.to);
      this.balances.set(tx.to, toBal + tx.amount);
      msgs.push({
        id: msgId,
        from: tx.from,
        to: tx.to,
        content: tx.data?.content || '',
        payment: { amount: tx.amount, memo: tx.data?.memo || '' },
        timestamp: tx.timestamp,
      });
    }
    this._recordTx(tx.from, tx);
    this._recordTx(tx.to, tx);
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
    // Charge profile update fee
    const fromBal = this.getBalance(tx.from);
    if (fromBal < PROFILE_UPDATE_FEE) return false;
    this.balances.set(tx.from, fromBal - PROFILE_UPDATE_FEE);

    const existing = this.profiles.get(tx.from) || {};
    this.profiles.set(tx.from, { ...existing, ...tx.data.profile });
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyStory(tx) {
    const { image, text, textStyle, duration } = tx.data || {};
    if (!image) return false;
    const stories = this.stories.get(tx.from) || [];
    stories.push({
      id: tx.hash || `story-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: tx.from,
      image,
      text: text || '',
      textStyle: textStyle || {},
      duration: duration || 24, // hours, 0 = permanent
      timestamp: tx.timestamp || Date.now(),
      views: new Set(),
      hidden: false,
    });
    this.stories.set(tx.from, stories);
    this._addReputation(tx.from, 0.3);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyDeleteStory(tx) {
    const storyId = tx.data?.storyId;
    if (!storyId) return false;
    const stories = this.stories.get(tx.from);
    if (!stories) return false;
    const idx = stories.findIndex(s => s.id === storyId);
    if (idx < 0) return false;
    if (stories[idx].author !== tx.from) return false;
    stories.splice(idx, 1);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyProfileDecor(tx) {
    const { itemId, slot } = tx.data;
    if (!itemId || !slot) return false;

    // Validate price against canonical item catalog (prevent client-set price exploit)
    const canonicalPrice = DECOR_PRICES[itemId];
    if (canonicalPrice == null || canonicalPrice <= 0) return false; // unknown item
    const price = canonicalPrice;

    const fromBal = this.getBalance(tx.from);
    if (fromBal < price) return false;
    this.balances.set(tx.from, fromBal - price);

    const decor = this.profileDecor.get(tx.from) || { purchased: new Set() };
    decor.purchased.add(itemId);
    decor[slot] = itemId;
    this.profileDecor.set(tx.from, decor);
    this._recordTx(tx.from, tx);
    return true;
  }

  _applyEquipDecor(tx) {
    const { slot, itemId } = tx.data; // itemId is null to unequip
    const decor = this.profileDecor.get(tx.from) || { purchased: new Set() };
    if (itemId) {
      // Equip — must own the item
      if (!decor.purchased.has(itemId)) return false;
      decor[slot] = itemId;
    } else {
      // Unequip
      decor[slot] = null;
    }
    this.profileDecor.set(tx.from, decor);
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
    // Store full tx object for proper display in UI
    const txData = tx.toJSON ? tx.toJSON() : (typeof tx === 'object' ? { ...tx } : { hash: tx, type: 'unknown' });
    this.txHistory.get(address).push(txData);
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
  getAllPosts(limit = 100, viewerAddress = null) {
    const posts = [];
    const addedIds = new Set();
    for (const [pid, post] of this.posts) {
      const likesSet = this.likes.get(pid) || new Set();
      posts.push({
        ...post,
        profile: this.getProfile(post.author),
        likesCount: likesSet.size,
        liked: viewerAddress ? likesSet.has(viewerAddress) : false,
      });
      addedIds.add(pid);
    }
    // Add reposts as separate feed entries
    for (const [pid, repostSet] of this.reposts) {
      if (repostSet.size === 0) continue;
      const post = this.posts.get(pid);
      if (!post) continue;
      for (const reposterAddr of repostSet) {
        if (reposterAddr === post.author) continue; // skip self-reposts
        const likesSet = this.likes.get(pid) || new Set();
        posts.push({
          ...post,
          profile: this.getProfile(post.author),
          likesCount: likesSet.size,
          liked: viewerAddress ? likesSet.has(viewerAddress) : false,
          repostedBy: reposterAddr,
          repostedByProfile: this.getProfile(reposterAddr),
        });
      }
    }
    // Sort by author reputation (higher rep = higher in feed), then by time
    posts.sort((a, b) => {
      const repA = this.getReputation(a.author).score;
      const repB = this.getReputation(b.author).score;
      if (repA !== repB) return repB - repA;
      return b.timestamp - a.timestamp;
    });
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
      replies: Object.fromEntries(
        Array.from(this.replies).map(([k, v]) => [k, v])
      ),
      savedMessages: Object.fromEntries(
        Array.from(this.savedMessages).map(([k, v]) => [k, v])
      ),
      reactions: Object.fromEntries(
        Array.from(this.reactions).map(([pid, emojiMap]) => [
          pid,
          Object.fromEntries(Array.from(emojiMap).map(([e, s]) => [e, [...s]]))
        ])
      ),
      reputation: Object.fromEntries(this.reputation),
      txHistory: Object.fromEntries(
        Array.from(this.txHistory).map(([k, v]) => [k, v])
      ),
      processedTxs: [...this.processedTxs],
      deletedPosts: [...this.deletedPosts],
      profileDecor: Object.fromEntries(
        Array.from(this.profileDecor).map(([k, v]) => [k, { ...v, purchased: [...(v.purchased || [])] }])
      ),
      reposts: Object.fromEntries(
        Array.from(this.reposts).map(([k, v]) => [k, [...v]])
      ),
      directMessages: Object.fromEntries(
        Array.from(this.directMessages).map(([k, v]) => [k, v])
      ),
      stories: Object.fromEntries(
        Array.from(this.stories).map(([k, v]) => [k, v.map(s => ({ ...s, views: [...(s.views || [])] }))])
      ),
      validators: Object.fromEntries(this.validators),
      proposals: Object.fromEntries(this.proposals),
      votes: Object.fromEntries(
        Array.from(this.votes).map(([pid, v]) => [pid, {
          for: v.for instanceof Map ? Object.fromEntries(v.for) : (v.for || {}),
          against: v.against instanceof Map ? Object.fromEntries(v.against) : (v.against || {}),
        }])
      ),
      totalStaked: this.totalStaked,
      blockHeight: this.blockHeight,
      faucetClaims: [...this.faucetClaims],
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
    if (data.replies) {
      state.replies = new Map(Object.entries(data.replies));
    }
    if (data.savedMessages) {
      state.savedMessages = new Map(Object.entries(data.savedMessages));
    }
    if (data.reactions) {
      state.reactions = new Map(
        Object.entries(data.reactions).map(([pid, emojiObj]) => [
          pid,
          new Map(Object.entries(emojiObj).map(([e, arr]) => [e, new Set(arr)]))
        ])
      );
    }
    if (data.reputation) {
      state.reputation = new Map(Object.entries(data.reputation));
    }
    if (data.txHistory) {
      state.txHistory = new Map(Object.entries(data.txHistory));
    }
    if (data.processedTxs) {
      state.processedTxs = new Set(data.processedTxs);
    }
    if (data.deletedPosts) {
      state.deletedPosts = new Set(data.deletedPosts);
    }
    if (data.profileDecor) {
      state.profileDecor = new Map(
        Object.entries(data.profileDecor).map(([k, v]) => [k, { ...v, purchased: new Set(v.purchased || []) }])
      );
    }
    if (data.reposts) {
      state.reposts = new Map(
        Object.entries(data.reposts).map(([k, v]) => [k, new Set(v)])
      );
    }
    if (data.directMessages) {
      state.directMessages = new Map(Object.entries(data.directMessages));
    }
    if (data.stories) {
      state.stories = new Map(
        Object.entries(data.stories).map(([k, v]) => [k, v.map(s => ({ ...s, views: new Set(s.views || []) }))])
      );
    }
    if (data.validators) {
      state.validators = new Map(Object.entries(data.validators));
    }
    if (data.proposals) {
      state.proposals = new Map(Object.entries(data.proposals));
    }
    if (data.votes) {
      state.votes = new Map(
        Object.entries(data.votes).map(([pid, v]) => [pid, {
          for: new Map(Object.entries(v.for || {})),
          against: new Map(Object.entries(v.against || {})),
        }])
      );
    }
    state.totalStaked = data.totalStaked || 0;
    state.blockHeight = data.blockHeight || 0;
    if (data.faucetClaims) {
      state.faucetClaims = new Set(data.faucetClaims);
    }
    return state;
  }
}
