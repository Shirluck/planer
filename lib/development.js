const { net } = require('electron');

const feeds = new Map([
  ['design', 'https://habr.com/ru/rss/hubs/design/articles/?fl=ru'],
  ['science', 'https://habr.com/ru/rss/hubs/popular_science/articles/?fl=ru'],
  ['trend', 'https://habr.com/ru/rss/articles/top/daily/?fl=ru']
]);

async function fetchDevelopmentFeed(category) {
  const url = feeds.get(category);
  if (!url) throw Error('Неизвестная рубрика');
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
    if (size > 1500000) {
      await reader.cancel();
      throw Error('Слишком большой ответ');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
module.exports = {fetchDevelopmentFeed};
