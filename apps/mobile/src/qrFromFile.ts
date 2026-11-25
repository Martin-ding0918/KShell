import {launchImageLibrary} from 'react-native-image-picker';
import jsQR from 'jsqr';
import jpeg from 'jpeg-js';
import {base64ToBytes} from '@zshell/core-shell';
import {decodePng, MAX_QR_IMAGE_PIXELS, RgbaImage} from './PngDecoder';

const MAX_QR_BASE64_LENGTH = 16 * 1024 * 1024;

function decodeImage(bytes: Uint8Array): RgbaImage | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
    return decodePng(bytes);
  }
  if (bytes.length > 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    try {
      const d = jpeg.decode(bytes, {useTArray: true, maxResolutionInMP: MAX_QR_IMAGE_PIXELS / 1_000_000, maxMemoryUsageInMB: 64});
      return {
        width: d.width,
        height: d.height,
        rgba: new Uint8ClampedArray(d.data),
      };
    } catch {
      return null;
    }
  }
  return null;
}

/** Decode a QR (pairing URL) from base64 image bytes; null when no QR found. */
export function decodeQrFromBase64(b64: string): string | null {
  if (!b64 || b64.length > MAX_QR_BASE64_LENGTH) {
    return null;
  }
  const img = decodeImage(base64ToBytes(b64));
  if (img == null) {
    return null;
  }
  const code = jsQR(img.rgba, img.width, img.height);
  return code != null ? code.data : null;
}

/** Open the system photo picker and try to decode a QR from the chosen image. */
export async function pickAndDecodeQr(): Promise<string | null> {
  const res = await launchImageLibrary({
    mediaType: 'photo',
    includeBase64: true,
    selectionLimit: 1,
    maxWidth: 1600,
    maxHeight: 1600,
  });
  if (res.errorCode) throw new Error('无法读取所选图片');
  const asset = res.assets?.[0];
  if (asset?.base64 == null) {
    return null;
  }
  return decodeQrFromBase64(asset.base64);
}
