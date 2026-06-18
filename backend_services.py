from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen
import csv
import io
import json
import random
import re
import time


WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql"
WIKIPEDIA_SUMMARY_URL = "https://ru.wikipedia.org/api/rest_v1/page/summary/"
CINEMETA_SEARCH_URL = "https://v3-cinemeta.strem.io/catalog/movie/top/search="
CINEMETA_META_URL = "https://v3-cinemeta.strem.io/meta/movie/"
EXTERNAL_FETCH_TIMEOUT = 7
EXTERNAL_SEARCH_CACHE_TTL = 10 * 60
EXTERNAL_DETAIL_CACHE_TTL = 60 * 60
EXTERNAL_RANDOM_SEARCH_LIMIT = 6
EXTERNAL_RANDOM_DETAIL_LIMIT = 18
EXTERNAL_RANDOM_DETAIL_BATCH_SIZE = 4
EXTERNAL_RANDOM_RECENT_LIMIT = 16
EXTERNAL_RANDOM_QUERIES = [
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
]
EXTERNAL_RANDOM_SHORT_QUERIES = [
    "short film",
    "animated short",
    "documentary short",
    "oscar short film",
    "short movie",
    "short animation",
]
EXTERNAL_RANDOM_HIGH_RATING_QUERIES = [
    "award winning film",
    "best picture",
    "criterion film",
    "classic cinema",
    "acclaimed film",
]
EXTERNAL_RANDOM_YEAR_TERMS = ["movie", "film", "cinema"]
EXTERNAL_RANDOM_MIN_YEAR = 1920
DURATION_RANGES = {
    "short": {"max": 60},
    "standard": {"min": 60, "max": 130},
    "long": {"min": 131},
}
RATING_RANGES = {
    "low": {"max": 5.5},
    "medium": {"min": 5.6, "max": 7.5},
    "high": {"min": 7.6},
}
PLACEHOLDER_POSTER = (
    "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' "
    "viewBox='0 0 120 180'%3E%3Crect width='120' height='180' fill='%23d8d1c6'/%3E"
    "%3Cpath d='M28 43h64v94H28z' fill='none' stroke='%23687076' stroke-width='6'/%3E"
    "%3Cpath d='M43 63h34M43 83h34M43 103h21' stroke='%23687076' stroke-width='6' "
    "stroke-linecap='round'/%3E%3C/svg%3E"
)


_search_cache = {}
_detail_cache = {}


def clean(value):
    return str(value).strip() if value and value != "N/A" else ""


def normalize_search_text(value):
    return re.sub(r"\s+", " ", clean(value).lower().replace("ё", "е")).strip()


def normalize_movie(movie):
    imdb_id = clean(movie.get("imdbId")) or clean(movie.get("imdb_id")) or make_local_movie_id()
    title = clean(movie.get("title")) or clean(movie.get("originalTitle")) or "Без названия"
    poster = clean(movie.get("poster"))
    return {
        "imdbId": imdb_id,
        "title": title,
        "originalTitle": clean(movie.get("originalTitle")),
        "year": clean(movie.get("year")),
        "poster": poster if poster and poster != "N/A" else PLACEHOLDER_POSTER,
        "rating": clean(movie.get("rating")),
        "runtime": clean(movie.get("runtime")),
        "genre": clean(movie.get("genre")),
        "director": clean(movie.get("director")),
        "cast": clean(movie.get("cast")),
        "plot": clean(movie.get("plot")) or "Описание не найдено.",
        "watched": bool(movie.get("watched")),
    }


def make_local_movie_id():
    return f"movie-{int(time.time() * 1000)}-{random.randrange(10**8):08d}"


