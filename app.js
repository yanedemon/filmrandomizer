import {
  PLACEHOLDER_POSTER,
  normalizeMovie,
} from "./services/movieModel.js";

const USER_STORAGE = "film-randomizer.user";
const LEGACY_MOVIES_STORAGE = "film-randomizer.movies";
const PAGE_SIZE = 9;
const SEARCH_DEBOUNCE_MS = 250;
const MOVIE_SEARCH_MIN_LENGTH = 3;
const MOVIE_SEARCH_LIMIT = 5;

let movieSearchTimer = null;
let movieSearchRequestId = 0;
let librarySearchTimer = null;
let collectionSearchTimer = null;

const state = {
  user: loadUser(),
  movies: [],
  moviesById: new Map(),
  collectionPickerMovies: [],
  collections: [],
  collectionsById: new Map(),
  collectionMovieIdSets: new Map(),
  libraryStats: { total: 0, watched: 0, unwatched: 0, inCollections: 0 },
  scopeStats: { total: 0, watched: 0, unwatched: 0 },
  libraryFilterOptions: { years: [], genres: [], directors: [] },
  libraryTotal: 0,
  selectedCollectionId: "all",
  randomResultMovie: null,
  pendingCandidates: [],
  libraryNextOffset: 0,
  libraryPageCache: new Map(),
  hideWatched: false,
  collectionModalMode: "create",
  editingCollectionId: null,
  collectionDraftMovieIds: new Set(),
  collectionSearch: "",
  librarySearch: "",
  libraryFilters: {
    year: "",
    rating: "",
    genre: "",
    director: "",
  },
  randomGenreDraft: new Set(),
  randomGenreFilters: new Set(),
  importRows: [],
  isLoading: false,
  isLibraryLoading: false,
  libraryRequestId: 0,
  isMigratingLegacy: false,
  recentLibraryRandomIds: [],
  recentExternalRandomKeys: [],
};

const elements = {
  appShell: document.querySelector("#appShell"),
  appContent: document.querySelector("#appContent"),
  authSection: document.querySelector("#authSection"),
  authForm: document.querySelector("#authForm"),
  authMessage: document.querySelector("#authMessage"),
  username: document.querySelector("#username"),
  password: document.querySelector("#password"),
  form: document.querySelector("#movieForm"),
  titleInput: document.querySelector("#movieTitle"),
  userPanel: document.querySelector("#userPanel"),
  currentUser: document.querySelector("#currentUser"),
  logoutButton: document.querySelector("#logoutButton"),
  movieImportFile: document.querySelector("#movieImportFile"),
  pickMovie: document.querySelector("#pickMovie"),
  pickExternalMovie: document.querySelector("#pickExternalMovie"),
  randomSettingsToggle: document.querySelector("#randomSettingsToggle"),
  randomSettings: document.querySelector("#randomSettings"),
  includeWatchedRandom: document.querySelector("#includeWatchedRandom"),
  durationRangeGroup: document.querySelector("#durationRangeGroup"),
  durationRangeInputs: document.querySelectorAll(".duration-range-input"),
  ratingRangeInputs: document.querySelectorAll(".rating-range-input"),
  openRandomGenreModal: document.querySelector("#openRandomGenreModal"),
  randomGenreSummary: document.querySelector("#randomGenreSummary"),
  pickedMovie: document.querySelector("#pickedMovie"),
  pickedDetails: document.querySelector("#pickedDetails"),
  searchResults: document.querySelector("#searchResults"),
  totalCount: document.querySelector("#totalCount"),
  watchedCount: document.querySelector("#watchedCount"),
  unwatchedCount: document.querySelector("#unwatchedCount"),
  inCollectionsCount: document.querySelector("#inCollectionsCount"),
  createCollection: document.querySelector("#createCollection"),
  editSelectedCollection: document.querySelector("#editSelectedCollection"),
  collectionList: document.querySelector("#collectionList"),
  collectionModal: document.querySelector("#collectionModal"),
  collectionModalTitle: document.querySelector("#collectionModalTitle"),
  closeCollectionModal: document.querySelector("#closeCollectionModal"),
  cancelCollectionModal: document.querySelector("#cancelCollectionModal"),
  collectionForm: document.querySelector("#collectionForm"),
  collectionName: document.querySelector("#collectionName"),
  collectionMovieSearch: document.querySelector("#collectionMovieSearch"),
  collectionMoviePicker: document.querySelector("#collectionMoviePicker"),
  deleteCollection: document.querySelector("#deleteCollection"),
  cardsTitle: document.querySelector("#cardsTitle"),
  cardsGrid: document.querySelector("#cardsGrid"),
  showMoreMovies: document.querySelector("#showMoreMovies"),
  librarySearch: document.querySelector("#librarySearch"),
  yearFilter: document.querySelector("#yearFilter"),
  ratingFilter: document.querySelector("#ratingFilter"),
  genreFilter: document.querySelector("#genreFilter"),
  directorFilter: document.querySelector("#directorFilter"),
  resetLibraryFilters: document.querySelector("#resetLibraryFilters"),
  message: document.querySelector("#message"),
  clearWatched: document.querySelector("#clearWatched"),
  importModal: document.querySelector("#importModal"),
  closeImportModal: document.querySelector("#closeImportModal"),
  cancelImport: document.querySelector("#cancelImport"),
  confirmImport: document.querySelector("#confirmImport"),
  importSummary: document.querySelector("#importSummary"),
  importReviewList: document.querySelector("#importReviewList"),
  plotModal: document.querySelector("#plotModal"),
  closePlotModal: document.querySelector("#closePlotModal"),
  plotModalTitle: document.querySelector("#plotModalTitle"),
  plotModalBody: document.querySelector("#plotModalBody"),
  randomGenreModal: document.querySelector("#randomGenreModal"),
  closeRandomGenreModal: document.querySelector("#closeRandomGenreModal"),
  cancelRandomGenres: document.querySelector("#cancelRandomGenres"),
  saveRandomGenres: document.querySelector("#saveRandomGenres"),
  selectAllRandomGenres: document.querySelector("#selectAllRandomGenres"),
  clearRandomGenres: document.querySelector("#clearRandomGenres"),
  randomGenrePicker: document.querySelector("#randomGenrePicker"),
  template: document.querySelector("#movieCardTemplate"),
};

initApp();

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const action = event.submitter?.dataset.action || "login";
  const username = elements.username.value.trim();
  const password = elements.password.value;
  if (!username || !password) {
    return;
  }

  try {
    showAuthMessage("");
    const endpoint = action === "register" ? "/api/users" : "/api/login";
    const response = await apiFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({ username, password }),
      skipAuth: true,
    });
    state.user = response.user;
    saveUser();
    elements.password.value = "";
    invalidateLibraryCache();
    renderShell();
    await loadLibrary();
    showMessage(action === "register" ? "Пользователь создан." : "Вы вошли.");
  } catch (error) {
    showAuthMessage(error.message, true);
  }
});

