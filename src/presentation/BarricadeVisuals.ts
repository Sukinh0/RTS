import Phaser from 'phaser';
import { BARRICADE_VISUALS, barricadeTextureKey } from './VisualRegistry';

/** Compose one tiny reusable palisade image per connection mask from the pack's wood log. */
export function registerBarricadeTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists(BARRICADE_VISUALS.sourceKey)) return;
  const source = scene.textures.get(BARRICADE_VISUALS.sourceKey).getSourceImage() as HTMLImageElement;
  if (!source?.width || !source?.height) return;
  const sx = source.width * 0.08;
  const sy = source.height * 0.18;
  const sw = source.width * 0.84;
  const sh = source.height * 0.64;
  for (let mask = 0; mask < 16; mask += 1) {
    const key = barricadeTextureKey(mask);
    if (scene.textures.exists(key)) continue;
    const texture = scene.textures.createCanvas(key, 32, 32);
    if (!texture) return;
    const ctx = texture.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 32, 32);
    const north = !!(mask & 1); const east = !!(mask & 2);
    const south = !!(mask & 4); const west = !!(mask & 8);
    const horizontal = east || west;
    const vertical = north || south;
    const links = (north ? 1 : 0) + (east ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0);
    const rail = (x: number, y: number, w: number, h: number, rotate = false): void => {
      ctx.save();
      if (rotate) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(source, sx, sy, sw, sh, -h / 2, -w / 2, h, w);
      } else ctx.drawImage(source, sx, sy, sw, sh, x, y, w, h);
      ctx.restore();
    };
    const hStart = west ? 0 : 9; const hEnd = east ? 32 : 23;
    const vStart = north ? 0 : 9; const vEnd = south ? 32 : 23;
    if (horizontal) {
      rail(hStart, 7, hEnd - hStart, 7);
      rail(hStart, 18, hEnd - hStart, 7);
    }
    if (vertical) {
      rail(7, vStart, 7, vEnd - vStart, true);
      rail(18, vStart, 7, vEnd - vStart, true);
    }
    if (!horizontal && !vertical) {
      rail(3, 7, 26, 7);
      rail(3, 18, 26, 7);
    }
    // Cross braces keep isolated pieces and intersections reading as tied timber.
    if (links < 2 || (horizontal && vertical)) rail(11, 9, 10, 14, true);
    texture.refresh();
  }
}
