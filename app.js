const USER_STORAGE = "film-randomizer.user";
const LEGACY_MOVIES_STORAGE = "film-randomizer.movies";
const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const WIKIPEDIA_SUMMARY_URL = "https://ru.wikipedia.org/api/rest_v1/page/summary/";
const CINEMETA_SEARCH_URL = "https://v3-cinemeta.strem.io/catalog/movie/top/search=";
const CINEMETA_META_URL = "https://v3-cinemeta.strem.io/meta/movie/";
const PAGE_SIZE = 15;
const GLITCH_CHARS = "&^%$#@01";
const DURATION_RANGES = {
  short: { max: 60 },
  standard: { min: 60, max: 130 },
  long: { min: 131 },
};
const RATING_RANGES = {
  low: { max: 5.5 },
  medium: { min: 5.6, max: 7.5 },
  high: { min: 7.6, minExclusive: true },
};
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
const PLACEHOLDER_POSTER =
  "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 180'%3E%3Crect width='120' height='180' fill='%23d8d1c6'/%3E%3Cpath d='M28 43h64v94H28z' fill='none' stroke='%23687076' stroke-width='6'/%3E%3Cpath d='M43 63h34M43 83h34M43 103h21' stroke='%23687076' stroke-width='6' stroke-linecap='round'/%3E%3C/svg%3E";

const state = {
  user: loadUser(),
  movies: [],
  collections: [],
  selectedCollectionId: "all",
  pendingCandidates: [],
  visibleMovieLimit: PAGE_SIZE,
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
  isMigratingLegacy: false,
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
  durationFilterEnabled: document.querySelector("#durationFilterEnabled"),
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
  const title = elements.titleInput.value.trim();
  if (!title) {
    return;
  }

  setLoading(true);
  hideSearchResults();
  showMessage("Ищу фильм...");

  try {
    const candidates = await searchMovieCandidates(title);
    if (!candidates.length) {
      throw new Error("Фильм не найден.");
    }

    if (candidates.length > 1) {
      state.pendingCandidates = candidates;
      renderSearchResults(candidates);
      showMessage("Выберите нужный фильм из списка.");
      return;
    }

    await addMovieFromCandidate(candidates[0]);
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    setLoading(false);
  }
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
  const pool = getRandomMoviePool("library");
  if (!pool.length) {
    elements.pickedMovie.innerHTML = `<span class="muted">${getRandomEmptyMessage()}</span>`;
    elements.pickedDetails.hidden = true;
    elements.pickedDetails.innerHTML = "";
    return;
  }

  const picked = pool[Math.floor(Math.random() * pool.length)];
  elements.pickedMovie.innerHTML = `
    <span>
      <strong>${escapeHtml(picked.title)}</strong>
      ${escapeHtml([picked.year, picked.rating && `${picked.rating}/10`].filter(Boolean).join(" • "))}
    </span>
  `;
  elements.pickedDetails.hidden = false;
  elements.pickedDetails.innerHTML = "<div class=\"picked-details-loading\">Загружаю подробности...</div>";

  const expanded = await getExpandedMovie(picked);
  renderPickedDetails(expanded);
});

elements.pickExternalMovie.addEventListener("click", pickExternalRandomMovie);

elements.includeWatchedRandom.addEventListener("change", () => {
  render();
});

elements.durationFilterEnabled.addEventListener("change", handleDurationFilterToggle);

elements.durationRangeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    render();
  });
});

elements.ratingRangeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    render();
  });
});

elements.openRandomGenreModal.addEventListener("click", openRandomGenreModal);