elements.logoutButton.addEventListener("click", logoutUser);

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  window.clearTimeout(movieSearchTimer);
  await runMovieSearch({ force: true });
});

elements.titleInput.addEventListener("input", () => {
  const title = elements.titleInput.value.trim();
  window.clearTimeout(movieSearchTimer);

  if (title.length < MOVIE_SEARCH_MIN_LENGTH) {
    movieSearchRequestId += 1;
    hideSearchResults();
    setLoading(false);
    return;
  }

  movieSearchTimer = window.setTimeout(() => {
    runMovieSearch().catch((error) => showMessage(error.message, true));
  }, SEARCH_DEBOUNCE_MS);
});

elements.searchResults.addEventListener("click", async (event) => {
  const option = event.target.closest(".candidate-option");
  if (!option) {
    return;
  }

  const candidate = state.pendingCandidates[Number(option.dataset.index)];
  if (!candidate) {
    return;
  }

  setLoading(true);
  showMessage("Загружаю карточку...");

  try {
    await addMovieFromCandidate(candidate);
    hideSearchResults();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setLoading(false);
  }
});

elements.movieImportFile.addEventListener("change", async () => {
  const file = elements.movieImportFile.files?.[0];
  elements.movieImportFile.value = "";
  if (!file) {
    return;
  }

  try {
    await prepareImportFromFile(file);
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.randomSettingsToggle.addEventListener("click", toggleRandomSettings);

elements.pickMovie.addEventListener("click", async () => {
  state.randomResultMovie = null;
  elements.pickMovie.disabled = true;
  elements.pickedDetails.hidden = true;
  elements.pickedDetails.innerHTML = "";
  elements.pickedMovie.innerHTML = "<span class=\"muted\">Подбираю фильм из библиотеки...</span>";

  try {
    const result = await apiFetch("/api/discovery/random", {
      method: "POST",
      body: JSON.stringify(buildRandomRequest("library")),
    });
    state.recentLibraryRandomIds = result.recentLibraryRandomIds || state.recentLibraryRandomIds;
    const picked = result.movie;
    if (!picked) {
      elements.pickedMovie.innerHTML = `<span class="muted">${getRandomEmptyMessage()}</span>`;
      return;
    }

    elements.pickedMovie.innerHTML = `
      <span>
        <strong>${escapeHtml(picked.title)}</strong>
        ${escapeHtml([picked.year, picked.rating && `${picked.rating}/10`].filter(Boolean).join(" • "))}
      </span>
    `;
    elements.pickedDetails.hidden = false;
    renderPickedDetails(picked);
  } catch (error) {
    elements.pickedMovie.innerHTML = "<span class=\"muted\">Не удалось подобрать фильм.</span>";
    showMessage(error.message, true);
  } finally {
    elements.pickMovie.disabled = false;
  }
});

elements.pickExternalMovie.addEventListener("click", pickExternalRandomMovie);

elements.pickedDetails.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action='add-picked-movie']");
  if (!button) {
    return;
  }

  addRandomResultMovie(button);
});

elements.includeWatchedRandom.addEventListener("change", renderRandomGenreSummary);

elements.durationRangeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    syncRandomDurationControls();
    renderRandomGenreSummary();
  });
});

elements.ratingRangeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    renderRandomGenreSummary();
  });
});

elements.openRandomGenreModal.addEventListener("click", openRandomGenreModal);

elements.clearWatched.addEventListener("change", toggleWatchedVisibility);

elements.createCollection.addEventListener("click", () => {
  openCollectionModal("create");
});

elements.editSelectedCollection.addEventListener("click", () => {
  const collection = getSelectedCollection();
  if (collection) {
    openCollectionModal("edit", collection);
  }
});

elements.collectionList.addEventListener("click", (event) => {
  const button = event.target.closest(".collection-tab");
  if (!button) {
    return;
  }
  selectCollection(button.dataset.id === "all" ? "all" : Number(button.dataset.id));
});

elements.closeCollectionModal.addEventListener("click", closeCollectionModal);
elements.cancelCollectionModal.addEventListener("click", closeCollectionModal);
elements.collectionModal.addEventListener("click", (event) => {
  if (event.target === elements.collectionModal) {
    closeCollectionModal();
  }
});

elements.collectionMovieSearch.addEventListener("input", () => {
  state.collectionSearch = elements.collectionMovieSearch.value.trim();
  window.clearTimeout(collectionSearchTimer);
  collectionSearchTimer = window.setTimeout(() => {
    loadCollectionPickerMovies().catch((error) => showMessage(error.message, true));
  }, SEARCH_DEBOUNCE_MS);
});

elements.collectionMoviePicker.addEventListener("change", (event) => {
  if (!event.target.matches("input[type='checkbox']")) {
    return;
  }

  toggleCollectionDraftMovie(Number(event.target.value), event.target.checked);
});

