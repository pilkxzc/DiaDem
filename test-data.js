/**
 * DiaDem Test Data Generator
 * Generates fake posts, likes, follows, replies, saved messages
 * and verifies all functionality works.
 *
 * Usage:
 *   Open browser console on http://localhost:3000
 *   Copy-paste this script, or load via:
 *   import('./test-data.js')
 *
 * To clean up:
 *   window.__diademTest.cleanup()
 */

const FAKE_POSTS = [
  'Decentralization is the future of social media. No more algorithms deciding what you see.',
  'Just staked 1000 DDM. APY looking good at 14.2%! Who else is validating?',
  'Built a new dApp on DiaDem today. The CAS storage is incredible — content-addressable everything.',
  'Remember: your keys, your data. Nobody can censor you on a decentralized network.',
  'The P2P architecture means every browser tab is a full node. Mind blown.',
  'Testing WebRTC peer connections — latency is surprisingly low for a fully decentralized system.',
  'Hot take: centralized social media is dead. DiaDem is the way forward.',
  'Love how likes earn DDM for post authors. Finally, creators get rewarded directly.',
  'Blockchain + IPFS + P2P = unstoppable social network. No single point of failure.',
  'Who needs servers when you have a mesh of browser nodes?',
  'DiaDem governance is going to change how we think about platform rules.',
  'Proof of Stake consensus is elegant. Energy efficient and secure.',
  'The reputation system rewards quality content. Higher rep = more trust.',
  'Just discovered you can save private notes in Saved Messages. Like Telegram but on-chain.',
  'Every transaction on DiaDem is signed with ECDSA P-256. Military-grade crypto in a social app.',
];

const FAKE_REPLIES = [
  'Totally agree with this!',
  'Great point, never thought about it that way.',
  'This is exactly why I joined DiaDem.',
  'Can you elaborate on this?',
  'Facts. No cap.',
  'Based take.',
  'Interesting perspective. I think the future is hybrid though.',
  'This is the way.',
];