def get_library_payload(movies, collections, params):
    collection_id = normalize_collection_id(params.get("collectionId", "all"))
    limit = max(1, safe_int(params.get("limit"), 15))
    offset = max(0, safe_int(params.get("offset"), 0))
    filters = {
        "search": params.get("search", ""),
        "year": params.get("year", ""),
        "rating": params.get("rating", ""),
        "genre": params.get("genre", ""),
        "director": params.get("director", ""),
        "hideWatched": is_truthy(params.get("hideWatched")),
    }
    scoped_movies = get_collection_movies(movies, collections, collection_id)
    filtered_movies = filter_library_movies(scoped_movies, filters)
    page_movies = filtered_movies[offset:offset + limit]

    return {
        "movies": page_movies,
        "collections": collections,
        "stats": build_global_stats(movies, collections),
        "scopeStats": build_scope_stats(scoped_movies),
        "filterOptions": build_filter_options(scoped_movies),
        "total": len(filtered_movies),
        "offset": offset,
        "limit": limit,
    }


def normalize_collection_id(value):
    if value in (None, "", "all"):
        return "all"
    try:
        return int(value)
    except (TypeError, ValueError):
        return "all"


def filter_library_movies(movies, filters):
    search = normalize_search_text(filters.get("search"))
    year = clean(filters.get("year"))
    rating = clean(filters.get("rating"))
    genre = clean(filters.get("genre"))
    director = clean(filters.get("director"))
    hide_watched = filters.get("hideWatched")
    result = []

    for movie in movies:
        if hide_watched and movie.get("watched"):
            continue
        if search and not matches_library_search(movie, search):
            continue
        if year and get_movie_year(movie) != year:
            continue
        if rating and not matches_rating_range(movie.get("rating"), rating):
            continue
        if genre and not has_matching_value(get_movie_genres(movie), genre):
            continue
        if director and not has_matching_value(get_movie_directors(movie), director):
            continue
        result.append(movie)

    return result


def matches_library_search(movie, search):
    fields = [
        movie.get("title"),
        movie.get("originalTitle"),
        movie.get("year"),
        movie.get("rating"),
        movie.get("runtime"),
        movie.get("genre"),
        movie.get("director"),
        movie.get("cast"),
        movie.get("plot"),
    ]
    return any(search in normalize_search_text(value) for value in fields if value)


def get_collection_movies(movies, collections, collection_id):
    if collection_id == "all":
        return movies
    selected = next((collection for collection in collections if collection["id"] == collection_id), None)
    if not selected:
        return movies
    movie_ids = {int(movie_id) for movie_id in selected.get("movieIds", [])}
    return [movie for movie in movies if int(movie["id"]) in movie_ids]


def build_global_stats(movies, collections):
    watched = sum(1 for movie in movies if movie.get("watched"))
    in_collections = len({movie_id for collection in collections for movie_id in collection.get("movieIds", [])})
    return {
        "total": len(movies),
        "watched": watched,
        "unwatched": len(movies) - watched,
        "inCollections": in_collections,
    }


def build_scope_stats(movies):
    watched = sum(1 for movie in movies if movie.get("watched"))
    return {
        "total": len(movies),
        "watched": watched,
        "unwatched": len(movies) - watched,
    }


def build_filter_options(movies):
    years = set()
    genres = set()
    directors = set()
    for movie in movies:
        year = get_movie_year(movie)
        if year:
            years.add(year)
        genres.update(get_movie_genres(movie))
        directors.update(get_movie_directors(movie))

    return {
        "years": sorted(years, key=year_sort_key),
        "genres": sort_text(genres),
        "directors": sort_text(directors),
    }


def year_sort_key(year):
    try:
        return (-int(year), year)
    except ValueError:
        return (0, year)


def sort_text(values):
    return sorted((value for value in values if value), key=lambda value: value.casefold())


def preview_import(text, existing_movies):
    parsed = parse_movie_import_text(text)
    existing_ids = {movie.get("imdbId") for movie in existing_movies if movie.get("imdbId")}
    rows = []
    for title in parsed["titles"]:
        row = {
            "title": title,
            "candidates": [],
            "selectedIndex": -1,
            "status": "",
            "error": "",
        }
        try:
            candidates = search_movie_candidates(title)
            row["candidates"] = candidates
            available = [candidate for candidate in candidates if candidate.get("imdbId") not in existing_ids]
            if not candidates:
                row["status"] = "not-found"
                row["error"] = "Не найдено"
            elif not available:
                row["status"] = "duplicate"
                row["error"] = "Уже есть в библиотеке"
            else:
                row["selectedIndex"] = candidates.index(best_import_candidate(title, available))
                row["status"] = "review" if len(candidates) > 1 else "ready"
        except Exception as exc:
            row["status"] = "error"
            row["error"] = str(exc)
        rows.append(row)
    return {"rows": rows, "duplicates": parsed["duplicates"]}


