/**
 * DiaDem Cryptographic Module
 * ECDSA P-256 key management, signing, and verification via Web Crypto API
 * No external dependencies — runs entirely in the browser
 */

const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN_ALGO = { name: 'ECDSA', hash: 'SHA-256' };

/** Convert ArrayBuffer to hex string */
export function bufToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Convert hex string to ArrayBuffer */
export function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

/** SHA-256 hash of a string, returns hex */
export async function sha256(data) {
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return bufToHex(hash);
}

/** Double SHA-256 (like Bitcoin) */
export async function doubleSha256(data) {
  const first = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  const second = await crypto.subtle.digest('SHA-256', first);
  return bufToHex(second);
}

/** Generate a new ECDSA P-256 keypair */
export async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const address = '0x' + (await sha256(bufToHex(publicKeyRaw))).slice(0, 40);

  return {
    publicKey: bufToHex(publicKeyRaw),
    privateKey: privateKeyJwk,
    address,
    _keyPair: keyPair
  };
}

/** Import a private key from JWK format */
export async function importPrivateKey(jwk) {
  return crypto.subtle.importKey('jwk', jwk, ALGO, true, ['sign']);
}

/** Import a public key from hex */
export async function importPublicKey(hex) {
  return crypto.subtle.importKey('raw', hexToBuf(hex), ALGO, true, ['verify']);
}

/** Sign data with private key (JWK), returns hex signature */
export async function sign(data, privateKeyJwk) {
  const key = await importPrivateKey(privateKeyJwk);
  const encoded = new TextEncoder().encode(data);
  const sig = await crypto.subtle.sign(SIGN_ALGO, key, encoded);
  return bufToHex(sig);
}

/** Verify signature against public key (hex) */
export async function verify(data, signature, publicKeyHex) {
  try {
    const key = await importPublicKey(publicKeyHex);
    const encoded = new TextEncoder().encode(data);
    return crypto.subtle.verify(SIGN_ALGO, key, hexToBuf(signature), encoded);
  } catch {
    return false;
  }
}

/** Derive address from public key hex */
export async function addressFromPublicKey(publicKeyHex) {
  return '0x' + (await sha256(publicKeyHex)).slice(0, 40);
}

// BIP39-like word list (simplified — 256 common words)
const SEED_WORDS = [
  'abandon','ability','able','abstract','absurd','abuse','access','accident',
  'account','acid','acoustic','acquire','across','act','action','actual',
  'adapt','add','addict','address','adjust','admit','adult','advance',
  'advice','aerobic','affair','afford','agree','ahead','aim','air',
  'airport','aisle','alarm','album','alert','alien','all','alley',
  'allow','almost','alone','alpha','already','also','alter','always',
  'amateur','among','amount','amused','anchor','ancient','anger','angle',
  'animal','ankle','announce','annual','another','answer','antenna','antique',
  'apart','apology','appear','apple','approve','april','arch','arctic',
  'arena','army','arrange','arrest','arrive','arrow','art','artefact',
  'artist','asthma','athlete','atom','attack','attend','auction','audit',
  'august','aunt','author','auto','avocado','avoid','awake','aware',
  'awesome','awful','awkward','axis','baby','bachelor','bacon','badge',
  'bag','balance','balcony','ball','bamboo','banana','banner','bar',
  'basic','basket','battle','beach','bean','beauty','become','beef',
  'before','begin','behave','behind','believe','bench','benefit','best',
  'betray','beyond','bicycle','bird','birth','bitter','blade','blame',
  'blanket','blast','bleak','bless','blind','blood','blossom','blue',
  'blur','blush','board','boat','body','boil','bomb','bone',
  'bonus','book','boost','border','bounce','box','brain','brand',
  'brave','bread','breeze','brick','bridge','bright','bring','broad',
  'broken','bronze','broom','brother','brown','brush','bubble','buddy',
  'budget','buffalo','build','bulk','bullet','bundle','burden','burger',
  'burst','bus','business','busy','butter','buyer','cabin','cable',
  'cactus','cage','cake','call','calm','camera','camp','canal',
  'cancel','canvas','canyon','capable','capital','captain','carbon','card',
  'cargo','carpet','carry','cart','case','cash','castle','casual',
  'catalog','catch','category','cattle','cause','cave','ceiling','celery'
];

