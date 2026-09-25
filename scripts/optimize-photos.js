#!/usr/bin/env node
'use strict';
// Optimizes every photo in public/assets/photos/ in place (max 1600px, JPEG q82,
// EXIF rotation applied) and writes 520px thumbnails to /thumbs. Needs `sharp`
// (devDependency). Usage: npm run photos:optimize [-- --max 1600 --quality 82]
const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch { console.error('sharp is not installed. Run: npm install --include=dev'); process.exit(1); }

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const MAX = opt('--max', 1600), Q = opt('--quality', 82), THUMB = opt('--thumb', 520);
const DIR = path.join(__dirname, '..', 'public', 'assets', 'photos');
const THUMBS = path.join(DIR, 'thumbs');
fs.mkdirSync(THUMBS, { recursive: true });

(async () => {
  const files = fs.readdirSync(DIR).filter(f => /\.(jpe?g|png|webp)$/i.test(f));
  let before = 0, after = 0;
  for (const f of files) {
    const src = path.join(DIR, f);
    const input = fs.readFileSync(src); before += input.length;
    const out = await sharp(input).rotate().resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: Q, mozjpeg: true }).toBuffer();
    const dest = path.join(DIR, f.replace(/\.(png|webp|jpeg)$/i, '.jpg'));
    if (dest !== src) fs.unlinkSync(src);
    fs.writeFileSync(dest, out); after += out.length;
    await sharp(out).resize({ width: THUMB, height: THUMB, fit: 'inside' }).jpeg({ quality: 75, mozjpeg: true }).toFile(path.join(THUMBS, path.basename(dest)));
    const m = await sharp(out).metadata();
    console.log(`✓ ${path.basename(dest)}  ${m.width}x${m.height}  ${(out.length / 1024).toFixed(0)} KB`);
  }
  console.log(`\n${files.length} photos · ${(before / 1024 / 1024).toFixed(2)} MB → ${(after / 1024 / 1024).toFixed(2)} MB`);
  if (dest_renamed_hint(files)) console.log('Note: non-JPEG files were converted to .jpg — update config/photos.js or run `npm run photos:sync`.');
})();
function dest_renamed_hint(files) { return files.some(f => !/\.jpe?g$/i.test(f)); }
