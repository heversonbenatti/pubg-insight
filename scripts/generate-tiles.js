/**
 * generate-tiles.js
 * Slices each map PNG (16384×16384) into JPEG tiles at zoom levels z=0..5.
 *
 * z=0  →   1× 1 tile  = 512px total
 * z=1  →   2× 2 tiles = 1024px
 * z=2  →   4× 4 tiles = 2048px
 * z=3  →   8× 8 tiles = 4096px
 * z=4  → 16×16 tiles  = 8192px
 * z=5  → 32×32 tiles  = 16384px  (native source resolution)
 *
 * Output: public/tiles/{mapname}/{z}/{tx}_{ty}.jpg
 * Run:    node scripts/generate-tiles.js
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir  = path.join(__dirname, '..', 'public');

const TILE_PX  = 512;
const SRC_SIZE = 16384;   // all source maps are 16384×16384
const MAX_Z    = 5;       // 2^5 = 32 → 32*512 = 16384 (native)
const BAND_H   = 4;       // tile rows processed per read of the source image
const JPEG_Q   = 85;      // quality for z≥3 (detail tiles)
const JPEG_Q_LO = 75;     // quality for z<3  (overview tiles — less detail needed)

const MAPS = [
  'erangel', 'miramar', 'sanhok', 'vikendi',
  'karakin', 'taego',   'deston', 'rondo',
];

const pad = (n, w) => String(n).padStart(w, ' ');

for (const mapName of MAPS) {
  const src = path.join(publicDir, 'images', `${mapName}map.png`);
  if (!fs.existsSync(src)) {
    console.warn(`⚠  ${mapName}map.png not found — skipping`);
    continue;
  }

  console.log(`\n▶  ${mapName}`);
  const t0 = Date.now();

  for (let z = 0; z <= MAX_Z; z++) {
    const count   = 1 << z;              // tiles per row/col at this level
    const totalPx = count * TILE_PX;     // target image width/height
    const outDir  = path.join(publicDir, 'tiles', mapName, String(z));
    const jpegQ   = z < 3 ? JPEG_Q_LO : JPEG_Q;

    fs.mkdirSync(outDir, { recursive: true });

    // Count already-generated tiles
    const existing = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg')).length;
    const expected = count * count;
    if (existing === expected) {
      console.log(`   z${z}: ${pad(expected,5)} tiles  (all cached)`);
      continue;
    }

    let done = 0, skip = 0;
    const bandCount = Math.ceil(count / BAND_H);

    for (let band = 0; band < bandCount; band++) {
      const tyStart = band * BAND_H;
      const tyEnd   = Math.min(count, tyStart + BAND_H);
      const bandRows = tyEnd - tyStart;

      // Check if every tile in this band already exists
      let allExist = true;
      outer: for (let ty = tyStart; ty < tyEnd; ty++) {
        for (let tx = 0; tx < count; tx++) {
          if (!fs.existsSync(path.join(outDir, `${tx}_${ty}.jpg`))) {
            allExist = false; break outer;
          }
        }
      }
      if (allExist) { skip += bandRows * count; continue; }

      // Source coordinates (within 16384×16384)
      const srcTop = Math.round(tyStart * SRC_SIZE / count);
      const srcBot = Math.round(tyEnd   * SRC_SIZE / count);
      const srcH   = srcBot - srcTop;

      // Target size for this band
      const tgtW = totalPx;
      const tgtH = bandRows * TILE_PX;

      // Build sharp pipeline: extract band → optional resize → raw buffer
      let pl = sharp(src, { limitInputPixels: false });
      if (srcTop > 0 || srcH < SRC_SIZE) {
        pl = pl.extract({ left: 0, top: srcTop, width: SRC_SIZE, height: srcH });
      }
      if (tgtW !== SRC_SIZE || tgtH !== srcH) {
        pl = pl.resize(tgtW, tgtH, { kernel: sharp.kernel.lanczos3 });
      }

      const { data, info } = await pl.raw().toBuffer({ resolveWithObject: true });
      const ch = info.channels;

      // Slice the band buffer into individual tiles
      for (let ty = tyStart; ty < tyEnd; ty++) {
        for (let tx = 0; tx < count; tx++) {
          const outFile = path.join(outDir, `${tx}_${ty}.jpg`);
          if (fs.existsSync(outFile)) { skip++; continue; }

          await sharp(data, { raw: { width: tgtW, height: tgtH, channels: ch } })
            .extract({ left: tx * TILE_PX, top: (ty - tyStart) * TILE_PX, width: TILE_PX, height: TILE_PX })
            .jpeg({ quality: jpegQ })
            .toFile(outFile);

          done++;
          process.stdout.write(`\r   z${z}: ${pad(done + skip, 5)}/${expected}...`);
        }
      }
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\r   z${z}: ${pad(expected, 5)} tiles  (${done} new, ${skip} cached)  ${elapsed}s`);
  }

  console.log(`   ✓ ${mapName} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

console.log('\n✓  All maps complete');