def parse_movie_import_text(text):
    titles = []
    duplicates = []
    seen = set()
    try:
        reader = csv.reader(io.StringIO(text), skipinitialspace=True)
        values = [value for row in reader for value in row]
    except csv.Error:
        raise ValueError("В файле есть незакрытая кавычка.")

    for value in values:
        title = re.sub(r"\s+", " ", value).strip().strip("\"'")
        if not title:
            continue
        key = normalize_search_text(title)
        if key in seen:
            duplicates.append(title)
            continue
        seen.add(key)
        titles.append(title)
    return {"titles": titles, "duplicates": duplicates}


def best_import_candidate(query, candidates):
    iterator = iter(candidates)
    try:
        best_candidate = next(iterator)
    except StopIteration:
        raise IndexError("list index out of range")

    best_score = score_candidate(query, best_candidate)
    for candidate in iterator:
        candidate_score = score_candidate(query, candidate)
        if candidate_score > best_score:
            best_candidate = candidate
            best_score = candidate_score
    return best_candidate


def score_candidate(query, candidate):
    normalized_query = normalize_search_text(query)
    titles = [
        normalize_search_text(value)
        for value in [candidate.get("ruTitle"), candidate.get("title"), candidate.get("enTitle")]
        if value
    ]
    if normalized_query in titles:
        return 100
    if any(title.startswith(normalized_query) or normalized_query.startswith(title) for title in titles):
        return 75
    if any(normalized_query in title or title in normalized_query for title in titles):
        return 50
    return 10


def search_movie_candidates(title, limit=8, enrich_details=False):
    wikidata_candidates = try_value(lambda: fetch_wikidata_candidates(title), [])
    candidates = wikidata_candidates if wikidata_candidates else fetch_cinemeta_candidates(title)
    ranked = sorted(candidates, key=lambda candidate: score_candidate(title, candidate), reverse=True)
    limited = ranked[:max(1, safe_int(limit, 8))]
    if enrich_details:
        return [enrich_search_candidate(candidate) for candidate in limited]
    return limited


def enrich_search_candidate(candidate):
    details = try_value(lambda: fetch_cinemeta_details_by_id(candidate.get("imdbId")), {}) if candidate.get("imdbId") else {}
    return {
        **candidate,
        "year": candidate.get("year") or details.get("year"),
        "poster": candidate.get("poster") or details.get("poster"),
        "rating": details.get("rating") or candidate.get("rating"),
        "runtime": details.get("runtime") or candidate.get("runtime"),
        "genre": details.get("genre") or candidate.get("genre"),
        "director": details.get("director") or candidate.get("director"),
        "cast": details.get("cast") or candidate.get("cast"),
    }


def fetch_movie_details(candidate):
    details = try_value(lambda: fetch_cinemeta_details_by_id(candidate.get("imdbId")), {}) if candidate.get("imdbId") else {}
    russian_plot = try_value(lambda: fetch_russian_summary(candidate.get("wikiTitle")), "") if candidate.get("wikiTitle") else ""
    return normalize_movie({
        "imdbId": candidate.get("imdbId") or details.get("imdbId"),
        "title": candidate.get("ruTitle") or candidate.get("title") or details.get("title"),
        "originalTitle": candidate.get("enTitle") or details.get("title"),
        "year": candidate.get("year") or details.get("year"),
        "poster": details.get("poster") or candidate.get("poster"),
        "rating": details.get("rating"),
        "runtime": details.get("runtime"),
        "genre": details.get("genre"),
        "director": details.get("director"),
        "cast": details.get("cast"),
        "plot": russian_plot or candidate.get("ruDescription") or details.get("plot"),
    })


