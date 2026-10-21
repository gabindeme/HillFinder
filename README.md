# HillFinder

**Find the best hill near you for hill repeats**, even in flat places.

HillFinder is a mobile-first web app for trail runners. Type an address or use your location, and it finds runnable climbs within your chosen radius. It ranks them by what "best" means to you, shows them on a map with an elevation profile, and suggests a repeat session such as *"10 × 235 m at 7.4% avg"*.

It was built for Rennes, France, where the best hill may only have 20–30 m of gain. The ranking compares hills with each other, not with mountains, so it always returns the best options available rather than nothing.

## Features

- **Location:** address search (Nominatim) or browser geolocation, with an explanation before the permission prompt and a fallback to typing an address.
- **Climb detection** along every path and road, in both directions. Short dips are tolerated, long flats split a climb in two, and gentle ends are trimmed off.
- **Ranking priorities:** balanced, steepest, longest, most elevation gain, closest or most trail-like. Every climb shows a **score breakdown** explaining its rank.
- **Filters:**
  - search radius, or travel time on foot or by bike
  - climb length range and average gradient range
  - minimum elevation gain and an optional cap on the steepest section
  - surface (trail, road or any)
  - avoid busy roads, prefer lit paths, and open at all times only

  Filters are saved in the browser. If too few climbs match, they loosen automatically, but the radius never does.
- **Public access:** climbs inside military land, prisons, school grounds or private areas, or through locked gates, are never shown. Climbs in parks with opening hours are flagged.
- **Climb details:** elevation profile coloured by gradient, stats, a suggested session and links to check the spot on OpenStreetMap.
- **Favourites:** star a climb to keep it in your browser. Saved hills stay viewable without a connection.
- **Two data sources:**
  - **Fast** (vector tiles, a few seconds per search)
  - **Detailed** (Overpass: slower, but adds lighting, opening hours and gates)
- **Speed:** a quick pass shows nearby climbs first, finished results are cached so repeat searches take 1–2 s, and all heavy work runs in a Web Worker.

## Getting started

Requires Node.js 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Browsers only allow geolocation on `localhost` or HTTPS. If the dev server runs on a remote machine, open it through an SSH tunnel (`ssh -L 5173:localhost:5173 <host>`) rather than its IP address.

Other scripts:

```bash
pnpm test         # unit tests (Vitest)
pnpm lint         # oxlint
pnpm build        # type-check + production build into dist/
pnpm preview      # serve the production build

# Run a full search from the command line and print the ranked climbs:
pnpm try                                  # central Rennes, 5 km, Overpass data
pnpm try 48.1113 -1.68 5 --fast           # lat, lon, radius km, vector tiles
```

No API keys are needed. The app is fully static and can be hosted on any static host, such as GitHub Pages or Cloudflare Pages.

## How it works

```
OSM paths ──► routes ──► elevation profiles ──► climbs ──► filter & rank
(tiles or     (paths      (IGN lidar,           (detect,    (user filters,
 Overpass)    joined)      sampled every 5 m)    label,      score, de-dup)
                                                 access)
```

1. **Paths** (`src/data/vectorTiles.ts`, `src/data/overpass.ts`): runnable OSM ways (footways, tracks, residential streets and so on). Motorways, steps and private paths are excluded.
2. **Routes** (`src/core/graph.ts`): OSM splits roads arbitrarily, so ways are cut at junctions and re-joined into continuous lines by pairing the straightest continuation at each junction.
3. **Profiles** (`src/core/profile.ts`): each route is resampled every 5 m and its elevation read from IGN's grid. A median filter and a 25 m moving average remove noise. Bridges and tunnels are interpolated, because the terrain model shows the valley under a bridge, not the deck.
4. **Climbs** (`src/core/climbs.ts`): a scan that tolerates dips of up to 2 m finds stretches that go up overall. Any 100 m stretch under 1% splits a climb in two. Gentle ends are trimmed, and the "max gradient" is the steepest 50 m section, not a single noisy sample.
5. **Labels & access** (`src/core/naming.ts`, `src/core/access.ts`): unnamed paths get a label such as "Footpath in Parc du Thabor" or "Footpath near Rue …". Climbs inside restricted areas or through closed gates are flagged.
6. **Ranking** (`src/core/scoring.ts`): each factor (steepness, gain, length, proximity, trail, safety, lighting) is normalised to the 90th percentile of the candidates found nearby, then weighted by the chosen priority. Near-duplicates are dropped, such as sidewalks beside a road or parallel paths up the same slope.
7. **Session** (`src/core/session.ts`): rep time comes from Minetti et al. (2002), a model of the energy cost of running uphill. Reps are sized for about 15 minutes of uphill effort; long climbs use their first 600 m.

Steps 1–5 run once per search in a Web Worker (`src/worker/`). Ranking runs on the main thread, so changing filters is instant.

## Data sources

| Data | Source | Notes |
|---|---|---|
| Elevation | [IGN RGE ALTI](https://geoservices.ign.fr/rgealti) via the Géoplateforme WMS-R | Lidar-based terrain model, fetched as about 4 m grids. **France only.** |
| Paths (fast) | [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema) | Lighting, opening hours, gates and most park names aren't included. |
| Paths (detailed) | [Overpass API](https://overpass-api.de) | Full OSM tags. Public servers are sometimes overloaded; the app retries several of them. |
| Geocoding | [Nominatim](https://nominatim.org) | Searches only on submit, at most one request per second, with results cached, per the [usage policy](https://operations.osmfoundation.org/policies/nominatim/). |
| Base map | OpenStreetMap tiles in [MapLibre GL](https://maplibre.org) | |

Map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) · © OpenMapTiles · Elevation © IGN.

Downloads are cached in IndexedDB for one to two weeks (paths) or three months (elevation), and finished results for a week, to avoid hammering the public services.

## Project structure

```
src/
  core/       pure, tested logic: graph, profiles, climb detection, scoring,
              filters, access, naming, sessions (no DOM)
  data/       data sources + IndexedDB cache + worker client
  worker/     search Web Worker and its message protocol
  ui/         React components, favourites, local storage
  i18n/       i18next setup; strings in locales/en.json
scripts/      command-line search for development
```

## Adding a language

All UI text lives in `src/i18n/locales/en.json`. To add French, copy it to `fr.json`, translate the values and register it in `src/i18n/index.ts`.

## Limitations

- **Elevation covers France only.** Elsewhere, searches report that no climbs were found.
- **Access information is only as good as OpenStreetMap.** Signs on site always take precedence. If you spot a mistake, report it with the link in a climb's details.
- **Travel time is an estimate:** distance at an easy running or cycling speed, allowing for indirect street routes. There's no real routing.
- **Searches rely on free public services.** A first search in a new area takes about 10–15 s with Fast data and can take a minute with Detailed.
