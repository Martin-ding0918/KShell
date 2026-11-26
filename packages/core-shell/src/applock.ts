import {
  bytesToHex,
  constantTimeEqual,
  hexToBytes,
  pbkdf2Sha256,
  utf8Encode,
} from './crypto';

/**
 * App-lock model (v2): multiple methods can be active at the same time so the
 * user is never permanently locked out — e.g. biometric + pattern + password
 * all enabled, any one of them unlocks. Android's biometric API reports
 * strength classes rather than finger/face modality, so biometric is a single
 * method whose display name is resolved by the app layer.
 */

export type SecretKind = 'pattern' | 'password';

export interface LockVerifier {
  /** Random salt, hex. */
  saltHex: string;
  /** PBKDF2-HMAC-SHA256(secret, salt, iterations), hex. */
  hashHex: string;
  iterations: number;
}

export interface LockMethods {
  biometric: boolean;
  pattern: LockVerifier | null;
  password: LockVerifier | null;
}

export interface LockConfig {
  /** True when at least one method is active (derived on every mutation). */
  enabled: boolean;
  methods: LockMethods;
  createdAt: number;
}

export const LOCK_ITERATIONS = 100_000;
const MAX_LOCK_ITERATIONS = 1_000_000;
const HEX_RE = /^[0-9a-fA-F]+$/;

function isValidVerifier(v: unknown): v is LockVerifier {
  if (v == null || typeof v !== 'object') {
    return false;
  }
  const cand = v as Partial<LockVerifier>;
  return (
    typeof cand.saltHex === 'string' &&
    cand.saltHex.length >= LOCK_SALT_LEN * 2 &&
    cand.saltHex.length % 2 === 0 &&
    HEX_RE.test(cand.saltHex) &&
    typeof cand.hashHex === 'string' &&
    cand.hashHex.length >= 2 &&
    cand.hashHex.length % 2 === 0 &&
    HEX_RE.test(cand.hashHex) &&
    typeof cand.iterations === 'number' &&
    Number.isInteger(cand.iterations) &&
    cand.iterations >= 1 &&
    cand.iterations <= MAX_LOCK_ITERATIONS
  );
}

/** Pattern dots are 0..8; the secret is their draw order, e.g. "0136". */
export function patternToString(dots: number[]): string {
  return dots.join('');
}

export function emptyLockConfig(): LockConfig {
  return {
    enabled: false,
    methods: {biometric: false, pattern: null, password: null},
    createdAt: 0,
  };
}

/** Kept for API continuity with the app layer. */
export function disabledConfig(): LockConfig {
  return emptyLockConfig();
}

export function hasActiveMethod(config: LockConfig): boolean {
  return (
    config.methods.biometric ||
    config.methods.pattern != null ||
    config.methods.password != null
  );
}

export function activeSecrets(config: LockConfig): SecretKind[] {
  const kinds: SecretKind[] = [];
  if (config.methods.pattern != null) {
    kinds.push('pattern');
  }
  if (config.methods.password != null) {
    kinds.push('password');
  }
  return kinds;
}

/** Salt length enforced by makeVerifier (matches the backup format). */
export const LOCK_SALT_LEN = 16;

/**
 * Build a verifier from a caller-supplied salt. Salt generation is a platform
 * concern (the app layer uses the native SecureRandom, which is async across
 * the bridge), so this takes bytes, not an RNG callback — same convention as
 * encryptBackup's randomSalt.
 */
export function makeVerifier(
  secret: string,
  salt: Uint8Array,
  iterations: number = LOCK_ITERATIONS,
): LockVerifier {
  if (salt.length < LOCK_SALT_LEN) {
    throw new Error('salt too short');
  }
  const hash = pbkdf2Sha256(utf8Encode(secret), salt, iterations, 32);
  return {saltHex: bytesToHex(salt), hashHex: bytesToHex(hash), iterations};
}

function withMethods(
  config: LockConfig,
  methods: LockMethods,
): LockConfig {
  return {
    enabled: methods.biometric || methods.pattern != null || methods.password != null,
    methods,
    createdAt: config.createdAt || Date.now(),
  };
}

export function setBiometric(config: LockConfig, on: boolean): LockConfig {
  return withMethods(config, {...config.methods, biometric: on});
}

export function setPattern(
  config: LockConfig,
  secret: string,
  salt: Uint8Array,
): LockConfig {
  return withMethods(config, {
    ...config.methods,
    pattern: makeVerifier(secret, salt),
  });
}

export function setPassword(
  config: LockConfig,
  secret: string,
  salt: Uint8Array,
): LockConfig {
  return withMethods(config, {
    ...config.methods,
    password: makeVerifier(secret, salt),
  });
}

export function clearMethod(config: LockConfig, kind: SecretKind): LockConfig {
  return withMethods(config, {...config.methods, [kind]: null});
}

