/**
 * DiaDem Server
 * HTTP server + WebSocket signaling + Server Node for P2P state sync.
 *
 * The server acts as a persistent node that:
 * 1. Serves the static frontend
 * 2. Relays WebSocket signaling for peer discovery / WebRTC
 * 3. Stores the latest blockchain state from peers (in-memory + disk)
 * 4. Sends stored state to newly connecting peers (bootstrap node)
 *
 * Usage: node server.js [--port PORT] [--dev]
 */

import { createServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { readFile, writeFile, stat, mkdir, access } from 'fs/promises';
import { readFileSync } from 'fs';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { networkInterfaces } from 'os';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';

/** Get local network IP (for LAN access from phone) */
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const args = process.argv.slice(2);
const PORT = parseInt(args.find((_, i, a) => a[i - 1] === '--port') || '3000');
const DEV = args.includes('--dev');

// ─── Server Node State ──────────────────────────────────────
// The server stores the latest state received from any peer.
// This acts as a "bootstrap node" for new peers.
const STATE_FILE = join(__dirname, 'data', 'server-state.json');
let serverState = null;       // latest state JSON (already serialized)
let serverStateHeight = 0;    // track best known chain height
const SERVER_NODE_ID = 'server-node-' + Math.random().toString(36).slice(2, 8);

async function loadServerState() {
  try {
    const data = await readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    serverState = parsed.state || null;
    serverStateHeight = parsed.height || 0;
    console.log(`[Node] Loaded saved state: height ${serverStateHeight}`);
  } catch {
    console.log('[Node] No saved state found, starting fresh');
  }
}

async function saveServerState() {
  try {
    await mkdir(join(__dirname, 'data'), { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify({
      state: serverState,
      height: serverStateHeight,
      savedAt: Date.now(),
    }));
  } catch (e) {
    console.warn('[Node] Failed to save state:', e.message);
  }
}

// Throttle disk writes (max once per 5 seconds)
let _saveTimer = null;
function scheduleSave() {
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    saveServerState();
  }, 5000);
}

// ─── MIME Types ──────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
};

// ─── HTTP/HTTPS Server ───────────────────────────────────────
// Use HTTPS if certs exist (required for crypto.subtle on LAN devices)
const CERT_PATH = join(__dirname, 'data', 'cert.pem');
const KEY_PATH = join(__dirname, 'data', 'key.pem');
let useHttps = false;
try {
  await access(CERT_PATH);
  await access(KEY_PATH);
  useHttps = true;
} catch { /* no certs, fall back to HTTP */ }

const requestHandler = async (req, res) => {
  // CORS for dev
  if (DEV) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  }

  let url = new URL(req.url, `http://localhost:${PORT}`);
  let pathname = decodeURIComponent(url.pathname);

  // API: node info endpoint
  if (pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      name: 'DiaDem',
      version: '0.1.0',
      network: 'testnet',
      peers: connectedPeers.size,
      stateHeight: serverStateHeight,
      serverNodeId: SERVER_NODE_ID,
      uptime: process.uptime(),
    }));
    return;
  }

  // API: peer list
  if (pathname === '/api/peers') {
    const peers = [];
    for (const [id, peer] of connectedPeers) {
      peers.push({ id, address: peer.address, connectedAt: peer.connectedAt });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ peers, total: peers.length }));
    return;
  }

  // API: QR code generation (renders PNG of any data)
  if (pathname === '/api/qr') {
    const data = url.searchParams.get('data');
    const size = Math.min(parseInt(url.searchParams.get('size') || '300'), 1000);
    if (!data) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing data parameter' }));
      return;
    }
    try {
      const pngBuffer = await QRCode.toBuffer(data, {
        type: 'png',
        width: size,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#FFFFFF' },
      });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      });
      res.end(pngBuffer);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'QR generation failed' }));
    }
    return;
  }

  // Static file serving
  if (pathname === '/') pathname = '/index.html';

  // SPA fallback: if path doesn't have extension, serve index.html
  const ext = extname(pathname);
  if (!ext && pathname !== '/index.html') {
    pathname = '/index.html';
  }

  const filePath = join(__dirname, pathname);

  try {
    // Security: prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) {
      res.writeHead(404); res.end('Not Found'); return;
    }

    const content = await readFile(filePath);
    const mime = MIME[ext] || 'application/octet-stream';

    const headers = { 'Content-Type': mime };
    if (DEV) {
      headers['Cache-Control'] = 'no-cache, no-store, must-revalidate';
    } else {
      // Cache static assets for 1 hour, HTML for 5 min
      headers['Cache-Control'] = ext === '.html'
        ? 'public, max-age=300'
        : 'public, max-age=3600';
    }

    res.writeHead(200, headers);
    res.end(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // SPA fallback
      try {
        const indexContent = await readFile(join(__dirname, 'index.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(indexContent);
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
    } else {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  }
};

const server = useHttps
  ? createHttpsServer({ cert: readFileSync(CERT_PATH), key: readFileSync(KEY_PATH) }, requestHandler)
  : createServer(requestHandler);

// HTTP→HTTPS redirect when HTTPS is enabled
let httpRedirectServer = null;
if (useHttps) {
  const REDIRECT_PORT = PORT + 1; // e.g. 3001 redirects to 3000 (HTTPS)
  httpRedirectServer = createServer((req, res) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    res.writeHead(302, { Location: `https://${host}:${PORT}${req.url}` });
    res.end();
  });
  httpRedirectServer.listen(REDIRECT_PORT, '0.0.0.0');
}

// ─── WebSocket Signaling Server + Node ───────────────────────
// Handles peer discovery, WebRTC signaling relay,
// and acts as a persistent node for state synchronization.

const wss = new WebSocketServer({ server, path: '/signal' });
const connectedPeers = new Map(); // peerId -> { ws, address, connectedAt }

// ─── Rate Limiting ──────────────────────────────────────────
const rateLimits = new Map(); // ip -> { count, resetAt }
const RATE_LIMIT_WINDOW = 10000; // 10 seconds
const RATE_LIMIT_MAX = 100; // max messages per window
const MAX_MESSAGE_SIZE = 5 * 1024 * 1024; // 5MB max message
const MAX_PEERS = 500; // max simultaneous connections
const MAX_PEER_ID_LENGTH = 128; // prevent absurdly long peerIds

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = rateLimits.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    rateLimits.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

// Clean up rate limit entries every 30s
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(ip);
  }
}, 30000);

