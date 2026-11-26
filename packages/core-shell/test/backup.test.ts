import {pbkdf2Sync} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  BACKUP_ITERATIONS,
  backupKeysFromMaster,
  decryptBackup,
  decryptBackupWithKeys,
  encryptBackupWithKeys,
  parseBackupBlob,
} from '../src/backup';
import {DiagnosticsLog} from '../src/diagnostics';
import {MachineRegistry} from '../src/machine';

const SALT = new Uint8Array(16).map((_, i) => i + 1);

function registryJson(): string {
  const reg = new MachineRegistry();
  reg.addFromUrl(
    'https://zcode.z.ai/remote/v4?sid=abc123&hash=deadbeef&name=My%20Desktop',
  );
  reg.rename('m1', '工作机');
  reg.toggleFavorite('m1');
  return JSON.stringify(reg.toJSON());
}

describe('backup encryption', () => {
  const pass = 'correct horse battery';
  const keysFor = (salt: Uint8Array, iterations = BACKUP_ITERATIONS) =>
    backupKeysFromMaster(pbkdf2Sync(pass, salt, iterations, 64, 'sha256'));
  const keys = keysFor(SALT);
  const payload = registryJson();
  const blob = encryptBackupWithKeys(payload, keys, SALT);

  it('round-trips ZSBK2 with native-equivalent PBKDF2 and authenticates the header', () => {
    expect(blob.startsWith('ZSBK2.600000.')).toBe(true);
    expect(blob).not.toContain('deadbeef');
    expect(parseBackupBlob(blob)).toEqual({
      salt: SALT, saltB64: 'AQIDBAUGBwgJCgsMDQ4PEA==', iterations: BACKUP_ITERATIONS,
    });
    expect(decryptBackupWithKeys(blob, keys)).toBe(payload);
    expect(decryptBackupWithKeys(blob.replace('.600000.', '.600001.'), keys)).toBeNull();
  });

  it('restores an independent legacy ZSBK1 fixture using its original KDF', () => {
    const fixture = 'ZSBK1.AQIDBAUGBwgJCgsMDQ4PEA==.x8Bc7ZEbxLOBVv/TZUSX.bJa8GX5tokyYeBfcFfZITExRjx32wKCBO82OFzhoDgs=';
    expect(parseBackupBlob(fixture)?.iterations).toBe(20_000);
    expect(decryptBackup(fixture, 'legacy passphrase')).toBe('{"machines":[]}');
  });

  it('rejects a wrong passphrase and tampered ciphertext or tag', () => {
    const wrong = backupKeysFromMaster(pbkdf2Sync('wrong', SALT, BACKUP_ITERATIONS, 64, 'sha256'));
    expect(decryptBackupWithKeys(blob, wrong)).toBeNull();
    const parts = blob.split('.');
    for (const index of [3, 4]) {
      const tampered = parts.slice();
      tampered[index] = (tampered[index][0] === 'A' ? 'B' : 'A') + tampered[index].slice(1);
      expect(decryptBackupWithKeys(tampered.join('.'), keys)).toBeNull();
    }
  });

  it.each(['0', '-1', '1e6', '600000.5', '0600000', '599999', '1000001'])('rejects iteration field %s before deriving keys', value => {
    expect(parseBackupBlob(blob.replace('.600000.', `.${value}.`))).toBeNull();
  });

  it('rejects malformed shapes', () => {
    expect(parseBackupBlob('')).toBeNull();
    expect(parseBackupBlob('ZSBK1.YQ.YQ.YQ')).toBeNull();
    expect(parseBackupBlob('OTHER.@@@@@@@@@@@@@@@@@@@.YQ.YQ.YQ.YQ')).toBeNull();
  });

  it('rejects non-canonical Base64 and header/ciphertext boundary shifts', () => {
    const parts = blob.split('.');
    // Appending '=' or non-Base64 chars to saltB64 must be rejected even though
    // lenient base64ToBytes would ignore them and keep the salt unchanged.
    expect(parseBackupBlob([parts[0], parts[1], parts[2] + '=', parts[3], parts[4]].join('.'))).toBeNull();
    expect(parseBackupBlob([parts[0], parts[1], parts[2] + '!', parts[3], parts[4]].join('.'))).toBeNull();
    expect(parseBackupBlob([parts[0], parts[1], parts[2], parts[3] + '\n', parts[4]].join('.'))).toBeNull();
    expect(decryptBackupWithKeys([parts[0], parts[1], parts[2] + '=', parts[3], parts[4]].join('.'), keys)).toBeNull();
  });

  it('round-trips Unicode and makes distinct ciphertext for distinct salts', () => {
    const json = JSON.stringify({name: '华为手机-🧪-Ωμέγα'});
    const salt2 = new Uint8Array(16).fill(9);
    const keys2 = keysFor(salt2);
    const a = encryptBackupWithKeys(json, keys, SALT);
    const b = encryptBackupWithKeys(json, keys2, salt2);
    expect(a.split('.')[3]).not.toBe(b.split('.')[3]);
    expect(decryptBackupWithKeys(b, keys2)).toBe(json);
  });
});

