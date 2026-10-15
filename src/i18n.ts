import en from '../_locales/en/messages.json';
import ko from '../_locales/ko/messages.json';
import ja from '../_locales/ja/messages.json';
export type Locale = 'system' | 'en' | 'ko' | 'ja';
let locale: Locale = 'system';
export function setLocale(value: Locale) {
  locale = value;
}
export function t(key: keyof typeof en, substitutions?: string | string[]): string {
  if (locale === 'system') return chrome.i18n.getMessage(key, substitutions) || en[key].message;
  const catalog = { en, ko, ja }[locale];
  return catalog[key]?.message || en[key].message;
}
