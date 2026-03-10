/**
 * DiaDem Local Persistence Layer
 * Minimal localStorage wrapper ONLY for wallet private keys.
 * All other data lives in the blockchain + CAS (content-addressable storage).
 * This is NOT a database — it's a keychain.
 */

const WALLET_KEY = 'diadem_wallet';
const WALLET_BACKUPS_KEY = 'diadem_wallet_backups';
const SETTINGS_KEY = 'diadem_settings';
const CAS_CACHE_KEY = 'diadem_cas_cache';

export class KeyStore {
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

  /** Load wallet credentials */
  static loadWallet() {
    const data = localStorage.getItem(WALLET_KEY);
    return data ? JSON.parse(data) : null;
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

  /** Full reset */
  static clearAll() {
    localStorage.removeItem(WALLET_KEY);
    localStorage.removeItem(WALLET_BACKUPS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(CAS_CACHE_KEY);
  }
}