/** Send the server's stored state to a specific peer via WS */
function sendServerStateToPeer(ws, peerId) {
  if (!serverState || ws.readyState !== 1) return;

  // Send as a relay message from the server node
  ws.send(JSON.stringify({
    type: 'relay',
    from: SERVER_NODE_ID,
    payload: {
      type: 'state_sync',
      payload: { state: serverState },
      from: SERVER_NODE_ID,
      timestamp: Date.now(),
    },
  }));
  console.log(`[Node] Sent stored state (height ${serverStateHeight}) to ${peerId.slice(0, 12)}...`);
}

/** Process a broadcast payload — if it's a state_sync, store it on the server */
function processRelayedPayload(payload) {
  if (!payload || !payload.type) return;

  // Store STATE_SYNC data if it has higher block height
  if (payload.type === 'state_sync' && payload.payload?.state) {
    const remoteState = payload.payload.state;
    const remoteHeight = remoteState.blockHeight || 0;

    // Sanity checks: reject absurd heights or jumps
    if (typeof remoteHeight !== 'number' || remoteHeight < 0 || remoteHeight > 1e9) return;
    // Prevent massive height jumps (max 1000 blocks ahead at a time)
    if (serverStateHeight > 0 && remoteHeight > serverStateHeight + 1000) {
      console.warn(`[Node] Rejected state sync: height ${remoteHeight} too far ahead of ${serverStateHeight}`);
      return;
    }
    // Limit state size (reject if serialized state > 50MB to prevent memory exhaustion)
    const stateStr = JSON.stringify(remoteState);
    if (stateStr.length > 50 * 1024 * 1024) {
      console.warn(`[Node] Rejected state sync: state too large (${(stateStr.length / 1024 / 1024).toFixed(1)}MB)`);
      return;
    }

    if (remoteHeight > serverStateHeight || !serverState) {
      serverState = remoteState;
      serverStateHeight = remoteHeight;
      console.log(`[Node] State updated: height ${serverStateHeight}, posts: ${Object.keys(remoteState.posts || {}).length}`);
      scheduleSave();
    } else if (remoteHeight === serverStateHeight && serverState) {
      // Same height — merge: take the state with more data
      const localPosts = Object.keys(serverState.posts || {}).length;
      const remotePosts = Object.keys(remoteState.posts || {}).length;
      if (remotePosts > localPosts) {
        serverState = remoteState;
        console.log(`[Node] State merged (same height ${serverStateHeight}, more posts: ${remotePosts})`);
        scheduleSave();
      }
    }
  }

  // Also store new blocks and transactions
  if (payload.type === 'new_block' && payload.payload?.block) {
    const block = payload.payload.block;
    if (typeof block.index === 'number' && block.index > serverStateHeight && block.index < serverStateHeight + 1000) {
      serverStateHeight = block.index;
    }
  }
}

