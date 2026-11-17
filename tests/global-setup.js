// Готовит тестовые файлы: изображения (sharp), короткое видео WebM (MediaRecorder из canvas внутри Electron,
// потому что ffmpeg в системе может отсутствовать), «плохие» файлы для проверок.
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { FIX, tmpDataDir, rmDir, launch, closeApp } = require('./helpers');

module.exports = async () => {
  fs.mkdirSync(FIX, { recursive: true });
  const f = n => path.join(FIX, n);
  const svg = (w, h, body) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '">' + body + '</svg>');

  if (!fs.existsSync(f('photo.png'))) {
    await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#9db8e0' } })
      .composite([{ input: svg(1600, 1000, '<rect x="0" y="640" width="1600" height="360" fill="#6f9a5a"/><circle cx="1180" cy="260" r="150" fill="#f2c14e"/><path d="M200 640 L520 260 L840 640 Z" fill="#5d6d7e"/><path d="M640 640 L960 330 L1280 640 Z" fill="#7f8c8d"/>') }])
      .png().toFile(f('photo.png'));
  }
  if (!fs.existsSync(f('cat.jpg'))) {
    await sharp({ create: { width: 900, height: 1200, channels: 3, background: '#f4e1c1' } })
      .composite([{ input: svg(900, 1200, '<circle cx="450" cy="600" r="300" fill="#c0602f"/><circle cx="350" cy="520" r="40" fill="#25221e"/><circle cx="550" cy="520" r="40" fill="#25221e"/>') }])
      .jpeg({ quality: 85 }).toFile(f('cat.jpg'));
  }
  if (!fs.existsSync(f('small.webp'))) await sharp({ create: { width: 700, height: 420, channels: 4, background: { r: 81, g: 86, b: 214, alpha: 1 } } }).webp().toFile(f('small.webp'));
  if (!fs.existsSync(f('noise.png'))) {
    const w = 700, h = 700, raw = Buffer.alloc(w * h * 3);
    for (let i = 0; i < raw.length; i++) raw[i] = (Math.random() * 256) | 0;
    await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toFile(f('noise.png'));
  }
  fs.writeFileSync(f('notes.txt'), 'обычный текстовый файл');
  fs.writeFileSync(f('empty.png'), Buffer.alloc(0));
  fs.copyFileSync(f('photo.png'), f('fake-video.mp4'));             // PNG под видом MP4
  fs.writeFileSync(f('fake-image.jpg'), Buffer.from('это не картинка, а текст'.repeat(20)));

  if (!fs.existsSync(f('clip.webm')) || fs.statSync(f('clip.webm')).size < 1000) {
    const dir = tmpDataDir('fixtures');
    const { app, page } = await launch(dir);
    try {
      const b64 = await page.evaluate(async () => {
        const c = document.createElement('canvas'); c.width = 320; c.height = 180;
        c.style.cssText = 'position:fixed;left:0;top:0;opacity:.01;pointer-events:none';
        document.body.append(c);
        const g = c.getContext('2d');
        let n = 0;
        const draw = () => { g.fillStyle = 'hsl(' + (n * 7 % 360) + ',65%,55%)'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.font = 'bold 38px sans-serif'; g.fillText('Кадр ' + n, 70, 105); n++; };
        draw();
        const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8' });
        const chunks = [];
        rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
        const iv = setInterval(draw, 33);
        rec.start(100);
        await new Promise(r => setTimeout(r, 2200));
        await new Promise(r => { rec.onstop = r; rec.stop(); });
        clearInterval(iv); c.remove();
        const buf = new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(s);
      });
      fs.writeFileSync(f('clip.webm'), Buffer.from(b64, 'base64'));
    } finally { await closeApp(app); rmDir(dir); }
  }
};
