/**
 * DiaDem Local Persistence Layer
 * Minimal localStorage wrapper ONLY for wallet private keys.
 * All other data lives in the blockchain + CAS (content-addressable storage).
 * This is NOT a database — it's a keychain.
 *
 * Security: Private keys and seed phrases are encrypted with AES-256-GCM
 * using a key derived from the user's password via PBKDF2 (100k iterations).
 * If no password is set, keys are stored in plaintext (legacy mode).
 */

const WALLET_KEY = 'diadem_wallet';
const WALLET_BACKUPS_KEY = 'diadem_wallet_backups';
const SETTINGS_KEY = 'diadem_settings';
const CAS_CACHE_KEY = 'diadem_cas_cache';
const ENCRYPTION_SALT_KEY = 'diadem_enc_salt';
const ENCRYPTION_CHECK_KEY = 'diadem_enc_check';

// ─── AES-256-GCM Encryption Helpers ─────────────────────────

async function deriveEncKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptData(data, password) {
  let salt = null;
  const storedSalt = localStorage.getItem(ENCRYPTION_SALT_KEY);
  if (storedSalt) {
    salt = Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(ENCRYPTION_SALT_KEY, btoa(String.fromCharCode(...salt)));
  }

  const key = await deriveEncKey(password, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(data))
  );

  return JSON.stringify({
    encrypted: true,
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
  });
}

