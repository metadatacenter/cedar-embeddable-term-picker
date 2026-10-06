// Every picker message that carries a count, at zero, one and two, in English and Hungarian.
//
// A number before a noun needs a singular in English: "1 values", "1 saved term actions" and
// "1 branches in 2 ontologies" were what one meant. A counted phrase keeps a form per count, one
// segment for each: `<key>.one` and `<key>.many`, or `<key>.one.many` for a phrase counting two
// things. `countKey` in localization.ts is the one place that chooses. Hungarian keeps a noun
// singular after any number, so its forms read alike. This fails when a message counting a plural
// noun has no singular form, when a singular form still reads as a plural, or when source names a
// form itself rather than asking `countKey`.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url).pathname;
const catalogue = async (language) =>
  JSON.parse(await readFile(join(root, 'src/assets/i18n', `${language}.json`), 'utf8'));
function flatten(node, prefix = '', into = {}) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value, path, into);
    else into[path] = value;
  }
  return into;
}
const texts = { en: flatten(await catalogue('en')), hu: flatten(await catalogue('hu')) };
const COUNTS = /\{\{\s*(count|total|maximum|branches)\s*\}\}([^.,:;()—–|]*)/g;
const NOT_PLURAL = new Set(['is', 'was', 'has', 'its', 'this', 'as']);
/** The counting placeholders whose following noun reads as a plural. */
const pluralAfter = (text) =>
  [...text.matchAll(COUNTS)]
    .filter((match) =>
      match[2]
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .some((word) => /s$/i.test(word) && !NOT_PLURAL.has(word.toLowerCase())),
    )
    .map((match) => match[1]);
const FORM = /\.(one|many)$/;

test('every English message that counts a plural noun has a singular form, in both languages', () => {
  const missing = Object.entries(texts.en)
    .filter(([key, text]) => !FORM.test(key) && pluralAfter(text).length)
    .map(([key, text]) => `${key}: ${text}`);
  assert.deepEqual(missing, []);
  for (const key of Object.keys(texts.en).filter((key) => FORM.test(key)))
    assert.equal(typeof texts.hu[key], 'string', `hu has no ${key}`);
});

// Each counted phrase, with its count segments read off its keys: `a.b.one.many` counts twice.
const phrases = new Map();
for (const key of Object.keys(texts.en)) {
  const segments = key.split('.');
  let depth = 0;
  while (depth < segments.length && /^(one|many)$/.test(segments[segments.length - 1 - depth])) depth++;
  if (depth) phrases.set(segments.slice(0, -depth).join('.'), depth);
}
for (const [phrase, depth] of phrases)
  for (const language of ['en', 'hu'])
    for (const counts of depth === 1
      ? [[0], [1], [2]]
      : [
          [1, 2],
          [2, 1],
          [2, 2],
          [1, 1],
        ])
      test(`${phrase} with ${counts.join(' and ')}, in ${language}`, () => {
        const key = [phrase, ...counts.map((count) => (count === 1 ? 'one' : 'many'))].join('.');
        const text = texts[language][key];
        assert.equal(typeof text, 'string', `${language} has no ${key}`);
        if (language === 'en') {
          // A placeholder counting exactly one may not be followed by a plural noun.
          const params = depth === 1 ? ['count', 'total', 'maximum'] : ['branches', 'count'];
          const singular = new Set(params.filter((_, index) => (counts[index] ?? counts[0]) === 1));
          assert.deepEqual(
            pluralAfter(text).filter((name) => singular.has(name)),
            [],
            `reads as a plural: ${text}`,
          );
        }
      });

test('no source names a counted form itself', async () => {
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|html)$/.test(entry.name) && !entry.name.endsWith('.spec.ts')) files.push(path);
    }
  }
  await walk(join(root, 'src/app'));
  const offenders = [];
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const phrase of phrases.keys()) {
      const literal = phrase.replace(/\./g, '\\.');
      if (new RegExp(`['"\`]${literal}\\.(one|many)`).test(source))
        offenders.push(`${file}: names a form of ${phrase}`);
      if (new RegExp(`['"\`]${literal}['"\`]\\s*\\|\\s*translate|phrase\\(\\s*['"\`]${literal}['"\`]`).test(source))
        offenders.push(`${file}: renders ${phrase} without countKey`);
    }
  }
  assert.deepEqual(offenders, []);
});
