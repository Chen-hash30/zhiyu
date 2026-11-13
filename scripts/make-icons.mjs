import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const sourcePath = 'build/icon-source.png';
if (!fs.existsSync(sourcePath)) {
  throw new Error('缺少 build/icon-source.png');
}
const source = fs.readFileSync(sourcePath);
const trimmed = await sharp(source).ensureAlpha().trim().png().toBuffer();

async function render(size, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(trimmed)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(target);
}

await render(512, 'build/icon.png');
await render(256, 'build/icon-256.png');
await render(512, 'src/assets/app-icon.png');
await render(64, 'public/favicon.png');
const ico = await pngToIco('build/icon-256.png');
fs.writeFileSync('build/icon.ico', ico);
console.log('icons written');