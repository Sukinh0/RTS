import { describe, expect, it } from 'vitest';
import { readZipDirectory } from './TinySwordsZip';

function makeStoredZip(name: string, payload: Uint8Array): ArrayBuffer {
  const filename = new TextEncoder().encode(name);
  const localLength = 30 + filename.length + payload.length;
  const centralLength = 46 + filename.length;
  const result = new ArrayBuffer(localLength + centralLength + 22);
  const bytes = new Uint8Array(result);
  const data = new DataView(result);
  data.setUint32(0, 0x04034b50, true);
  data.setUint16(8, 0, true);
  data.setUint32(18, payload.length, true);
  data.setUint32(22, payload.length, true);
  data.setUint16(26, filename.length, true);
  bytes.set(filename, 30);
  bytes.set(payload, 30 + filename.length);
  const cd = localLength;
  data.setUint32(cd, 0x02014b50, true);
  data.setUint16(cd + 10, 0, true);
  data.setUint32(cd + 20, payload.length, true);
  data.setUint32(cd + 24, payload.length, true);
  data.setUint16(cd + 28, filename.length, true);
  data.setUint32(cd + 42, 0, true);
  bytes.set(filename, cd + 46);
  const end = cd + centralLength;
  data.setUint32(end, 0x06054b50, true);
  data.setUint16(end + 8, 1, true);
  data.setUint16(end + 10, 1, true);
  data.setUint32(end + 12, centralLength, true);
  data.setUint32(end + 16, cd, true);
  return result;
}

describe('Local Tiny Swords ZIP parser', () => {
  it('rejects invalid ZIPs without reading remote sources', () => {
    expect(() => readZipDirectory(new Uint8Array(12).buffer)).toThrow('ZIP válido');
  });
  it('locates a PNG in nested folders and reads its bounded local offset', () => {
    const path = 'Tiny Swords (Free Pack)/Units/Yellow Units/Warrior/Warrior_Idle.png';
    const archive = makeStoredZip(path, new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]));
    const result = readZipDirectory(archive);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: path, method: 0, compressed: 8, expanded: 8,
    });
    expect(new Uint8Array(archive).slice(result[0].offset, result[0].offset + result[0].compressed))
      .toEqual(new Uint8Array([137, 80, 78, 71, 0, 0, 0, 0]));
  });
});
