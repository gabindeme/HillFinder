/**
 * Translations. All UI strings live in locales/<lang>.json; to add French,
 * create fr.json with the same keys and register it below.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React already escapes
});

export default i18n;
