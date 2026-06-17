import {
  getMovieDirectors,
  getMovieGenres,
  getMovieYear,
  hasMatchingValue,
  matchesRatingRange,
  normalizeSearchText,
  sortText,
} from "./movieModel.js";

export function getVisibleMovies(movies, selectedCollection) {
  if (!selectedCollection) {
    return movies;
  }

  const movieIds = new Set(selectedCollection.movieIds.map(Number));
  return movies.filter((movie) => movieIds.has(movie.id));
}

export function getDisplayMovies(movies, { selectedCollection = null, hideWatched = false, search = "", filters = {} } = {}) {
  let visibleMovies = getVisibleMovies(movies, selectedCollection);
  if (hideWatched) {
    visibleMovies = visibleMovies.filter((movie) => !movie.watched);
  }

  return visibleMovies.filter((movie) => matchesLibraryFilters(movie, { search, filters }));
}

export function matchesLibraryFilters(movie, { search = "", filters = {} } = {}) {
  const normalizedSearch = normalizeSearchText(search);
  if (normalizedSearch) {
    const searchableFields = [
      movie.title,
      movie.originalTitle,
      movie.year,
      movie.rating,
      movie.runtime,
      movie.genre,
      movie.director,
      movie.cast,
      movie.plot,
    ];
    const hasSearchMatch = searchableFields
      .filter(Boolean)
      .some((value) => normalizeSearchText(value).includes(normalizedSearch));
    if (!hasSearchMatch) {
      return false;
    }
  }

  if (filters.year && getMovieYear(movie) !== filters.year) {
    return false;
  }

  if (!matchesRatingRange(movie.rating, filters.rating)) {
    return false;
  }

  if (filters.genre && !hasMatchingValue(getMovieGenres(movie), filters.genre)) {
    return false;
  }

  if (filters.director && !hasMatchingValue(getMovieDirectors(movie), filters.director)) {
    return false;
  }

  return true;
}

export function getUniqueYears(movies) {
  return [...new Set(movies.map(getMovieYear).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a) || b.localeCompare(a));
}

export function getLibraryGenres(movies) {
  return getUniqueGenres(movies);
}

export function getUniqueGenres(movies) {
  return sortText([...new Set(movies.flatMap(getMovieGenres).filter(Boolean))]);
}

export function getUniqueDirectors(movies) {
  return sortText([...new Set(movies.flatMap(getMovieDirectors).filter(Boolean))]);
}
