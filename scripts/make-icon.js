// Генерирует иконку приложения: четыре цветных квадрата (как логотип в шапке) на скруглённом фоне.
// build/icon.png (1024×1024) и build/icon.ico (16, 24, 32, 48, 64, 128, 256). Запуск: npm run icons
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const OUT = path.join(__dirname, '..', 'build');
const COLORS = ['#0b8a80', '#5156d6', '#c0602f', '#a145b8'];   // --c-day, --c-week, --c-plans, --c-ideas

// Для мелких размеров геометрия подгоняется под пиксельную сетку, иначе квадраты расплываются.
function svg(size) {
  const small = size <= 48;
  const m = small ? 0 : Math.round(size * 0.04);                   // поле вокруг фона
  const bg = size - 2 * m;
  const r = Math.round(bg * (small ? 0.2 : 0.22));
  const pad = small ? Math.round(size * 0.17) : Math.round(size * 0.215);
  const gap = Math.max(1, Math.round(size * (small ? 0.07 : 0.045)));
  const inner = size - 2 * pad;
  const cell = Math.floor((inner - gap) / 2);
  const off = Math.round((size - (cell * 2 + gap)) / 2);
  const cr = Math.max(1, Math.round(cell * 0.22));
  const sq = COLORS.map((c, i) => {
    const x = off + (i % 2) * (cell + gap), y = off + Math.floor(i / 2) * (cell + gap);
    return '<rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="' + cr + '" fill="' + c + '"/>';
  }).join('');
  const stroke = Math.max(1, Math.round(size / 128));
  return Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffdfa"/><stop offset="1" stop-color="#f1ede5"/></linearGradient></defs>' +
    '<rect x="' + (m + stroke / 2) + '" y="' + (m + stroke / 2) + '" width="' + (bg - stroke) + '" height="' + (bg - stroke) + '" rx="' + r + '" fill="url(#g)" stroke="#d9d3c7" stroke-width="' + stroke + '"/>' +
    sq + '</svg>');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await sharp(svg(1024)).png().toFile(path.join(OUT, 'icon.png'));
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = await Promise.all(sizes.map(s => sharp(svg(s), { density: 72 }).resize(s, s).png().toBuffer()));
  const { default: pngToIco } = await import('png-to-ico');
  fs.writeFileSync(path.join(OUT, 'icon.ico'), await pngToIco(pngs));
  // превью всех размеров для проверки глазами
  const strip = await sharp({ create: { width: sizes.reduce((a, s) => a + s + 16, 16), height: 256 + 32, channels: 4, background: '#202020' } })
    .composite(pngs.map((b, i) => ({ input: b, left: 16 + sizes.slice(0, i).reduce((a, s) => a + s + 16, 0), top: 16 }))).png().toBuffer();
  fs.writeFileSync(path.join(OUT, 'icon-preview.png'), strip);
  console.log('build/icon.png, build/icon.ico (' + sizes.join(', ') + ')');
})().catch(e => { console.error(e); process.exit(1); });