describe('DiagnosticsLog', () => {
  it('keeps newest events within the cap', () => {
    const log = new DiagnosticsLog(5);
    for (let i = 0; i < 8; i++) {
      log.push('ws-closed', `code=${i}`, 1000 + i);
    }
    const recent = log.recent();
    expect(recent).toHaveLength(5);
    expect(recent[0].detail).toBe('code=7');
    expect(recent[4].detail).toBe('code=3');
  });

  it('persists and restores via JSON', () => {
    const log = new DiagnosticsLog();
    log.push('ws-connected', undefined, 42);
    log.push('kicked');
    const restored = DiagnosticsLog.fromJSON(log.toJSON());
    expect(restored.size).toBe(2);
    expect(restored.recent()[0].type).toBe('kicked');
    expect(restored.recent()[1].t).toBe(42);
  });

  it('tolerates corrupt persisted JSON', () => {
    expect(DiagnosticsLog.fromJSON('!!!').size).toBe(0);
    expect(DiagnosticsLog.fromJSON(null).size).toBe(0);
  });
});

describe('machine mute', () => {
  it('toggles and persists through toJSON', () => {
    const reg = new MachineRegistry();
    reg.addFromUrl(
      'https://zcode.z.ai/remote/v4?sid=s&hash=h',
    );
    expect(reg.setMuted('m1', true)).toBe(true);
    expect(reg.get('m1')?.muted).toBe(true);
    const revived = MachineRegistry.fromJSON(JSON.stringify(reg.toJSON()));
    expect(revived?.get('m1')?.muted).toBe(true);
    expect(reg.setMuted('nope', true)).toBe(false);
  });
});

describe('importMachines', () => {
  const backupMachine = {
    id: 'm9',
    name: '备份机',
    credentials: {sid: 'sid-x', hash: 'hash-x', origin: 'https://zcode.z.ai'},
    favorite: true,
    sortOrder: 1,
    createdAt: 1,
    lastUsedAt: null,
  };

  it('appends unknown machines and refreshes known credentials', () => {
    const reg = new MachineRegistry();
    reg.addFromUrl('https://zcode.z.ai/remote/v4?sid=sid-x&hash=old-hash');
    const r = reg.importMachines([backupMachine]);
    expect(r).toEqual({added: 0, updated: 1});
    expect(reg.size).toBe(1);
    expect(reg.get('m1')?.credentials.hash).toBe('hash-x');
    // Local name/order survive the credential refresh.
    expect(reg.get('m1')?.favorite).toBe(false);

    const r2 = reg.importMachines([
      {...backupMachine, credentials: {sid: 'sid-y', hash: 'h', origin: 'https://zcode.z.ai'}},
    ]);
    expect(r2).toEqual({added: 1, updated: 0});
    expect(reg.size).toBe(2);
  });

  it('skips malformed entries', () => {
    const reg = new MachineRegistry();
    expect(reg.importMachines('nope')).toEqual({added: 0, updated: 0});
    expect(reg.importMachines([{name: 1}, null, {}])).toEqual({added: 0, updated: 0});
    expect(reg.size).toBe(0);
  });
});
