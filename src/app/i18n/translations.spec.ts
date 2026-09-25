/**
 * The translation files, as data.
 *
 * Modeled on CEE's check of its own maps, which had drifted apart unnoticed: keys missing from one
 * language, and a key whose name had been translated along with its value so that nothing would
 * ever look it up. These assertions are structural rather than linguistic. A test cannot know
 * whether a translation is good, but it can know that one exists, that it is not the English
 * verbatim, and that its key is still an identifier.
 */
import en from '../../assets/i18n/en.json';
import hu from '../../assets/i18n/hu.json';

type Flat = Record<string, string>;

function flatten(node: Record<string, unknown>, prefix = ''): Flat {
  const out: Flat = {};
  for (const [key, value] of Object.entries(node)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Record<string, unknown>, `${prefix}${key}.`));
    } else {
      out[`${prefix}${key}`] = String(value);
    }
  }
  return out;
}

const maps: Record<'en' | 'hu', Flat> = { en: flatten(en), hu: flatten(hu) };
const reference = maps.en;

/**
 * Hungarian values that are the English verbatim on purpose. Empty today; an entry names the key
 * and says why the two languages write it alike.
 */
const SAME_IN_BOTH: Readonly<Record<string, string>> = {};

/** The placeholders a value interpolates, which every translation of it must keep. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]).sort();
}

describe('the translation files', () => {
  it('are both non-empty', () => {
    expect(Object.keys(maps.en).length).toBeGreaterThan(0);
    expect(Object.keys(maps.hu).length).toBeGreaterThan(0);
  });

  it('declare exactly the same keys', () => {
    // Named rather than counted, so a failure says which string a reader would not see.
    expect(Object.keys(reference).filter((key) => !(key in maps.hu))).toEqual([]);
    expect(Object.keys(maps.hu).filter((key) => !(key in reference))).toEqual([]);
  });

  it.each(['en', 'hu'] as const)('%s uses ASCII key names', (language) => {
    expect(Object.keys(maps[language]).filter((key) => !/^[A-Za-z0-9.]+$/.test(key))).toEqual([]);
  });

  it.each(['en', 'hu'] as const)('%s has no blank values', (language) => {
    expect(
      Object.entries(maps[language])
        .filter(([, value]) => value.trim() === '')
        .map(([key]) => key),
    ).toEqual([]);
  });

  it('translates every Hungarian value rather than copying the English', () => {
    const copied = Object.entries(maps.hu)
      .filter(([key, value]) => value === reference[key] && !(key in SAME_IN_BOTH))
      .map(([key]) => key);
    expect(copied).toEqual([]);
  });

  it('keeps every exception to that rule current', () => {
    const stale = Object.keys(SAME_IN_BOTH).filter((key) => maps.hu[key] !== reference[key]);
    expect(stale).toEqual([]);
  });

  it('keeps the placeholders of every English value', () => {
    const mismatched = Object.keys(reference).filter(
      (key) => JSON.stringify(placeholders(reference[key])) !== JSON.stringify(placeholders(maps.hu[key] ?? '')),
    );
    expect(mismatched).toEqual([]);
  });
});