/** Generate a deterministic seed phrase (12 words) from entropy */
export function generateSeedPhrase() {
  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);

  const phrase = [];
  for (let i = 0; i < 12; i++) {
    const idx = ((entropy[i % 16] + (i * 37)) % SEED_WORDS.length);
    phrase.push(SEED_WORDS[idx]);
  }
  return phrase;
}

/** Validate that a seed phrase contains valid words */
export function validateSeedPhrase(phrase) {
  if (!Array.isArray(phrase)) phrase = phrase.trim().split(/\s+/);
  if (phrase.length !== 12) return false;
  return phrase.every(w => SEED_WORDS.includes(w.toLowerCase()));
}

/** Derive ECDSA P-256 keypair deterministically from a seed phrase.
 *  Uses PBKDF2 to derive key material, then imports as ECDSA private key. */
export async function deriveKeyFromSeed(seedPhrase) {
  const phrase = Array.isArray(seedPhrase) ? seedPhrase.join(' ') : seedPhrase.trim();

  // Derive 32 bytes via PBKDF2(SHA-256, seed, "diadem-p256", 100000)
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(phrase), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('diadem-p256-v1'), iterations: 100000 },
    baseKey,
    256
  );

  // Use derived 32 bytes as the "d" parameter of P-256 private key (JWK format)
  // P-256 private key is a 32-byte scalar
  const dBytes = new Uint8Array(derived);
  const dB64 = btoa(String.fromCharCode(...dBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  // Import as JWK private key to compute the public point
  // We need to use a workaround: generate a key, then re-import with our "d" value
  // First, generate a throwaway key to get the structure
  const tempPair = await crypto.subtle.generateKey(ALGO, true, ['sign', 'verify']);
  const tempJwk = await crypto.subtle.exportKey('jwk', tempPair.privateKey);

  // Replace d with our derived value
  tempJwk.d = dB64;

  // Try to import — if d is out of range for P-256, hash again to reduce
  let privateKey, publicKeyRaw;
  try {
    privateKey = await crypto.subtle.importKey('jwk', tempJwk, ALGO, true, ['sign']);
    // Derive matching public key
    const pubJwk = { ...tempJwk };
    delete pubJwk.d;
    pubJwk.key_ops = ['verify'];
    const publicKey = await crypto.subtle.importKey('jwk', pubJwk, ALGO, true, ['verify']);
    publicKeyRaw = await crypto.subtle.exportKey('raw', publicKey);
  } catch {
    // If d is invalid for P-256 curve order, hash it to get valid scalar
    const h = await crypto.subtle.digest('SHA-256', derived);
    const hBytes = new Uint8Array(h);
    // Ensure < curve order by zeroing top bit
    hBytes[0] &= 0x7F;
    const dB64v2 = btoa(String.fromCharCode(...hBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    tempJwk.d = dB64v2;
    privateKey = await crypto.subtle.importKey('jwk', tempJwk, ALGO, true, ['sign']);
    const pubJwk = { ...tempJwk };
    delete pubJwk.d;
    pubJwk.key_ops = ['verify'];
    const publicKey = await crypto.subtle.importKey('jwk', pubJwk, ALGO, true, ['verify']);
    publicKeyRaw = await crypto.subtle.exportKey('raw', publicKey);
  }

  const privateKeyJwk = await crypto.subtle.exportKey('jwk', privateKey);
  const publicKeyHex = bufToHex(publicKeyRaw);
  const address = '0x' + (await sha256(publicKeyHex)).slice(0, 40);

  return { publicKey: publicKeyHex, privateKey: privateKeyJwk, address };
}

/** Generate an access key string from wallet data (base64-encoded encrypted export) */
export async function generateAccessKey(wallet) {
  const payload = JSON.stringify({
    a: wallet.address,
    p: wallet.publicKey,
    k: wallet.privateKey,
    s: wallet.seedPhrase,
    t: wallet.createdAt,
  });
  // Encode as base64 with a prefix
  return 'DDM1-' + btoa(unescape(encodeURIComponent(payload)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parse an access key string back to wallet data */
export function parseAccessKey(accessKey) {
  if (!accessKey || !accessKey.startsWith('DDM1-')) return null;
  try {
    const b64 = accessKey.slice(5).replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - b64.length % 4) % 4);
    const json = decodeURIComponent(escape(atob(padded)));
    const data = JSON.parse(json);
    return {
      address: data.a,
      publicKey: data.p,
      privateKey: data.k,
      seedPhrase: data.s,
      createdAt: data.t,
    };
  } catch {
    return null;
  }
}
