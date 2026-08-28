/*
 * Standalone decoder for the archive tiles.
 *
 * Why it exists
 * -------------
 * An existing WebAssembly decoder for this format is published without a
 * license, so it cannot be redistributed -- and the Chrome Web Store forbids
 * loading code remotely. Either way it was unusable here.
 *
 * The format turned out to be simple, so we read it ourselves. This is an
 * independent implementation: only `fzstd` (MIT) and the wplace palette.
 *
 * The format, read off the files themselves
 * -----------------------------------------
 * The file is a sequence of records, with no other header:
 *
 *   [uint32 version][uint32 size][zstd stream of `size` bytes]   x N
 *
 * Each stream decompresses into: 8 bytes (width, height) + width*height bytes,
 * one per pixel.
 *
 *   - the first record carries version 0: that is the base image;
 *   - the following ones are deltas, and their version matches exactly the
 *     snapshots published by the archive (14305, 14329, 14353...);
 *     inside a delta, 0xFE means "pixel unchanged".
 *
 * Each byte is an index into the 64-color wplace palette, index 0 meaning
 * "transparent". Applying the deltas up to the wanted version yields the
 * matching snapshot -- verified identical to the original decoder's output.
 *
 * (An early version located the streams by looking for the zstd magic number.
 * That was fragile: this four-byte sequence turns up by chance inside the
 * compressed data, which cut the streams in the wrong place. The announced
 * sizes remove any ambiguity.)
 */

import { decompress } from './vendor/fzstd.js';

const UNCHANGED = 0xfe;

/*
 * Decompression: JavaScript by default, WebAssembly if we are handed one.
 *
 * fzstd (MIT) is pure JavaScript and is always enough. But it is the heaviest
 * item in decoding a tile -- 26 ms on average against 10 ms for the reference
 * zstd compiled to WebAssembly, two and a half times more.
 *
 * We do not force it: worker.js plugs it in if it managed to initialize it,
 * and everything falls back to fzstd at the slightest hitch. Displaying tiles
 * must not depend on a WebAssembly that a CSP could block.
 */
let zstdDecompress = decompress;

export function setDecompressor(fn) {
  zstdDecompress = fn || decompress;
}

/** The wplace palette, read from its own bundle. Index 0 = transparent. */
export const PALETTE = [
  [0, 0, 0], [0, 0, 0], [60, 60, 60], [120, 120, 120], [210, 210, 210],
  [255, 255, 255], [96, 0, 24], [237, 28, 36], [255, 127, 39], [246, 170, 9],
  [249, 221, 59], [255, 250, 188], [14, 185, 104], [19, 230, 123], [135, 255, 94],
  [12, 129, 110], [16, 174, 166], [19, 225, 190], [40, 80, 158], [64, 147, 228],
  [96, 247, 242], [107, 80, 246], [153, 177, 251], [120, 12, 153], [170, 56, 185],
  [224, 159, 249], [203, 0, 122], [236, 31, 128], [243, 141, 169], [104, 70, 52],
  [149, 104, 42], [248, 178, 119], [170, 170, 170], [165, 14, 30], [250, 128, 114],
  [228, 92, 26], [214, 181, 148], [156, 132, 49], [197, 173, 49], [232, 212, 95],
  [74, 107, 58], [90, 148, 74], [132, 197, 115], [15, 121, 159], [187, 250, 242],
  [125, 199, 255], [77, 49, 184], [74, 66, 132], [122, 113, 196], [181, 174, 241],
  [219, 164, 99], [209, 128, 81], [255, 197, 165], [155, 82, 73], [209, 128, 120],
  [250, 182, 164], [123, 99, 82], [156, 132, 107], [51, 57, 65], [109, 117, 141],
  [179, 185, 209], [109, 100, 63], [148, 140, 107], [205, 197, 158],
];

/**
 * Splits the file into [version, compressed stream] records.
 * @returns {Array<{version:number, stream:Uint8Array}>}
 */
function records(u8) {
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = [];
  let o = 0;
  while (o + 8 <= u8.length) {
    const version = view.getUint32(o, true);
    const size = view.getUint32(o + 4, true);
    if (size === 0 || o + 8 + size > u8.length) break;
    out.push({ version, stream: u8.subarray(o + 8, o + 8 + size) });
    o += 8 + size;
  }
  return out;
}

/** Versions available in a tile, the base (0) excluded. */
export function versionsOf(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return records(u8).map((e) => e.version).filter((v) => v !== 0);
}

/**
 * Decodes a `.zst` tile from the archive.
 * @param {ArrayBuffer|Uint8Array} data
 * @param {number} [version] wanted snapshot; defaults to the most recent one
 * @returns {{width:number, height:number, index:Uint8Array, version:number}}
 */
export function decodeTile(data, version) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const recs = records(u8);
  if (!recs.length) throw new Error('unreadable tile: no record');

  const base = zstdDecompress(recs[0].stream);
  const view = new DataView(base.buffer, base.byteOffset, 8);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const size = width * height;
  if (base.length < 8 + size) throw new Error('base image truncated');

  const index = base.slice(8, 8 + size);
  let reached = recs[0].version;

  for (let k = 1; k < recs.length; k++) {
    if (version !== undefined && recs[k].version > version) break;
    const d = zstdDecompress(recs[k].stream);
    if (d.length < 8 + size) continue;
    for (let i = 0; i < size; i++) {
      const v = d[8 + i];
      if (v !== UNCHANGED) index[i] = v;
    }
    reached = recs[k].version;
  }
  // Field names are the shape worker.js and content-main.js destructure.
  return { width, height, index, version: reached };
}

/** Turns the palette indexes into RGBA pixels. */
export function toImageData(width, height, index) {
  const img = new ImageData(width, height);
  const d = img.data;
  for (let i = 0, o = 0; i < index.length; i++, o += 4) {
    const v = index[i];
    if (!v) continue;                       // 0 = transparent, left at zero
    const c = PALETTE[v];
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return img;
}

/** `.zst` tile -> PNG, ready to be served to MapLibre. */
export async function tileToPng(data, version) {
  const { width, height, index } = decodeTile(data, version);
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d').putImageData(toImageData(width, height, index), 0, 0);
  return await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer();
}
