import { deflateSync } from "node:zlib";

const PAPER = [0xf7, 0xf6, 0xf3, 255];
const INK = [0x2c, 0x28, 0x24, 255];

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

export function iconPng(size) {
  const stroke = Math.max(1, Math.round(size * 0.09));
  const inset = size * 0.2;
  const lines = [0.32, 0.5, 0.68];
  const widths = [1, 0.62, 0.36];
  const bars = lines.map((y, i) => ({
    x: inset,
    y: size * y - stroke / 2,
    w: (size - inset * 2) * widths[i],
    h: stroke,
    r: stroke / 2,
  }));
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let color = PAPER;
      for (const bar of bars) {
        if (inRoundRect(x + 0.5, y + 0.5, bar)) {
          color = INK;
          break;
        }
      }
      const offset = row + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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
