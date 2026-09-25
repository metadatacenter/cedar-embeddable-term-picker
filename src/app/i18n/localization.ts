import { Injectable, Provider, computed, inject } from '@angular/core';
import {
  InterpolationParameters,
  TranslateLoader,
  TranslateService,
  TranslationObject,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import en from '../../assets/i18n/en.json';
import hu from '../../assets/i18n/hu.json';
import type { CetpLanguage } from '../cetp-public-api';

export type { CetpLanguage };

/** The languages the picker speaks. A host chooses one with the element's `language` input. */
export const LANGUAGES: readonly CetpLanguage[] = ['en', 'hu'];

export const DEFAULT_LANGUAGE: CetpLanguage = 'en';

/**
 * Both maps, compiled into the bundle.
 *
 * The picker is a script a host page loads from wherever it likes, so a map fetched at runtime
 * would need a URL the picker cannot know. Bundling them costs a few kilobytes and removes the
 * question.
 */
const TRANSLATIONS: Readonly<Record<CetpLanguage, TranslationObject>> = { en, hu };

/**
 * The locale each language formats counts in.
 *
 * English is `en-US` because that is what every test browser already resolved the argument-free
 * `toLocaleString()` to, so English output is unchanged there. A viewer whose browser runs in
 * another locale now sees English counts grouped the English way rather than their own, which is
 * what a page that has chosen English should show.
 */
const NUMBER_LOCALES: Readonly<Record<CetpLanguage, string>> = { en: 'en-US', hu: 'hu-HU' };

/** A language the picker speaks, or the default for any other value a host sets. */
export function languageOf(value: unknown): CetpLanguage {
  return LANGUAGES.find((language) => language === value) ?? DEFAULT_LANGUAGE;
}

/** Text the picker states itself, identified by its key in the translation files. */
export interface Phrase {
  readonly key: string;
  readonly params?: InterpolationParameters;
}

/**
 * Something to tell the author: a phrase of the picker's own, or text someone else wrote.
 *
 * A plain string is text the picker did not write and so cannot translate, such as a sentence the
 * terminology server sent. Keeping the two apart is what lets a phrase follow a change of language
 * after it was raised, where a string translated at the time would stay in the old one.
 */
export type Message = Phrase | string;

export function phrase(key: string, params?: InterpolationParameters): Phrase {
  return params === undefined ? { key } : { key, params };
}

export function isPhrase(message: Message): message is Phrase {
  return typeof message !== 'string';
}

/**
 * Carries a message out of code that reports by throwing.
 *
 * `message` holds the text when there is one to hold and the key otherwise, so a stack trace
 * still says something; what the author reads is `said`.
 */
export class MessageError extends Error {
  constructor(readonly said: Message) {
    super(isPhrase(said) ? said.key : said);
    this.name = 'MessageError';
  }
}

/** What a failure tells the author: its own message when it carries one, else the fallback. */
export function messageOf(failure: unknown, fallback: Message): Message {
  if (failure instanceof MessageError) {
    return failure.said;
  }
  return failure instanceof Error ? failure.message : fallback;
}

class BundledTranslationLoader implements TranslateLoader {
  getTranslation(language: string): Observable<TranslationObject> {
    return of(TRANSLATIONS[languageOf(language)]);
  }
}

/**
 * Speaks the active language of one picker.
 *
 * Every call reads `language`, so a template or a `computed` that goes through here depends on the
 * language and is redrawn when it changes. ngx-translate's `translate` pipe does the same for the
 * static keys in the templates.
 */
@Injectable()
export class Localizer {
  private readonly translations = inject(TranslateService);

  readonly language = computed(() => languageOf(this.translations.currentLang()));

  use(language: CetpLanguage): void {
    this.translations.use(language);
  }

  t(key: string, params?: InterpolationParameters): string {
    this.language();
    const text: unknown = this.translations.instant(key, params);
    return typeof text === 'string' ? text : key;
  }

  /** A phrase whose English differs between one and many; Hungarian keeps both keys alike. */
  plural(key: string, count: number, params?: InterpolationParameters): string {
    return this.t(`${key}.${count === 1 ? 'one' : 'many'}`, { count, ...params });
  }

  say(message: Message): string {
    return isPhrase(message) ? this.t(message.key, message.params) : message;
  }

  /** A count, grouped the way the active language groups digits. */
  number(value: number): string {
    return value.toLocaleString(NUMBER_LOCALES[this.language()]);
  }
}

/**
 * The providers that give one picker its own language.
 *
 * Declared as view providers of the picker, so each element on a page holds its own translation
 * service and two pickers can speak different languages side by side. View providers are also
 * what the picker's own template, its pipes and its child components resolve.
 */
export function provideLocalization(): Provider[] {
  return [
    ...provideTranslateService({
      loader: provideTranslateLoader(() => new BundledTranslationLoader()),
      lang: DEFAULT_LANGUAGE,
      fallbackLang: DEFAULT_LANGUAGE,
    }),
    Localizer,
  ];
}
