/**
 * Build-only installation of Pixel Frog's Tiny Swords Free Pack.
 * Never commit the ZIP or PNG source files to this public repo.
 * Set TINY_SWORDS_ARCHIVE_URL to a PRIVATE HTTPS object (optional bearer
 * TINY_SWORDS_ARCHIVE_TOKEN) or place the original ZIP in external-assets/.
 * Set TINY_SWORDS_REQUIRED=1 to reject art-free publisher deployments.
 * Note: web clients can retrieve served game textures; privacy of the build
 * input does not make the compiled web textures inaccessible.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ARCHIVE = resolve(ROOT, 'external-assets', 'Tiny Swords (Free Pack).zip');
const DESTINATION = resolve(ROOT, 'public/assets/tiny-swords');
const CHECK = resolve(DESTINATION, 'Units/Yellow Units/Pawn/Pawn_Idle.png');
const MAX_ZIP_BYTES = 30 * 1024 * 1024;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 180 * 1024 * 1024;
const PREFIX = 'Tiny Swords (Free Pack)/';

export function installTinySwordsFromBuffer(source, destination = DESTINATION) {
  if (!Buffer.isBuffer(source)) source = Buffer.from(source);
  if (source.length > MAX_ZIP_BYTES) throw new Error('Tiny Swords ZIP exceeds 30 MB');
  let eocd = -1;
  for (let at = source.length - 22; at >= Math.max(0, source.length - 65557); at--) {
    if (source.readUInt32LE(at) === 0x06054b50) { eocd = at; break; }
  }
  if (eocd < 0) throw new Error('Invalid Tiny Swords ZIP');
  const total = source.readUInt16LE(eocd + 10);
  if (total > 1800) throw new Error('Too many ZIP files');
  let offset = source.readUInt32LE(eocd + 16);
  let expanded = 0;
  const planned = [];
  let mainPawn = false;
  const root = resolve(destination);
  for (let i = 0; i < total; i++) {
    if (offset + 46 > source.length || source.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error('Corrupted ZIP directory');
    }
    const method = source.readUInt16LE(offset + 10);
    const compressed = source.readUInt32LE(offset + 20);
    const expandedSize = source.readUInt32LE(offset + 24);
    const nameSize = source.readUInt16LE(offset + 28);
    const extras = source.readUInt16LE(offset + 30);
    const comments = source.readUInt16LE(offset + 32);
    const local = source.readUInt32LE(offset + 42);
    if (offset + 46 + nameSize + extras + comments > source.length) {
      throw new Error('Truncated ZIP directory');
    }
    const name = source.subarray(offset + 46, offset + 46 + nameSize).toString('utf8');
    offset += 46 + nameSize + extras + comments;
    if (!name.startsWith(PREFIX) || !name.toLowerCase().endsWith('.png')) continue;
    const relative = name.slice(PREFIX.length);
    const pathParts = relative.split('/');
    if (relative.includes('\\') || relative.includes('\0')
        || pathParts.some(part => !part || part === '.' || part === '..')) {
      throw new Error('Unsafe ZIP asset path');
    }
    if (!/^(Terrain|Units|Buildings|Particle FX|UI Elements)\//.test(relative)) continue;
    // After security validation, filter unnecessary colors from the web build.
    if (relative.startsWith('Units/') && !/^Units\/(Yellow|Red) Units\//.test(relative)) continue;
    if (relative.startsWith('Buildings/') && !/^Buildings\/(Yellow|Red) Buildings\//.test(relative)) continue;
    const dest = resolve(root, relative);
    if (!dest.startsWith(root + sep)) throw new Error('ZIP path traversal');
    if (expandedSize > MAX_FILE_BYTES) throw new Error('Tiny Swords image exceeds 12 MB');
    expanded += expandedSize;
    if (expanded > MAX_EXPANDED_BYTES) throw new Error('Tiny Swords extraction exceeds 180 MB');
    if (local + 30 > source.length || source.readUInt32LE(local) !== 0x04034b50) {
      throw new Error('Invalid local ZIP entry');
    }
    const start = local + 30 + source.readUInt16LE(local + 26) + source.readUInt16LE(local + 28);
    if (start + compressed > source.length) throw new Error('Truncated ZIP PNG');
    if (method !== 0 && method !== 8) throw new Error('Unsupported ZIP compression');
    const block = source.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(block, { maxOutputLength: MAX_FILE_BYTES }) : block;
    if (data.length !== expandedSize) throw new Error('Corrupted ZIP image length');
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      throw new Error('Non-PNG content in Tiny Swords archive');
    }
    if (relative === 'Units/Yellow Units/Pawn/Pawn_Idle.png') mainPawn = true;
    planned.push({ dest, data });
  }
  if (!mainPawn || planned.length < 20) {
    throw new Error('Missing textures: expected the official Tiny Swords Free Pack');
  }
  for (const {dest, data} of planned) {
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, data);
  }
  return planned.length;
}

export async function prepareTinySwords() {
  if (existsSync(CHECK)) {
    console.log('Tiny Swords: using installed game textures.');
    return { source: 'installed' };
  }
  let archive;
  const url = process.env.TINY_SWORDS_ARCHIVE_URL?.trim();
  if (url) {
    if (new URL(url).protocol !== 'https:') throw new Error('Asset source must use HTTPS');
    const archiveUrl = new URL(url);
    // Vercel Blob private storage injects this token into the linked project.
    // Only send it to the store's HTTPS private Blob hostname, never to an
    // arbitrary archive URL supplied via environment configuration.
    const isPrivateBlob = archiveUrl.hostname.endsWith('.private.blob.vercel-storage.com');
    const token = process.env.TINY_SWORDS_ARCHIVE_TOKEN?.trim()
      || (isPrivateBlob ? process.env.BLOB_READ_WRITE_TOKEN?.trim() : undefined);
    if (isPrivateBlob && !token) {
      throw new Error('Private Blob source configured without BLOB_READ_WRITE_TOKEN');
    }
    if (isPrivateBlob) {
      const storeFromToken = token?.split('_')[3];
      const storeFromUrl = archiveUrl.hostname.split('.')[0];
      if (!storeFromToken || storeFromToken.toLowerCase() !== storeFromUrl.toLowerCase()) {
        throw new Error('Vercel Blob credential refers to a different storage store');
      }
    }
    const requestOptions = {
      headers: token ? { Authorization: 'Bearer ' + token } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    };
    let response = await fetch(url, requestOptions);
    if (response.status === 404 && isPrivateBlob) {
      // After a recent upload a CDN can temporarily cache a missing object.
      // Vercel Blob supports cache=0 to revalidate at the origin.
      const directOrigin = new URL(url);
      directOrigin.searchParams.set('cache', '0');
      response = await fetch(directOrigin, requestOptions);
    }
    if (!response.ok) throw new Error('Private asset fetch failed, HTTP ' + response.status);
    if (Number(response.headers.get('content-length') || 0) > MAX_ZIP_BYTES) {
      throw new Error('Private asset archive too large');
    }
    archive = Buffer.from(await response.arrayBuffer());
  } else if (existsSync(DEFAULT_ARCHIVE)) {
    archive = readFileSync(DEFAULT_ARCHIVE);
  }
  if (!archive) {
    if (process.env.TINY_SWORDS_REQUIRED === '1') {
      throw new Error('Tiny Swords missing. Configure a private TINY_SWORDS_ARCHIVE_URL or local external-assets/Tiny Swords (Free Pack).zip on the BUILD machine.');
    }
    console.log('Tiny Swords: no private source on builder; using procedural fallback.');
    return { source: 'missing' };
  }
  try {
    const count = installTinySwordsFromBuffer(archive);
    console.log('Tiny Swords: prepared ' + count + ' PNG game textures for automatic boot.');
    return { source: 'archive', count };
  } catch (error) {
    rmSync(DESTINATION, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareTinySwords().catch(error => {
    console.error('Tiny Swords install error: ' + error.message);
    process.exitCode = 1;
  });
}
