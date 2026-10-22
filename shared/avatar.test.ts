import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { AVATAR_MAX_BYTES, avatarCrop, prepareAvatarThumbnail, validateAvatar, validatePeopleAvatars } from './avatar.ts';

function chunk(kind: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length);
  out.write(kind, 4);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of out.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
  return out;
}
function png(width: number, height = width, noise = false, metadata = false) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height);
  let random = 1977;
  if (noise)
    for (let y = 0; y < height; y++)
      for (let x = 1; x <= width * 4; x++) {
        random ^= random << 13;
        random ^= random >>> 17;
        random ^= random << 5;
        pixels[y * (width * 4 + 1) + x] = random & 255;
      }
  return (
    'data:image/png;base64,' +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      ...(metadata ? [chunk('tEXt', Buffer.from('Private location'))] : []),
      chunk('IDAT', deflateSync(pixels)),
      chunk('IEND', new Uint8Array()),
    ]).toString('base64')
  );
}

test('avatar validates square PNG thumbnails, bounds and removal', () => {
  for (const size of [1, 64, 128]) assert.equal(validateAvatar(png(size)), png(size));
  assert.equal(validateAvatar(undefined), undefined);
  assert.equal(validateAvatar(null), undefined);
  for (const input of [png(129), png(128, 127), png(1, 1, false, true), '', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAAA'])
    assert.throws(() => validateAvatar(input));
  const corrupted = Buffer.from(png(128).split(',')[1], 'base64');
  corrupted[20] ^= 1;
  assert.throws(() => validateAvatar('data:image/png;base64,' + corrupted.toString('base64')));
  assert.throws(() => validateAvatar(png(128).slice(0, -4)));
});

test('avatar enforces byte limits on compressed image data and roster UTF-8 size', () => {
  const near = png(127, 127, true),
    large = png(128, 128, true);
  assert.ok(Buffer.from(near.split(',')[1], 'base64').length < AVATAR_MAX_BYTES);
  assert.ok(Buffer.from(large.split(',')[1], 'base64').length > AVATAR_MAX_BYTES);
  assert.equal(validateAvatar(near), near);
  assert.throws(() => validateAvatar(large));
  assert.throws(() => validatePeopleAvatars(Array.from({ length: 24 }, (_, i) => ({ id: String(i), name: 'Test', avatar: near }))));
  assert.throws(() => validatePeopleAvatars([{ id: 'one', name: '人'.repeat(600_001) }]));
});

test('avatar rejects remote protocols and MIME spoofing without making requests', () => {
  for (const url of ['https://example.test/a.png', 'http://example.test/a.png', 'file:///a.png', 'javascript:alert(1)', '//example.test/a.png'])
    assert.throws(() => validateAvatar(url));
  assert.throws(() => validateAvatar(png(1).replace('image/png', 'image/webp')));
});

test('avatar center crop uses the shorter side and limits decoded pixel counts', () => {
  assert.deepEqual(avatarCrop(800, 400), { x: 200, y: 0, side: 400, size: 128 });
  assert.deepEqual(avatarCrop(300, 601), { x: 0, y: 150.5, side: 300, size: 128 });
  assert.deepEqual(avatarCrop(1, 1), { x: 0, y: 0, side: 1, size: 128 });
  for (const [w, h] of [
    [0, 2],
    [2, -1],
    [1.1, 2],
    [Infinity, 2],
    [10_000, 10_000],
  ])
    assert.throws(() => avatarCrop(w, h));
});

const webp =
  'data:image/webp;base64,UklGRnwAAABXRUJQVlA4WAoAAAAAAAAAfwAAfwAAVlA4IF4AAADwBgCdASqAAIAAPmEwlkikIyIhIIgAgAwJaW7hdJlwH4AAAT22IvEFRz2xF4gqOe2IvEFRz2xF4gqOe2IvEE2AAP7+lp///8pV4LG6PP//y0L5aF8tC/5JwAAAAAAA';
test('browser WebP color-profile chunks are stripped; dimensions, animation and metadata stay bounded', () => {
  assert.equal(validateAvatar(webp), webp);
  const bytes = Buffer.from(webp.split(',')[1], 'base64');
  const metadata = Buffer.alloc(12);
  metadata.write('ICCP');
  metadata.writeUInt32LE(4, 4);
  metadata.write('test', 8);
  const tagged = Buffer.concat([bytes.subarray(0, 30), metadata, bytes.subarray(30)]);
  tagged[20] |= 32;
  tagged.writeUInt32LE(tagged.length - 8, 4);
  const encoded = 'data:image/webp;base64,' + tagged.toString('base64');
  assert.throws(() => validateAvatar(encoded));
  assert.equal(prepareAvatarThumbnail(encoded), webp);
  for (const edit of [(b: Buffer) => (b[20] |= 2), (b: Buffer) => (b[24] = 255), (b: Buffer) => (b[27] = 126), (b: Buffer) => b.writeUInt32LE(999999, 34)]) {
    const invalid = Buffer.from(bytes);
    edit(invalid);
    assert.throws(() => validateAvatar('data:image/webp;base64,' + invalid.toString('base64')));
  }
  assert.equal(prepareAvatarThumbnail(png(128, 128, false, true)), png(128));
});
