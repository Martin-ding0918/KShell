declare module 'pako' {
  export class Inflate {
    constructor(opts?: {windowBits?: number});
    ended: boolean;
    err: number;
    onData: (chunk: Uint8Array) => void;
    push(data: Uint8Array, flush?: boolean): boolean;
  }
  export function deflate(data: Uint8Array): Uint8Array;
}

declare module 'jpeg-js' {
  export interface JpegDecodeResult {
    width: number;
    height: number;
    data: Uint8Array;
    comments?: string[];
  }
  export function decode(
    buffer: Uint8Array,
    opts: {useTArray: boolean; maxResolutionInMP?: number; maxMemoryUsageInMB?: number},
  ): JpegDecodeResult;
  const jpeg: {decode: typeof decode};
  export default jpeg;
}

declare module 'jsqr' {
  export interface QRCode {
    data: string;
  }
  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ): QRCode | null;
}
