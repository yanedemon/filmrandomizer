import {
  clean,
  getMovieGenres,
  getMovieYear,
  hasMatchingValue,
  matchesDurationRange,
  matchesRatingRange,
  normalizeSearchText,
  shuffleArray,
} from "./movieModel.js";

const EXTERNAL_RANDOM_SEARCH_LIMIT = 6;
const EXTERNAL_RANDOM_DETAIL_LIMIT = 18;
const EXTERNAL_RANDOM_DETAIL_BATCH_SIZE = 4;
const EXTERNAL_RANDOM_RECENT_LIMIT = 16;
const EXTERNAL_RANDOM_QUERIES = [
  "movie",
  "film",
  "classic",
  "action",
  "comedy",
  "drama",
  "thriller",
  "adventure",
  "science fiction",
  "crime",
  "romance",
  "horror",
];
const EXTERNAL_RANDOM_SHORT_QUERIES = [
  "short film",
  "animated short",
  "documentary short",
  "oscar short film",
  "short movie",
  "short animation",
];
const EXTERNAL_RANDOM_HIGH_RATING_QUERIES = [
  "award winning film",
  "best picture",
  "criterion film",
  "classic cinema",
  "acclaimed film",
];
const EXTERNAL_RANDOM_YEAR_TERMS = ["movie", "film", "cinema"];
const EXTERNAL_RANDOM_MIN_YEAR = 1920;

export function getRandomMoviePool({ source = "library", movies = [], localMovies = movies, settings = {} } = {}) {
  if (source !== "library") {
    return [];
  }
  return movies.filter((movie) => matchesRandomSettings(movie, { source, localMovies, settings }));
}

export function pickRandomMovieFromPool(pool, recentIds = []) {
  const recentSet = new Set(recentIds);
  const freshPool = pool.length > 1
    ? pool.filter((movie) => !recentSet.has(movie.id))
    : pool;
  const sourcePool = freshPool.length ? freshPool : pool;
  const movie = sourcePool[Math.floor(Math.random() * sourcePool.length)];

  return {
    movie,
    recentIds: rememberLibraryRandomMovie(movie, pool.length, recentIds),
  };
}

export async function findExternalRandomMovie({ catalog, localMovies = [], recentKeys = [], settings = {} } = {}) {
  const queries = shuffleArray(buildExternalRandomQueries(settings)).slice(0, EXTERNAL_RANDOM_SEARCH_LIMIT);
  const searchResults = await Promise.all(queries.map((query) => {
    return tryFetch(() => catalog.fetchCinemetaCandidates(query), []);
  }));
  const candidates = collectExternalRandomCandidates(searchResults);
  const freshCandidates = candidates.filter((candidate) => !isRecentlyPickedExternalMovie(candidate, recentKeys));
  const recentCandidates = candidates.filter((candidate) => isRecentlyPickedExternalMovie(candidate, recentKeys));
  const candidatePool = [...freshCandidates, ...recentCandidates].slice(0, EXTERNAL_RANDOM_DETAIL_LIMIT);
  let fallback = null;

  for (let index = 0; index < candidatePool.length; index += EXTERNAL_RANDOM_DETAIL_BATCH_SIZE) {
    const batch = candidatePool.slice(index, index + EXTERNAL_RANDOM_DETAIL_BATCH_SIZE);
    const movies = await Promise.all(batch.map((candidate) => {
      return tryFetch(() => catalog.fetchMovieDetails(candidate), null);
    }));
    const matches = shuffleArray(movies.filter((movie) => {
      return movie && matchesRandomSettings(movie, {
        source: "external",
        localMovies,
        settings,
      });
    }));
    const freshMatch = matches.find((movie) => !isRecentlyPickedExternalMovie(movie, recentKeys));

    if (freshMatch) {
      return {
        movie: freshMatch,
        recentKeys: rememberExternalRandomMovie(freshMatch, recentKeys),
      };
    }

    if (!fallback && matches.length) {
      fallback = matches[0];
    }
  }

  if (fallback) {
    return {
      movie: fallback,
      recentKeys: rememberExternalRandomMovie(fallback, recentKeys),
    };
  }

  return { movie: null, recentKeys };
}