def get_expanded_movie(movie):
    details = try_value(lambda: fetch_cinemeta_details_by_id(movie.get("imdbId")), {}) if movie.get("imdbId") else {}
    return {
        **details,
        **movie,
        "runtime": movie.get("runtime") or details.get("runtime") or "",
        "genre": movie.get("genre") or details.get("genre") or "",
        "director": movie.get("director") or details.get("director") or "",
        "cast": movie.get("cast") or details.get("cast") or "",
        "plot": movie.get("plot") or details.get("plot") or "Описание не найдено.",
    }


def fetch_wikidata_candidates(title):
    query = f"""
    SELECT ?item ?itemLabel ?itemDescription ?imdbId ?date ?ruwikiTitle ?enLabel WHERE {{
      SERVICE wikibase:mwapi {{
        bd:serviceParam wikibase:endpoint "www.wikidata.org";
          wikibase:api "EntitySearch";
          mwapi:search "{escape_sparql_string(title)}";
          mwapi:language "ru";
          mwapi:limit "10".
        ?item wikibase:apiOutputItem mwapi:item.
      }}
      ?item wdt:P31/wdt:P279* wd:Q11424.
      ?item wdt:P345 ?imdbId.
      OPTIONAL {{ ?item wdt:P577 ?date. }}
      OPTIONAL {{
        ?ruwiki schema:about ?item;
          schema:isPartOf <https://ru.wikipedia.org/>;
          schema:name ?ruwikiTitle.
      }}
      OPTIONAL {{ ?item rdfs:label ?enLabel FILTER(LANG(?enLabel) = "en") }}
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ru,en". }}
    }}
    LIMIT 12
    """
    data = fetch_json(f"{WIKIDATA_SPARQL_URL}?{urlencode({'query': query, 'format': 'json'})}", "Wikidata не ответила.")
    return unique_candidates([
        {
            "source": "wikidata",
            "imdbId": read_binding(item, "imdbId"),
            "title": read_binding(item, "itemLabel"),
            "ruTitle": read_binding(item, "itemLabel"),
            "enTitle": read_binding(item, "enLabel"),
            "ruDescription": read_binding(item, "itemDescription"),
            "wikiTitle": read_binding(item, "ruwikiTitle"),
            "year": year_from_date(read_binding(item, "date")),
        }
        for item in data.get("results", {}).get("bindings", [])
    ])[:8]


def fetch_cinemeta_candidates(title):
    cache_key = normalize_search_text(title)
    return cached_value(_search_cache, cache_key, EXTERNAL_SEARCH_CACHE_TTL, lambda: _fetch_cinemeta_candidates(title))


def _fetch_cinemeta_candidates(title):
    data = fetch_json(
        f"{CINEMETA_SEARCH_URL}{quote(title)}.json",
        "Не удалось получить данные о фильме. Попробуйте позже.",
    )
    return unique_candidates([
        {
            "source": "cinemeta",
            "imdbId": item.get("imdb_id") or item.get("id"),
            "title": item.get("name"),
            "enTitle": item.get("name"),
            "year": item.get("releaseInfo") or item.get("year"),
            "poster": item.get("poster"),
            "ruDescription": "Cinemeta",
        }
        for item in data.get("metas", [])
        if item.get("type") == "movie"
    ])[:12]


def fetch_cinemeta_details_by_id(imdb_id):
    cache_key = clean(imdb_id)
    return cached_value(_detail_cache, cache_key, EXTERNAL_DETAIL_CACHE_TTL, lambda: _fetch_cinemeta_details_by_id(imdb_id))


def _fetch_cinemeta_details_by_id(imdb_id):
    data = fetch_json(f"{CINEMETA_META_URL}{quote(imdb_id)}.json", "Cinemeta не ответила.")
    details = data.get("meta", {}) or {}
    return {
        "imdbId": details.get("imdb_id") or details.get("id") or imdb_id,
        "title": details.get("name"),
        "year": details.get("year") or details.get("releaseInfo"),
        "poster": details.get("poster"),
        "rating": details.get("imdbRating"),
        "runtime": details.get("runtime"),
        "genre": join_list(details.get("genre") or details.get("genres")),
        "director": join_list(details.get("director")),
        "cast": join_list(details.get("cast")),
        "plot": details.get("description") or details.get("plot"),
    }


