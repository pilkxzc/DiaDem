/**
 * DiaDem Signaling Client
 * Connects to the WebSocket signaling server for automatic
 * peer discovery and WebRTC connection establishment.
 *
 * Flow:
 * 1. Connect to signaling server
 * 2. Announce our nodeId
 * 3. Receive list of online peers
 * 4. Automatically initiate WebRTC connections to all peers
 * 5. When new peers join, connect to them too
 */

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_DELAY = 30000;

export class SignalingClient {
  constructor(peerNetwork, options = {}) {
    this.peerNetwork = peerNetwork;
    this.ws = null;
    this.connected = false;
    this.reconnectDelay = RECONNECT_DELAY;
    this.reconnectTimer = null;
    this.pendingConnections = new Map(); // peerId -> RTCPeerConnection

    // Determine signaling server URL
    this.serverUrl = options.serverUrl || this._getDefaultUrl();

    // Callbacks
    this.onStatusChange = options.onStatusChange || null;
  }

  _getDefaultUrl() {
    if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/signal`;
    }
    return 'ws://localhost:3000/signal';
  }

  /** Connect to the signaling server */
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;

    try {
      this.ws = new WebSocket(this.serverUrl);
    } catch (err) {
      console.warn('[Signal] WebSocket creation failed:', err.message);
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[Signal] Connected to signaling server');
      this.connected = true;
      this.reconnectDelay = RECONNECT_DELAY;
      this._emitStatus('connected');

      // Announce ourselves
      this.ws.send(JSON.stringify({
        type: 'announce',
        peerId: this.peerNetwork.nodeId,
        address: this.peerNetwork.nodeId,
        chainHeight: 0,
      }));
    };

    this.ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch { return; }

      this._handleMessage(msg);
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._emitStatus('disconnected');
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  /** Handle signaling messages */
  async _handleMessage(msg) {
    switch (msg.type) {
      // We got the list of existing peers
      case 'peers': {
        console.log(`[Signal] ${msg.peers.length} peers online`);
        for (const peer of msg.peers) {
          if (!this.peerNetwork.peers.has(peer.id)) {
            await this._initiateConnection(peer.id);
          }
        }
        break;
      }

      // A new peer joined
      case 'peer_joined': {
        const peerId = msg.peer?.id;
        console.log(`[Signal] New peer: ${peerId?.slice(0, 12)}...`);
        if (peerId && !this.peerNetwork.peers.has(peerId)) {
          await this._initiateConnection(peerId);
        }
        break;
      }

      // A peer left
      case 'peer_left': {
        // PeerNetwork handles cleanup via channel.onclose
        break;
      }

      // Incoming WebRTC offer
      case 'offer': {
        await this._handleOffer(msg.from, msg.offer);
        break;
      }

      // Incoming WebRTC answer
      case 'answer': {
        await this._handleAnswer(msg.from, msg.answer);
        break;
      }

      // ICE candidate
      case 'ice': {
        await this._handleIce(msg.from, msg.candidate);
        break;
      }

      // Relayed broadcast message (for peers without direct WebRTC)
      case 'relay': {
        this.peerNetwork._handleMessage(msg.from, msg.payload);
        break;
      }
    }
  }

  /** Initiate a WebRTC connection to a remote peer */
  async _initiateConnection(remotePeerId) {
    if (this.pendingConnections.has(remotePeerId)) return;

    const ICE_SERVERS = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pendingConnections.set(remotePeerId, pc);

    const channel = pc.createDataChannel('diadem', { ordered: true });

    // Send ICE candidates as they're gathered
    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({
          type: 'ice',
          to: remotePeerId,
          candidate: event.candidate,
        }));
      }
    };

    channel.onopen = () => {
      console.log(`[Signal] WebRTC channel open with ${remotePeerId.slice(0, 12)}...`);
      this.peerNetwork.peers.set(remotePeerId, {
        connection: pc,
        channel,
        address: remotePeerId,
      });
      this.pendingConnections.delete(remotePeerId);
      if (this.peerNetwork.onPeerConnect) {
        this.peerNetwork.onPeerConnect(remotePeerId);
      }
    };

    channel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.peerNetwork._handleMessage(remotePeerId, msg);
      } catch (err) {
        console.error('[Signal] Parse error:', err);
      }
    };

    channel.onclose = () => {
      this.peerNetwork.peers.delete(remotePeerId);
      this.pendingConnections.delete(remotePeerId);
      if (this.peerNetwork.onPeerDisconnect) {
        this.peerNetwork.onPeerDisconnect(remotePeerId);
      }
    };

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({
        type: 'offer',
        to: remotePeerId,
        offer: pc.localDescription,
      }));
    }
  }

  /** Handle an incoming WebRTC offer */
  async _handleOffer(fromPeerId, offer) {
    const ICE_SERVERS = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pendingConnections.set(fromPeerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws?.readyState === 1) {
        this.ws.send(JSON.stringify({
          type: 'ice',
          to: fromPeerId,
          candidate: event.candidate,
        }));
      }
    };

    pc.ondatachannel = (event) => {
      const channel = event.channel;

      channel.onopen = () => {
        console.log(`[Signal] Accepted channel from ${fromPeerId.slice(0, 12)}...`);
        this.peerNetwork.peers.set(fromPeerId, {
          connection: pc,
          channel,
          address: fromPeerId,
        });
        this.pendingConnections.delete(fromPeerId);
        if (this.peerNetwork.onPeerConnect) {
          this.peerNetwork.onPeerConnect(fromPeerId);
        }
      };

      channel.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.peerNetwork._handleMessage(fromPeerId, msg);
        } catch (err) {
          console.error('[Signal] Parse error:', err);
        }
      };

      channel.onclose = () => {
        this.peerNetwork.peers.delete(fromPeerId);
        this.pendingConnections.delete(fromPeerId);
        if (this.peerNetwork.onPeerDisconnect) {
          this.peerNetwork.onPeerDisconnect(fromPeerId);
        }
      };
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({
        type: 'answer',
        to: fromPeerId,
        answer: pc.localDescription,
      }));
    }
  }

  /** Handle an incoming WebRTC answer */
  async _handleAnswer(fromPeerId, answer) {
    const pc = this.pendingConnections.get(fromPeerId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(answer);
    } catch (err) {
      console.warn('[Signal] Failed to set answer:', err.message);
    }
  }

  /** Handle an incoming ICE candidate */
  async _handleIce(fromPeerId, candidate) {
    const pc = this.pendingConnections.get(fromPeerId);
    if (!pc) return;

    try {
      await pc.addIceCandidate(candidate);
    } catch (err) {
      // ICE candidate may arrive before remote description is set
    }
  }

  /** Update chain height on the signaling server */
  updateHeight(height) {
    if (this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify({ type: 'height', height }));
    }
  }

  /** Schedule reconnection */
  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, MAX_RECONNECT_DELAY);
      this.connect();
    }, this.reconnectDelay);
  }

  _emitStatus(status) {
    if (this.onStatusChange) this.onStatusChange(status);
  }

  /** Disconnect from signaling server */
  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    // Close all pending connections
    for (const [, pc] of this.pendingConnections) {
      pc.close();
    }
    this.pendingConnections.clear();
  }

  /** Get signaling status */
  getStatus() {
    return {
      connected: this.connected,
      serverUrl: this.serverUrl,
      pendingConnections: this.pendingConnections.size,
    };
  }
}
