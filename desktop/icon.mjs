import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, "ascii");
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, sum]);
}

function inRoundRect(px, py, bar) {
  const nx = Math.min(Math.max(px, bar.x + bar.r), bar.x + bar.w - bar.r);
  const ny = Math.min(Math.max(py, bar.y + bar.r), bar.y + bar.h - bar.r);
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy <= bar.r * bar.r;
}

// The Clarity mark: three settling white lines on a deep blue tile, on the macOS icon grid
// (824/1024 body, ~22% corner radius), anti-aliased by 4x4 supersampling.
const TOP = [0x5b, 0x9b, 0xff];
const BOTTOM = [0x27, 0x45, 0xb8];

/**
 * The mark as a PNG. Defaults draw the macOS icon. Options for other platforms:
 * margin (fraction of size around the tile), radius (fraction of the tile), glyph (fraction
 * of the tile the lines span), background (RGB behind the tile instead of transparency), height (a taller or wider canvas,
 * the tile centred in it; margin stays a fraction of the width).
 */
export function iconPng(
  size,
  { margin: marginFrac = 100 / 1024, radius = 0.225, glyph = 0.62, background = null, height = size } = {},
) {
  const margin = size * marginFrac;
  const body = size - margin * 2;
  const dy = (height - size) / 2;
  const tile = { x: margin, y: margin + dy, w: body, h: body, r: body * radius };
  // Same geometry as the in-app LogoMark: on a 32-unit grid, centred in the tile.
  const unit = (body * glyph) / 32;
  const gx = margin + (body * (1 - glyph)) / 2;
  const stroke = 3.2 * unit;
  const bars = [
    [10.5, 6, 26],
    [16, 6, 19],
    [21.5, 6, 13.5],
  ].map(([cy, x1, x2]) => ({
    x: gx + (x1 - stroke / unit / 2) * unit,
    y: gx + dy + cy * unit - stroke / 2,
    w: (x2 - x1) * unit + stroke,
    h: stroke,
    r: stroke / 2,
  }));
  const S = 4;
  // On a background the image is opaque: RGB, no alpha channel (the App Store requires it).
  const channels = background ? 3 : 4;
  const stride = size * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let inTile = 0;
      let inBar = 0;
      // Pixels clear of the tile (most of a splash screen) need no sampling.
      const outside = x + 1 < tile.x || y + 1 < tile.y || x > tile.x + tile.w || y > tile.y + tile.h;
      for (let sy = 0; sy < S && !outside; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;
          if (!inRoundRect(px, py, tile)) continue;
          inTile += 1;
          if (bars.some((bar) => inRoundRect(px, py, bar))) inBar += 1;
        }
      }
      const offset = row + 1 + x * channels;
      const cover = inTile / (S * S);
      if (inTile === 0 && !background) {
        raw[offset + 3] = 0;
        continue;
      }
      const t = Math.min(1, Math.max(0, ((x - margin) + (y - dy - margin)) / (body * 2)));
      const mix = inTile ? inBar / inTile : 0;
      for (let c = 0; c < 3; c += 1) {
        const bg = TOP[c] + (BOTTOM[c] - TOP[c]) * t;
        const color = bg + (255 - bg) * mix;
        raw[offset + c] = Math.round(background ? background[c] + (color - background[c]) * cover : color);
      }
      if (!background) raw[offset + 3] = Math.round(255 * cover);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = background ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ICNS_TYPES = [
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];

export function iconIcns() {
  const parts = ICNS_TYPES.map(([type, size]) => {
    const png = iconPng(size);
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}
