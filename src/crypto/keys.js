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

/** Generate a deterministic seed phrase (12 words) from entropy */
export function generateSeedPhrase() {
  // BIP39-like word list (simplified — 256 common words)
  const words = [
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

  const entropy = new Uint8Array(16);
  crypto.getRandomValues(entropy);

  const phrase = [];
  for (let i = 0; i < 12; i++) {
    const idx = ((entropy[i % 16] + (i * 37)) % words.length);
    phrase.push(words[idx]);
  }
  return phrase;
}
