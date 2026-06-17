export const DURATION_RANGES = {
  short: { max: 60 },
  standard: { min: 60, max: 130 },
  long: { min: 131 },
};

export const RATING_RANGES = {
  low: { max: 5.5 },
  medium: { min: 5.6, max: 7.5 },
  high: { min: 7.6 },
};

export const PLACEHOLDER_POSTER =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 180'%3E%3Crect width='120' height='180' fill='%23d8d1c6'/%3E%3Cpath d='M28 43h64v94H28z' fill='none' stroke='%23687076' stroke-width='6'/%3E%3Cpath d='M43 63h34M43 83h34M43 103h21' stroke='%23687076' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E";

export function normalizeMovie(movie) {
  const imdbId = movie.imdbId || makeId();
  const title = clean(movie.title) || clean(movie.originalTitle) || "Без названия";

  return {
    imdbId,
    title,
    originalTitle: clean(movie.originalTitle),
    year: clean(movie.year),
    poster: movie.poster && movie.poster !== "N/A" ? movie.poster : PLACEHOLDER_POSTER,
    rating: movie.rating && movie.rating !== "N/A" ? movie.rating : "",
    runtime: clean(movie.runtime),
    genre: clean(movie.genre),
    director: clean(movie.director),
    cast: clean(movie.cast),
    plot: clean(movie.plot) || "Описание не найдено.",
    watched: false,
  };
}

export function clean(value) {
  return value && value !== "N/A" ? String(value).trim() : "";
}

export function normalizeSearchText(value) {
  return clean(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function matchesDurationRange(runtime, range) {
  const minutes = parseRuntimeMinutes(runtime);
  if (!minutes) {
    return false;
  }
  const bounds = DURATION_RANGES[range] || DURATION_RANGES.standard;
  return (!bounds.min || minutes >= bounds.min) && (!bounds.max || minutes <= bounds.max);
}

export function matchesRatingRange(rating, range) {
  if (!range || range === "any") {
    return true;
  }

  const ratingValue = parseRatingValue(rating);
  if (ratingValue === null) {
    return false;
  }

  const bounds = RATING_RANGES[range];
  if (!bounds) {
    return true;
  }

  const aboveMin = bounds.minExclusive ? ratingValue > bounds.min : (!bounds.min || ratingValue >= bounds.min);
  return aboveMin && (!bounds.max || ratingValue <= bounds.max);
}

export function parseRatingValue(rating) {
  const match = String(rating || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function parseRuntimeMinutes(runtime) {
  const text = String(runtime || "").trim().toLowerCase();
  if (!text) {
    return null;
  }

  const iso = text.match(/pt(?:(\d+)h)?(?:(\d+)m)?/i);
  if (iso?.[1] || iso?.[2]) {
    return Number(iso[1] || 0) * 60 + Number(iso[2] || 0);
  }

  const hours = text.match(/(\d+)\s*(?:h|hr|hrs|hour|hours|ч|час|часа|часов)/i);
  const minutes = text.match(/(\d+)\s*(?:m|min|mins|minute|minutes|м|мин|минута|минуты|минут)/i);
  if (hours || minutes) {
    return Number(hours?.[1] || 0) * 60 + Number(minutes?.[1] || 0);
  }

  const plainMinutes = text.match(/\b(\d{1,3})\b/);
  return plainMinutes ? Number(plainMinutes[1]) : null;
}

export function getMovieYear(movie) {
  const match = clean(movie.year).match(/\d{4}/);
  return match ? match[0] : clean(movie.year);
}

export function getMovieGenres(movie) {
  return splitMovieList(movie.genre);
}

export function getMovieDirectors(movie) {
  return splitMovieList(movie.director);
}

export function splitMovieList(value) {
  return clean(value)
    .split(/[,;•/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function hasMatchingValue(values, expectedValue) {
  const expected = normalizeSearchText(expectedValue);
  return [...values].some((value) => normalizeSearchText(value) === expected);
}

export function sortText(values) {
  return values.sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
}

export function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

export function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.imdbId || `${candidate.title}-${candidate.year}`;
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function readBinding(item, key) {
  return item[key]?.value || "";
}

export function yearFromDate(value) {
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : "";
}

export function joinList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : clean(value);
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `movie-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
