import {PairingCredentials} from './types';
import {hostLabel, isValidKimiSid, parsePairingUrl, ParseFailureReason} from './pairing-url';

/**
 * A saved remote machine (paired desktop endpoint). The whole registry is
 * persisted as one JSON blob inside encrypted storage — credentials never
 * touch plain preferences.
 */
/**
 * Observed web-login state for a machine (Kimi Code account pages only;
 * absent = unknown / not applicable, e.g. ZCode hash pairing).
 */
export type MachineLoginState = 'logged-in' | 'logged-out';

export interface MachineRecord {
  id: string;
  /** User-defined display name (defaults to the QR's device name or origin host). */
  name: string;
  credentials: PairingCredentials;
  favorite: boolean;
  /** Manual order within its group (favorites / non-favorites). Smaller first. */
  sortOrder: number;
  createdAt: number;
  lastUsedAt: number | null;
  /** Per-machine notification mute (older backups may lack this field). */
  muted?: boolean;
  /** Last observed console login state (see MachineLoginState). */
  loginState?: MachineLoginState;
  /** When loginState was last observed (ms). */
  loginAt?: number | null;
}

export interface MachineRegistryData {
  version: 1;
  machines: MachineRecord[];
  nextSortOrder: number;
  nextId: number;
}

export type AddResult =
  | {ok: true; record: MachineRecord; updatedExisting: boolean}
  | {ok: false; reason: ParseFailureReason | 'unsupported-host'};

export interface MachineRegistryOptions {
  now?: () => number;
  acceptsCredentials?: (credentials: PairingCredentials) => boolean;
}

function isSupportedKind(creds: Partial<PairingCredentials>): boolean {
  return creds.kind === undefined || creds.kind === 'zcode' || creds.kind === 'kimi';
}

function sanitizeCredentials(raw: unknown): PairingCredentials | null {
  if (raw == null || typeof raw !== 'object') {
    return null;
  }
  const c = raw as Partial<PairingCredentials>;
  if (
    typeof c.sid !== 'string' ||
    c.sid.trim().length === 0 ||
    typeof c.hash !== 'string' ||
    typeof c.origin !== 'string' ||
    !isSupportedKind(c)
  ) {
    return null;
  }
  let normalizedOrigin: string;
  try {
    const parsed = new URL(c.origin);
    if (parsed.protocol !== 'https:') {
      return null;
    }
    normalizedOrigin = parsed.origin;
  } catch {
    return null;
  }
  const sid = c.sid.trim();
  if (c.kind === 'kimi' && !isValidKimiSid(sid)) {
    return null;
  }
  const sanitized: PairingCredentials = {
    sid,
    hash: c.hash,
    origin: normalizedOrigin,
    mid: typeof c.mid === 'string' ? c.mid : null,
    deviceName: typeof c.deviceName === 'string' ? c.deviceName : null,
    appVersion: typeof c.appVersion === 'string' ? c.appVersion : null,
    issuedAt:
      typeof c.issuedAt === 'number' && Number.isFinite(c.issuedAt)
        ? c.issuedAt
        : null,
  };
  if (c.kind !== undefined) {
    sanitized.kind = c.kind;
  }
  if (c.source !== undefined) {
    sanitized.source = typeof c.source === 'string' ? c.source : null;
  }
  if (c.extraQuery !== undefined) {
    sanitized.extraQuery = typeof c.extraQuery === 'string' ? c.extraQuery : null;
  }
  return sanitized;
}

function parseMachineIdNumber(id: string): number {
  const m = /^m([1-9][0-9]*)$/.exec(id);
  if (m == null) {
    return 0;
  }
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n < Number.MAX_SAFE_INTEGER ? n : 0;
}

function defaultName(creds: PairingCredentials): string {  if (creds.kind === 'kimi') {
    // Kimi links carry no device name — label the product source plus an
    // id prefix so multiple devices of one account stay distinguishable.
    return `${hostLabel(creds)} ${creds.sid.slice(0, 8)}`;
  }
  if (creds.deviceName != null && creds.deviceName.length > 0) {
    return creds.deviceName;
  }
  try {
    return new URL(creds.origin).host;
  } catch {
    return creds.origin;
  }
}

export class MachineRegistry {
  private data: MachineRegistryData;
  private readonly now: () => number;
  private readonly acceptsCredentials: NonNullable<MachineRegistryOptions['acceptsCredentials']>;

