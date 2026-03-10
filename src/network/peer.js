/**
 * DiaDem P2P Network
 * WebRTC-based peer-to-peer networking for blockchain synchronization.
 * Works entirely in the browser — no server required.
 *
 * Connection methods:
 * 1. Manual peer connection via offer/answer exchange (copy-paste)
 * 2. BroadcastChannel for same-device tab communication
 * 3. Optional signaling via public WebSocket relays
 *
 * Protocol messages:
 * - HELLO: Announce node presence
 * - GET_BLOCKS: Request blocks from a peer
 * - BLOCKS: Response with blocks
 * - NEW_BLOCK: Broadcast new block
 * - NEW_TX: Broadcast new transaction
 * - GET_PEERS: Request peer list
 * - PEERS: Response with known peers
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export const MSG_TYPES = {
  HELLO: 'hello',
  GET_BLOCKS: 'get_blocks',
  BLOCKS: 'blocks',
  NEW_BLOCK: 'new_block',
  NEW_TX: 'new_tx',
  GET_PEERS: 'get_peers',
  PEERS: 'peers',
  SYNC_REQUEST: 'sync_request',
  SYNC_RESPONSE: 'sync_response',
};

export class PeerNetwork {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.peers = new Map(); // peerId -> { connection, channel, address }
    this.messageHandlers = new Map(); // msgType -> [handler, ...]
    this.broadcastChannel = null;
    this.onPeerConnect = null;
    this.onPeerDisconnect = null;

    this._initBroadcastChannel();
  }

  /** Initialize BroadcastChannel for same-device communication */
  _initBroadcastChannel() {
    try {
      this.broadcastChannel = new BroadcastChannel('diadem-network');
      this.broadcastChannel.onmessage = (event) => {
        const msg = event.data;
        if (msg.from === this.nodeId) return; // Ignore own messages
        this._handleMessage(msg.from, msg);
      };
    } catch (e) {
      console.warn('[P2P] BroadcastChannel not available');
    }
  }

  /** Register a message handler */
  on(msgType, handler) {
    if (!this.messageHandlers.has(msgType)) {
      this.messageHandlers.set(msgType, []);
    }
    this.messageHandlers.get(msgType).push(handler);
  }

  /** Handle incoming message */
  _handleMessage(peerId, msg) {
    const handlers = this.messageHandlers.get(msg.type) || [];
    for (const handler of handlers) {
      try {
        handler(peerId, msg.payload, msg);
      } catch (err) {
        console.error(`[P2P] Handler error for ${msg.type}:`, err);
      }
    }
  }

  /** Send a message to a specific peer */
  send(peerId, type, payload) {
    const msg = {
      type,
      payload,
      from: this.nodeId,
      timestamp: Date.now(),
    };

    const peer = this.peers.get(peerId);
    if (peer && peer.channel && peer.channel.readyState === 'open') {
      peer.channel.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  /** Broadcast a message to all peers and BroadcastChannel */
  broadcast(type, payload) {
    const msg = {
      type,
      payload,
      from: this.nodeId,
      timestamp: Date.now(),
    };

    // Send to WebRTC peers
    for (const [peerId, peer] of this.peers) {
      if (peer.channel && peer.channel.readyState === 'open') {
        try {
          peer.channel.send(JSON.stringify(msg));
        } catch (err) {
          console.warn(`[P2P] Failed to send to ${peerId}`);
        }
      }
    }

    // Send to BroadcastChannel (for local tabs)
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage(msg);
      } catch (e) {}
    }
  }

  /**
   * Create a WebRTC offer to connect to a peer.
   * Returns the offer string to be shared with the peer.
   */
  async createOffer() {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const channel = pc.createDataChannel('diadem', { ordered: true });

    const peerId = crypto.randomUUID();

    return new Promise((resolve) => {
      const candidates = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidates.push(event.candidate);
        } else {
          // ICE gathering complete
          const offerData = {
            sdp: pc.localDescription,
            candidates,
            peerId,
            nodeId: this.nodeId,
          };
          resolve({
            offerString: btoa(JSON.stringify(offerData)),
            peerId,
            _pc: pc,
            _channel: channel,
          });
        }
      };

      channel.onopen = () => {
        console.log(`[P2P] Channel open with peer ${peerId}`);
        this.peers.set(peerId, { connection: pc, channel, address: null });
        if (this.onPeerConnect) this.onPeerConnect(peerId);
      };

      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this._handleMessage(peerId, msg);
        } catch (err) {
          console.error('[P2P] Parse error:', err);
        }
      };

      channel.onclose = () => {
        this.peers.delete(peerId);
        if (this.onPeerDisconnect) this.onPeerDisconnect(peerId);
      };

      pc.createOffer().then(offer => pc.setLocalDescription(offer));
    });
  }

  /**
   * Accept a connection offer and return an answer string.
   */
  async acceptOffer(offerString) {
    const offerData = JSON.parse(atob(offerString));
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const peerId = offerData.peerId;

    return new Promise((resolve) => {
      const candidates = [];

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          candidates.push(event.candidate);
        } else {
          const answerData = {
            sdp: pc.localDescription,
            candidates,
            peerId: this.nodeId,
            nodeId: this.nodeId,
          };
          resolve({
            answerString: btoa(JSON.stringify(answerData)),
            peerId,
          });
        }
      };

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.onopen = () => {
          console.log(`[P2P] Channel accepted from peer ${peerId}`);
          this.peers.set(peerId, { connection: pc, channel, address: null });
          if (this.onPeerConnect) this.onPeerConnect(peerId);
        };
        channel.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this._handleMessage(peerId, msg);
          } catch (err) {
            console.error('[P2P] Parse error:', err);
          }
        };
        channel.onclose = () => {
          this.peers.delete(peerId);
          if (this.onPeerDisconnect) this.onPeerDisconnect(peerId);
        };
      };

      pc.setRemoteDescription(offerData.sdp)
        .then(() => {
          for (const candidate of offerData.candidates) {
            pc.addIceCandidate(candidate);
          }
          return pc.createAnswer();
        })
        .then(answer => pc.setLocalDescription(answer));
    });
  }

  /**
   * Complete the connection by applying the answer.
   */
  async completeConnection(peerId, answerString, _pc) {
    const answerData = JSON.parse(atob(answerString));
    await _pc.setRemoteDescription(answerData.sdp);
    for (const candidate of answerData.candidates) {
      await _pc.addIceCandidate(candidate);
    }
  }

  /** Get number of connected peers */
  getPeerCount() {
    let count = 0;
    for (const [, peer] of this.peers) {
      if (peer.channel && peer.channel.readyState === 'open') count++;
    }
    return count;
  }

  /** Get list of connected peer IDs */
  getPeerIds() {
    return [...this.peers.keys()];
  }

  /** Disconnect from all peers */
  disconnect() {
    for (const [peerId, peer] of this.peers) {
      if (peer.channel) peer.channel.close();
      if (peer.connection) peer.connection.close();
    }
    this.peers.clear();
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
    }
  }
}
