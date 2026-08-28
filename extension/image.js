/*
 * Building the final image, without PNG.
 *
 * ---------------------------------------------------------------------------
 * Why BMP
 * ---------------------------------------------------------------------------
 * MapLibre wants one single thing from our fetch hook: bytes it can hand to
 * createImageBitmap. The format is irrelevant to it -- it even builds its Blob
 * with a hardcoded type:
 *
 *     x.f = s => { ... new Blob([new Uint8Array(s)], {type: "image/png"}) ... }
 *                                             (MapLibre GL JS 5.21.1, read in
 *                                              the bundle served by wplace)
 *
 * Chrome sniffs the bytes and ignores that declared type: a BMP goes through.
 * Verified in bench-perf3.html, including across the full path Response ->
 * arrayBuffer -> lying Blob -> ImageBitmap.
 *
 * And BMP changes everything, because it has no compression:
 *
 *     dense z6 tile        ->pixels   encoding   weight    ->ImageBitmap  total
 *     PNG                   5.8 ms    36.9 ms    1505 KB   11.4 ms       54.1 ms
 *     BMP                   3.4 ms     2.9 ms    3906 KB   12.2 ms       18.5 ms
 *
 * PNG encoding is a zlib pass over 4 MB: 37 ms per tile, twelve tiles per
 * screen. A BMP is a 122-byte header and a copy. Three times cheaper, and the
 * rendering is identical down to the pixel (0 difference over 1,000,000 pixels,
 * transparency included).
 *
 * The weight costs nothing here: these bytes NEVER cross the MV3 bridge. They
 * are born in a Web Worker of the page and are transferred (not copied) to the
 * main thread, which hands them to MapLibre right away.
 */

// BITMAPV4HEADER and not the old BITMAPINFOHEADER: we need the alpha channel.
// The unpainted areas of wplace are transparent (13.5 % of a dense tile as
// measured); a 24-bit BMP would render them black.
const HEADER = 14 + 108;

/**
 * Wraps BGRA pixels in a 32-bit BMP.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array} bgra  width*height*4 bytes, in B,G,R,A order
 * @returns {ArrayBuffer}
 */
export function toBmp(width, height, bgra) {
  const buf = new ArrayBuffer(HEADER + bgra.byteLength);
  const v = new DataView(buf);
  v.setUint16(0, 0x4d42, true);                 // 'BM'
  v.setUint32(2, buf.byteLength, true);
  v.setUint32(10, HEADER, true);                // where the pixels start
  v.setUint32(14, 108, true);                   // size of the V4 header
  v.setInt32(18, width, true);
  v.setInt32(22, -height, true);                // NEGATIVE height = top-down
  v.setUint16(26, 1, true);                     // planes
  v.setUint16(28, 32, true);                    // bits per pixel
  v.setUint32(30, 3, true);                     // BI_BITFIELDS
  v.setUint32(34, bgra.byteLength, true);
  v.setUint32(54, 0x00ff0000, true);            // red mask
  v.setUint32(58, 0x0000ff00, true);            // green mask
  v.setUint32(62, 0x000000ff, true);            // blue mask
  v.setUint32(66, 0xff000000, true);            // alpha mask
  v.setUint32(70, 0x73524742, true);            // 'BGRs': sRGB color space
  new Uint8Array(buf, HEADER).set(bgra);
  return buf;
}

/**
 * Palette -> 32-bit word table, ready for a direct write.
 * In little-endian, writing 0xAARRGGBB does give the B,G,R,A order in memory:
 * exactly what a BI_BITFIELDS BMP expects.
 */
function colorTable(palette) {
  const t = new Uint32Array(palette.length);
  for (let i = 1; i < palette.length; i++) {   // 0 = transparent, left at 0
    const [r, g, b] = palette[i];
    t[i] = ((255 << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  return t;
}

/** Palette indexes -> BGRA pixels. */
export function toBgra(width, height, index, palette) {
  const out = new Uint8Array(width * height * 4);
  const words = new Uint32Array(out.buffer);
  const table = colorTable(palette);
  for (let i = 0; i < index.length; i++) {
    const c = index[i];
    if (c) words[i] = table[c];
  }
  return out;
}

/**
 * Assembles a z10 tile from the four z11 tiles it covers.
 *
 * The archive publishes z0 to z9 and z11, but not z10. Without that level,
 * MapLibre scales up a z9: one pixel kept per 4x4 block instead of one per 2x2
 * block, which is half the information for the same area on screen.
 *
 * The 2:1 reduction is done by sampling -- every other pixel. This is pixel
 * art: any smoothing would mush the outlines.
 *
 * We write straight into the BGRA buffer, with no intermediate canvas.
 */
export function composeBgra(quadrants, palette) {
  if (!quadrants.length) return null;
  const out = new Uint8Array(1000 * 1000 * 4);
  const words = new Uint32Array(out.buffer);
  const table = colorTable(palette);

  for (const q of quadrants) {
    const ox = q.dx * 500, oy = q.dy * 500;
    for (let y = 0; y < 500; y++) {
      const row = (y * 2) * q.width;                // every other row
      let o = (oy + y) * 1000 + ox;
      for (let x = 0; x < 500; x++, o++) {
        const v = q.index[row + x * 2];               // every other column
        if (v) words[o] = table[v];
      }
    }
  }
  return out;
}

/**
 * Same assembly, but from ImageBitmaps: that is the Direct mode case, where
 * the quadrants are the live wplace PNGs and not archive .zst files.
 *
 * Here the canvas cannot be avoided -- we start from already decoded images. We
 * only ask it to smooth nothing, then read the pixels back and swap them in
 * place into BGRA order.
 */
export function bgraFromBitmaps(bitmaps) {
  if (!bitmaps.length) return null;
  const canvas = new OffscreenCanvas(1000, 1000);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  for (const b of bitmaps) {
    g.drawImage(b.bmp, b.dx * 500, b.dy * 500, 500, 500);
    b.bmp.close();
  }
  const d = g.getImageData(0, 0, 1000, 1000).data;
  for (let i = 0; i < d.length; i += 4) {            // RGBA -> BGRA
    const r = d[i]; d[i] = d[i + 2]; d[i + 2] = r;
  }
  return d;
}

/** The four z11 tiles covered by a z10 tile. */
export function quadrantsOf(x, y) {
  return [
    { dx: 0, dy: 0, x: x * 2,     y: y * 2 },
    { dx: 1, dy: 0, x: x * 2 + 1, y: y * 2 },
    { dx: 0, dy: 1, x: x * 2,     y: y * 2 + 1 },
    { dx: 1, dy: 1, x: x * 2 + 1, y: y * 2 + 1 },
  ];
}