def fetch_russian_summary(wiki_title):
    data = fetch_json(f"{WIKIPEDIA_SUMMARY_URL}{quote(wiki_title)}", "Wikipedia не ответила.")
    return clean(data.get("extract"))


def fetch_json(url, error_message):
    request = Request(url, headers={"User-Agent": "FilmRandomizer/1.0"})
    try:
        with urlopen(request, timeout=EXTERNAL_FETCH_TIMEOUT) as response:
            if response.status >= 400:
                raise RuntimeError(error_message)
            return json.loads(response.read().decode("utf-8"))
    except TimeoutError:
        raise RuntimeError("Запрос занял слишком много времени.")
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            raise
        raise RuntimeError(error_message)


def cached_value(cache, key, ttl, loader):
    now = time.time()
    cached = cache.get(key)
    if cached and now - cached["created_at"] < ttl:
        return cached["value"]
    value = loader()
    cache[key] = {"created_at": now, "value": value}
    return value


def pick_library_random(movies, collections, payload):
    collection_id = normalize_collection_id(payload.get("collectionId", "all"))
    settings = normalize_random_settings(payload)
    scoped_movies = get_collection_movies(movies, collections, collection_id)
    pool = [
        movie
        for movie in scoped_movies
        if matches_random_settings(movie, "library", movies, settings)
    ]
    if not pool:
        return {"movie": None, "recentLibraryRandomIds": payload.get("recentLibraryRandomIds", [])}

    recent_ids = [int(value) for value in payload.get("recentLibraryRandomIds", []) if str(value).isdigit()]
    recent_set = set(recent_ids)
    fresh_pool = [movie for movie in pool if movie.get("id") not in recent_set] if len(pool) > 1 else pool
    source_pool = fresh_pool or pool
    movie = random.choice(source_pool)
    recent_ids = remember_library_random_movie(movie, len(pool), recent_ids)
    return {
        "movie": get_expanded_movie(movie),
        "recentLibraryRandomIds": recent_ids,
    }


def pick_external_random(movies, payload):
    settings = normalize_random_settings(payload)
    recent_keys = [clean(value) for value in payload.get("recentExternalRandomKeys", []) if clean(value)]
    recent_key_set = set(recent_keys)
    local_movie_index = build_local_movie_index(movies)
    queries = build_external_random_queries(settings)
    random.shuffle(queries)
    search_results = [try_value(lambda query=query: fetch_cinemeta_candidates(query), []) for query in queries[:EXTERNAL_RANDOM_SEARCH_LIMIT]]
    candidates = collect_external_random_candidates(search_results)
    fresh_candidates, recent_candidates = split_external_candidates_by_recency(candidates, recent_key_set)
    candidate_pool = (fresh_candidates + recent_candidates)[:EXTERNAL_RANDOM_DETAIL_LIMIT]
    fallback = None

    for index in range(0, len(candidate_pool), EXTERNAL_RANDOM_DETAIL_BATCH_SIZE):
        batch = candidate_pool[index:index + EXTERNAL_RANDOM_DETAIL_BATCH_SIZE]
        details = [try_value(lambda candidate=candidate: fetch_movie_details(candidate), None) for candidate in batch]
        matches = [
            movie
            for movie in details
            if movie and matches_random_settings(movie, "external", movies, settings, local_movie_index)
        ]
        random.shuffle(matches)
        fresh_match = next((movie for movie in matches if not is_recent_external(movie, recent_key_set)), None)
        if fresh_match:
            return {
                "movie": fresh_match,
                "recentExternalRandomKeys": remember_external_random_movie(fresh_match, recent_keys),
            }
        if not fallback and matches:
            fallback = matches[0]

    if fallback:
        return {
            "movie": fallback,
            "recentExternalRandomKeys": remember_external_random_movie(fallback, recent_keys),
        }
    return {"movie": None, "recentExternalRandomKeys": recent_keys}


def normalize_random_settings(payload):
    return {
        "includeWatched": bool(payload.get("includeWatched")),
        "durationFilterEnabled": bool(payload.get("durationFilterEnabled")),
        "durationRange": payload.get("durationRange") or "standard",
        "ratingRange": payload.get("ratingRange") or "any",
        "genreFilters": set(payload.get("genreFilters") or []),
    }


