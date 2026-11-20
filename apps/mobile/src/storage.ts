import {MMKVLoader} from 'react-native-mmkv-storage';
import {
  deserializeLockConfig,
  disabledConfig,
  hostKindOf,
  KNOWN_ORIGINS,
  LegalConsent,
  LockConfig,
  LockAttempts,
  parseLockAttempts,
  MachineRegistry,
  PairingCredentials,
  SecureKvStore,
  serializeLockConfig,
  STORAGE_KEYS,
} from '@zshell/core-shell';

/**
 * Encrypted MMKV instance. `.withEncryption()` makes MMKV generate a random
 * AES key and store it in the Android Keystore (API 23+) / iOS Keychain —
 * machine credentials and lock verifiers never exist in plaintext at rest.
 */
const mmkv = new MMKVLoader()
  .withInstanceID('zshellSecure')
  .withEncryption()
  .initialize();

/**
 * Policy gate for every pairing entry point (scan, manual link, backup
 * restore): official Kimi Code device pages and official ZCode console
 * origins only. DSH stays out of the app. Legacy ZCode records (kind absent,
 * restored from old backups) pass through hostKindOf's 'zcode' default.
 */
function acceptsCredentials(credentials: PairingCredentials | null): boolean {
  if (credentials == null) {
    return false;
  }
  if (hostKindOf(credentials) === 'kimi') {
    return /^https:\/\/code-rc\.kimi\.(com|ai)$/.test(credentials.origin);
  }
  if (hostKindOf(credentials) === 'zcode') {
    const origin = credentials.origin.toLowerCase();
    return origin === KNOWN_ORIGINS.international || origin === KNOWN_ORIGINS.china;
  }
  return false;
}

const registryOptions: ConstructorParameters<typeof MachineRegistry>[1] = {
  acceptsCredentials,
};

export const secureStore: SecureKvStore = {
  getString: (key: string): string | null =>
    (mmkv.getString(key) as string | null) ?? null,
  set: (key: string, value: string): void => {
    if (!mmkv.setString(key, value)) throw new Error('无法写入加密存储');
  },
  remove: (key: string): void => {
    mmkv.removeItem(key);
  },
};

export function loadRegistry(): MachineRegistry {
  return (
    MachineRegistry.fromJSON(secureStore.getString(STORAGE_KEYS.machines), registryOptions) ??
    new MachineRegistry(null, registryOptions)
  );
}

export function saveRegistry(registry: MachineRegistry): void {
  secureStore.set(STORAGE_KEYS.machines, JSON.stringify(registry.toJSON()));
}

export function loadLockConfig(): LockConfig {
  return (
    deserializeLockConfig(secureStore.getString(STORAGE_KEYS.lock)) ??
    disabledConfig()
  );
}

export function saveLockConfig(config: LockConfig): void {
  secureStore.set(STORAGE_KEYS.lock, serializeLockConfig(config));
  clearLockAttempts();
}

export function loadLockAttempts(): LockAttempts {
  return parseLockAttempts(secureStore.getString(STORAGE_KEYS.lockAttempts), Date.now());
}

export function saveLockAttempts(attempts: LockAttempts): void {
  secureStore.set(STORAGE_KEYS.lockAttempts, JSON.stringify(attempts));
}

export function clearLockAttempts(): void {
  secureStore.remove(STORAGE_KEYS.lockAttempts);
}

export function loadLegalConsent(): LegalConsent | null {
  const raw = secureStore.getString(STORAGE_KEYS.legal);
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw) as LegalConsent;
  } catch {
    return null;
  }
}

export function saveLegalConsent(consent: LegalConsent): void {
  secureStore.set(STORAGE_KEYS.legal, JSON.stringify(consent));
}
