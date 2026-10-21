import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { geocode, type Place } from '../data/nominatim';

interface Props {
  onPlace: (place: Place) => void;
  /** Recently searched places, newest first (their results work offline). */
  recent: Place[];
}

type GeoState = 'idle' | 'explain' | 'locating';

export function LocationBar({ onPlace, recent }: Props) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [geo, setGeo] = useState<GeoState>('idle');

  const choose = (p: Place) => {
    setResults([]);
    setMessage(null);
    setQuery(shortLabel(p));
    onPlace(p);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const places = await geocode(query, i18n.language);
      if (!places.length) setMessage(t('location.noResults', { query }));
      else if (places.length === 1) choose(places[0]);
      else setResults(places);
    } catch {
      setMessage(t('location.error'));
    } finally {
      setBusy(false);
    }
  };

  const askLocation = async () => {
    if (!('geolocation' in navigator)) {
      setMessage(t('location.unavailable'));
      return;
    }
    // Skip our explanation if the user already granted permission earlier.
    const status = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
    if (status?.state === 'granted') locate();
    else setGeo('explain');
  };

  const locate = () => {
    setGeo('locating');
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo('idle');
        choose({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: t('location.myPosition') });
      },
      (err) => {
        setGeo('idle');
        setMessage(err.code === err.PERMISSION_DENIED ? t('location.denied') : t('location.unavailable'));
        document.getElementById('location-input')?.focus();
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  };

  return (
    <div className="location">
      <form className="location-form" onSubmit={submit} role="search">
        <input
          id="location-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('location.placeholder')}
          aria-label={t('location.placeholder')}
          autoComplete="street-address"
        />
        <button type="submit" disabled={busy}>
          {t('location.search')}
        </button>
      </form>
      <button type="button" className="link" onClick={askLocation} disabled={geo === 'locating'}>
        ◎ {geo === 'locating' ? t('location.locating') : t('location.useMyLocation')}
      </button>

      {geo === 'explain' && (
        <div className="notice" role="dialog" aria-labelledby="geo-title">
          <strong id="geo-title">{t('location.permissionTitle')}</strong>
          <p>{t('location.permissionBody')}</p>
          <div className="row">
            <button type="button" onClick={locate}>
              {t('location.allow')}
            </button>
            <button type="button" className="secondary" onClick={() => setGeo('idle')}>
              {t('location.cancel')}
            </button>
          </div>
        </div>
      )}

      {results.length > 1 && (
        <ul className="place-results">
          {results.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" onClick={() => choose(p)}>
                {p.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 && results.length === 0 && (
        <div className="recent" aria-label={t('location.recent')}>
          <span className="muted">{t('location.recent')}</span>
          {recent.map((p) => (
            <button key={`${p.lat},${p.lon}`} type="button" className="chip" onClick={() => choose(p)}>
              {shortLabel(p)}
            </button>
          ))}
        </div>
      )}
      {message && (
        <p className="message" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

/** "12 Rue X, Rennes, Ille-et-Vilaine, …" → "12 Rue X, Rennes". */
const shortLabel = (p: Place) => p.label.split(',').slice(0, 2).join(',');