def matches_random_settings(movie, source, local_movies, settings, local_movie_index=None):
    if source == "library" and not settings["includeWatched"] and movie.get("watched"):
        return False
    if source == "external" and not settings["includeWatched"]:
        local_match = find_matching_local_movie(local_movies, movie, local_movie_index)
        if local_match and local_match.get("watched"):
            return False
    if settings["durationFilterEnabled"] and not matches_duration_range(movie.get("runtime"), settings["durationRange"]):
        return False
    if not matches_rating_range(movie.get("rating"), settings["ratingRange"]):
        return False
    if settings["genreFilters"] and not any(has_matching_value(settings["genreFilters"], genre) for genre in get_movie_genres(movie)):
        return False
    return True


def build_local_movie_index(local_movies):
    by_imdb = {}
    by_title_year = {}
    for item in local_movies:
        imdb_id = clean(item.get("imdbId"))
        if imdb_id and imdb_id not in by_imdb:
            by_imdb[imdb_id] = item
        title_year_key = get_title_year_key(item)
        if title_year_key not in by_title_year:
            by_title_year[title_year_key] = item
    return {"by_imdb": by_imdb, "by_title_year": by_title_year}


def get_title_year_key(movie):
    return (
        normalize_search_text(movie.get("title") or movie.get("originalTitle")),
        get_movie_year(movie),
    )


def find_matching_local_movie(local_movies, movie, local_movie_index=None):
    imdb_id = clean(movie.get("imdbId"))
    if imdb_id:
        if local_movie_index:
            match = local_movie_index["by_imdb"].get(imdb_id)
            if match:
                return match
        match = next((item for item in local_movies if item.get("imdbId") == imdb_id), None)
        if match:
            return match
    if local_movie_index:
        return local_movie_index["by_title_year"].get(get_title_year_key(movie))
    title, year = get_title_year_key(movie)
    return next(
        (
            item for item in local_movies
            if normalize_search_text(item.get("title") or item.get("originalTitle")) == title
            and get_movie_year(item) == year
        ),
        None,
    )