  constructor(data?: MachineRegistryData | null, opts: MachineRegistryOptions = {}) {
    this.acceptsCredentials = opts.acceptsCredentials ?? (() => true);
    this.now = opts.now ?? Date.now;
    if (data == null) {
      this.data = {version: 1, machines: [], nextSortOrder: 1, nextId: 1};
      return;
    }
    const machines: MachineRecord[] = [];
    let maxId = 0;
    let maxSort = 0;
    for (const raw of data.machines) {
      if (raw == null || typeof raw !== 'object') {
        continue;
      }
      const credentials = sanitizeCredentials(raw.credentials);
      if (
        credentials == null ||
        !this.acceptsCredentials(credentials) ||
        typeof raw.id !== 'string' ||
        raw.id.length === 0 ||
        typeof raw.name !== 'string' ||
        raw.name.trim().length === 0
      ) {
        continue;
      }
      const sortOrder =
        typeof raw.sortOrder === 'number' &&
        Number.isSafeInteger(raw.sortOrder) &&
        raw.sortOrder >= 0 &&
        raw.sortOrder < Number.MAX_SAFE_INTEGER
          ? raw.sortOrder
          : ++maxSort;
      const loginState: MachineLoginState | undefined =
        raw.loginState === 'logged-in' || raw.loginState === 'logged-out'
          ? raw.loginState
          : undefined;
      machines.push({
        id: raw.id,
        name: raw.name,
        credentials,
        favorite: raw.favorite === true,
        sortOrder,
        createdAt:
          typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
            ? raw.createdAt
            : this.now(),
        lastUsedAt:
          typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt)
            ? raw.lastUsedAt
            : null,
        muted: raw.muted === true ? true : raw.muted === false ? false : undefined,
        loginState,
        loginAt:
          typeof raw.loginAt === 'number' && Number.isFinite(raw.loginAt)
            ? raw.loginAt
            : raw.loginAt === null
              ? null
              : undefined,
      });
      maxId = Math.max(maxId, parseMachineIdNumber(raw.id));
      maxSort = Math.max(maxSort, sortOrder);
    }
    const rawNextId =
      typeof data.nextId === 'number' &&
      Number.isSafeInteger(data.nextId) &&
      data.nextId >= 1 &&
      data.nextId < Number.MAX_SAFE_INTEGER
        ? data.nextId
        : 1;
    const rawNextSort =
      typeof data.nextSortOrder === 'number' &&
      Number.isSafeInteger(data.nextSortOrder) &&
      data.nextSortOrder >= 1 &&
      data.nextSortOrder < Number.MAX_SAFE_INTEGER
        ? data.nextSortOrder
        : 1;
    this.data = {
      version: 1,
      machines,
      nextId: Math.max(rawNextId, maxId + 1),
      nextSortOrder: Math.max(rawNextSort, maxSort + 1),
    };
  }

  toJSON(): MachineRegistryData {
    return {
      version: 1,
      machines: this.data.machines.map(m => ({...m})),
      nextSortOrder: this.data.nextSortOrder,
      nextId: this.data.nextId,
    };
  }

  static fromJSON(raw: string | null, opts?: MachineRegistryOptions): MachineRegistry | null {
    if (raw == null || raw.length === 0) {
      return new MachineRegistry(null, opts);
    }
    try {
      const parsed = JSON.parse(raw) as MachineRegistryData;
      if (parsed.version !== 1 || !Array.isArray(parsed.machines)) {
        return null;
      }
      return new MachineRegistry(parsed, opts);
    } catch {
      return null;
    }
  }

  /**
   * Add (or refresh) a machine from a pairing URL. Dedupe key is sid+origin:
   * re-pairing the same desktop keeps name/favorite/order and only rotates
   * the credential material (desktop `rotate()` changes the hash).
   */
  addFromUrl(url: string): AddResult {
    const parsed = parsePairingUrl(url);
    if (!parsed.ok) {
      return {ok: false, reason: parsed.reason};
    }
    const creds = parsed.credentials;
    if (!this.acceptsCredentials(creds)) {
      return {ok: false, reason: 'unsupported-host'};
    }
    const existing = this.data.machines.find(
      m =>
        m.credentials.sid === creds.sid &&
        m.credentials.origin === creds.origin,
    );
    if (existing != null) {
      existing.credentials = creds;
      existing.lastUsedAt = this.now();
      return {ok: true, record: {...existing}, updatedExisting: true};
    }
    const record: MachineRecord = {
      id: `m${this.data.nextId}`,
      name: defaultName(creds),
      credentials: creds,
      favorite: false,
      sortOrder: this.data.nextSortOrder++,
      createdAt: this.now(),
      lastUsedAt: this.now(),
    };
    this.data.nextId++;
    this.data.machines.push(record);
    return {ok: true, record: {...record}, updatedExisting: false};
  }

  get(id: string): MachineRecord | null {
    const m = this.data.machines.find(x => x.id === id);
    return m == null ? null : {...m};
  }

  rename(id: string, name: string): boolean {
    const m = this.data.machines.find(x => x.id === id);
    if (m == null) {
      return false;
    }
    const trimmed = name.trim();
    m.name = trimmed.length > 0 ? trimmed : m.name;
    return true;
  }

  toggleFavorite(id: string): boolean {
    const m = this.data.machines.find(x => x.id === id);
    if (m == null) {
      return false;
    }
    m.favorite = !m.favorite;
    return true;
  }

  /** Mute/unmute status notifications for one machine. */
  setMuted(id: string, muted: boolean): boolean {
    const m = this.data.machines.find(x => x.id === id);
    if (m == null) {
      return false;
    }
    m.muted = muted;
    return true;
  }

  /** Record the last observed web-login state (Kimi Code machines). */
  setLoginState(id: string, state: MachineLoginState): boolean {
    const m = this.data.machines.find(x => x.id === id);
    if (m == null) {
      return false;
    }
    m.loginState = state;
    m.loginAt = this.now();
    return true;
  }

  /** Move a machine up (-1) or down (+1) within its favorite group. */
  move(id: string, direction: -1 | 1): boolean {
    const target = this.data.machines.find(x => x.id === id);
    if (target == null) {
      return false;
    }
    const group = this.sorted().filter(m => m.favorite === target.favorite);
    const idx = group.findIndex(m => m.id === id);
    const swapWith = group[idx + direction];
    if (swapWith == null) {
      return false;
    }
    const a = this.data.machines.find(x => x.id === id)!;
    const b = this.data.machines.find(x => x.id === swapWith.id)!;
    const tmp = a.sortOrder;
    a.sortOrder = b.sortOrder;
    b.sortOrder = tmp;
    return true;
  }

  touch(id: string): void {
    const m = this.data.machines.find(x => x.id === id);
    if (m != null) {
      m.lastUsedAt = this.now();
    }
  }

  remove(id: string): boolean {
    const before = this.data.machines.length;
    this.data.machines = this.data.machines.filter(m => m.id !== id);
    return this.data.machines.length < before;
  }

  /**
   * Merge machines from a decrypted backup. Match key is sid+origin: an
   * existing machine keeps its local name/favorite/order and only gets its
   * credentials refreshed; unknown machines are appended with fresh ids.
   */
  importMachines(records: unknown): {added: number; updated: number} {
    const result = {added: 0, updated: 0};
    if (!Array.isArray(records)) {
      return result;
    }
    for (const r of records) {
      if (r == null || typeof r !== 'object') {
        continue;
      }
      const rec = r as Partial<MachineRecord>;
      const sanitized = sanitizeCredentials(rec.credentials);
      if (
        typeof rec.name !== 'string' ||
        rec.name.trim().length === 0 ||
        sanitized == null ||
        !this.acceptsCredentials(sanitized)
      ) {
        continue;
      }
      if (sanitized.source === undefined) {
        sanitized.source = null;
      }
      if (sanitized.extraQuery === undefined) {
        sanitized.extraQuery = null;
      }
      const loginState: MachineLoginState | undefined =
        rec.loginState === 'logged-in' || rec.loginState === 'logged-out'
          ? rec.loginState
          : undefined;
      const existing = this.data.machines.find(
        m => m.credentials.sid === sanitized.sid && m.credentials.origin === sanitized.origin,
      );
      if (existing != null) {
        existing.credentials = sanitized;
        result.updated++;
        continue;
      }
      this.data.machines.push({
        id: `m${this.data.nextId++}`,
        name: rec.name,
        credentials: sanitized,
        favorite: rec.favorite === true,
        sortOrder: this.data.nextSortOrder++,
        createdAt:
          typeof rec.createdAt === 'number' && Number.isFinite(rec.createdAt)
            ? rec.createdAt
            : this.now(),
        lastUsedAt: null,
        muted: rec.muted === true,
        ...(loginState != null
          ? {
              loginState,
              loginAt:
                typeof rec.loginAt === 'number' && Number.isFinite(rec.loginAt)
                  ? rec.loginAt
                  : null,
            }
          : {}),
      });
      result.added++;
    }
    return result;
  }

  /** Display order: favorites first, then manual sortOrder ascending. */
  sorted(): MachineRecord[] {
    return [...this.data.machines]
      .sort((a, b) => {
        if (a.favorite !== b.favorite) {
          return a.favorite ? -1 : 1;
        }
        return a.sortOrder - b.sortOrder;
      })
      .map(m => ({...m}));
  }

  get size(): number {
    return this.data.machines.length;
  }
}
