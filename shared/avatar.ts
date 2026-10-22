// Private, self-contained thumbnails; no remote URLs or active image formats.
import { t } from './i18n.ts';
import type { Person } from './types.ts';

export const AVATAR_SIZE = 128;
export const AVATAR_MAX_BYTES = 64 * 1024;
export const AVATAR_INPUT_MAX_BYTES = 8 * 1024 * 1024;
const fail = (): never => {
  throw new Error(t('server.avatarInvalid'));
};

export function avatarCrop(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 40_000_000) return fail();
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side, size: AVATAR_SIZE };
}

/** Check byte signatures, bounded container chunks, dimensions and metadata. */
export function validateAvatar(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== 'string' || value.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 32) return fail();
  const match = /^data:image\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) return fail();
  let raw: string;
  try {
    raw = atob(match[2]);
  } catch {
    return fail();
  }
  if (raw.length > AVATAR_MAX_BYTES || btoa(raw) !== match[2]) return fail();
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const str = (offset: number, n: number) => raw.slice(offset, offset + n);
  let width = 0,
    height = 0;
  if (match[1] === 'png') {
    if (str(0, 8) !== '\x89PNG\r\n\x1a\n') return fail();
    let offset = 8,
      data = false,
      ended = false;
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset),
        kind = str(offset + 4, 4);
      if (offset + length + 12 > bytes.length || !['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(kind)) return fail();
      let crc = 0xffffffff;
      for (let i = offset + 4; i < offset + 8 + length; i++) {
        crc ^= bytes[i];
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
      if ((crc ^ 0xffffffff) >>> 0 !== view.getUint32(offset + 8 + length)) return fail();
      if (offset === 8) {
        if (kind !== 'IHDR' || length !== 13) return fail();
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        if (bytes[offset + 18] || bytes[offset + 19] || bytes[offset + 20]) return fail();
      } else if (kind === 'IHDR') return fail();
      if (kind === 'IDAT' && length > 0) data = true;
      offset += length + 12;
      if (kind === 'IEND') {
        if (length || !data || offset !== bytes.length) return fail();
        ended = true;
        break;
      }
    }
    if (!ended) return fail();
  } else {
    if (bytes.length < 30 || str(0, 4) !== 'RIFF' || str(8, 4) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) return fail();
    let offset = 12,
      image = false,
      canvasWidth = 0,
      canvasHeight = 0;
    while (offset + 8 <= bytes.length) {
      const kind = str(offset, 4),
        length = view.getUint32(offset + 4, true),
        start = offset + 8;
      if (start + length > bytes.length || !['VP8 ', 'VP8L', 'VP8X', 'ALPH'].includes(kind)) return fail();
      if (kind === 'VP8X') {
        if (offset !== 12 || length !== 10 || bytes[start] & ~16 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) return fail();
        canvasWidth = 1 + bytes[start + 4] + (bytes[start + 5] << 8) + (bytes[start + 6] << 16);
        canvasHeight = 1 + bytes[start + 7] + (bytes[start + 8] << 8) + (bytes[start + 9] << 16);
        if (canvasWidth !== canvasHeight || canvasWidth > AVATAR_SIZE) return fail();
      } else if (kind === 'VP8 ' || kind === 'VP8L') {
        if (image) return fail();
        image = true;
        if (kind === 'VP8 ') {
          if (length < 10 || bytes[start] & 1 || str(start + 3, 3) !== '\x9d\x01\x2a') return fail();
          width = view.getUint16(start + 6, true) & 0x3fff;
          height = view.getUint16(start + 8, true) & 0x3fff;
        } else {
          if (length < 5 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0) return fail();
          const bits = view.getUint32(start + 1, true);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
        }
      }
      offset = start + length + (length % 2);
    }
    if (!image || offset !== bytes.length || (canvasWidth && (canvasWidth !== width || canvasHeight !== height))) return fail();
  }
  if (!width || width !== height || width > AVATAR_SIZE) return fail();
  return value;
}

/** Leave headroom under D1's 2 MB value/row limit, including UTF-8 names. */
export function validatePeopleAvatars(people: Person[]): void {
  for (const p of people) validateAvatar(p.avatar);
  if (new TextEncoder().encode(JSON.stringify(people)).length > 1_800_000) throw new Error(t('server.avatarRosterFull'));
}

export function personSummary(p: Person) {
  const { avatar, ...record } = p;
  return { ...record, has_avatar: !!avatar };
}

/** Strip encoder-added color/metadata chunks from an already re-encoded thumbnail. */
export function prepareAvatarThumbnail(value: string): string {
  const [prefix, encoded] = value.split(',');
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const kind = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const chunks: Uint8Array[] = [];
  if (prefix === 'data:image/webp;base64' && bytes.length >= 12) {
    chunks.push(bytes.slice(0, 12));
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const length = view.getUint32(offset + 4, true),
        end = offset + 8 + length + (length % 2);
      if (end > bytes.length) return fail();
      const name = kind(offset),
        chunk = bytes.slice(offset, end);
      if (name === 'VP8X') chunk[8] &= ~0x2c; // ICC, EXIF, XMP; retain alpha/animation for validation.
      if (!['ICCP', 'EXIF', 'XMP '].includes(name)) chunks.push(chunk);
      offset = end;
    }
  } else if (prefix === 'data:image/png;base64' && bytes.length >= 8) {
    chunks.push(bytes.slice(0, 8));
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const end = offset + 12 + view.getUint32(offset);
      if (end > bytes.length) return fail();
      if (['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'].includes(kind(offset + 4))) chunks.push(bytes.slice(offset, end));
      offset = end;
    }
  } else return fail();
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  if (prefix === 'data:image/webp;base64') new DataView(out.buffer).setUint32(4, out.length - 8, true);
  let raw = '';
  for (const byte of out) raw += String.fromCharCode(byte);
  return validateAvatar(`${prefix},${btoa(raw)}`)!;
}
