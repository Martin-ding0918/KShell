import {deflateSync} from 'node:zlib';
import {describe, expect, it} from 'vitest';
import {decodePng} from '../src/PngDecoder';

function png(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const chunk = (name: string, data: Uint8Array) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(data.length);
    header.write(name, 4);
    return Buffer.concat([header, data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = deflateSync(pixels);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', compressed.subarray(0, 5)), chunk('IDAT', compressed.subarray(5)),
    chunk('IEND', new Uint8Array()),
  ]);
}

describe('PNG QR image decoder', () => {
  it('reads scanlines split across IDAT chunks', () => {
    const img = decodePng(png(1, 1, Uint8Array.of(0, 1, 2, 3, 255)));
    expect(img).toEqual({width: 1, height: 1, rgba: Uint8ClampedArray.of(1, 2, 3, 255)});
  });

  it('rejects oversized dimensions', () => {
    expect(decodePng(png(60_000, 60_000, new Uint8Array()))).toBeNull();
  });

  it('rejects inflated data larger than the declared scanlines', () => {
    expect(decodePng(png(1, 1, new Uint8Array(1024 * 1024)))).toBeNull();
  });
});
