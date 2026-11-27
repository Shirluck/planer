const { net } = require('electron');

const { sniff } = require('./media');

const feeds = new Map([
  ['behance', 'https://www.behance.net/feeds/projects'],
  ['design', 'https://habr.com/ru/rss/hubs/design/articles/?fl=ru'],
  ['science', 'https://habr.com/ru/rss/hubs/popular_science/articles/?fl=ru'],
  ['trend', 'https://habr.com/ru/rss/articles/top/daily/?fl=ru']
]);

async function fetchDevelopmentFeed(category) {
  const url = feeds.get(category);
  if (!url) throw Error('Неизвестная рубрика');
  return (await readPublic(url, 1500000)).toString('utf8');
}

async function readPublic(url, limit) {
  const response = await net.fetch(url, {
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(10000)
  });
  if (!response.ok || !response.body) throw Error('Источник недоступен');
  const chunks = [];
  let size = 0;
  const reader = response.body.getReader();
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw Error('Слишком большой ответ');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
async function developmentCover(raw, media) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    const hosts = ['habrastorage.org', 'mir-s3-cdn-cf.behance.net'];
    if (url.protocol !== 'https:' || !hosts.includes(url.hostname) || url.port || url.username || url.password) return null;
    const bytes = await readPublic(url.href, 6 * 1024 * 1024);
    const ext = sniff(bytes);
    if (!['jpg','png','webp','avif','gif'].includes(ext)) return null;
    const saved = await media.importBuffer('cover.' + ext, 'image/' + (ext === 'jpg' ? 'jpeg' : ext), bytes);
    return saved.ok ? saved.meta.id : null;
  } catch { return null; }
}
module.exports = {fetchDevelopmentFeed, developmentCover};