async function decryptData(stored, password) {
  const parsed = JSON.parse(stored);
  if (!parsed.encrypted) return parsed;

  const storedSalt = localStorage.getItem(ENCRYPTION_SALT_KEY);
  if (!storedSalt) throw new Error('No encryption salt found');
  const salt = Uint8Array.from(atob(storedSalt), c => c.charCodeAt(0));

  const key = await deriveEncKey(password, salt);
  const iv = Uint8Array.from(atob(parsed.iv), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(parsed.data), c => c.charCodeAt(0));

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

// In-memory password cache (cleared on page unload)
let _cachedPassword = null;

export class KeyStore {
  /** Set encryption password (call before save/load operations) */
  static setPassword(password) {
    _cachedPassword = password;
  }

  /** Check if wallet storage is encrypted */
  static isEncrypted() {
    try {
      const data = localStorage.getItem(WALLET_KEY);
      if (!data) return false;
      const parsed = JSON.parse(data);
      return parsed.encrypted === true;
    } catch { return false; }
  }

  /** Check if a password has been set for encryption */
  static hasPassword() {
    return localStorage.getItem(ENCRYPTION_CHECK_KEY) !== null;
  }

  /** Verify password is correct by decrypting the check value */
  static async verifyPassword(password) {
    const check = localStorage.getItem(ENCRYPTION_CHECK_KEY);
    if (!check) return true; // no password set
    try {
      const decrypted = await decryptData(check, password);
      return decrypted.check === 'diadem';
    } catch {
      return false;
    }
  }

  /** Enable encryption with a password (encrypts existing wallet data) */
  static async enableEncryption(password) {
    // Store a check value so we can verify the password later
    const checkEncrypted = await encryptData({ check: 'diadem' }, password);
    localStorage.setItem(ENCRYPTION_CHECK_KEY, checkEncrypted);

    _cachedPassword = password;

    // Re-encrypt existing wallet
    const wallet = KeyStore.loadWallet();
    if (wallet) {
      await KeyStore.saveWalletEncrypted(wallet, password);
    }

    // Re-encrypt backups
    const backups = KeyStore.loadWalletBackups();
    if (backups.length > 0) {
      const encrypted = await encryptData(backups, password);
      localStorage.setItem(WALLET_BACKUPS_KEY, encrypted);
    }
  }

  /** Save wallet credentials with encryption if password is set */
  static async saveWalletEncrypted(wallet, password = null) {
    const pwd = password || _cachedPassword;
    const existing = pwd ? await KeyStore.loadWalletAsync(pwd) : KeyStore.loadWallet();
    if (existing && existing.address !== wallet.address) {
      KeyStore._backupWallet(existing);
    }

    const data = {
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      seedPhrase: wallet.seedPhrase,
      createdAt: wallet.createdAt || Date.now(),
    };

    if (pwd) {
      const encrypted = await encryptData(data, pwd);
      localStorage.setItem(WALLET_KEY, encrypted);
    } else {
      localStorage.setItem(WALLET_KEY, JSON.stringify(data));
    }
  }

  /** Save wallet credentials (private key only — never leaves the device) */
  static saveWallet(wallet) {
    // Backup current wallet before overwriting (for seed phrase restore of old wallets)
    const existing = KeyStore.loadWallet();
    if (existing && existing.address !== wallet.address) {
      KeyStore._backupWallet(existing);
    }

    const data = {
      address: wallet.address,
      publicKey: wallet.publicKey,
      privateKey: wallet.privateKey,
      seedPhrase: wallet.seedPhrase,
      createdAt: wallet.createdAt || Date.now(),
    };
    localStorage.setItem(WALLET_KEY, JSON.stringify(data));
  }

  /** Load wallet (async, supports encrypted) */
  static async loadWalletAsync(password = null) {
    const data = localStorage.getItem(WALLET_KEY);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed.encrypted) {
        const pwd = password || _cachedPassword;
        if (!pwd) return null; // can't decrypt without password
        return await decryptData(data, pwd);
      }
      return parsed;
    } catch { return null; }
  }

  /** Backup a wallet to the backups list (dedup by address) */
  static _backupWallet(wallet) {
    try {
      const backups = KeyStore.loadWalletBackups();
      if (backups.some(b => b.address === wallet.address)) return;
      backups.push({
        address: wallet.address,
        publicKey: wallet.publicKey,
        privateKey: wallet.privateKey,
        seedPhrase: wallet.seedPhrase,
        createdAt: wallet.createdAt,
      });
      localStorage.setItem(WALLET_BACKUPS_KEY, JSON.stringify(backups));
    } catch (e) {
      console.warn('[KeyStore] Failed to backup wallet:', e.message);
    }
  }

  /** Load all backed-up wallets */
  static loadWalletBackups() {
    try {
      const data = localStorage.getItem(WALLET_BACKUPS_KEY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  /** Load wallet credentials (sync, plaintext only — use loadWalletAsync for encrypted) */
  static loadWallet() {
    const data = localStorage.getItem(WALLET_KEY);
    if (!data) return null;
    try {
      const parsed = JSON.parse(data);
      if (parsed.encrypted) return null; // need async + password
      return parsed;
    } catch { return null; }
  }

  /** Delete wallet */
  static deleteWallet() {
    localStorage.removeItem(WALLET_KEY);
  }

  /** Check if wallet exists */
  static hasWallet() {
    return localStorage.getItem(WALLET_KEY) !== null;
  }

  /** Save user settings (theme, etc.) */
  static saveSetting(key, value) {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    settings[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  /** Load user setting */
  static loadSetting(key, defaultValue = null) {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return settings[key] ?? defaultValue;
  }

  /** Cache CAS pinned data for offline startup */
  static saveCASCache(data) {
    try {
      localStorage.setItem(CAS_CACHE_KEY, JSON.stringify(data));
    } catch (e) {
      // localStorage quota exceeded — that's fine, CAS data comes from peers
      console.warn('[KeyStore] CAS cache too large for localStorage');
    }
  }

  /** Load CAS cache */
  static loadCASCache() {
    const data = localStorage.getItem(CAS_CACHE_KEY);
    return data ? JSON.parse(data) : null;
  }

  /** Remove encryption (decrypt wallet back to plaintext) */
  static async disableEncryption(password) {
    const wallet = await KeyStore.loadWalletAsync(password);
    if (wallet) {
      localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
    }
    localStorage.removeItem(ENCRYPTION_SALT_KEY);
    localStorage.removeItem(ENCRYPTION_CHECK_KEY);
    _cachedPassword = null;
  }

  /** Full reset */
  static clearAll() {
    localStorage.removeItem(WALLET_KEY);
    localStorage.removeItem(WALLET_BACKUPS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(CAS_CACHE_KEY);
    localStorage.removeItem(ENCRYPTION_SALT_KEY);
    localStorage.removeItem(ENCRYPTION_CHECK_KEY);
    _cachedPassword = null;
  }
}
