/*
 * The decoder, moved out into a Web Worker of the PAGE.
 *
 * ---------------------------------------------------------------------------
 * Why here and not in the service worker
 * ---------------------------------------------------------------------------
 * An MV3 service worker is single-threaded. MAX_PARALLEL was therefore only
 * interleaving tasks on a single core: twelve tiles = ~756 ms serialized,
 * during which nothing else moves forward. And the page paid AFTERWARDS for
 * decoding the data: URL and for the createImageBitmap on its main thread --
 * ~432 ms of stutter per screen.
 *
 * A page, on the other hand, can open as many Web Workers as it has cores.
 * Measured on twelve real tiles (bench-perf2.html, 16 cores):
 *
 *     everything inline, PNG (old path)      1241 ms   main thread blocked 57 ms
 *     pool x2, BMP                            342 ms   0 ms
 *     pool x4, BMP                            283 ms   0 ms      <- kept
 *     pool x8, BMP                            300 ms   0 ms
 *
 * Four times faster, and NO long task on the main thread: the map stays smooth
 * while loading. Past four workers there is nothing left to gain -- the network
 * becomes the limiting factor.
 *
 * The extension's service worker is now only a network relay: it brings back
 * the raw .zst files (267-538 KB) instead of decoded PNGs (651-1687 KB), which
 * also lightens the MV3 bridge by a factor of three.
 *
 * ---------------------------------------------------------------------------
 * Loading
 * ---------------------------------------------------------------------------
 * This file is never loaded through its chrome-extension:// URL: a Worker must
 * be same-origin with the page. content-main.js fetches the sources as text and
 * re-chains them into a blob: (see its worker factory), which brings them back
 * to the wplace.live origin.
 */

import { decodeTile, PALETTE, setDecompressor } from './decoder.js';
import { toBgra, toBmp, composeBgra, bgraFromBitmaps, quadrantsOf } from './image.js';
import { ZSTDDecoder } from './vendor/zstddec.js';

const LIVE = 'https://backend.wplace.live/files/s0/tiles';

/*
 * The reference zstd, compiled to WebAssembly.
 *
 * It is the heaviest item in decoding a tile. Measured on seven real tiles,
 * twenty-nine streams (bench-zstd.html): 26 ms on average in JavaScript against
 * 10 ms in WebAssembly, two and a half times more. Output verified IDENTICAL
 * byte for byte on all twenty-nine.
 *
 * ONE TRAP, which would have broken everything silently: the archive streams do
 * NOT carry their decompressed size in their header. Calling decode() with no
 * bound goes through ZSTD_findDecompressedSize, which then returns anything --
 * 16,908,218 instead of 1,000,008 on the test tile, and wrong bytes. So we pass
 * a generous bound: ZSTD_decompress returns the REAL size, and we keep only
 * what it wrote.
 *
 * None of this is essential: at the slightest hitch -- WebAssembly refused by a
 * CSP, failed initialization, absurd size -- we fall back to fzstd, which is
 * slower but always right.
 */
const LIMIT = 4 << 20;          // a tile is 1,000,008 bytes; generous, but bounded

async function attachWasm() {
  try {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    setDecompressor((stream) => {
      const out = decoder.decode(stream, LIMIT);
      // guard: an absurd size means zstd returned an error
      if (!out || !out.length || out.length > LIMIT) throw new Error('absurd size');
      return out;
    });
    return true;
  } catch (e) {
    return false;                // fzstd stays in place, nothing to undo
  }
}
const zstdReady = attachWasm();

/** An archive tile: .zst -> BMP. */
function fromZst(zst) {
  const { width, height, index } = decodeTile(new Uint8Array(zst));
  return { bmp: toBmp(width, height, toBgra(width, height, index, PALETTE)) };
}

/** An archive z10 tile: four level-11 .zst files -> BMP. */
function fromQuadrants(quadrants) {
  const decoded = [];
  for (const q of quadrants) {
    try { decoded.push({ dx: q.dx, dy: q.dy, ...decodeTile(new Uint8Array(q.zst)) }); }
    catch (e) { /* one unreadable quadrant does not stop the other three */ }
  }
  const bgra = composeBgra(decoded, PALETTE);
  return bgra ? { bmp: toBmp(1000, 1000, bgra) } : { empty: true };
}

/**
 * A z10 tile in Direct mode: four live wplace PNGs -> BMP.
 *
 * The worker fetches them itself. It inherits the origin of the page, so these
 * requests go through the wplace service worker exactly like the ones from the
 * site: same cache, no double download.
 */
async function fromLive(x, y) {
  const pieces = await Promise.all(quadrantsOf(x, y).map(async (q) => {
    try {
      const r = await fetch(`${LIVE}/${q.x}/${q.y}.png`);
      if (!r.ok) return null;
      const b = await r.blob();
      // the wplace service worker returns a 1x1 PNG for blank tiles
      if (b.size < 200) return null;
      return { dx: q.dx, dy: q.dy, bmp: await createImageBitmap(b) };
    } catch (e) { return null; }
  }));

  const found = pieces.filter(Boolean);
  if (!found.length) return { empty: true };
  return { bmp: toBmp(1000, 1000, bgraFromBitmaps(found)) };
}

self.onmessage = async (e) => {
  const { id, tache: task } = e.data;
  try {
    let r;
    if (task.type === 'zst') r = fromZst(task.zst);
    else if (task.type === 'quadrants') r = fromQuadrants(task.quadrants);
    else if (task.type === 'live') r = await fromLive(task.x, task.y);
    else throw new Error('unknown task: ' + task.type);

    // transfer and not copy: 4 MB changing thread without being duplicated
    self.postMessage({ id, ...r }, r.bmp ? [r.bmp] : []);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};

// We only announce "ready" after having tried WebAssembly: otherwise the first
// tiles would be decoded in JavaScript for nothing.
zstdReady.then((ok) => self.postMessage({ pret: true, wasm: ok }));
