import { useTranslation } from 'react-i18next';
import { LANGUAGES, setLanguage } from '../i18n';

/** Compact EN | FR toggle; the choice is remembered (see i18n/index.ts). */
export function LanguageSwitch() {
  const { t, i18n } = useTranslation();
  return (
    <div className="lang-switch" role="group" aria-label={t('lang.label')}>
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          lang={lng}
          aria-pressed={i18n.language === lng}
          onClick={() => setLanguage(lng)}
        >
          {t(`lang.${lng}`)}
        </button>
      ))}
    </div>
  );
}
