// Renders the app icon (blue rounded square with a white check) as a PNG at
// runtime, so the repo doesn't need binary assets.
const zlib = require('zlib');

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function iconPng(size = 64) {
  const rows = [];
  const r = size * 0.22;
  const stroke = size * 0.085;
  const check = [[0.28, 0.52], [0.44, 0.67], [0.73, 0.36]].map(([x, y]) => [x * size, y * size]);
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      // Rounded-rect coverage with 1px anti-aliasing.
      const qx = Math.max(Math.abs(px - size / 2) - (size / 2 - r), 0);
      const qy = Math.max(Math.abs(py - size / 2) - (size / 2 - r), 0);
      const inside = Math.max(0, Math.min(1, r - Math.hypot(qx, qy) + 0.5));
      const t = (px + py) / (2 * size);
      let [cr, cg, cb] = [57 + (124 - 57) * t, 135 + (92 - 135) * t, 229 + (240 - 229) * t];
      const d = Math.min(distToSegment(px, py, ...check[0], ...check[1]), distToSegment(px, py, ...check[1], ...check[2]));
      const w = Math.max(0, Math.min(1, stroke - d + 0.5));
      cr += (255 - cr) * w; cg += (255 - cg) * w; cb += (255 - cb) * w;
      row.set([Math.round(cr), Math.round(cg), Math.round(cb), Math.round(inside * 255)], 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { iconPng };
