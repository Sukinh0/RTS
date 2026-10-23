import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { installTinySwordsFromBuffer } from './prepare-tiny-swords.mjs';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function zipEntries(entries) {
  const files = [], directory = [];
  let position = 0;
  for (const item of entries) {
    const fileName = Buffer.from('Tiny Swords (Free Pack)/' + item.name);
    const compressed = item.method === 8 ? deflateRawSync(item.data) : item.data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(item.method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(item.data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    files.push(local, fileName, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(item.method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(item.data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(position, 42);
    directory.push(central, fileName);
    position += local.length + fileName.length + compressed.length;
  }
  const directoryData = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryData.length, 12);
  end.writeUInt32LE(position, 16);
  return Buffer.concat([...files, directoryData, end]);
}
function sampleEntries() {
  return [
    {name:'Units/Yellow Units/Pawn/Pawn_Idle.png', data:SIGNATURE, method:8},
    {name:'UI Elements/UI Elements/Buttons/BigBlueButton_Regular.png', data:SIGNATURE, method:8},
    ...Array.from({length:22}, (_,i)=>({
      name:'Terrain/Decorations/Rocks/Rock' + (i+1) + '.png',
      data:SIGNATURE, method:i%2===0?0:8,
    })),
  ];
}

describe('automatic Tiny Swords build installer', () => {
  it('installs official-format stored and deflated PNGs into a private build directory', () => {
    const destination = mkdtempSync(join(tmpdir(),'rts-art-'));
    try {
      const count=installTinySwordsFromBuffer(zipEntries(sampleEntries()),destination);
      assert.equal(count,24);
      const pawn=join(destination,'Units/Yellow Units/Pawn/Pawn_Idle.png');
      assert.equal(existsSync(pawn),true);
      assert.deepEqual(readFileSync(pawn),SIGNATURE);
      assert.equal(existsSync(join(destination,'Terrain/Decorations/Rocks/Rock1.png')),true);
      assert.equal(existsSync(join(destination,'UI Elements/UI Elements/Buttons/BigBlueButton_Regular.png')),true);
    } finally {
      rmSync(destination,{recursive:true,force:true});
    }
  });
  it('rejects traversal without writing files',()=>{
    const destination = mkdtempSync(join(tmpdir(),'rts-art-'));
    try {
      const entries=sampleEntries();
      entries.push({name:'Units/../../unexpected.png',data:SIGNATURE,method:0});
      assert.throws(()=>installTinySwordsFromBuffer(zipEntries(entries),destination),/Unsafe ZIP asset path/);
      assert.equal(existsSync(join(destination,'Units/Yellow Units/Pawn/Pawn_Idle.png')),false);
    }finally{rmSync(destination,{recursive:true,force:true});}
  });
  it('rejects arbitrary zip, missing required sheets and too-large ZIPs',()=>{
    assert.throws(()=>installTinySwordsFromBuffer(Buffer.from('not a zip')),/Invalid Tiny Swords ZIP/);
    const missing=sampleEntries().slice(1);
    assert.throws(()=>installTinySwordsFromBuffer(zipEntries(missing)),/Missing textures/);
    assert.throws(()=>installTinySwordsFromBuffer(Buffer.alloc(30*1024*1024+1)),/exceeds 30 MB/);
  });
});