elements.clearWatched.addEventListener("click", toggleWatchedVisibility);

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
  renderCollectionMoviePicker();
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
    await loadLibrary();
    showMessage("Коллекция удалена. Фильмы остались в библиотеке.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

elements.showMoreMovies.addEventListener("click", () => {
  state.visibleMovieLimit += PAGE_SIZE;
  renderCards();
});

elements.librarySearch.addEventListener("input", () => {
  state.librarySearch = elements.librarySearch.value.trim();
  state.visibleMovieLimit = PAGE_SIZE;
  renderCards();
});

[
  ["year", elements.yearFilter],
  ["rating", elements.ratingFilter],
  ["genre", elements.genreFilter],
  ["director", elements.directorFilter],
].forEach(([key, element]) => {
  element.addEventListener("change", () => {
    state.libraryFilters[key] = element.value;
    state.visibleMovieLimit = PAGE_SIZE;
    renderCards();
  });
});

elements.resetLibraryFilters.addEventListener("click", resetLibraryFilters);

elements.cardsGrid.addEventListener("change", async (event) => {
  if (!event.target.classList.contains("watched-input")) {
    return;
  }

  const card = event.target.closest(".movie-card");
  const movie = state.movies.find((item) => item.id === Number(card.dataset.id));
  if (!movie) {
    return;
  }

  try {
    const response = await apiFetch(`/api/movies/${movie.id}`, {
      method: "PATCH",
      body: JSON.stringify({ watched: event.target.checked }),
    });
    Object.assign(movie, response.movie);
    render();
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
  const movie = state.movies.find((item) => item.id === Number(card.dataset.id));

  try {
    await apiFetch(`/api/movies/${card.dataset.id}`, { method: "DELETE" });
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
  runTerminalReveals();

  if (state.user) {
    loadLibrary().catch((error) => {
      showMessage(error.message, true);
    });
  }
}

function logoutUser() {
  state.user = null;
  state.movies = [];
  state.collections = [];
  selectCollection("all", { shouldRender: false });
  state.visibleMovieLimit = PAGE_SIZE;
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

function handleDurationFilterToggle() {
  syncRandomDurationControls();
  render();
}

function toggleWatchedVisibility() {
  state.hideWatched = !state.hideWatched;
  state.visibleMovieLimit = PAGE_SIZE;
  render();
  showMessage(state.hideWatched ? "Просмотренные скрыты из выдачи." : "Просмотренные снова показаны.");
}

function selectCollection(collectionId, { shouldRender = true } = {}) {
  state.selectedCollectionId = collectionId;
  state.visibleMovieLimit = PAGE_SIZE;
  state.hideWatched = false;
  if (shouldRender) {
    render();
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
  if (!options.skipAuth && state.user) {
    headers["X-User-Id"] = String(state.user.id);
  }

  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      state.user = null;
      localStorage.removeItem(USER_STORAGE);
      renderShell();
    }
    throw new Error(data.error || "Ошибка запроса.");
  }
  return data;
}

async function loadLibrary() {
  if (!state.user) {
    return;
  }

  const data = await apiFetch("/api/library");
  state.movies = data.movies || [];
  state.collections = data.collections || [];
  if (state.selectedCollectionId !== "all" && !getSelectedCollection()) {
    state.selectedCollectionId = "all";
  }
  renderShell();
  render();
  await migrateLegacyMovies();
}

async function migrateLegacyMovies() {
  if (state.isMigratingLegacy || state.movies.length) {
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
    const data = await apiFetch("/api/library");
    state.movies = data.movies || [];
    state.collections = data.collections || [];
    render();
    showMessage(`Импортировано из старого хранилища: ${legacyMovies.length}`);
  } finally {
    state.isMigratingLegacy = false;
  }
}

async function searchMovieCandidates(title) {
  const wikidataCandidates = await tryFetch(() => fetchWikidataCandidates(title), []);
  if (wikidataCandidates.length) {
    return wikidataCandidates;
  }

  return fetchCinemetaCandidates(title);
}

async function addMovieFromCandidate(candidate) {
  if (candidate.imdbId && state.movies.some((item) => item.imdbId === candidate.imdbId)) {
    showMessage("Этот фильм уже есть в списке.");
    return;
  }

  const activeCollection = getSelectedCollection();
  const movie = await fetchMovieDetails(candidate);
  const response = await apiFetch("/api/movies", {
    method: "POST",
    body: JSON.stringify(movie),
  });

  if (response.alreadyExists) {
    showMessage("Этот фильм уже есть в списке.");
    return;
  }

  elements.titleInput.value = "";
  const attachedCollectionName = activeCollection
    ? await attachMovieToCollection(response.movie.id, activeCollection)
    : "";
  await loadLibrary();
  showMessage(attachedCollectionName
    ? `Сохранено: ${response.movie.title}. Добавлено в коллекцию «${attachedCollectionName}».`
    : `Сохранено: ${response.movie.title}`);
}

async function attachMovieToCollection(movieId, collection) {
  if (!collection || collection.movieIds.includes(movieId)) {
    return collection?.name || "";
  }

  await apiFetch(`/api/collections/${collection.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: collection.name,
      movieIds: [...collection.movieIds, movieId],
    }),
  });
  return collection.name;
}

async function fetchMovieDetails(candidate) {
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

async function fetchWikidataCandidates(title) {
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

async function fetchCinemetaCandidates(title) {
  const searchUrl = `${CINEMETA_SEARCH_URL}${encodeURIComponent(title)}.json`;
  const response = await fetch(searchUrl);
  if (!response.ok) {
    throw new Error("Не удалось получить данные о фильме. Попробуйте позже.");
  }

  const data = await response.json();
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
    }))).slice(0, 8);
}

async function fetchCinemetaDetailsById(imdbId) {
  const response = await fetch(`${CINEMETA_META_URL}${encodeURIComponent(imdbId)}.json`);
  if (!response.ok) {
    throw new Error("Cinemeta не ответила.");
  }

  const data = await response.json();
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
}

async function fetchRussianSummary(wikiTitle) {
  const response = await fetch(`${WIKIPEDIA_SUMMARY_URL}${encodeURIComponent(wikiTitle)}`);
  if (!response.ok) {
    throw new Error("Wikipedia не ответила.");
  }

  const data = await response.json();
  return clean(data.extract);
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
  const parsed = parseMovieImportText(text);
  if (!parsed.titles.length) {
    throw new Error("В файле не найдено названий фильмов.");
  }
  if (parsed.titles.length > 100) {
    throw new Error("Слишком много фильмов за один раз. Ограничение: 100 названий.");
  }

  showMessage(`Ищу фильмы из файла: ${parsed.titles.length}...`);
  const existingImdbIds = new Set(state.movies.map((movie) => movie.imdbId));
  const rows = [];

  for (const title of parsed.titles) {
    const row = {
      title,
      candidates: [],
      selectedIndex: -1,
      status: "",
      error: "",
    };

    try {
      const candidates = await searchMovieCandidates(title);
      row.candidates = candidates;
      const availableCandidates = candidates.filter((candidate) => !existingImdbIds.has(candidate.imdbId));
      if (!candidates.length) {
        row.status = "not-found";
        row.error = "Не найдено";
      } else if (!availableCandidates.length) {
        row.status = "duplicate";
        row.error = "Уже есть в библиотеке";
      } else {
        row.selectedIndex = candidates.indexOf(bestImportCandidate(title, availableCandidates));
        row.status = candidates.length > 1 ? "review" : "ready";
      }
    } catch (error) {
      row.status = "error";
      row.error = error.message;
    }

    rows.push(row);
  }

  state.importRows = rows;
  openImportModal(parsed.duplicates);
}

function parseMovieImportText(text) {
  const titles = [];
  const duplicates = [];
  const seen = new Set();
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && next === "\"") {
      current += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      pushImportedTitle(current, titles, duplicates, seen);
      current = "";
      continue;
    }
    current += char;
  }

  if (inQuotes) {
    throw new Error("В файле есть незакрытая кавычка.");
  }

  pushImportedTitle(current, titles, duplicates, seen);
  return { titles, duplicates };
}

function pushImportedTitle(value, titles, duplicates, seen) {
  const title = value.replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "");
  if (!title) {
    return;
  }
  const key = normalizeSearchText(title);
  if (seen.has(key)) {
    duplicates.push(title);
    return;
  }
  seen.add(key);
  titles.push(title);
}

function bestImportCandidate(query, candidates) {
  return candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(query, candidate) }))
    .sort((left, right) => right.score - left.score)[0]?.candidate || candidates[0];
}

function scoreCandidate(query, candidate) {
  const normalizedQuery = normalizeSearchText(query);
  const titles = [candidate.ruTitle, candidate.title, candidate.enTitle].filter(Boolean).map(normalizeSearchText);
  if (titles.includes(normalizedQuery)) {
    return 100;
  }
  if (titles.some((title) => title.startsWith(normalizedQuery) || normalizedQuery.startsWith(title))) {
    return 75;
  }
  if (titles.some((title) => title.includes(normalizedQuery) || normalizedQuery.includes(title))) {
    return 50;
  }
  return 10;
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
  const selected = state.importRows.filter((row) => row.selectedIndex >= 0).length;
  const review = state.importRows.filter((row) => row.status === "review").length;
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
  const importedImdbIds = new Set(state.movies.map((movie) => movie.imdbId));
  let added = 0;
  let skipped = 0;

  elements.confirmImport.disabled = true;
  elements.confirmImport.textContent = "Добавляю...";

  try {
    for (const row of rows) {
      const candidate = row.candidates[row.selectedIndex];
      if (!candidate || importedImdbIds.has(candidate.imdbId)) {
        skipped += 1;
        continue;
      }

      const movie = await fetchMovieDetails(candidate);
      const response = await apiFetch("/api/movies", {
        method: "POST",
        body: JSON.stringify(movie),
      });
      if (response.alreadyExists) {
        skipped += 1;
      } else {
        added += 1;
        importedImdbIds.add(response.movie.imdbId);
      }
    }

    closeImportModal();
    await loadLibrary();
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

function render() {
  renderStats();
  renderCollections();
  renderLibraryFilterOptions();
  renderRandomGenreSummary();
  renderCards();
  elements.clearWatched.disabled = !getVisibleMovies().some((movie) => movie.watched);
  elements.clearWatched.textContent = state.hideWatched ? "Показать просмотренные" : "Убрать просмотренные";
  elements.pickMovie.disabled = !getRandomMoviePool("library").length;
  elements.pickExternalMovie.disabled = state.isLoading;
}

function renderStats() {
  const watched = state.movies.filter((movie) => movie.watched).length;
  const inCollections = new Set(state.collections.flatMap((collection) => collection.movieIds)).size;
  elements.totalCount.textContent = state.movies.length;
  elements.watchedCount.textContent = watched;
  elements.unwatchedCount.textContent = state.movies.length - watched;
  elements.inCollectionsCount.textContent = inCollections;
}

function renderCollections() {
  elements.collectionList.innerHTML = "";
  elements.collectionList.append(makeCollectionButton({
    id: "all",
    name: "Все фильмы",
    count: state.movies.length,
    active: state.selectedCollectionId === "all",
  }));

  state.collections.forEach((collection) => {
    elements.collectionList.append(makeCollectionButton({
      id: collection.id,
      name: collection.name,
      count: collection.movieIds.length,
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

  elements.collectionModalTitle.textContent = mode === "edit" ? "Настройка коллекции" : "Новая коллекция";
  elements.collectionName.value = collection?.name || "";
  elements.collectionMovieSearch.value = "";
  elements.deleteCollection.hidden = mode !== "edit";
  elements.collectionModal.hidden = false;
  renderCollectionMoviePicker();
  elements.collectionName.focus();
}

function closeCollectionModal() {
  elements.collectionModal.hidden = true;
  state.collectionModalMode = "create";
  state.editingCollectionId = null;
  state.collectionDraftMovieIds = new Set();
  state.collectionSearch = "";
}

function renderCollectionMoviePicker() {
  const search = normalizeSearchText(state.collectionSearch);
  const filteredMovies = search
    ? state.movies.filter((movie) => {
      return [movie.title, movie.originalTitle, movie.year, movie.genre]
        .filter(Boolean)
        .some((value) => normalizeSearchText(value).includes(search));
    })
    : state.movies;

  elements.collectionMoviePicker.innerHTML = "";

  if (!state.movies.length) {
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

  const sourceMovies = getVisibleMovies();
  elements.librarySearch.value = state.librarySearch;
  state.libraryFilters.year = syncSelectOptions(
    elements.yearFilter,
    getUniqueYears(sourceMovies),
    "Все",
    state.libraryFilters.year,
  );
  elements.ratingFilter.value = state.libraryFilters.rating;
  state.libraryFilters.genre = syncSelectOptions(
    elements.genreFilter,
    getUniqueGenres(sourceMovies),
    "Все",
    state.libraryFilters.genre,
  );
  state.libraryFilters.director = syncSelectOptions(
    elements.directorFilter,
    getUniqueDirectors(sourceMovies),
    "Все",
    state.libraryFilters.director,
  );
}

function syncSelectOptions(select, values, emptyLabel, selectedValue) {
  const currentValues = [...new Set(values.filter(Boolean))];
  select.innerHTML = "";
  select.append(new Option(emptyLabel, ""));
  currentValues.forEach((value) => {
    select.append(new Option(value, value));
  });

  const nextValue = currentValues.includes(selectedValue) ? selectedValue : "";
  select.value = nextValue;
  return nextValue;
}

function resetLibraryFilters() {
  state.librarySearch = "";
  state.libraryFilters = {
    year: "",
    rating: "",
    genre: "",
    director: "",
  };
  state.visibleMovieLimit = PAGE_SIZE;
  render();
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
  render();
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

function renderCards() {
  const visibleMovies = getDisplayMovies();
  const selected = getSelectedCollection();
  const pageMovies = visibleMovies.slice(0, state.visibleMovieLimit);
  elements.cardsTitle.textContent = selected ? selected.name : "Все фильмы";

  if (!state.user) {
    elements.cardsGrid.innerHTML = "";
    elements.showMoreMovies.hidden = true;
    return;
  }

  if (!visibleMovies.length) {
    elements.cardsGrid.innerHTML = "<div class=\"empty-state\">Здесь пока нет фильмов.</div>";
    elements.showMoreMovies.hidden = true;
    return;
  }

  elements.cardsGrid.innerHTML = "";
  const fragment = document.createDocumentFragment();

  pageMovies.forEach((movie) => {
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

    const originalTitle = movie.originalTitle && movie.originalTitle !== movie.title ? movie.originalTitle : "";
    const rating = card.querySelector(".rating");
    const runtime = card.querySelector(".runtime");

    card.querySelector(".year").textContent = movie.year || "год ?";
    runtime.textContent = movie.runtime || "";
    runtime.title = movie.runtime ? `Длительность: ${movie.runtime}` : "";
    runtime.hidden = !movie.runtime;
    rating.textContent = movie.rating ? `IMDb ${movie.rating}` : "IMDb —";
    rating.title = movie.rating ? `IMDb ${movie.rating}` : "Рейтинг не найден";
    card.querySelector(".title").textContent = movie.title;
    card.querySelector(".meta").textContent = [originalTitle, movie.genre, movie.director].filter(Boolean).join(" • ");
    const plot = card.querySelector(".plot");
    plot.textContent = movie.plot;
    plot.title = movie.plot || "";
    card.querySelector(".watched-input").checked = movie.watched;

    fragment.append(card);
  });

  elements.cardsGrid.append(fragment);
  const remaining = visibleMovies.length - pageMovies.length;
  elements.showMoreMovies.hidden = remaining <= 0;
  elements.showMoreMovies.textContent = remaining > 0 ? `Показать ещё ${Math.min(PAGE_SIZE, remaining)}` : "Показать ещё";
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

    const details = document.createElement("span");
    details.className = "candidate-details";
    details.textContent = [
      candidate.enTitle && candidate.enTitle !== candidate.ruTitle ? candidate.enTitle : "",
      candidate.year,
      candidate.ruDescription,
    ].filter(Boolean).join(" • ");

    option.append(main, details);
    list.append(option);
  });

  elements.searchResults.append(list);
}

function hideSearchResults() {
  state.pendingCandidates = [];
  elements.searchResults.hidden = true;
  elements.searchResults.innerHTML = "";
}

function normalizeMovie(movie) {
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

async function getExpandedMovie(movie) {
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

function renderPickedDetails(movie) {
  elements.pickedDetails.innerHTML = renderMovieDetailsCard(movie);
}

function resetPickedMovie() {
  elements.pickedMovie.innerHTML = "<span class=\"muted\">Непросмотренные фильмы ждут своего часа.</span>";
  elements.pickedDetails.hidden = true;
  elements.pickedDetails.innerHTML = "";
}

function openMovieDetailsFromCard(card) {
  const movie = state.movies.find((item) => item.id === Number(card.dataset.id));
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

  const expanded = await getExpandedMovie(movie);
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

function renderMovieDetailsCard(movie, { className = "picked-expanded-card", isLoading = false } = {}) {
  return `
    <article class="${className}">
      <img class="picked-expanded-poster" src="${escapeHtml(movie.poster || PLACEHOLDER_POSTER)}" alt="Постер: ${escapeHtml(movie.title)}">
      <div class="picked-expanded-body">
        <div class="card-topline">
          <span class="year">${escapeHtml(movie.year || "год ?")}</span>
          ${movie.runtime ? `<span class="runtime">${escapeHtml(movie.runtime)}</span>` : ""}
          <span class="rating">${escapeHtml(movie.rating ? `IMDb ${movie.rating}` : "IMDb —")}</span>
        </div>
        <h3>${escapeHtml(movie.title)}</h3>
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

function isCardControlTarget(target) {
  return Boolean(target.closest("button, input, label, select, textarea, a, .card-actions"));
}

function getVisibleMovies() {
  const selected = getSelectedCollection();
  if (!selected) {
    return state.movies;
  }
  const movieIds = new Set(selected.movieIds.map(Number));
  return state.movies.filter((movie) => movieIds.has(movie.id));
}

function getDisplayMovies() {
  let movies = getVisibleMovies();
  if (state.hideWatched) {
    movies = movies.filter((movie) => !movie.watched);
  }
  return movies.filter(matchesLibraryFilters);
}

function matchesLibraryFilters(movie) {
  const search = normalizeSearchText(state.librarySearch);
  if (search) {
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
      .some((value) => normalizeSearchText(value).includes(search));
    if (!hasSearchMatch) {
      return false;
    }
  }

  if (state.libraryFilters.year && getMovieYear(movie) !== state.libraryFilters.year) {
    return false;
  }

  if (!matchesRatingRange(movie.rating, state.libraryFilters.rating)) {
    return false;
  }

  if (state.libraryFilters.genre && !hasMatchingValue(getMovieGenres(movie), state.libraryFilters.genre)) {
    return false;
  }

  if (state.libraryFilters.director && !hasMatchingValue(getMovieDirectors(movie), state.libraryFilters.director)) {
    return false;
  }

  return true;
}

function getRandomMoviePool(source = "library") {
  if (source !== "library") {
    return [];
  }
  return getVisibleMovies().filter((movie) => matchesRandomSettings(movie, { source }));
}

async function pickExternalRandomMovie() {
  const originalText = elements.pickExternalMovie.textContent;
  elements.pickExternalMovie.disabled = true;
  elements.pickExternalMovie.textContent = "Сканирую...";
  elements.pickedMovie.innerHTML = "<span class=\"muted\">Ищу случайный фильм во внешнем каталоге...</span>";
  elements.pickedDetails.hidden = true;
  elements.pickedDetails.innerHTML = "";

  try {
    const picked = await findExternalRandomMovie();
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
    renderPickedDetails(picked);
  } catch (error) {
    elements.pickedMovie.innerHTML = "<span class=\"muted\">Не удалось получить случайный фильм.</span>";
    showMessage(error.message, true);
  } finally {
    elements.pickExternalMovie.disabled = false;
    elements.pickExternalMovie.textContent = originalText;
  }
}

async function findExternalRandomMovie() {
  const queries = shuffleArray(buildExternalRandomQueries());
  const seen = new Set();

  for (const query of queries.slice(0, 10)) {
    const candidates = await tryFetch(() => fetchCinemetaCandidates(query), []);
    for (const candidate of shuffleArray(candidates).slice(0, 8)) {
      const key = candidate.imdbId || `${candidate.title}-${candidate.year}`;
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);

      const movie = await tryFetch(() => fetchMovieDetails(candidate), null);
      if (movie && matchesRandomSettings(movie, { source: "external" })) {
        return movie;
      }
    }
  }

  return null;
}

function buildExternalRandomQueries() {
  const genreQueries = [...state.randomGenreFilters]
    .map((genre) => clean(genre))
    .filter(Boolean);
  return [...genreQueries, ...EXTERNAL_RANDOM_QUERIES];
}

function matchesRandomSettings(movie, { source = "library" } = {}) {
  if (source === "library" && !elements.includeWatchedRandom.checked && movie.watched) {
    return false;
  }

  if (source === "external" && !elements.includeWatchedRandom.checked) {
    const localMatch = findMatchingLocalMovie(movie);
    if (localMatch?.watched) {
      return false;
    }
  }

  if (elements.durationFilterEnabled.checked && !matchesDurationRange(movie.runtime, getSelectedDurationRange())) {
    return false;
  }

  if (!matchesRatingRange(movie.rating, getSelectedRatingRange())) {
    return false;
  }

  if (!matchesRandomGenres(movie)) {
    return false;
  }

  return true;
}

function findMatchingLocalMovie(movie) {
  const imdbId = clean(movie.imdbId);
  if (imdbId) {
    const byImdbId = state.movies.find((item) => item.imdbId === imdbId);
    if (byImdbId) {
      return byImdbId;
    }
  }

  const title = normalizeSearchText(movie.title || movie.originalTitle);
  const year = getMovieYear(movie);
  return state.movies.find((item) => {
    return normalizeSearchText(item.title || item.originalTitle) === title && getMovieYear(item) === year;
  }) || null;
}

function hasActiveRandomFilters() {
  return elements.durationFilterEnabled.checked
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
  const enabled = elements.durationFilterEnabled.checked;
  elements.durationRangeGroup.classList.toggle("is-disabled", !enabled);
  elements.durationRangeGroup.dataset.state = enabled ? "active" : "disabled";
  elements.durationRangeInputs.forEach((input) => {
    input.disabled = !enabled;
  });
}

function getSelectedDurationRange() {
  return [...elements.durationRangeInputs].find((input) => input.checked)?.value || "standard";
}

function getSelectedRatingRange() {
  return [...elements.ratingRangeInputs].find((input) => input.checked)?.value || "any";
}

function matchesDurationRange(runtime, range) {
  const minutes = parseRuntimeMinutes(runtime);
  if (!minutes) {
    return false;
  }
  const bounds = DURATION_RANGES[range] || DURATION_RANGES.standard;
  return (!bounds.min || minutes >= bounds.min) && (!bounds.max || minutes <= bounds.max);
}

function matchesRatingRange(rating, range) {
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

function matchesRandomGenres(movie) {
  if (!state.randomGenreFilters.size) {
    return true;
  }

  return getMovieGenres(movie).some((genre) => hasMatchingValue(state.randomGenreFilters, genre));
}

function parseRatingValue(rating) {
  const match = String(rating || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function getUniqueYears(movies) {
  return [...new Set(movies.map(getMovieYear).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a) || b.localeCompare(a));
}

function getLibraryGenres() {
  return getUniqueGenres(state.movies);
}

function getUniqueGenres(movies) {
  return sortText([...new Set(movies.flatMap(getMovieGenres).filter(Boolean))]);
}

function getUniqueDirectors(movies) {
  return sortText([...new Set(movies.flatMap(getMovieDirectors).filter(Boolean))]);
}

function getMovieGenres(movie) {
  return splitMovieList(movie.genre);
}

function getMovieDirectors(movie) {
  return splitMovieList(movie.director);
}

function getMovieYear(movie) {
  const match = clean(movie.year).match(/\d{4}/);
  return match ? match[0] : clean(movie.year);
}

function splitMovieList(value) {
  return clean(value)
    .split(/[,;•/]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasMatchingValue(values, expectedValue) {
  const expected = normalizeSearchText(expectedValue);
  return [...values].some((value) => normalizeSearchText(value) === expected);
}

function sortText(values) {
  return values.sort((a, b) => a.localeCompare(b, "ru", { sensitivity: "base" }));
}

function shuffleArray(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[randomIndex]] = [copy[randomIndex], copy[index]];
  }
  return copy;
}

function parseRuntimeMinutes(runtime) {
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

function getSelectedCollection() {
  if (state.selectedCollectionId === "all") {
    return null;
  }
  return state.collections.find((collection) => collection.id === state.selectedCollectionId) || null;
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  elements.form.querySelector("button").disabled = isLoading;
  elements.titleInput.disabled = isLoading;
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
    return JSON.parse(localStorage.getItem(USER_STORAGE) || "null");
  } catch {
    return null;
  }
}

function saveUser() {
  localStorage.setItem(USER_STORAGE, JSON.stringify(state.user));
}

function runTerminalReveals(root = document) {
  root.querySelectorAll("[data-terminal-reveal]").forEach((element) => {
    revealTerminalText(element);
  });
}

function revealTerminalText(element) {
  if (element.dataset.revealed === "true") {
    return;
  }

  const text = element.textContent;
  element.dataset.revealed = "true";
  element.textContent = "";

  const spans = [...text].map((char) => {
    const span = document.createElement("span");
    span.dataset.final = char;
    span.textContent = char === " " ? "\u00a0" : char;
    element.append(span);
    return span;
  });

  let frame = 0;
  const settleFrame = 8;
  const interval = window.setInterval(() => {
    spans.forEach((span, index) => {
      const finalChar = span.dataset.final;
      if (finalChar === " " || index < frame - 3) {
        span.textContent = finalChar === " " ? "\u00a0" : finalChar;
        return;
      }
      span.textContent = GLITCH_CHARS[Math.floor(Math.random() * GLITCH_CHARS.length)];
    });

    frame += 1;
    if (frame > spans.length + settleFrame) {
      window.clearInterval(interval);
      spans.forEach((span) => {
        const finalChar = span.dataset.final;
        span.textContent = finalChar === " " ? "\u00a0" : finalChar;
      });
    }
  }, 34);
}

function uniqueCandidates(candidates) {
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

function readBinding(item, key) {
  return item[key]?.value || "";
}

function yearFromDate(value) {
  const match = String(value).match(/\d{4}/);
  return match ? match[0] : "";
}

function joinList(value) {
  return Array.isArray(value) ? value.filter(Boolean).join(", ") : clean(value);
}

async function tryFetch(callback, fallback) {
  try {
    return await callback();
  } catch (error) {
    console.warn(error);
    return fallback;
  }
}

function makeId() {
  if (globalThis.crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  return `movie-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function clean(value) {
  return value && value !== "N/A" ? String(value).trim() : "";
}

function normalizeSearchText(value) {
  return clean(value).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function escapeSparqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
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
