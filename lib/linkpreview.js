// Превью ссылок для доски: заголовок, описание, картинка (Open Graph / Twitter / <title>), для YouTube — oEmbed.
// Загрузка только по запросу пользователя (ссылка на доске), только http/https, без адресов локальной сети,
// с ограничением времени и размера. Картинка сохраняется в медиа-хранилище (media://), дальше работает без сети.
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const HTML_MAX = 1536 * 1024, IMG_MAX = 6 * 1024 * 1024, TIMEOUT = 12000;

function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !h.includes(':')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:');
  return false;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => { try { return String.fromCodePoint(parseInt(x, 16)); } catch (_) { return ''; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(Number(d)); } catch (_) { return ''; } })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|laquo|raquo|mdash|ndash|hellip);/g, (_, n) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', mdash: '—', ndash: '–', hellip: '…' })[n]);
}
const clean = (s, max) => decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max);

function parseHtml(html, baseUrl) {
  const meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {};
    tag.replace(/([a-zA-Z_:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g, (_, k, _v, a, b, c) => { attrs[k.toLowerCase()] = a != null ? a : b != null ? b : c; return ''; });
    const key = (attrs.property || attrs.name || attrs.itemprop || '').toLowerCase();
    if (key && attrs.content != null && meta[key] == null) meta[key] = attrs.content;
  }
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  const linkImg = (html.match(/<link\b[^>]*rel=["']?image_src["']?[^>]*>/i) || [''])[0].match(/href\s*=\s*["']([^"']+)/i);
  const abs = u => { try { return u ? new URL(decodeEntities(u).trim(), baseUrl).href : null; } catch (_) { return null; } };
  return {
    title: clean(meta['og:title'] || meta['twitter:title'] || titleTag || '', 300),
    description: clean(meta['og:description'] || meta['twitter:description'] || meta['description'] || '', 600),
    site: clean(meta['og:site_name'] || meta['application-name'] || '', 80),
    image: abs(meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || (linkImg && linkImg[1])),
    type: clean(meta['og:type'] || '', 40)
  };
}

function charsetOf(contentType, bytes) {
  const m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || '');
  if (m) return m[1];
  const head = Buffer.from(bytes.subarray(0, 4096)).toString('latin1');
  const mm = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);
  return mm ? mm[1] : 'utf-8';
}

function youtubeId(u) {
  const h = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (h !== 'youtube.com' && h !== 'youtube-nocookie.com') return null;
  if (u.pathname === '/watch') return u.searchParams.get('v');
  const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/);
  return m ? m[2] : null;
}

function createLinkPreview({ media, allowLocal }) {
  const cache = new Map();

  // fetch с проверкой каждого перенаправления и ограничением размера
  /** @param {string} url @param {{accept:string, max:number, cookie?:string}} opts */
  async function get(url, { accept, max, cookie }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
      let cur = url;
      for (let hop = 0; hop < 6; hop++) {
        const u = new URL(cur);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
        if (!allowLocal && isPrivateHost(u.hostname)) throw new Error('private host');
        const res = await fetch(u.href, {
          redirect: 'manual', signal: ctrl.signal,
          headers: { 'user-agent': UA, accept: accept || '*/*', 'accept-language': 'ru,en;q=0.8', ...(cookie ? { cookie } : {}) }
        });
        if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { cur = new URL(res.headers.get('location'), u).href; continue; }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const type = res.headers.get('content-type') || '';
        const len = Number(res.headers.get('content-length') || 0);
        if (len && len > max * 4) throw new Error('too big');
        const chunks = []; let size = 0;
        if (res.body) {
          const reader = res.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value); size += value.length;
            if (size >= max) { try { await reader.cancel(); } catch (_) {} break; }
          }
        }
        return { url: u.href, type, bytes: Buffer.concat(chunks.map(c => Buffer.from(c))) };
      }
      throw new Error('too many redirects');
    } finally { clearTimeout(timer); }
  }

  async function saveImage(imgUrl) {
    if (!imgUrl || !media) return null;
    try {
      const r = await get(imgUrl, { accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8', max: IMG_MAX });
      if (r.bytes.length >= IMG_MAX || r.bytes.length < 200) return null;
      const name = 'preview.' + ((media.sniff && media.sniff(r.bytes.subarray(0, 4096))) || 'jpg');
      const saved = await media.importBuffer(name, r.type.split(';')[0], r.bytes);
      return saved && saved.ok && saved.meta.kind === 'image' ? saved.meta : null;
    } catch (_) { return null; }
  }

  async function fetchPreview(rawUrl) {
    let u;
    try { u = new URL(String(rawUrl)); } catch (_) { return { ok: false, error: 'bad url' }; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, error: 'protocol' };
    if (cache.has(u.href)) return cache.get(u.href);
    const out = { ok: false, url: u.href, title: '', description: '', site: '', image: null, kind: '' };
    try {
      const yt = youtubeId(u);
      if (yt) {
        out.kind = 'video'; out.site = 'YouTube';
        const watch = 'https://www.youtube.com/watch?v=' + encodeURIComponent(yt);
        try {
          const o = await get('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(watch), { accept: 'application/json', max: 64 * 1024 });
          const j = JSON.parse(o.bytes.toString('utf8'));
          out.title = clean(j.title, 300); out.author = clean(j.author_name, 120);
        } catch (_) {}
        try {
          const page = await get(watch, { accept: 'text/html', max: HTML_MAX, cookie: 'SOCS=CAI; CONSENT=YES+1' });
          const p = parseHtml(page.bytes.toString('utf8'), page.url);
          if (!out.title && p.title) out.title = p.title.replace(/ - YouTube$/, '');
          if (p.description) out.description = p.description;
        } catch (_) {}
        for (const v of ['maxresdefault', 'hq720', 'sddefault', 'mqdefault']) {
          const img = await saveImage('https://i.ytimg.com/vi/' + encodeURIComponent(yt) + '/' + v + '.jpg');
          if (img && img.width >= 320) { out.image = img; break; }
        }
        if (!out.description && out.author) out.description = 'Канал: ' + out.author;
        out.ok = !!(out.title || out.image);
      } else {
        const page = await get(u.href, { accept: 'text/html,application/xhtml+xml', max: HTML_MAX });
        if (/^image\//i.test(page.type)) {
          out.kind = 'image'; out.title = decodeURIComponent(u.pathname.split('/').pop() || u.hostname);
          out.image = await saveImage(page.url);
        } else {
          let html = '';
          try { html = new TextDecoder(charsetOf(page.type, page.bytes)).decode(page.bytes); } catch (_) { html = page.bytes.toString('utf8'); }
          const p = parseHtml(html, page.url);
          Object.assign(out, { title: p.title, description: p.description, site: p.site, kind: /video/.test(p.type) ? 'video' : (p.type === 'article' ? 'article' : '') });
          out.image = await saveImage(p.image);
        }
        out.ok = !!(out.title || out.description || out.image);
      }
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    const res = { ok: out.ok, url: out.url, title: out.title, description: out.description, site: out.site, kind: out.kind, author: out.author || '',
      image: out.image ? { id: out.image.id, width: out.image.width || 0, height: out.image.height || 0, thumb: !!out.image.thumb } : null, error: out.error };
    if (res.ok) cache.set(u.href, res);
    return res;
  }

  return { fetchPreview, isPrivateHost, parseHtml };
}

module.exports = { createLinkPreview, isPrivateHost, parseHtml, youtubeId };