def remember_library_random_movie(movie, pool_size, recent_ids):
    if not movie.get("id"):
        return recent_ids
    limit = min(EXTERNAL_RANDOM_RECENT_LIMIT, max(1, pool_size // 2))
    return [movie["id"]] + [movie_id for movie_id in recent_ids if movie_id != movie["id"]][:limit - 1]


def build_external_random_queries(settings):
    genre_queries = [clean(genre) for genre in settings["genreFilters"] if clean(genre)]
    return unique_queries(
        genre_queries
        + build_external_random_filter_queries(settings)
        + EXTERNAL_RANDOM_QUERIES
        + build_external_random_year_queries(genre_queries)
    )


def build_external_random_filter_queries(settings):
    queries = []
    if settings["durationFilterEnabled"] and settings["durationRange"] == "short":
        queries.extend(EXTERNAL_RANDOM_SHORT_QUERIES)
    if settings["ratingRange"] == "high":
        queries.extend(EXTERNAL_RANDOM_HIGH_RATING_QUERIES)
    if settings["durationFilterEnabled"] and settings["durationRange"] == "short" and settings["ratingRange"] == "high":
        queries.extend(["best short film", "award winning short film", "oscar winning short film"])
    return queries


def build_external_random_year_queries(genre_queries):
    terms = genre_queries or EXTERNAL_RANDOM_YEAR_TERMS
    current_year = time.localtime().tm_year
    years = [random.randint(EXTERNAL_RANDOM_MIN_YEAR, current_year) for _ in range(4)]
    return [f"{terms[index % len(terms)]} {year}" for index, year in enumerate(years)]


def collect_external_random_candidates(search_results):
    seen = set()
    candidates = [candidate for result in search_results for candidate in result]
    random.shuffle(candidates)
    unique = []
    for candidate in candidates:
        key = get_external_movie_key(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def split_external_candidates_by_recency(candidates, recent_keys):
    fresh_candidates = []
    recent_candidates = []
    for candidate in candidates:
        if is_recent_external(candidate, recent_keys):
            recent_candidates.append(candidate)
        else:
            fresh_candidates.append(candidate)
    return fresh_candidates, recent_candidates


def get_external_movie_key(movie):
    imdb_id = clean(movie.get("imdbId"))
    if imdb_id:
        return imdb_id
    title = normalize_search_text(movie.get("title") or movie.get("originalTitle") or movie.get("ruTitle") or movie.get("enTitle"))
    year = get_movie_year(movie)
    return f"{title}-{year}" if title else ""


def is_recent_external(movie, recent_keys):
    key = get_external_movie_key(movie)
    return key in recent_keys if key else False


def remember_external_random_movie(movie, recent_keys):
    key = get_external_movie_key(movie)
    if not key:
        return recent_keys
    return [key] + [item for item in recent_keys if item != key][:EXTERNAL_RANDOM_RECENT_LIMIT - 1]


def get_movie_year(movie):
    match = re.search(r"\d{4}", clean(movie.get("year")))
    return match.group(0) if match else clean(movie.get("year"))


def get_movie_genres(movie):
    return split_movie_list(movie.get("genre"))


def get_movie_directors(movie):
    return split_movie_list(movie.get("director"))


def split_movie_list(value):
    return [item.strip() for item in re.split(r"[,;•/]+", clean(value)) if item.strip()]


def has_matching_value(values, expected_value):
    expected = normalize_search_text(expected_value)
    return any(normalize_search_text(value) == expected for value in values)


def matches_duration_range(runtime, range_name):
    minutes = parse_runtime_minutes(runtime)
    if not minutes:
        return False
    bounds = DURATION_RANGES.get(range_name) or DURATION_RANGES["standard"]
    return (not bounds.get("min") or minutes >= bounds["min"]) and (not bounds.get("max") or minutes <= bounds["max"])


def parse_runtime_minutes(runtime):
    text = clean(runtime).lower()
    if not text:
        return None
    iso = re.search(r"pt(?:(\d+)h)?(?:(\d+)m)?", text, re.I)
    if iso and (iso.group(1) or iso.group(2)):
        return int(iso.group(1) or 0) * 60 + int(iso.group(2) or 0)
    hours = re.search(r"(\d+)\s*(?:h|hr|hrs|hour|hours|ч|час|часа|часов)", text, re.I)
    minutes = re.search(r"(\d+)\s*(?:m|min|mins|minute|minutes|м|мин|минута|минуты|минут)", text, re.I)
    if hours or minutes:
        return int(hours.group(1) if hours else 0) * 60 + int(minutes.group(1) if minutes else 0)
    plain = re.search(r"\b(\d{1,3})\b", text)
    return int(plain.group(1)) if plain else None


def matches_rating_range(rating, range_name):
    if not range_name or range_name == "any":
        return True
    rating_value = parse_rating_value(rating)
    if rating_value is None:
        return False
    bounds = RATING_RANGES.get(range_name)
    if not bounds:
        return True
    return (not bounds.get("min") or rating_value >= bounds["min"]) and (not bounds.get("max") or rating_value <= bounds["max"])


def parse_rating_value(rating):
    match = re.search(r"\d+(?:\.\d+)?", clean(rating).replace(",", "."))
    return float(match.group(0)) if match else None


def unique_candidates(candidates):
    seen = set()
    unique = []
    for candidate in candidates:
        key = candidate.get("imdbId") or f"{candidate.get('title')}-{candidate.get('year')}"
        if not key or key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def unique_queries(queries):
    seen = set()
    unique = []
    for query in queries:
        normalized = normalize_search_text(query)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(query)
    return unique


def read_binding(item, key):
    return item.get(key, {}).get("value", "")


def year_from_date(value):
    match = re.search(r"\d{4}", str(value))
    return match.group(0) if match else ""


def join_list(value):
    if isinstance(value, list):
        return ", ".join(clean(item) for item in value if clean(item))
    return clean(value)


def escape_sparql_string(value):
    return str(value).replace("\\", "\\\\").replace('"', '\\"')


def safe_int(value, fallback=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def is_truthy(value):
    return str(value).lower() in {"1", "true", "yes", "on"}


def try_value(callback, fallback):
    try:
        return callback()
    except Exception:
        return fallback
