import type Phaser from 'phaser';
import { tinySwordsLocalManifest } from './VisualRegistry';

export interface ZipRecord { name: string; method: number; offset: number; compressed: number; expanded: number }

/** Read ZIP central directory without additional CDN libraries or uploading user files. */
export function readZipDirectory(buffer: ArrayBuffer): ZipRecord[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let tail = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { tail = at; break; }
  }
  if (tail < 0) throw new Error('O arquivo não é um ZIP válido.');
  const count = view.getUint16(tail + 10, true);
  const start = view.getUint32(tail + 16, true);
  if (count > 1600 || start > bytes.length) throw new Error('Pacote ZIP inválido ou grande demais.');
  const results: ZipRecord[] = [];
  let expandedTotal = 0;
  let offset = start;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Diretório ZIP corrompido.');
    }
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const expanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error('Nome de arquivo ZIP inválido.');
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength)).replaceAll('\\', '/');
    if (name.toLowerCase().endsWith('.png')) {
      if (expanded > 12 * 1024 * 1024) throw new Error('Imagem ZIP excessivamente grande.');
      expandedTotal += expanded;
      // Bound the *expanded* data, not only the compressed ZIP size, to avoid
      // exhausting browser memory on accidentally/maliciously huge archives.
      if (expandedTotal > 160 * 1024 * 1024) {
        throw new Error('ZIP descompactado excede o limite seguro de 160 MB.');
      }
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) {
        throw new Error('Cabeçalho ZIP inválido.');
      }
      const localName = view.getUint16(local + 26, true);
      const localExtra = view.getUint16(local + 28, true);
      const dataOffset = local + 30 + localName + localExtra;
      if (dataOffset + compressed > bytes.length) throw new Error('PNG comprimido incompleto.');
      results.push({ name, method, offset: dataOffset, compressed, expanded });
    }
    offset = end;
  }
  return results;
}

async function decodePng(buffer: ArrayBuffer, item: ZipRecord): Promise<Blob> {
  const compressed = buffer.slice(item.offset, item.offset + item.compressed);
  let decoded: Blob;
  if (item.method === 0) decoded = new Blob([compressed], { type: 'image/png' });
  else if (item.method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('O navegador não suporta extração de ZIP.');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    decoded = new Blob([await new Response(stream).arrayBuffer()], { type: 'image/png' });
  } else throw new Error('Compressão ZIP não suportada.');
  const data = new Uint8Array(await decoded.slice(0, 8).arrayBuffer());
  if (data.length !== 8 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => data[index] === byte)) {
    throw new Error('PNG inválido no pacote Tiny Swords.');
  }
  if (decoded.size !== item.expanded) throw new Error('Tamanho de PNG inválido no ZIP.');
  return decoded;
}

/**
 * Use official user-owned ZIP without fetching from a third-party mirror.
 * Texture bytes live only in the active browser session and are not reuploaded.
 */
export async function loadTinySwordsZip(scene: Phaser.Scene, zip: File): Promise<{ loaded: number; total: number }> {
  if (zip.size > 30 * 1024 * 1024) throw new Error('ZIP maior que o limite de 30 MB.');
  const buffer = await zip.arrayBuffer();
  const records = readZipDirectory(buffer);
  const manifest = tinySwordsLocalManifest();
  const entries = new Map<string, ZipRecord>();
  for (const record of records) {
    const normalized = record.name.replace(/^.*?(?=Terrain\/|Units\/|Buildings\/|Particle FX\/)/, '');
    entries.set(normalized.toLowerCase(), record);
  }
  const matching = manifest.flatMap((asset) => {
    // Reusing cached textures also avoids needless decompression on re-import.
    const record = entries.get(asset.path.toLowerCase());
    return record && !scene.textures.exists(asset.key) ? [{ asset, record }] : [];
  });
  if (matching.length < 15) {
    // A fully imported pack can be selected again in the same browser tab.
    const alreadyPresent = manifest.filter((asset) => scene.textures.exists(asset.key)).length;
    if (alreadyPresent >= 15 && matching.length === 0) return { loaded: 0, total: manifest.length };
    if (matching.length + alreadyPresent < 15) {
      throw new Error('O ZIP não corresponde ao Tiny Swords (Free Pack) oficial.');
    }
  }
  const urls: string[] = [];
  let success = 0;
  try {
    const requests = await Promise.all(matching.map(async ({ asset, record }) => {
      const blob = await decodePng(buffer, record);
      const url = URL.createObjectURL(blob);
      urls.push(url);
      return { asset, url };
    }));
    await new Promise<void>((resolve, reject) => {
      let errored = 0;
      const onError = () => { errored++; };
      const complete = () => {
        scene.load.off('loaderror', onError);
        if (errored) reject(new Error(`${errored} sprites não carregaram.`));
        else resolve();
      };
      scene.load.once('complete', complete);
      scene.load.on('loaderror', onError);
      for (const { asset, url } of requests) {
        if (scene.textures.exists(asset.key)) continue;
        if (asset.frameWidth && asset.frameHeight) {
          scene.load.spritesheet(asset.key, url, {
            frameWidth: asset.frameWidth, frameHeight: asset.frameHeight,
            ...(asset.frames ? { endFrame: asset.frames - 1 } : {}),
          });
        } else scene.load.image(asset.key, url);
        success++;
      }
      if (success === 0) {
        scene.load.off('complete', complete);
        scene.load.off('loaderror', onError);
        resolve();
      } else scene.load.start();
    });
    return { loaded: success, total: manifest.length };
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