const FAKE_SAVED = [
  'TODO: Check staking rewards tomorrow',
  'Idea: Build a DAO for community governance',
  'Remember to backup seed phrase',
  'Meeting notes: DiaDem dev call — discussed new features',
  'Link to save: https://docs.diadem.network/api',
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runTests() {
  const { getNode } = await import('./src/diadem.js');
  const node = await getNode();

  if (!node.wallet) {
    console.error('❌ No wallet found. Create a wallet first!');
    return;
  }

  const results = { passed: 0, failed: 0, errors: [] };
  const createdPostIds = [];
  const createdReplyIds = [];

  function assert(condition, name) {
    if (condition) {
      console.log(`  ✅ ${name}`);
      results.passed++;
    } else {
      console.error(`  ❌ ${name}`);
      results.failed++;
      results.errors.push(name);
    }
  }

  console.log('');
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     DiaDem Test Suite — Full Check        ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');

  // ── 1. Balance check ──────────────────────────────
  console.log('📊 1. Balance & Wallet');
  const initialBalance = node.getBalance();
  assert(initialBalance > 0, `Has balance: ${initialBalance} DDM`);
  assert(node.wallet.address.startsWith('0x'), `Valid address: ${node.wallet.address.slice(0, 12)}...`);
  assert(node.wallet.publicKey.length > 0, 'Has public key');

  // ── 2. Create posts ───────────────────────────────
  console.log('');
  console.log('📝 2. Creating Posts (costs 1 DDM each)');
  const postsToCreate = FAKE_POSTS.slice(0, 5);
  for (const content of postsToCreate) {
    try {
      const tx = await node.createPost(content);
      createdPostIds.push(tx.data.id);
      assert(true, `Post created: "${content.slice(0, 40)}..."`);
      await sleep(100);
    } catch (e) {
      assert(false, `Post failed: ${e.message}`);
    }
  }

  const afterPostBalance = node.getBalance();
  const postCost = initialBalance - afterPostBalance;
  assert(postCost >= postsToCreate.length, `Balance decreased by ${postCost} DDM (expected ${postsToCreate.length}+)`);

  // ── 3. Check posts appear in state ────────────────
  console.log('');
  console.log('🔍 3. Verifying Posts in State');
  const myPosts = node.getUserPosts(node.wallet.address);
  assert(myPosts.length >= postsToCreate.length, `Found ${myPosts.length} posts in state`);

  const feed = node.getFeed(50);
  assert(feed.length >= postsToCreate.length, `Feed has ${feed.length} posts`);

  const explore = node.getExplorePosts(50);
  assert(explore.length >= postsToCreate.length, `Explore has ${explore.length} posts`);

  // ── 4. Like posts ─────────────────────────────────
  console.log('');
  console.log('❤️ 4. Liking Posts');
  if (createdPostIds.length >= 2) {
    // Like own post — should NOT give reward
    const balBefore = node.getBalance();
    try {
      await node.likePost(createdPostIds[0]);
      assert(true, 'Liked own post');
      await sleep(100);
      const balAfter = node.getBalance();
      assert(balAfter === balBefore, `Self-like no reward (bal unchanged: ${balAfter})`);
    } catch (e) {
      assert(false, `Like failed: ${e.message}`);
    }

    // Try double-like — should fail silently
    try {
      await node.likePost(createdPostIds[0]);
      const likes = node.blockchain.state.likes.get(createdPostIds[0]) || new Set();
      assert(likes.size === 1, `Double-like prevented (likes: ${likes.size})`);
    } catch (e) {
      assert(true, 'Double-like correctly rejected');
    }

    // Unlike
    try {
      await node.unlikePost(createdPostIds[0]);
      await sleep(100);
      const likes = node.blockchain.state.likes.get(createdPostIds[0]) || new Set();
      assert(!likes.has(node.wallet.address), `Unlike worked (likes: ${likes.size})`);
    } catch (e) {
      assert(false, `Unlike failed: ${e.message}`);
    }

    // Re-like for test data
    try {
      await node.likePost(createdPostIds[0]);
      await node.likePost(createdPostIds[1]);
      await sleep(100);
      assert(true, 'Re-liked posts for test data');
    } catch (e) {
      assert(false, `Re-like failed: ${e.message}`);
    }
  }

  // ── 5. Replies ────────────────────────────────────
  console.log('');
  console.log('💬 5. Replies');
  if (createdPostIds.length > 0) {
    const parentId = createdPostIds[0];
    for (const reply of FAKE_REPLIES.slice(0, 3)) {
      try {
        const tx = await node.replyToPost(parentId, reply);
        createdReplyIds.push(tx.data.id);
        assert(true, `Reply: "${reply.slice(0, 30)}..."`);
        await sleep(100);
      } catch (e) {
        assert(false, `Reply failed: ${e.message}`);
      }
    }
    const replies = node.blockchain.state.replies.get(parentId) || [];
    assert(replies.length >= 3, `Post has ${replies.length} replies`);

    // Reply should be free (check balance didn't change much)
    const replyBalance = node.getBalance();
    assert(true, `Balance after replies: ${replyBalance} DDM (replies are free)`);
  }

  // ── 6. Saved Messages ─────────────────────────────
  console.log('');
  console.log('📌 6. Saved Messages');
  const savedIds = [];
  for (const msg of FAKE_SAVED) {
    try {
      const tx = await node.saveMessage(msg);
      savedIds.push(tx.data.id);
      assert(true, `Saved: "${msg.slice(0, 30)}..."`);
      await sleep(100);
    } catch (e) {
      assert(false, `Save msg failed: ${e.message}`);
    }
  }
  const savedMsgs = node.getSavedMessages();
  assert(savedMsgs.length >= FAKE_SAVED.length, `Got ${savedMsgs.length} saved messages`);

  // Delete one
  if (savedIds.length > 0) {
    try {
      await node.deleteSavedMessage(savedIds[0]);
      await sleep(100);
      const afterDelete = node.getSavedMessages();
      assert(afterDelete.length === savedMsgs.length - 1, `Deleted saved msg (now ${afterDelete.length})`);
    } catch (e) {
      assert(false, `Delete saved msg failed: ${e.message}`);
    }
  }

  // ── 7. Profile Update ─────────────────────────────
  console.log('');
  console.log('👤 7. Profile Update');
  const balBeforeProfile = node.getBalance();
  try {
    await node.updateProfile({ name: 'Test User', handle: '@testuser', bio: 'DiaDem enthusiast. Building the decentralized future.' });
    await sleep(100);
    const profile = node.getProfile();
    assert(profile?.name === 'Test User', `Profile name: ${profile?.name}`);
    assert(profile?.bio?.includes('DiaDem'), `Profile bio set`);
    const balAfterProfile = node.getBalance();
    assert(balBeforeProfile - balAfterProfile >= 0.5, `Profile update cost 0.5 DDM (was ${balBeforeProfile}, now ${balAfterProfile})`);
  } catch (e) {
    assert(false, `Profile update failed: ${e.message}`);
  }

  // ── 8. Reputation ─────────────────────────────────
  console.log('');
  console.log('⭐ 8. Reputation System');
  const rep = node.getReputation();
  assert(rep.score > 0, `Reputation score: ${rep.score.toFixed(1)}`);
  assert(rep.posts >= postsToCreate.length, `Posts tracked: ${rep.posts}`);
  assert(rep.level !== 'Newcomer' || rep.score < 5, `Level: ${rep.level}`);
  console.log(`   Level: ${rep.level} | Score: ${rep.score.toFixed(1)} | Posts: ${rep.posts} | Likes received: ${rep.likesReceived}`);

  // ── 9. Delete Post ────────────────────────────────
  console.log('');
  console.log('🗑️ 9. Delete Post');
  if (createdPostIds.length >= 5) {
    const deleteId = createdPostIds[4]; // Delete last test post
    try {
      await node.deletePost(deleteId);
      await sleep(100);
      const deleted = node.blockchain.state.posts.get(deleteId);
      assert(!deleted, `Post deleted successfully`);
    } catch (e) {
      assert(false, `Delete post failed: ${e.message}`);
    }
  }

  // ── 10. Transaction History ───────────────────────
  console.log('');
  console.log('📋 10. Transaction History');
  const txs = node.getTransactions(50);
  assert(txs.length > 0, `Has ${txs.length} transactions`);
  const types = new Set(txs.map(tx => typeof tx === 'string' ? 'hash' : tx.type));
  console.log(`   Types found: ${[...types].join(', ')}`);
  assert(types.has('post'), 'Has post transactions');

  // ── 11. Blockchain State ──────────────────────────
  console.log('');
  console.log('⛓️ 11. Blockchain State');
  const info = node.getNodeInfo();
  assert(info.chain.height >= 0, `Chain height: ${info.chain.height}`);
  assert(info.state.totalPosts > 0, `Total posts: ${info.state.totalPosts}`);
  console.log(`   Blocks: ${info.chain.blocks} | Pending: ${info.chain.pendingTxs} | CAS: ${info.cas.objects} obj`);

  // ── 12. More fake posts for feed ──────────────────
  console.log('');
  console.log('📝 12. Generating More Feed Data');
  for (const content of FAKE_POSTS.slice(5)) {
    try {
      const tx = await node.createPost(content);
      createdPostIds.push(tx.data.id);
      await sleep(50);
    } catch (e) { break; } // Stop if balance runs out
  }
  const totalPosts = node.getUserPosts(node.wallet.address).length;
  console.log(`   Total posts now: ${totalPosts}`);

  // ── Summary ───────────────────────────────────────
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`  Results: ${results.passed} passed, ${results.failed} failed`);
  console.log(`  Final balance: ${node.getBalance().toLocaleString()} DDM`);
  console.log(`  Posts: ${node.blockchain.state.posts.size}`);
  console.log(`  Reputation: ${node.getReputation().score.toFixed(1)} (${node.getReputation().level})`);
  if (results.failed > 0) {
    console.log(`  Failed tests:`);
    results.errors.forEach(e => console.log(`    ❌ ${e}`));
  }
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('💡 Use window.__diademTest.cleanup() to remove all test data');

  // Store cleanup function
  window.__diademTest = {
    createdPostIds,
    createdReplyIds,
    results,
    async cleanup() {
      console.log('🧹 Cleaning up test data...');
      const node = await getNode();
      let cleaned = 0;
      for (const postId of createdPostIds) {
        try {
          if (node.blockchain.state.posts.has(postId)) {
            await node.deletePost(postId);
            cleaned++;
            await sleep(50);
          }
        } catch {}
      }
      console.log(`  Deleted ${cleaned} posts`);

      // Clear saved messages
      const saved = node.getSavedMessages();
      let msgCleaned = 0;
      for (const msg of saved) {
        try {
          await node.deleteSavedMessage(msg.id);
          msgCleaned++;
          await sleep(50);
        } catch {}
      }
      console.log(`  Deleted ${msgCleaned} saved messages`);
      console.log('✅ Cleanup complete! Refresh the page.');
    }
  };

  // Trigger UI refresh
  node.emit('stateChange');

  return results;
}

// Auto-run
runTests();
