import {
  clean,
  joinList,
  normalizeMovie,
  normalizeSearchText,
  readBinding,
  uniqueCandidates,
  yearFromDate,
} from "./movieModel.js";

const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const WIKIPEDIA_SUMMARY_URL = "https://ru.wikipedia.org/api/rest_v1/page/summary/";
const CINEMETA_SEARCH_URL = "https://v3-cinemeta.strem.io/catalog/movie/top/search=";
const CINEMETA_META_URL = "https://v3-cinemeta.strem.io/meta/movie/";
const EXTERNAL_RANDOM_FETCH_TIMEOUT = 7000;
const EXTERNAL_SEARCH_CACHE_TTL = 10 * 60 * 1000;
const EXTERNAL_DETAIL_CACHE_TTL = 60 * 60 * 1000;

const externalRequestCache = {
  searches: new Map(),
  details: new Map(),
};

export async function searchMovieCandidates(title) {
  const wikidataCandidates = await tryFetch(() => fetchWikidataCandidates(title), []);
  if (wikidataCandidates.length) {
    return wikidataCandidates;
  }

  return fetchCinemetaCandidates(title);
}

export async function fetchMovieDetails(candidate) {
  const details = candidate.imdbId
    ? await tryFetch(() => fetchCinemetaDetailsById(candidate.imdbId), {})
    : {};
  const russianPlot = candidate.wikiTitle
    ? await tryFetch(() => fetchRussianSummary(candidate.wikiTitle), "")
    : "";

  return normalizeMovie({
    imdbId: candidate.imdbId || details.imdbId,
    title: candidate.ruTitle || candidate.title || details.title,
    originalTitle: candidate.enTitle || details.title,
    year: candidate.year || details.year,
    poster: details.poster || candidate.poster,
    rating: details.rating,
    runtime: details.runtime,
    genre: details.genre,
    director: details.director,
    cast: details.cast,
    plot: russianPlot || candidate.ruDescription || details.plot,
  });
}

export async function getExpandedMovie(movie) {
  const details = movie.imdbId
    ? await tryFetch(() => fetchCinemetaDetailsById(movie.imdbId), {})
    : {};

  return {
    ...details,
    ...movie,
    runtime: movie.runtime || details.runtime || "",
    genre: movie.genre || details.genre || "",
    director: movie.director || details.director || "",
    cast: movie.cast || details.cast || "",
    plot: movie.plot || details.plot || "Описание не найдено.",
  };
}

export async function fetchWikidataCandidates(title) {
  const query = `
    SELECT ?item ?itemLabel ?itemDescription ?imdbId ?date ?ruwikiTitle ?enLabel WHERE {
      SERVICE wikibase:mwapi {
        bd:serviceParam wikibase:endpoint "www.wikidata.org";
          wikibase:api "EntitySearch";
          mwapi:search "${escapeSparqlString(title)}";
          mwapi:language "ru";
          mwapi:limit "10".
        ?item wikibase:apiOutputItem mwapi:item.
      }
      ?item wdt:P31/wdt:P279* wd:Q11424.
      ?item wdt:P345 ?imdbId.
      OPTIONAL { ?item wdt:P577 ?date. }
      OPTIONAL {
        ?ruwiki schema:about ?item;
          schema:isPartOf <https://ru.wikipedia.org/>;
          schema:name ?ruwikiTitle.
      }
      OPTIONAL { ?item rdfs:label ?enLabel FILTER(LANG(?enLabel) = "en") }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ru,en". }
    }
    LIMIT 12
  `;

  const params = new URLSearchParams({ query, format: "json" });
  const response = await fetch(`${WIKIDATA_SPARQL_URL}?${params}`);
  if (!response.ok) {
    throw new Error("Wikidata не ответила.");
  }

  const data = await response.json();
  return uniqueCandidates(data.results.bindings.map((item) => ({
    source: "wikidata",
    imdbId: readBinding(item, "imdbId"),
    title: readBinding(item, "itemLabel"),
    ruTitle: readBinding(item, "itemLabel"),
    enTitle: readBinding(item, "enLabel"),
    ruDescription: readBinding(item, "itemDescription"),
    wikiTitle: readBinding(item, "ruwikiTitle"),
    year: yearFromDate(readBinding(item, "date")),
  }))).slice(0, 8);
}

export async function fetchCinemetaCandidates(title) {
  const cacheKey = normalizeSearchText(title);
  return fetchCachedValue(externalRequestCache.searches, cacheKey, EXTERNAL_SEARCH_CACHE_TTL, async () => {
    const searchUrl = `${CINEMETA_SEARCH_URL}${encodeURIComponent(title)}.json`;
    const data = await fetchJsonWithTimeout(searchUrl, "Не удалось получить данные о фильме. Попробуйте позже.");
    return uniqueCandidates((data.metas || [])
      .filter((item) => item.type === "movie")
      .map((item) => ({
        source: "cinemeta",
        imdbId: item.imdb_id || item.id,
        title: item.name,
        enTitle: item.name,
        year: item.releaseInfo || item.year,
        poster: item.poster,
        ruDescription: "Cinemeta",
      }))).slice(0, 12);
  });
}

export async function fetchCinemetaDetailsById(imdbId) {
  const cacheKey = clean(imdbId);
  return fetchCachedValue(externalRequestCache.details, cacheKey, EXTERNAL_DETAIL_CACHE_TTL, async () => {
    const data = await fetchJsonWithTimeout(
      `${CINEMETA_META_URL}${encodeURIComponent(imdbId)}.json`,
      "Cinemeta не ответила.",
    );
    const details = data.meta || {};

    return {
      imdbId: details.imdb_id || details.id || imdbId,
      title: details.name,
      year: details.year || details.releaseInfo,
      poster: details.poster,
      rating: details.imdbRating,
      runtime: details.runtime,
      genre: joinList(details.genre || details.genres),
      director: joinList(details.director),
      cast: joinList(details.cast),
      plot: details.description || details.plot,
    };
  });
}

export async function fetchRussianSummary(wikiTitle) {
  const response = await fetch(`${WIKIPEDIA_SUMMARY_URL}${encodeURIComponent(wikiTitle)}`);
  if (!response.ok) {
    throw new Error("Wikipedia не ответила.");
  }

  const data = await response.json();
  return clean(data.extract);
}

async function fetchCachedValue(cache, key, ttl, loader) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.createdAt < ttl) {
    return cached.value;
  }

  const value = await loader();
  cache.set(key, {
    createdAt: Date.now(),
    value,
  });
  return value;
}

async function fetchJsonWithTimeout(url, errorMessage, timeoutMs = EXTERNAL_RANDOM_FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(errorMessage);
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Запрос занял слишком много времени.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function tryFetch(callback, fallback) {
  try {
    return await callback();
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function escapeSparqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}
