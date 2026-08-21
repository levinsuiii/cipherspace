import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const iconDirectory = resolve(scriptDirectory, "../public/icons");

const colors = {
  accent: [118, 243, 196, 255],
  background: [9, 17, 15, 255],
  panel: [16, 35, 29, 255]
};

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function insideRoundedSquare(x, y) {
  const distanceX = Math.max(Math.abs(x - 0.5) - 0.31, 0);
  const distanceY = Math.max(Math.abs(y - 0.5) - 0.31, 0);
  return Math.hypot(distanceX, distanceY) <= 0.09;
}

function iconPixel(x, y) {
  let color = colors.background;
  if (insideRoundedSquare(x, y)) color = colors.panel;

  const borderDistanceX = Math.max(Math.abs(x - 0.5) - 0.315, 0);
  const borderDistanceY = Math.max(Math.abs(y - 0.5) - 0.315, 0);
  const borderDistance = Math.hypot(borderDistanceX, borderDistanceY);
  if (borderDistance > 0.073 && borderDistance <= 0.09) color = colors.accent;

  const dx = x - 0.5;
  const dy = y - 0.5;
  const radius = Math.hypot(dx, dy);
  const inLetterRing = radius >= 0.135 && radius <= 0.245;
  const inLetterGap = dx > 0.035 && Math.abs(dy) < 0.145;
  if (inLetterRing && !inLetterGap) color = colors.accent;

  return color;
}

function createPng(size) {
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * stride;
    pixels[rowStart] = 0;
    for (let x = 0; x < size; x += 1) {
      const offset = rowStart + 1 + x * 4;
      const color = iconPixel((x + 0.5) / size, (y + 0.5) / size);
      pixels.set(color, offset);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

await mkdir(iconDirectory, { recursive: true });
for (const [filename, size] of [
  ["cipherspace-180.png", 180],
  ["cipherspace-192.png", 192],
  ["cipherspace-512.png", 512],
  ["cipherspace-maskable-512.png", 512]
]) {
  await writeFile(resolve(iconDirectory, filename), createPng(size));
}

console.log("Generated CipherSpace PWA icons in apps/web/public/icons.");
