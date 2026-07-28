import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePng = path.join(rootDir, "public", "pwa-icon-512.png");
const outputDir = path.join(rootDir, "build");
const outputIco = path.join(outputDir, "icon.ico");

function readPngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a") {
    throw new Error(`${sourcePng} is not a PNG file.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

const png = fs.readFileSync(sourcePng);
const { width, height } = readPngSize(png);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

const directory = Buffer.alloc(16);
directory.writeUInt8(width >= 256 ? 0 : width, 0);
directory.writeUInt8(height >= 256 ? 0 : height, 1);
directory.writeUInt8(0, 2);
directory.writeUInt8(0, 3);
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(32, 6);
directory.writeUInt32LE(png.length, 8);
directory.writeUInt32LE(header.length + directory.length, 12);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputIco, Buffer.concat([header, directory, png]));
console.log(`Created ${path.relative(rootDir, outputIco)} from ${path.relative(rootDir, sourcePng)}.`);
