import {Inflate} from 'pako';

/**
 * Minimal dependency-free PNG decoder for QR screenshots: 8-bit depth,
 * color types 0/2/3/4/6, non-interlaced. Uses pako (pure JS) for IDAT
 * inflate so it runs identically on Hermes and any future ArkTS host.
 */

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

export const MAX_QR_IMAGE_PIXELS = 1600 * 1600;

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

const CHANNELS: Record<number, number> = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};

export function decodePng(bytes: Uint8Array): RgbaImage | null {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) {
      return null;
    }
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  while (pos + 8 <= bytes.length) {
    const len =
      ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
    const type = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7],
    );
    if (len > bytes.length - pos - 12) return null;
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      if (pos !== 8 || len !== 13) return null;
      width =
        ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
      height =
        ((data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]) >>> 0;
      if (width === 0 || height === 0 || width * height > MAX_QR_IMAGE_PIXELS) return null;
      const bitDepth = data[8];
      colorType = data[9];
      const interlace = data[12];
      if (bitDepth !== 8 || interlace !== 0 || CHANNELS[colorType] == null) {
        return null;
      }
    } else if (type === 'PLTE') {
      if (len === 0 || len > 768 || len % 3 !== 0) return null;
      palette = data.slice();
    } else if (type === 'tRNS') {
      if (len > 256 && colorType === 3) return null;
      trns = data.slice();
    } else if (type === 'IDAT') {
      if (data.length > 0) idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (width <= 0 || height <= 0 || colorType < 0 || idat.length === 0) {
    return null;
  }
  if (colorType === 3) {
    if (palette == null || (trns != null && trns.length > palette.length / 3)) {
      return null;
    }
  }

  const channels = CHANNELS[colorType];
  const bpp = channels;
  const stride = width * channels;
  const raw = new Uint8Array(height * (stride + 1));
  let written = 0;
  try {
    const inflater = new Inflate({windowBits: 15});
    inflater.onData = chunk => {
      if (typeof chunk === 'string' || chunk.length > raw.length - written) {
        throw new Error('PNG exceeds declared size');
      }
      raw.set(chunk, written);
      written += chunk.length;
    };
    for (let i = 0; i < idat.length; i++) {
      if (inflater.ended || !inflater.push(idat[i], i === idat.length - 1)) return null;
    }
    if (!inflater.ended || inflater.err || written !== raw.length) return null;
  } catch {
    return null;
  }

  // Unfilter row-by-row directly into RGBA using two 1-row scratch buffers
  // instead of holding a full intermediate recon image in memory.
  const rgba = new Uint8ClampedArray(width * height * 4);
  let prevRow = new Uint8Array(stride);
  let currRow = new Uint8Array(stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    for (let x = 0; x < stride; x++) {
      const filt = raw[src + x];
      const left = x >= bpp ? currRow[x - bpp] : 0;
      const up = y > 0 ? prevRow[x] : 0;
      const upLeft = y > 0 && x >= bpp ? prevRow[x - bpp] : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = filt;
          break;
        case 1:
          value = filt + left;
          break;
        case 2:
          value = filt + up;
          break;
        case 3:
          value = filt + ((left + up) >> 1);
          break;
        case 4:
          value = filt + paeth(left, up, upLeft);
          break;
        default:
          return null;
      }
      currRow[x] = value & 0xff;
    }
    src += stride;

    const rowPixelBase = y * width;
    for (let x = 0; x < width; x++) {
      const o = x * channels;
      const q = (rowPixelBase + x) * 4;
      switch (colorType) {
        case 0:
          rgba[q] = currRow[o];
          rgba[q + 1] = currRow[o];
          rgba[q + 2] = currRow[o];
          rgba[q + 3] = 255;
          break;
        case 2:
          rgba[q] = currRow[o];
          rgba[q + 1] = currRow[o + 1];
          rgba[q + 2] = currRow[o + 2];
          rgba[q + 3] = 255;
          break;
        case 3: {
          const idx = currRow[o];
          if (idx * 3 + 2 >= palette!.length) return null;
          rgba[q] = palette![idx * 3];
          rgba[q + 1] = palette![idx * 3 + 1];
          rgba[q + 2] = palette![idx * 3 + 2];
          rgba[q + 3] = trns != null && idx < trns.length ? trns[idx] : 255;
          break;
        }
        case 4:
          rgba[q] = currRow[o];
          rgba[q + 1] = currRow[o];
          rgba[q + 2] = currRow[o];
          rgba[q + 3] = currRow[o + 1];
          break;
        case 6:
          rgba[q] = currRow[o];
          rgba[q + 1] = currRow[o + 1];
          rgba[q + 2] = currRow[o + 2];
          rgba[q + 3] = currRow[o + 3];
          break;
      }
    }
    const swap = prevRow;
    prevRow = currRow;
    currRow = swap;
  }
  return {width, height, rgba};
}
