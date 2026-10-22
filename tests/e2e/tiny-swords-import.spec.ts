import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

const files = [
  'Terrain/Tileset/Tilemap_color3.png',
  'Terrain/Tileset/Tilemap_color1.png',
  'Terrain/Tileset/Water Background color.png',
  'Terrain/Resources/Wood/Wood Resource/Wood Resource.png',
  ...[3, 1, 2, 4, 5, 6].map((i) => `Terrain/Resources/Gold/Gold Stones/Gold Stone ${i}.png`),
  ...[1, 2, 3, 4].map((i) => `Terrain/Decorations/Rocks/Rock${i}.png`),
  'Units/Yellow Units/Warrior/Warrior_Idle.png',
];

function crc32(data: Buffer): number {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const kind = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const check = Buffer.alloc(4);
  check.writeUInt32BE(crc32(Buffer.concat([kind, body])));
  return Buffer.concat([length, kind, body, check]);
}

function originalTestPng(): Buffer {
  // A synthesized 8-frame-wide texture, not any part of Pixel Frog's art.
  const width = 1536;
  const height = 384;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // RGBA
  ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let row = 0; row < height; row++) {
    const offset = row * (1 + width * 4);
    for (let x = 0; x < width; x++) {
      const p = offset + 1 + x * 4;
      raw[p] = 77;
      raw[p + 1] = 141;
      raw[p + 2] = 97;
      raw[p + 3] = 255;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function zipWithStoredPngs(): Buffer {
  const png = originalTestPng();
  const localParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let localOffset = 0;
  for (const file of files) {
    const name = Buffer.from(`Tiny Swords (Free Pack)/${file}`);
    const check = crc32(png);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(check, 14);
    local.writeUInt32LE(png.length, 18);
    local.writeUInt32LE(png.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, png);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(check, 16);
    central.writeUInt32LE(png.length, 20);
    central.writeUInt32LE(png.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    directoryParts.push(central, name);
    localOffset += local.length + name.length + png.length;
  }
  const directory = Buffer.concat(directoryParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, directory, end]);
}

test('imports an original synthetic local ZIP, reboots match and keeps graphics available', async ({ page }) => {
  await page.goto('/?noai=1');
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  const initial = await page.locator('#gold-value').textContent();
  await page.locator('#tiny-zip-file').setInputFiles({
    name: 'generated-test-pack.zip',
    mimeType: 'application/zip',
    buffer: zipWithStoredPngs(),
  });
  await expect(page.locator('#tiny-assets-status')).toContainText('Tiny Swords ativo nesta aba', { timeout: 20_000 });
  await expect(page.locator('#game')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#gold-value')).toHaveText(initial ?? '');
  await expect(page.locator('#btn-load-tiny')).toBeEnabled();
});