/**
 * Install a precomputed verifier (e.g. hashed off the JS thread via the
 * platform's native PBKDF2). Pure config manipulation; pairing with
 * makeVerifier covers the same paths as setPattern/setPassword.
 */
export function installVerifier(
  config: LockConfig,
  kind: SecretKind,
  verifier: LockVerifier,
): LockConfig {
  return withMethods(config, {...config.methods, [kind]: verifier});
}

export function verifySecret(
  secret: string,
  kind: SecretKind,
  config: LockConfig,
): boolean {
  const verifier =
    kind === 'pattern' ? config.methods.pattern : config.methods.password;
  if (verifier == null) {
    return false;
  }
  const hash = pbkdf2Sha256(
    utf8Encode(secret),
    hexToBytes(verifier.saltHex),
    verifier.iterations,
    32,
  );
  return constantTimeEqual(bytesToHex(hash), verifier.hashHex.toLowerCase());
}

export function serializeLockConfig(config: LockConfig): string {
  return JSON.stringify(config);
}

/** Migrate a v1 (single-method) config into the multi-method shape. */
function migrateV1(parsed: Record<string, unknown>): LockConfig | null {
  const method = parsed.method as string | undefined;
  const secretKind = parsed.secretKind as unknown;
  const verifier = parsed.verifier;
  if (method !== 'biometric' && secretKind == null) {
    return null;
  }
  if (secretKind != null && secretKind !== 'pattern' && secretKind !== 'password') {
    return null;
  }
  const methods: LockMethods = {
    biometric: method === 'biometric',
    pattern: null,
    password: null,
  };
  if (secretKind === 'pattern' || secretKind === 'password') {
    if (verifier == null) {
      if (method !== 'biometric') {
        return null;
      }
    } else {
      if (!isValidVerifier(verifier)) {
        return null;
      }
      methods[secretKind] = {
        saltHex: verifier.saltHex.toLowerCase(),
        hashHex: verifier.hashHex.toLowerCase(),
        iterations: verifier.iterations,
      };
    }
  }
  return {
    enabled: hasActiveMethod({enabled: false, methods, createdAt: 0}),
    methods,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
  };
}

export function deserializeLockConfig(raw: string | null): LockConfig | null {
  if (raw == null || raw.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed == null || typeof parsed !== 'object') {
      return null;
    }
    if (parsed.methods == null) {
      // v1 single-method config (<= 0.0.1-alpha.2 storage format)
      return migrateV1(parsed);
    }
    if (typeof parsed.methods !== 'object') {
      return null;
    }
    const rawMethods = parsed.methods as Partial<LockMethods>;
    if (typeof rawMethods.biometric !== 'boolean') {
      return null;
    }
    if (rawMethods.pattern != null && !isValidVerifier(rawMethods.pattern)) {
      return null;
    }
    if (rawMethods.password != null && !isValidVerifier(rawMethods.password)) {
      return null;
    }
    const methods: LockMethods = {
      biometric: rawMethods.biometric,
      pattern:
        rawMethods.pattern != null
          ? {
              saltHex: rawMethods.pattern.saltHex.toLowerCase(),
              hashHex: rawMethods.pattern.hashHex.toLowerCase(),
              iterations: rawMethods.pattern.iterations,
            }
          : null,
      password:
        rawMethods.password != null
          ? {
              saltHex: rawMethods.password.saltHex.toLowerCase(),
              hashHex: rawMethods.password.hashHex.toLowerCase(),
              iterations: rawMethods.password.iterations,
            }
          : null,
    };
    return {
      enabled: hasActiveMethod({enabled: false, methods, createdAt: 0}),
      methods,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export interface LockAttempts {
  failures: number;
  retryAt: number;
}

export const NO_LOCK_ATTEMPTS: Readonly<LockAttempts> = {failures: 0, retryAt: 0};
const MAX_LOCK_DELAY_MS = 5 * 60_000;

export function recordLockFailure(previous: LockAttempts, now: number): LockAttempts {
  const failures = Math.min(previous.failures + 1, 30);
  const delay = failures < 5 ? 0 : Math.min(5_000 * 2 ** (failures - 5), MAX_LOCK_DELAY_MS);
  return {failures, retryAt: delay > 0 ? now + delay : 0};
}

export function parseLockAttempts(raw: string | null, now: number): LockAttempts {
  if (raw != null) {
    try {
      const value = JSON.parse(raw) as Partial<LockAttempts> | null;
      const {failures, retryAt} = value ?? {};
      if (typeof failures === 'number' && Number.isInteger(failures) && failures >= 0 && failures <= 30 &&
          typeof retryAt === 'number' && Number.isSafeInteger(retryAt) && retryAt >= 0) {
        return {failures, retryAt: Math.min(retryAt, now + MAX_LOCK_DELAY_MS)};
      }
    } catch {
      // Invalid persisted state.
    }
  }
  return NO_LOCK_ATTEMPTS;
}
