require('dotenv').config();

require('isomorphic-fetch');
const cheerio = require('cheerio');
const util = require('util');
const redis = require('redis');

const client = redis.createClient({
  url: process.env.REDIS_URL,
});

client.on('connect', () => {
  console.info('Connected to redis...', ' keys expire in: ', process.env.REDIS_EXPIRE, 'ms');
});

const asyncGet = util.promisify(client.get).bind(client);
const asyncSet = util.promisify(client.set).bind(client);
const asyncDel = util.promisify(client.del).bind(client);
const asyncKeys = util.promisify(client.keys).bind(client);

const url = 'https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=';

/**
 * Listi af sviðum með „slug“ fyrir vefþjónustu og viðbættum upplýsingum til
 * að geta sótt gögn.
 */
const departments = [
  {
    name: 'Félagsvísindasvið',
    slug: 'felagsvisindasvid',
    id: 1,
  },
  {
    name: 'Heilbrigðisvísindasvið',
    slug: 'heilbrigdisvisindasvid',
    id: 2,
  },
  {
    name: 'Hugvísindasvið',
    slug: 'hugvisindasvid',
    id: 3,
  },
  {
    name: 'Menntavísindasvið',
    slug: 'menntavisindasvid',
    id: 4,
  },
  {
    name: 'Verkfræði- og náttúruvísindasvið',
    slug: 'verkfraedi-og-natturuvisindasvid',
    id: 5,
  },
];

/**
 * Sækir svið eftir `slug`. Fáum gögn annaðhvort beint frá vef eða úr cache.
 *
 * @param {string} slug - Slug fyrir svið sem skal sækja
 * @returns {Promise} Promise sem mun innihalda gögn fyrir svið eða null ef það finnst ekki
 */
async function getTests(slug) {
  const cached = await asyncGet(slug);
  if (cached) {
    return JSON.parse(cached);
  }

  const department = departments.find(item => item.slug === slug) || null;
  if (!department) {
    return null;
  }

  const { id } = department;
  const response = await fetch(url + id);
  const text = await response.json();
  const $ = cheerio.load(text.html);
  const tables = $('table');
  const tests = [];
  tables.each((i, element) => {
    const rows = $('tbody tr', element);
    const testies = [];

    rows.map((t, el) => (testies.push({
      course: $(el).find('td:nth-of-type(1)').text().trim(),
      name: $(el).find('td:nth-of-type(2)').text().trim(),
      type: $(el).find('td:nth-of-type(3)').text().trim(),
      students: $(el).find('td:nth-of-type(4)').text().trim(),
      date: $(el).find('td:nth-of-type(5)').text().trim(),
    })));

    const results = {
      heading: $('div').find(`h3:nth-of-type(${i + 1})`).text().trim(),
      tests: testies,
    };
    tests.push(results);
  });

  await asyncSet(slug, JSON.stringify(tests), 'EX', process.env.REDIS_EXPIRE);
  return tests;
}

/**
 * Hreinsar cache.
 *
 * @returns {Promise} Promise sem mun innihalda boolean um hvort cache hafi verið hreinsað eða ekki.
 */
async function clearCache() {
  const keys = await asyncKeys('*');
  let del = 0;
  if (keys.length > 0) {
    del = await asyncDel.apply(client, keys);
  }
  return del === keys.length;
}

/**
 * Sækir tölfræði fyrir öll próf allra deilda allra sviða.
 *
 * @returns {Promise} Promise sem mun innihalda object með tölfræði um próf
 */
async function getStats() {
  const cached = await asyncGet('stats');
  if (cached) {
    return JSON.parse(cached);
  }

  const response = await fetch(url + 0);
  const text = await response.json();
  const $ = cheerio.load(text.html);
  const tests = $('tbody tr');
  let sum = 0;
  let maxValue = 0;
  let minValue = Infinity;
  tests.each((i, el) => {
    const num = Number($(el).find('td:nth-of-type(4)').text().trim());
    sum += num;
    if (maxValue < num) maxValue = num;
    if (minValue > num) minValue = num;
  });
  const avg = parseFloat(sum / tests.length).toFixed(2);

  const data = {
    min: minValue,
    max: maxValue,
    numTests: tests.length,
    numStudents: sum,
    averageStudents: avg,
  };
  await asyncSet('stats', JSON.stringify(data), 'EX', process.env.REDIS_EXPIRE);

  return data;
}

module.exports = {
  departments,
  getTests,
  clearCache,
  getStats,
};