export function matchesRandomSettings(movie, { source = "library", localMovies = [], settings = {} } = {}) {
  if (source === "library" && !settings.includeWatched && movie.watched) {
    return false;
  }

  if (source === "external" && !settings.includeWatched) {
    const localMatch = findMatchingLocalMovie(localMovies, movie);
    if (localMatch?.watched) {
      return false;
    }
  }

  if (settings.durationFilterEnabled && !matchesDurationRange(movie.runtime, settings.durationRange)) {
    return false;
  }

  if (!matchesRatingRange(movie.rating, settings.ratingRange)) {
    return false;
  }

  if (!matchesRandomGenres(movie, settings.genreFilters)) {
    return false;
  }

  return true;
}

export function findMatchingLocalMovie(localMovies, movie) {
  const imdbId = clean(movie?.imdbId);
  if (imdbId) {
    const byImdbId = localMovies.find((item) => item.imdbId === imdbId);
    if (byImdbId) {
      return byImdbId;
    }
  }

  const title = normalizeSearchText(movie?.title || movie?.originalTitle);
  const year = getMovieYear(movie || {});
  return localMovies.find((item) => {
    return normalizeSearchText(item.title || item.originalTitle) === title && getMovieYear(item) === year;
  }) || null;
}

export function getExternalMovieKey(movie) {
  const imdbId = clean(movie?.imdbId);
  if (imdbId) {
    return imdbId;
  }

  const title = normalizeSearchText(movie?.title || movie?.originalTitle || movie?.ruTitle || movie?.enTitle);
  const year = getMovieYear(movie || {});
  return title ? `${title}-${year}` : "";
}

function rememberLibraryRandomMovie(movie, poolSize, recentIds) {
  if (!movie?.id) {
    return recentIds;
  }

  const limit = Math.min(EXTERNAL_RANDOM_RECENT_LIMIT, Math.max(1, Math.floor(poolSize / 2)));
  return [
    movie.id,
    ...recentIds.filter((id) => id !== movie.id),
  ].slice(0, limit);
}

function buildExternalRandomQueries(settings = {}) {
  const genreQueries = [...(settings.genreFilters || [])]
    .map((genre) => clean(genre))
    .filter(Boolean);
  return uniqueQueries([
    ...genreQueries,
    ...buildExternalRandomFilterQueries(settings),
    ...EXTERNAL_RANDOM_QUERIES,
    ...buildExternalRandomYearQueries(genreQueries),
  ]);
}

function buildExternalRandomFilterQueries(settings = {}) {
  const queries = [];
  const durationRange = settings.durationFilterEnabled ? settings.durationRange : "";
  const ratingRange = settings.ratingRange;

  if (durationRange === "short") {
    queries.push(...EXTERNAL_RANDOM_SHORT_QUERIES);
  }

  if (ratingRange === "high") {
    queries.push(...EXTERNAL_RANDOM_HIGH_RATING_QUERIES);
  }

  if (durationRange === "short" && ratingRange === "high") {
    queries.push("best short film", "award winning short film", "oscar winning short film");
  }

  return queries;
}

function buildExternalRandomYearQueries(genreQueries = []) {
  const terms = genreQueries.length ? genreQueries : EXTERNAL_RANDOM_YEAR_TERMS;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 4 }, () => randomInt(EXTERNAL_RANDOM_MIN_YEAR, currentYear));
  return years.map((year, index) => `${terms[index % terms.length]} ${year}`);
}

function collectExternalRandomCandidates(searchResults) {
  const seen = new Set();
  return shuffleArray(searchResults.flat()).filter((candidate) => {
    const key = getExternalMovieKey(candidate);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniqueQueries(queries) {
  const seen = new Set();
  return queries.filter((query) => {
    const normalized = normalizeSearchText(query);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function matchesRandomGenres(movie, genreFilters = new Set()) {
  if (!genreFilters.size) {
    return true;
  }

  return getMovieGenres(movie).some((genre) => hasMatchingValue(genreFilters, genre));
}

function isRecentlyPickedExternalMovie(movie, recentKeys) {
  const key = getExternalMovieKey(movie);
  return key ? recentKeys.includes(key) : false;
}

function rememberExternalRandomMovie(movie, recentKeys) {
  const key = getExternalMovieKey(movie);
  if (!key) {
    return recentKeys;
  }

  return [
    key,
    ...recentKeys.filter((item) => item !== key),
  ].slice(0, EXTERNAL_RANDOM_RECENT_LIMIT);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function tryFetch(callback, fallback) {
  try {
    return await callback();
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}