elements.collectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = elements.collectionName.value.trim();
  if (!name) {
    return;
  }

  try {
    const body = JSON.stringify({
      name,
      movieIds: [...state.collectionDraftMovieIds],
    });
    if (state.collectionModalMode === "edit" && state.editingCollectionId) {
      await apiFetch(`/api/collections/${state.editingCollectionId}`, { method: "PATCH", body });
      showMessage("Коллекция сохранена.");
    } else {
      await apiFetch("/api/collections", { method: "POST", body });
      showMessage("Коллекция создана.");
    }
    closeCollectionModal();
    invalidateLibraryCache();
    await loadLibrary();
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.deleteCollection.addEventListener("click", async () => {
  if (!state.editingCollectionId) {
    return;
  }

  try {
    await apiFetch(`/api/collections/${state.editingCollectionId}`, { method: "DELETE" });
    state.selectedCollectionId = "all";
    closeCollectionModal();
    invalidateLibraryCache();
    await loadLibrary();
    showMessage("Коллекция удалена. Фильмы остались в библиотеке.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.showMoreMovies.addEventListener("click", async () => {
  await loadLibrary({ skipMigration: true, append: true });
});

elements.librarySearch.addEventListener("input", () => {
  state.librarySearch = elements.librarySearch.value.trim();
  resetLibraryPaging();
  window.clearTimeout(librarySearchTimer);
  librarySearchTimer = window.setTimeout(() => {
    loadLibrary({ skipMigration: true }).catch((error) => showMessage(error.message, true));
  }, SEARCH_DEBOUNCE_MS);
});

[
  ["year", elements.yearFilter],
  ["rating", elements.ratingFilter],
  ["genre", elements.genreFilter],
  ["director", elements.directorFilter],
].forEach(([key, element]) => {
  element.addEventListener("change", () => {
    state.libraryFilters[key] = element.value;
    resetLibraryPaging();
    loadLibrary({ skipMigration: true }).catch((error) => showMessage(error.message, true));
  });
});

elements.resetLibraryFilters.addEventListener("click", resetLibraryFilters);

elements.cardsGrid.addEventListener("change", async (event) => {
  if (!event.target.classList.contains("watched-input")) {
    return;
  }

  const card = event.target.closest(".movie-card");
  const movie = getMovieById(card.dataset.id);
  if (!movie) {
    return;
  }

  try {
    const response = await apiFetch(`/api/movies/${movie.id}`, {
      method: "PATCH",
      body: JSON.stringify({ watched: event.target.checked }),
    });
    Object.assign(movie, response.movie);
    invalidateLibraryCache();
    await loadLibrary({ skipMigration: true });
  } catch (error) {
    showMessage(error.message, true);
    event.target.checked = movie.watched;
  }
});

elements.cardsGrid.addEventListener("click", async (event) => {
  const removeButton = event.target.closest(".remove-button");
  if (!removeButton) {
    const card = event.target.closest(".movie-card");
    if (card && !isCardControlTarget(event.target)) {
      openMovieDetailsFromCard(card);
    }
    return;
  }

  const card = removeButton.closest(".movie-card");
  const movie = getMovieById(card.dataset.id);

  try {
    await apiFetch(`/api/movies/${card.dataset.id}`, { method: "DELETE" });
    invalidateLibraryCache();
    await loadLibrary();
    showMessage(movie ? `Удалено: ${movie.title}` : "Карточка удалена.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.cardsGrid.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const card = event.target.closest(".movie-card");
  if (!card || event.target !== card) {
    return;
  }

  event.preventDefault();
  openMovieDetailsFromCard(card);
});

elements.importReviewList.addEventListener("change", (event) => {
  if (!event.target.classList.contains("import-select")) {
    return;
  }
  const row = state.importRows[Number(event.target.dataset.index)];
  if (!row) {
    return;
  }
  row.selectedIndex = Number(event.target.value);
  renderImportSummary();
});

elements.confirmImport.addEventListener("click", async () => {
  await confirmImportRows();
});

elements.closeImportModal.addEventListener("click", closeImportModal);
elements.cancelImport.addEventListener("click", closeImportModal);
elements.importModal.addEventListener("click", (event) => {
  if (event.target === elements.importModal) {
    closeImportModal();
  }
});

elements.closePlotModal.addEventListener("click", closePlotModal);
elements.plotModal.addEventListener("click", (event) => {
  if (event.target === elements.plotModal) {
    closePlotModal();
  }
});

elements.closeRandomGenreModal.addEventListener("click", closeRandomGenreModal);
elements.cancelRandomGenres.addEventListener("click", closeRandomGenreModal);
elements.saveRandomGenres.addEventListener("click", saveRandomGenres);
elements.selectAllRandomGenres.addEventListener("click", () => {
  state.randomGenreDraft = new Set(getLibraryGenres());
  renderRandomGenrePicker();
});
elements.clearRandomGenres.addEventListener("click", () => {
  state.randomGenreDraft = new Set();
  renderRandomGenrePicker();
});
elements.randomGenrePicker.addEventListener("change", (event) => {
  if (!event.target.matches("input[type='checkbox']")) {
    return;
  }
  toggleSetValue(state.randomGenreDraft, event.target.value, event.target.checked);
  renderRandomGenreSummary(state.randomGenreDraft, true);
});
elements.randomGenreModal.addEventListener("click", (event) => {
  if (event.target === elements.randomGenreModal) {
    closeRandomGenreModal();
  }
});

function initApp() {
  document.documentElement.dataset.theme = "dark";
  syncRandomDurationControls();
  renderShell();
  render();

  if (state.user) {
    loadLibrary().catch((error) => {
      showMessage(error.message, true);
    });
  }
}

function logoutUser() {
  const token = state.user?.token;
  if (token) {
    fetch("/api/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  }
  state.user = null;
  state.movies = [];
  state.collectionPickerMovies = [];
  state.collections = [];
  state.libraryPageCache.clear();
  state.libraryNextOffset = 0;
  state.isLibraryLoading = false;
  state.libraryRequestId += 1;
  rebuildLibraryIndexes();
  selectCollection("all", { shouldRender: false });
  state.hideWatched = false;
  localStorage.removeItem(USER_STORAGE);
  hideSearchResults();
  resetPickedMovie();
  closeCollectionModal();
  closeImportModal();
  renderShell();
  render();
}

function toggleRandomSettings() {
  const isOpen = elements.randomSettings.hidden;
  elements.randomSettings.hidden = !isOpen;
  elements.randomSettingsToggle.setAttribute("aria-expanded", String(isOpen));
  elements.randomSettingsToggle.classList.toggle("is-open", isOpen);
  elements.randomSettingsToggle.dataset.state = isOpen ? "open" : "closed";
  elements.randomSettings.dataset.state = isOpen ? "open" : "closed";
  elements.appShell.dataset.randomSettings = isOpen ? "open" : "closed";
}

async function toggleWatchedVisibility() {
  state.hideWatched = elements.clearWatched.checked;
  resetLibraryPaging();
  await loadLibrary({ skipMigration: true });
  showMessage(state.hideWatched ? "Просмотренные скрыты из выдачи." : "Просмотренные снова показаны.");
}

function selectCollection(collectionId, { shouldRender = true } = {}) {
  state.selectedCollectionId = collectionId;
  resetLibraryPaging();
  state.hideWatched = false;
  if (shouldRender) {
    loadLibrary({ skipMigration: true }).catch((error) => showMessage(error.message, true));
  }
}

function toggleCollectionDraftMovie(movieId, isSelected) {
  if (isSelected) {
    state.collectionDraftMovieIds.add(movieId);
  } else {
    state.collectionDraftMovieIds.delete(movieId);
  }
}

async function apiFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (!options.skipAuth && state.user?.token) {
    headers.Authorization = `Bearer ${state.user.token}`;
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      state.user = null;
      localStorage.removeItem(USER_STORAGE);
      invalidateLibraryCache();
      renderShell();
    }
    throw new Error(data.error || "Ошибка запроса.");
  }
  return data;
}

async function loadLibrary({ skipMigration = false, append = false } = {}) {
  if (!state.user) {
    return;
  }

  if (append && state.isLibraryLoading) {
    return;
  }

  const requestId = state.libraryRequestId + 1;
  state.libraryRequestId = requestId;
  state.isLibraryLoading = true;
  elements.showMoreMovies.disabled = true;

  try {
    const offset = append ? state.libraryNextOffset : 0;
    const cacheKey = `${buildLibraryCacheKey()}|offset=${offset}`;
    let data = state.libraryPageCache.get(cacheKey);

    if (!data) {
      data = await apiFetch(`/api/library?${buildLibraryQuery(offset)}`);
      state.libraryPageCache.set(cacheKey, data);
    }

    if (requestId !== state.libraryRequestId) {
      return;
    }

    state.movies = append ? appendMoviePage(state.movies, data.movies || []) : data.movies || [];
    state.collections = data.collections || [];
    rebuildLibraryIndexes();
    state.libraryStats = data.stats || state.libraryStats;
    state.scopeStats = data.scopeStats || state.scopeStats;
    state.libraryFilterOptions = data.filterOptions || state.libraryFilterOptions;
    state.libraryTotal = data.total || 0;
    state.libraryNextOffset = state.movies.length;
    if (state.selectedCollectionId !== "all" && !getSelectedCollection()) {
      state.selectedCollectionId = "all";
    }
    renderShell();
    render({ appendCards: append });
    if (!skipMigration) {
      await migrateLegacyMovies();
    }
  } finally {
    if (requestId === state.libraryRequestId) {
      state.isLibraryLoading = false;
      updateShowMoreButton();
    }
  }
}

function buildLibraryCacheKey() {
  const params = new URLSearchParams({
    collectionId: String(state.selectedCollectionId),
    search: state.librarySearch,
    year: state.libraryFilters.year,
    rating: state.libraryFilters.rating,
    genre: state.libraryFilters.genre,
    director: state.libraryFilters.director,
    hideWatched: state.hideWatched ? "1" : "",
  });
  return params.toString();
}

function buildLibraryQuery(offset = 0) {
  const params = new URLSearchParams(buildLibraryCacheKey());
  params.set("limit", String(PAGE_SIZE));
  params.set("offset", String(offset));
  return params.toString();
}

function appendMoviePage(currentMovies, nextMovies) {
  const seenIds = new Set(currentMovies.map((movie) => Number(movie.id)));
  const merged = [...currentMovies];
  nextMovies.forEach((movie) => {
    const movieId = Number(movie.id);
    if (!seenIds.has(movieId)) {
      seenIds.add(movieId);
      merged.push(movie);
    }
  });
  return merged;
}

function resetLibraryPaging() {
  state.libraryNextOffset = 0;
}

function invalidateLibraryCache() {
  state.libraryPageCache.clear();
  resetLibraryPaging();
}

function updateShowMoreButton() {
  const remaining = state.libraryTotal - state.movies.length;
  elements.showMoreMovies.hidden = remaining <= 0;
  elements.showMoreMovies.disabled = state.isLibraryLoading;
  elements.showMoreMovies.textContent = state.isLibraryLoading
    ? "Загружаю..."
    : remaining > 0
      ? `Показать ещё ${Math.min(PAGE_SIZE, remaining)}`
      : "Показать ещё";
}

async function migrateLegacyMovies() {
  if (state.isMigratingLegacy || state.libraryStats.total) {
    return;
  }

  let legacyMovies = [];
  try {
    legacyMovies = JSON.parse(localStorage.getItem(LEGACY_MOVIES_STORAGE) || "[]");
  } catch {
    legacyMovies = [];
  }

  if (!Array.isArray(legacyMovies) || !legacyMovies.length) {
    return;
  }

  state.isMigratingLegacy = true;
  try {
    for (const movie of legacyMovies) {
      await apiFetch("/api/movies", {
        method: "POST",
        body: JSON.stringify(normalizeMovie(movie)),
      });
    }
    localStorage.removeItem(LEGACY_MOVIES_STORAGE);
    invalidateLibraryCache();
    await loadLibrary({ skipMigration: true });
    showMessage(`Импортировано из старого хранилища: ${legacyMovies.length}`);
  } finally {
    state.isMigratingLegacy = false;
  }
}

async function runMovieSearch({ force = false } = {}) {
  const title = elements.titleInput.value.trim();
  const requestId = movieSearchRequestId + 1;
  movieSearchRequestId = requestId;

  if (title.length < MOVIE_SEARCH_MIN_LENGTH) {
    hideSearchResults();
    setLoading(false);
    if (force) {
      showMessage(`Введите минимум ${MOVIE_SEARCH_MIN_LENGTH} символа для поиска.`, true);
    }
    return;
  }

  setLoading(true);
  hideSearchResults();
  showMessage("Ищу фильм...");

  try {
    const candidates = (await searchMovieCandidates(title)).slice(0, MOVIE_SEARCH_LIMIT);
    if (requestId !== movieSearchRequestId) {
      return;
    }

    state.pendingCandidates = candidates;
    if (!candidates.length) {
      showMessage("Фильм не найден.", true);
      return;
    }

    renderSearchResults(candidates);
    showMessage("Выберите нужный фильм из списка.");
  } catch (error) {
    if (requestId === movieSearchRequestId) {
      showMessage(error.message, true);
    }
  } finally {
    if (requestId === movieSearchRequestId) {
      setLoading(false);
    }
  }
}

async function addMovieFromCandidate(candidate) {
  const result = await apiFetch("/api/movies/from-candidate", {
    method: "POST",
    body: JSON.stringify({
      candidate,
      collectionId: getSelectedCollection()?.id || "",
    }),
  });
  elements.titleInput.value = "";
  invalidateLibraryCache();
  await loadLibrary({ skipMigration: true });
  showMovieSaveResult(result);
}

async function addRandomResultMovie(button) {
  if (!state.randomResultMovie) {
    return;
  }

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Добавляю...";

  try {
    const result = await saveMovieToLibrary(state.randomResultMovie);
    state.randomResultMovie = { ...state.randomResultMovie, ...result.movie };
    renderPickedDetails(state.randomResultMovie, { showAddAction: true });
    showMovieSaveResult(result);
  } catch (error) {
    button.disabled = false;
    button.textContent = originalText;
    showMessage(error.message, true);
  }
}

async function saveMovieToLibrary(movie) {
  const result = await apiFetch("/api/movies", {
    method: "POST",
    body: JSON.stringify({
      ...movie,
      collectionId: getSelectedCollection()?.id || "",
    }),
  });
  invalidateLibraryCache();
  await loadLibrary({ skipMigration: true });
  return result;
}

function showMovieSaveResult(result) {
  const title = result.movie?.title || "Фильм";

  if (result.attachedToCollection) {
    showMessage(result.alreadyInLibrary
      ? `Добавлено в коллекцию «${result.collectionName}»: ${title}.`
      : `Сохранено: ${title}. Добавлено в коллекцию «${result.collectionName}».`);
    return;
  }

  if (result.alreadyInLibrary) {
    showMessage(result.collectionName
      ? `Этот фильм уже есть в коллекции «${result.collectionName}».`
      : "Этот фильм уже есть в списке.");
    return;
  }

  showMessage(`Сохранено: ${title}`);
}

async function searchMovieCandidates(title) {
  const params = new URLSearchParams({
    q: title,
    limit: String(MOVIE_SEARCH_LIMIT),
  });
  const data = await apiFetch(`/api/catalog/search?${params}`);
  return data.candidates || [];
}

async function prepareImportFromFile(file) {
  if (!state.user) {
    throw new Error("Сначала войдите.");
  }
  if (!file.name.toLowerCase().endsWith(".txt") && file.type && file.type !== "text/plain") {
    throw new Error("Нужен TXT-файл со списком фильмов через запятую.");
  }
  if (file.size > 256 * 1024) {
    throw new Error("Файл слишком большой. Импорт рассчитан на короткие списки до 256 КБ.");
  }

  const text = await file.text();
  showMessage("Ищу фильмы из файла...");
  const data = await apiFetch("/api/import/preview", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
  state.importRows = data.rows || [];
  openImportModal(data.duplicates || []);
}

function openImportModal(duplicates = []) {
  elements.importModal.hidden = false;
  renderImportSummary(duplicates);
  renderImportReviewList();
}

function closeImportModal() {
  elements.importModal.hidden = true;
  state.importRows = [];
}

function renderImportSummary(duplicates = []) {
  let selected = 0;
  let review = 0;
  for (const row of state.importRows) {
    if (row.selectedIndex >= 0) {
      selected += 1;
    }
    if (row.status === "review") {
      review += 1;
    }
  }
  const skipped = state.importRows.length - selected;
  const parts = [
    `К добавлению: ${selected}`,
    `на проверку: ${review}`,
    `пропущено: ${skipped}`,
  ];
  if (duplicates.length) {
    parts.push(`дубли в файле: ${duplicates.length}`);
  }
  elements.importSummary.textContent = parts.join(" • ");
  elements.confirmImport.disabled = selected === 0;
}

function renderImportReviewList() {
  elements.importReviewList.innerHTML = "";

  state.importRows.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "import-row";
    item.classList.toggle("needs-review", row.status === "review");

    const title = document.createElement("div");
    title.className = "import-title";
    title.innerHTML = `
      <strong>${escapeHtml(row.title)}</strong>
      <span>${escapeHtml(importRowStatus(row))}</span>
    `;

    const select = document.createElement("select");
    select.className = "import-select";
    select.dataset.index = String(index);
    select.disabled = !row.candidates.length || row.status === "duplicate" || row.status === "not-found" || row.status === "error";
    select.append(new Option("Пропустить", "-1"));
    row.candidates.forEach((candidate, candidateIndex) => {
      const label = [
        candidate.ruTitle || candidate.title || "Без названия",
        candidate.enTitle && candidate.enTitle !== candidate.ruTitle ? candidate.enTitle : "",
        candidate.year,
      ].filter(Boolean).join(" • ");
      select.append(new Option(label, String(candidateIndex)));
    });
    select.value = String(row.selectedIndex);

    item.append(title, select);
    elements.importReviewList.append(item);
  });
}

function importRowStatus(row) {
  if (row.error) {
    return row.error;
  }
  if (row.status === "review") {
    return "Проверьте выбранный вариант";
  }
  if (row.status === "ready") {
    return "Готово к добавлению";
  }
  return "Пропущено";
}

async function confirmImportRows() {
  const rows = state.importRows.filter((row) => row.selectedIndex >= 0);
  let added = 0;
  let skipped = 0;

  elements.confirmImport.disabled = true;
  elements.confirmImport.textContent = "Добавляю...";

  try {
    for (const row of rows) {
      const candidate = row.candidates[row.selectedIndex];
      if (!candidate) {
        skipped += 1;
        continue;
      }

      const response = await apiFetch("/api/movies/from-candidate", {
        method: "POST",
        body: JSON.stringify({ candidate }),
      });
      if (response.alreadyExists) {
        skipped += 1;
      } else {
        added += 1;
      }
    }

    closeImportModal();
    invalidateLibraryCache();
    await loadLibrary({ skipMigration: true });
    showMessage(`Импортировано: ${added}${skipped ? `, пропущено: ${skipped}` : ""}`);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    elements.confirmImport.disabled = false;
    elements.confirmImport.textContent = "Добавить выбранные";
  }
}

function renderShell() {
  const isLoggedIn = Boolean(state.user);
  elements.appShell.dataset.state = isLoggedIn ? "archive" : "locked";
  elements.appShell.classList.toggle("is-locked", !isLoggedIn);
  elements.authSection.hidden = isLoggedIn;
  elements.appContent.hidden = !isLoggedIn;
  elements.form.hidden = !isLoggedIn;
  elements.userPanel.hidden = !isLoggedIn;
  elements.currentUser.textContent = isLoggedIn ? `Пользователь: ${state.user.username}` : "";
  if (!isLoggedIn) {
    showAuthMessage("");
  }
}

function render({ appendCards = false } = {}) {
  renderStats();
  renderCollections();
  renderLibraryFilterOptions();
  renderRandomGenreSummary();
  renderCards({ appendCards });
  refreshRandomResultDetails();
  elements.clearWatched.checked = state.hideWatched;
  elements.clearWatched.disabled = !state.scopeStats.watched && !state.hideWatched;
  elements.pickMovie.disabled = !state.scopeStats.total;
  elements.pickExternalMovie.disabled = state.isLoading;
}

function renderStats() {
  elements.totalCount.textContent = state.libraryStats.total;
  elements.watchedCount.textContent = state.libraryStats.watched;
  elements.unwatchedCount.textContent = state.libraryStats.unwatched;
  elements.inCollectionsCount.textContent = state.libraryStats.inCollections;
}

function renderCollections() {
  elements.collectionList.innerHTML = "";
  elements.collectionList.append(makeCollectionButton({
    id: "all",
    name: "Все фильмы",
    count: state.libraryStats.total,
    active: state.selectedCollectionId === "all",
  }));

  state.collections.forEach((collection) => {
    elements.collectionList.append(makeCollectionButton({
      id: collection.id,
      name: collection.name,
      count: collection.movieCount ?? collection.movieIds.length,
      active: state.selectedCollectionId === collection.id,
    }));
  });

  elements.editSelectedCollection.hidden = !getSelectedCollection();
}

function makeCollectionButton({ id, name, count, active }) {
  const button = document.createElement("button");
  button.className = "collection-tab";
  button.type = "button";
  button.dataset.id = String(id);
  button.classList.toggle("is-active", active);
  button.innerHTML = `
    <span>${escapeHtml(name)}</span>
    <strong>${count}</strong>
  `;
  return button;
}

function openCollectionModal(mode, collection = null) {
  state.collectionModalMode = mode;
  state.editingCollectionId = collection?.id || null;
  state.collectionDraftMovieIds = new Set(collection?.movieIds || []);
  state.collectionSearch = "";
  state.collectionPickerMovies = [];

  elements.collectionModalTitle.textContent = mode === "edit" ? "Настройка коллекции" : "Новая коллекция";
  elements.collectionName.value = collection?.name || "";
  elements.collectionMovieSearch.value = "";
  elements.deleteCollection.hidden = mode !== "edit";
  elements.collectionModal.hidden = false;
  renderCollectionMoviePicker();
  loadCollectionPickerMovies().catch((error) => showMessage(error.message, true));
  elements.collectionName.focus();
}

function closeCollectionModal() {
  elements.collectionModal.hidden = true;
  state.collectionModalMode = "create";
  state.editingCollectionId = null;
  state.collectionDraftMovieIds = new Set();
  state.collectionSearch = "";
  state.collectionPickerMovies = [];
}

async function loadCollectionPickerMovies() {
  if (!state.user) {
    return;
  }
  const query = new URLSearchParams({ search: state.collectionSearch });
  const data = await apiFetch(`/api/library/movie-picker?${query}`);
  state.collectionPickerMovies = data.movies || [];
  renderCollectionMoviePicker();
}

function renderCollectionMoviePicker() {
  const search = state.collectionSearch;
  const filteredMovies = state.collectionPickerMovies;

  elements.collectionMoviePicker.innerHTML = "";

  if (!state.collectionPickerMovies.length && !search) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "Фильмов пока нет. Коллекцию можно сохранить пустой.";
    elements.collectionMoviePicker.append(empty);
    return;
  }

  if (!filteredMovies.length) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "Поиск ничего не нашел.";
    elements.collectionMoviePicker.append(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "checkbox-grid";
  filteredMovies.forEach((movie) => {
    const label = document.createElement("label");
    label.className = "movie-check";
    label.innerHTML = `
      <input type="checkbox" value="${movie.id}" ${state.collectionDraftMovieIds.has(movie.id) ? "checked" : ""}>
      <span>${escapeHtml(movie.title)}</span>
    `;
    grid.append(label);
  });
  elements.collectionMoviePicker.append(grid);
}

function renderLibraryFilterOptions() {
  if (!state.user) {
    return;
  }

  elements.librarySearch.value = state.librarySearch;
  state.libraryFilters.year = syncSelectOptions(
    elements.yearFilter,
    state.libraryFilterOptions.years || [],
    "Все",
    state.libraryFilters.year,
  );
  elements.ratingFilter.value = state.libraryFilters.rating;
  state.libraryFilters.genre = syncSelectOptions(
    elements.genreFilter,
    state.libraryFilterOptions.genres || [],
    "Все",
    state.libraryFilters.genre,
  );
  state.libraryFilters.director = syncSelectOptions(
    elements.directorFilter,
    state.libraryFilterOptions.directors || [],
    "Все",
    state.libraryFilters.director,
  );
}

function syncSelectOptions(select, values, emptyLabel, selectedValue) {
  const currentValues = [...new Set(values.filter(Boolean))];
  const currentValueSet = new Set(currentValues);
  select.innerHTML = "";
  select.append(new Option(emptyLabel, ""));
  currentValues.forEach((value) => {
    select.append(new Option(value, value));
  });

  const nextValue = currentValueSet.has(selectedValue) ? selectedValue : "";
  select.value = nextValue;
  return nextValue;
}

function resetLibraryFilters() {
  state.librarySearch = "";
  state.hideWatched = false;
  state.libraryFilters = {
    year: "",
    rating: "",
    genre: "",
    director: "",
  };
  resetLibraryPaging();
  loadLibrary({ skipMigration: true }).catch((error) => showMessage(error.message, true));
}

function openRandomGenreModal() {
  state.randomGenreDraft = new Set(state.randomGenreFilters);
  renderRandomGenrePicker();
  elements.randomGenreModal.hidden = false;
}

function closeRandomGenreModal() {
  elements.randomGenreModal.hidden = true;
  state.randomGenreDraft = new Set(state.randomGenreFilters);
}

function saveRandomGenres() {
  state.randomGenreFilters = new Set(state.randomGenreDraft);
  closeRandomGenreModal();
  renderRandomGenreSummary();
}

function renderRandomGenrePicker() {
  const genres = getLibraryGenres();
  elements.randomGenrePicker.innerHTML = "";

  if (!genres.length) {
    const empty = document.createElement("div");
    empty.className = "picker-empty";
    empty.textContent = "В библиотеке пока нет жанров.";
    elements.randomGenrePicker.append(empty);
    renderRandomGenreSummary(state.randomGenreDraft, true);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "checkbox-grid";
  genres.forEach((genre) => {
    const label = document.createElement("label");
    label.className = "movie-check";
    label.innerHTML = `
      <input type="checkbox" value="${escapeHtml(genre)}" ${state.randomGenreDraft.has(genre) ? "checked" : ""}>
      <span>${escapeHtml(genre)}</span>
    `;
    grid.append(label);
  });
  elements.randomGenrePicker.append(grid);
  renderRandomGenreSummary(state.randomGenreDraft, true);
}

function renderRandomGenreSummary(selection = state.randomGenreFilters, isDraft = false) {
  const count = selection.size;
  const suffix = isDraft ? " выбрано" : "";
  elements.randomGenreSummary.textContent = count ? `${count} ${pluralizeGenre(count)}${suffix}` : "Все жанры";
}

function pluralizeGenre(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "жанр";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "жанра";
  }
  return "жанров";
}

function toggleSetValue(targetSet, value, isSelected) {
  if (isSelected) {
    targetSet.add(value);
  } else {
    targetSet.delete(value);
  }
}

function renderCards({ appendCards = false } = {}) {
  const selected = getSelectedCollection();
  elements.cardsTitle.textContent = selected ? selected.name : "Все фильмы";

  if (!state.user) {
    elements.cardsGrid.innerHTML = "";
    elements.showMoreMovies.hidden = true;
    elements.showMoreMovies.disabled = false;
    return;
  }

  if (!state.movies.length) {
    elements.cardsGrid.innerHTML = "<div class=\"empty-state\">Здесь пока нет фильмов.</div>";
    elements.showMoreMovies.hidden = true;
    elements.showMoreMovies.disabled = false;
    return;
  }

  const renderedIds = appendCards
    ? new Set([...elements.cardsGrid.querySelectorAll(".movie-card")].map((card) => Number(card.dataset.id)))
    : new Set();
  const moviesToRender = appendCards
    ? state.movies.filter((movie) => !renderedIds.has(Number(movie.id)))
    : state.movies;

  if (!appendCards) {
    elements.cardsGrid.innerHTML = "";
  }

  const fragment = document.createDocumentFragment();

  moviesToRender.forEach((movie) => {
    const card = elements.template.content.firstElementChild.cloneNode(true);
    card.dataset.id = movie.id;
    card.tabIndex = 0;
    card.setAttribute("aria-label", `Открыть карточку фильма: ${movie.title}`);
    card.classList.toggle("is-watched", movie.watched);

    const poster = card.querySelector(".poster");
    poster.src = movie.poster || PLACEHOLDER_POSTER;
    poster.alt = `Постер: ${movie.title}`;
    poster.classList.toggle("placeholder", !movie.poster || movie.poster === PLACEHOLDER_POSTER);
    poster.addEventListener("error", () => {
      poster.src = PLACEHOLDER_POSTER;
      poster.classList.add("placeholder");
    });

    const rating = card.querySelector(".rating");
    const runtime = card.querySelector(".runtime");

    card.querySelector(".year").textContent = movie.year || "год ?";
    runtime.textContent = movie.runtime || "";
    runtime.hidden = !movie.runtime;
    rating.textContent = movie.rating ? `IMDb ${movie.rating}` : "IMDb —";
    card.querySelector(".title").textContent = movie.title;
    const director = card.querySelector(".director");
    director.textContent = movie.director || "Режиссёр не найден";
    director.hidden = !movie.director;
    const plot = card.querySelector(".plot");
    plot.textContent = movie.plot;
    card.querySelector(".watched-input").checked = movie.watched;

    fragment.append(card);
  });

  elements.cardsGrid.append(fragment);
  updateShowMoreButton();
}

function renderSearchResults(candidates) {
  elements.searchResults.innerHTML = "";
  elements.searchResults.hidden = false;

  const title = document.createElement("div");
  title.className = "search-results-title";
  title.textContent = "Найдено несколько вариантов";
  elements.searchResults.append(title);

  const list = document.createElement("div");
  list.className = "candidate-list";

  candidates.forEach((candidate, index) => {
    const option = document.createElement("button");
    option.className = "candidate-option";
    option.type = "button";
    option.dataset.index = String(index);

    const main = document.createElement("span");
    main.className = "candidate-main";
    main.textContent = candidate.ruTitle || candidate.title || "Без названия";

    const heading = document.createElement("span");
    heading.className = "candidate-heading";

    const tags = document.createElement("span");
    tags.className = "candidate-tags";
    [
      candidate.year,
      candidate.runtime,
      candidate.rating ? `IMDb ${candidate.rating}` : "",
    ].filter(Boolean).forEach((value) => {
      const tag = document.createElement("span");
      tag.className = "candidate-tag";
      tag.textContent = value;
      tags.append(tag);
    });

    const details = document.createElement("span");
    details.className = "candidate-details";
    const detailText = [
      candidate.director,
      candidate.cast,
      candidate.genre,
    ].filter(Boolean).join(" • ");
    details.textContent = detailText;

    heading.append(main, details, tags);
    option.append(heading);
    list.append(option);
  });

  elements.searchResults.append(list);
}

function hideSearchResults() {
  state.pendingCandidates = [];
  elements.searchResults.hidden = true;
  elements.searchResults.innerHTML = "";
}

function renderPickedDetails(movie, options = {}) {
  elements.pickedDetails.innerHTML = renderMovieDetailsCard(movie, options);
}

function refreshRandomResultDetails() {
  if (state.randomResultMovie && !elements.pickedDetails.hidden) {
    renderPickedDetails(state.randomResultMovie, { showAddAction: true });
  }
}

function resetPickedMovie() {
  state.randomResultMovie = null;
  elements.pickedMovie.innerHTML = "";
  elements.pickedDetails.hidden = true;
  elements.pickedDetails.innerHTML = "";
}

function openMovieDetailsFromCard(card) {
  const movie = getMovieById(card.dataset.id);
  if (movie) {
    openMovieDetailsModal(movie);
  }
}

async function openMovieDetailsModal(movie) {
  const movieKey = String(movie.id || movie.imdbId || movie.title);
  elements.plotModalTitle.textContent = movie.title || "Фильм";
  elements.plotModalBody.dataset.movieKey = movieKey;
  elements.plotModalBody.innerHTML = renderMovieDetailsCard(movie, {
    className: "picked-expanded-card movie-detail-card",
    isLoading: Boolean(movie.imdbId),
  });
  elements.plotModal.hidden = false;

  const data = await apiFetch(`/api/movies/${movie.id}/details`);
  const expanded = data.movie;
  if (!elements.plotModal.hidden && elements.plotModalBody.dataset.movieKey === movieKey) {
    elements.plotModalTitle.textContent = expanded.title || movie.title || "Фильм";
    elements.plotModalBody.innerHTML = renderMovieDetailsCard(expanded, {
      className: "picked-expanded-card movie-detail-card",
    });
  }
}

function closePlotModal() {
  elements.plotModal.hidden = true;
  elements.plotModalBody.innerHTML = "";
  delete elements.plotModalBody.dataset.movieKey;
}

function renderMovieDetailsCard(movie, { className = "picked-expanded-card", isLoading = false, showAddAction = false } = {}) {
  const addAction = showAddAction ? renderRandomResultAddAction(movie) : "";

  return `
    <article class="${className}">
      <img class="picked-expanded-poster" src="${escapeHtml(movie.poster || PLACEHOLDER_POSTER)}" alt="Постер: ${escapeHtml(movie.title)}">
      <div class="picked-expanded-body">
        <div class="card-topline">
          <span class="year">${escapeHtml(movie.year || "год ?")}</span>
          ${movie.runtime ? `<span class="runtime">${escapeHtml(movie.runtime)}</span>` : ""}
          <span class="rating">${escapeHtml(movie.rating ? `IMDb ${movie.rating}` : "IMDb —")}</span>
        </div>
        <div class="picked-expanded-heading">
          <h3>${escapeHtml(movie.title)}</h3>
          ${addAction}
        </div>
        <dl class="detail-list">
          <div><dt>Оригинал</dt><dd>${escapeHtml(movie.originalTitle || "не найдено")}</dd></div>
          <div><dt>Год</dt><dd>${escapeHtml(movie.year || "не найден")}</dd></div>
          <div><dt>Длительность</dt><dd>${escapeHtml(movie.runtime || "не найдена")}</dd></div>
          <div><dt>IMDb</dt><dd>${escapeHtml(movie.rating ? `${movie.rating}/10` : "не найден")}</dd></div>
          <div><dt>Жанры</dt><dd>${escapeHtml(movie.genre || "не найдены")}</dd></div>
          <div><dt>Режиссёр</dt><dd>${escapeHtml(movie.director || "не найден")}</dd></div>
          <div><dt>В главных ролях</dt><dd>${escapeHtml(movie.cast || "не найдены")}</dd></div>
        </dl>
        <p>${escapeHtml(movie.plot || "Описание не найдено.")}</p>
        ${isLoading ? "<div class=\"picked-details-loading\">Уточняю данные...</div>" : ""}
      </div>
    </article>
  `;
}

function renderRandomResultAddAction(movie) {
  const action = getRandomResultAddAction(movie);
  return `
    <button
      class="primary-button picked-add-button"
      type="button"
      data-action="add-picked-movie"
      aria-label="${escapeHtml(action.ariaLabel)}"
      ${action.disabled ? "disabled" : ""}
    >${escapeHtml(action.label)}</button>
  `;
}

function getRandomResultAddAction(movie) {
  const selectedCollection = getSelectedCollection();
  const localMovieId = Number(movie.id);
  const title = movie.title || "фильм";

  if (!localMovieId) {
    return {
      label: "Добавить",
      disabled: false,
      ariaLabel: selectedCollection
        ? `Добавить «${title}» в список и коллекцию «${selectedCollection.name}»`
        : `Добавить «${title}» в список`,
    };
  }

  if (selectedCollection) {
    if (collectionHasMovie(selectedCollection, localMovieId)) {
      return {
        label: "В коллекции",
        disabled: true,
        ariaLabel: `«${title}» уже есть в коллекции «${selectedCollection.name}»`,
      };
    }

    return {
      label: "Добавить",
      disabled: false,
      ariaLabel: `Добавить «${title}» в коллекцию «${selectedCollection.name}»`,
    };
  }

  return {
    label: "В списке",
    disabled: true,
    ariaLabel: `«${title}» уже есть в списке`,
  };
}

function isCardControlTarget(target) {
  return Boolean(target.closest("button, input, label, select, textarea, a, .card-actions"));
}

async function pickExternalRandomMovie() {
  const originalText = elements.pickExternalMovie.textContent;
  state.randomResultMovie = null;
  elements.pickExternalMovie.disabled = true;
  elements.pickExternalMovie.textContent = "Сканирую...";
  elements.pickedMovie.innerHTML = "<span class=\"muted\">Ищу случайный фильм во внешнем каталоге...</span>";
  elements.pickedDetails.hidden = true;
  elements.pickedDetails.innerHTML = "";

  try {
    const result = await apiFetch("/api/discovery/random", {
      method: "POST",
      body: JSON.stringify(buildRandomRequest("external")),
    });
    state.recentExternalRandomKeys = result.recentExternalRandomKeys || state.recentExternalRandomKeys;
    const picked = result.movie;
    if (!picked) {
      elements.pickedMovie.innerHTML = "<span class=\"muted\">Под эти настройки внешний каталог ничего не вернул. Попробуйте ослабить фильтры.</span>";
      return;
    }

    elements.pickedMovie.innerHTML = `
      <span>
        <strong>${escapeHtml(picked.title)}</strong>
        ${escapeHtml([picked.year, picked.rating && `${picked.rating}/10`, "внешний каталог"].filter(Boolean).join(" • "))}
      </span>
    `;
    elements.pickedDetails.hidden = false;
    state.randomResultMovie = picked;
    renderPickedDetails(picked, { showAddAction: true });
  } catch (error) {
    state.randomResultMovie = null;
    elements.pickedMovie.innerHTML = "<span class=\"muted\">Не удалось получить случайный фильм.</span>";
    showMessage(error.message, true);
  } finally {
    elements.pickExternalMovie.disabled = false;
    elements.pickExternalMovie.textContent = originalText;
  }
}

function buildRandomRequest(source) {
  return {
    source,
    collectionId: String(state.selectedCollectionId),
    includeWatched: elements.includeWatchedRandom.checked,
    durationFilterEnabled: getSelectedDurationRange() !== "any",
    durationRange: getSelectedDurationRange(),
    ratingRange: getSelectedRatingRange(),
    genreFilters: [...state.randomGenreFilters],
    recentLibraryRandomIds: state.recentLibraryRandomIds,
    recentExternalRandomKeys: state.recentExternalRandomKeys,
  };
}

function hasActiveRandomFilters() {
  return getSelectedDurationRange() !== "any"
    || getSelectedRatingRange() !== "any"
    || state.randomGenreFilters.size > 0;
}

function getRandomEmptyMessage() {
  if (hasActiveRandomFilters()) {
    return "Под выбранные настройки не нашлось фильмов.";
  }
  return elements.includeWatchedRandom.checked
    ? "В текущем разделе нет фильмов."
    : "Нет непросмотренных фильмов.";
}

function syncRandomDurationControls() {
  const enabled = getSelectedDurationRange() !== "any";
  elements.durationRangeGroup.dataset.state = enabled ? "active" : "idle";
}

function getSelectedDurationRange() {
  return [...elements.durationRangeInputs].find((input) => input.checked)?.value || "any";
}

function getSelectedRatingRange() {
  return [...elements.ratingRangeInputs].find((input) => input.checked)?.value || "any";
}

function getLibraryGenres() {
  return state.libraryFilterOptions.genres || [];
}

function rebuildLibraryIndexes() {
  state.moviesById = new Map(state.movies.map((movie) => [Number(movie.id), movie]));
  state.collectionsById = new Map(state.collections.map((collection) => [Number(collection.id), collection]));
  state.collectionMovieIdSets = new Map(state.collections.map((collection) => {
    return [Number(collection.id), new Set((collection.movieIds || []).map(Number))];
  }));
}

function getMovieById(movieId) {
  return state.moviesById.get(Number(movieId)) || null;
}

function getSelectedCollection() {
  if (state.selectedCollectionId === "all") {
    return null;
  }
  return state.collectionsById.get(Number(state.selectedCollectionId)) || null;
}

function collectionHasMovie(collection, movieId) {
  return state.collectionMovieIdSets.get(Number(collection?.id))?.has(Number(movieId)) || false;
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  elements.form.querySelector("button[type='submit']").disabled = isLoading;
  elements.searchResults.querySelectorAll("button").forEach((button) => {
    button.disabled = isLoading;
  });
}

function showMessage(text, isError = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", isError);
}

function showAuthMessage(text, isError = false) {
  elements.authMessage.textContent = text;
  elements.authMessage.classList.toggle("error", isError);
}

function loadUser() {
  try {
    const user = JSON.parse(localStorage.getItem(USER_STORAGE) || "null");
    if (!user?.token) {
      localStorage.removeItem(USER_STORAGE);
      return null;
    }
    return user;
  } catch {
    localStorage.removeItem(USER_STORAGE);
    return null;
  }
}

function saveUser() {
  if (!state.user?.token) {
    localStorage.removeItem(USER_STORAGE);
    return;
  }
  localStorage.setItem(USER_STORAGE, JSON.stringify(state.user));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}
