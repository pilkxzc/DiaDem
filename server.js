/**
 * DiaDem Server
 * Minimal HTTP server + WebSocket signaling for P2P peer discovery.
 *
 * The HTTP server serves the static frontend.
 * The WebSocket server acts as a signaling relay so peers can
 * automatically discover each other and exchange WebRTC offers/answers
 * without manual copy-paste.
 *
 * Usage: node server.js [--port PORT] [--dev]
 */

import { createServer } from 'http';
import { readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const args = process.argv.slice(2);
const PORT = parseInt(args.find((_, i, a) => a[i - 1] === '--port') || '3000');
const DEV = args.includes('--dev');

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

// ─── HTTP Server ─────────────────────────────────────────────
const server = createServer(async (req, res) => {
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
});

// ─── WebSocket Signaling Server ──────────────────────────────
// Handles peer discovery and WebRTC signaling relay.
// Peers connect, announce themselves, and the server relays
// offers/answers between them for automatic P2P connection.

const wss = new WebSocketServer({ server, path: '/signal' });
const connectedPeers = new Map(); // peerId -> { ws, address, connectedAt }

wss.on('connection', (ws, req) => {
  let peerId = null;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch { return; }

    switch (msg.type) {
      // Peer announces itself
      case 'announce': {
        peerId = msg.peerId;
        connectedPeers.set(peerId, {
          ws,
          address: msg.address || null,
          connectedAt: Date.now(),
          chainHeight: msg.chainHeight || 0,
        });

        // Send back the list of other peers
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

        console.log(`[Signal] Peer joined: ${peerId.slice(0, 12)}... (${connectedPeers.size} total)`);
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

      // Broadcast a message to all peers (for CAS data announcements)
      case 'broadcast': {
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
      console.log(`[Signal] Peer left: ${peerId.slice(0, 12)}... (${connectedPeers.size} total)`);
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
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║          DiaDem Node Server              ║');
  console.log('  ╠══════════════════════════════════════════╣');
  console.log(`  ║  HTTP:      http://localhost:${PORT}        ║`);
  console.log(`  ║  Signal:    ws://localhost:${PORT}/signal    ║`);
  console.log(`  ║  Mode:      ${DEV ? 'Development' : 'Production '}              ║`);
  console.log('  ║  Network:   DiaDem Testnet               ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});