wss.on('connection', (ws, req) => {
  let peerId = null;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  ws.on('message', (data) => {
    // Rate limiting
    if (!checkRateLimit(ip)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Rate limit exceeded' }));
      return;
    }

    // Message size check
    if (data.length > MAX_MESSAGE_SIZE) {
      ws.send(JSON.stringify({ type: 'error', message: 'Message too large' }));
      return;
    }

    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch { return; }

    // Validate message structure
    if (!msg || typeof msg.type !== 'string') return;

    switch (msg.type) {
      // Peer announces itself
      case 'announce': {
        // Validate peerId
        if (!msg.peerId || typeof msg.peerId !== 'string' || msg.peerId.length > MAX_PEER_ID_LENGTH) {
          ws.send(JSON.stringify({ type: 'error', message: 'Invalid peerId' }));
          return;
        }
        // Connection limit
        if (connectedPeers.size >= MAX_PEERS && !connectedPeers.has(msg.peerId)) {
          ws.send(JSON.stringify({ type: 'error', message: 'Server full' }));
          return;
        }

        peerId = msg.peerId;
        connectedPeers.set(peerId, {
          ws,
          address: msg.address || null,
          connectedAt: Date.now(),
          chainHeight: msg.chainHeight || 0,
        });

        // Send back the list of other peers (include server node as a virtual peer)
        const otherPeers = [];
        for (const [id, peer] of connectedPeers) {
          if (id !== peerId) {
            otherPeers.push({
              id,
              address: peer.address,
              chainHeight: peer.chainHeight,
            });
          }
        }
        // Add server node itself as a peer so clients know it exists
        otherPeers.push({
          id: SERVER_NODE_ID,
          address: 'server',
          chainHeight: serverStateHeight,
        });
        ws.send(JSON.stringify({
          type: 'peers',
          peers: otherPeers,
        }));

        // Notify other peers about the new peer
        for (const [id, peer] of connectedPeers) {
          if (id !== peerId && peer.ws.readyState === 1) {
            peer.ws.send(JSON.stringify({
              type: 'peer_joined',
              peer: {
                id: peerId,
                address: msg.address,
                chainHeight: msg.chainHeight,
              },
            }));
          }
        }

        console.log(`[Signal] Peer joined: ${peerId.slice(0, 16)}... (${connectedPeers.size} total)`);

        // Server acts as a node: send stored state to the new peer
        // Delay slightly to let the client finish its own setup
        setTimeout(() => sendServerStateToPeer(ws, peerId), 500);
        break;
      }

      // WebRTC signaling relay: offer
      case 'offer': {
        const target = connectedPeers.get(msg.to);
        if (target && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({
            type: 'offer',
            from: peerId,
            offer: msg.offer,
          }));
        }
        break;
      }

      // WebRTC signaling relay: answer
      case 'answer': {
        const target = connectedPeers.get(msg.to);
        if (target && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({
            type: 'answer',
            from: peerId,
            answer: msg.answer,
          }));
        }
        break;
      }

      // WebRTC signaling relay: ICE candidate
      case 'ice': {
        const target = connectedPeers.get(msg.to);
        if (target && target.ws.readyState === 1) {
          target.ws.send(JSON.stringify({
            type: 'ice',
            from: peerId,
            candidate: msg.candidate,
          }));
        }
        break;
      }

      // Chain height update
      case 'height': {
        const peer = connectedPeers.get(peerId);
        if (peer) peer.chainHeight = msg.height;
        break;
      }

      // Broadcast a message to all peers (for CAS data, state sync, etc.)
      case 'broadcast': {
        // Server node: intercept and store relevant data
        processRelayedPayload(msg.payload);

        // Relay to all other peers
        for (const [id, peer] of connectedPeers) {
          if (id !== peerId && peer.ws.readyState === 1) {
            peer.ws.send(JSON.stringify({
              type: 'relay',
              from: peerId,
              payload: msg.payload,
            }));
          }
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (peerId) {
      connectedPeers.delete(peerId);
      // Notify others
      for (const [id, peer] of connectedPeers) {
        if (peer.ws.readyState === 1) {
          peer.ws.send(JSON.stringify({
            type: 'peer_left',
            peerId,
          }));
        }
      }
      console.log(`[Signal] Peer left: ${peerId.slice(0, 16)}... (${connectedPeers.size} total)`);
    }
  });

  ws.on('error', () => {
    if (peerId) connectedPeers.delete(peerId);
  });
});

// ─── Periodic cleanup ─────────────────────────────────────────
setInterval(() => {
  for (const [id, peer] of connectedPeers) {
    if (peer.ws.readyState !== 1) {
      connectedPeers.delete(id);
    }
  }
}, 30000);

// ─── Start ───────────────────────────────────────────────────
await loadServerState();

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalIP();
  const proto = useHttps ? 'https' : 'http';
  const wsproto = useHttps ? 'wss' : 'ws';
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║              DiaDem Node Server                  ║');
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Local:     ${proto}://localhost:${PORT}`.padEnd(52) + '║');
  console.log(`  ║  Network:   ${proto}://${localIP}:${PORT}`.padEnd(52) + '║');
  console.log(`  ║  Signal:    ${wsproto}://${localIP}:${PORT}/signal`.padEnd(52) + '║');
  console.log(`  ║  Mode:      ${(DEV ? 'Development' : 'Production').padEnd(37)}║`);
  console.log(`  ║  HTTPS:     ${(useHttps ? 'Enabled (self-signed)' : 'Disabled').padEnd(37)}║`);
  console.log(`  ║  Node:      ${SERVER_NODE_ID.padEnd(37)}║`);
  console.log(`  ║  State:     height ${String(serverStateHeight).padEnd(28)}║`);
  console.log('  ╠══════════════════════════════════════════════════╣');
  console.log(`  ║  Phone: ${proto}://${localIP}:${PORT}`.padEnd(52) + '║');
  if (useHttps) {
  console.log('  ║  (accept self-signed cert warning on phone)      ║');
  }
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log('');
});
