from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import argparse
import hashlib
import json
import mimetypes
import sqlite3
import sys
import time

from backend_services import (
    fetch_movie_details,
    find_matching_local_movie,
    get_expanded_movie,
    get_library_payload,
    normalize_movie,
    pick_external_random,
    pick_library_random,
    preview_import,
    search_movie_candidates,
)


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "filmrandomizer.sqlite"


def now_ts():
    return int(time.time())


def password_hash(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def normalize_username(username):
    return str(username).strip().lower()


def connect_db():
    DATA_DIR.mkdir(exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def init_db():
    with connect_db() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              username TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS movies (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              imdb_id TEXT NOT NULL,
              title TEXT NOT NULL,
              original_title TEXT,
              year TEXT,
              poster TEXT,
              rating TEXT,
              runtime TEXT,
              genre TEXT,
              director TEXT,
              cast TEXT,
              plot TEXT,
              watched INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
              UNIQUE (user_id, imdb_id)
            );

            CREATE TABLE IF NOT EXISTS collections (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_id INTEGER NOT NULL,
              name TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS collection_movies (
              collection_id INTEGER NOT NULL,
              movie_id INTEGER NOT NULL,
              PRIMARY KEY (collection_id, movie_id),
              FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
              FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
            );
            """
        )
        movie_columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(movies)")
        }
        if "cast" not in movie_columns:
            db.execute("ALTER TABLE movies ADD COLUMN cast TEXT")


def row_to_movie(row):
    return {
        "id": row["id"],
        "imdbId": row["imdb_id"],
        "title": row["title"],
        "originalTitle": row["original_title"] or "",
        "year": row["year"] or "",
        "poster": row["poster"] or "",
        "rating": row["rating"] or "",
        "runtime": row["runtime"] or "",
        "genre": row["genre"] or "",
        "director": row["director"] or "",
        "cast": row["cast"] or "",
        "plot": row["plot"] or "",
        "watched": bool(row["watched"]),
        "createdAt": row["created_at"],
    }


def row_to_collection(row, movie_ids):
    return {
        "id": row["id"],
        "name": row["name"],
        "movieIds": movie_ids,
        "movieCount": len(movie_ids),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def json_error(message, status=400):
    return status, {"error": message}


def export_database(path):
    init_db()
    tables = ["users", "movies", "collections", "collection_movies"]
    with connect_db() as db:
        payload = {
            "version": 1,
            "exportedAt": now_ts(),
            "tables": {
                table: [dict(row) for row in db.execute(f"SELECT * FROM {table}")]
                for table in tables
            },
        }
    Path(path).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def import_database(path):
    init_db()
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    tables = payload.get("tables", {})
    with connect_db() as db:
        db.execute("DELETE FROM collection_movies")
        db.execute("DELETE FROM collections")
        db.execute("DELETE FROM movies")
        db.execute("DELETE FROM users")
        for table in ["users", "movies", "collections", "collection_movies"]:
            for row in tables.get(table, []):
                columns = list(row.keys())
                placeholders = ", ".join("?" for _ in columns)
                db.execute(
                    f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
                    [row[column] for column in columns],
                )


class Handler(SimpleHTTPRequestHandler):
    server_version = "FilmRandomizer/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/library":
            self.handle_library(parsed)
            return
        if parsed.path == "/api/library/movie-picker":
            self.handle_library_movie_picker(parsed)
            return
        if parsed.path == "/api/catalog/search":
            self.handle_catalog_search(parsed)
            return
        if parsed.path.startswith("/api/movies/") and parsed.path.endswith("/details"):
            self.handle_movie_details(parsed.path)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/users":
            self.handle_create_user()
        elif parsed.path == "/api/login":
            self.handle_login()
        elif parsed.path == "/api/movies":
            self.handle_create_movie()
        elif parsed.path == "/api/movies/from-candidate":
            self.handle_create_movie_from_candidate()
        elif parsed.path == "/api/catalog/details":
            self.handle_catalog_details()
        elif parsed.path == "/api/discovery/random":
            self.handle_random_discovery()
        elif parsed.path == "/api/import/preview":
            self.handle_import_preview()
        elif parsed.path == "/api/collections":
            self.handle_create_collection()
        else:
            self.send_json(*json_error("Маршрут не найден.", 404))

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/movies/"):
            self.handle_update_movie(parsed.path)
        elif parsed.path.startswith("/api/collections/"):
            self.handle_update_collection(parsed.path)
        else:
            self.send_json(*json_error("Маршрут не найден.", 404))

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/movies/"):
            self.handle_delete_movie(parsed.path)
        elif parsed.path.startswith("/api/collections/"):
            self.handle_delete_collection(parsed.path)
        else:
            self.send_json(*json_error("Маршрут не найден.", 404))

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if not length:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_static(self, path):
        target = "index.html" if path in ("", "/") else path.lstrip("/")
        file_path = (ROOT / target).resolve()
        if not str(file_path).startswith(str(ROOT)) or not file_path.is_file():
            self.send_error(404)
            return

        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def get_user_id(self):
        value = self.headers.get("X-User-Id")
        if not value:
            return None
        try:
            return int(value)
        except ValueError:
            return None

    def require_user(self, db):
        user_id = self.get_user_id()
        if not user_id:
            return None
        row = db.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        return user_id if row else None

    def handle_create_user(self):
        data = self.read_json()
        username = normalize_username(data.get("username", ""))
        password = str(data.get("password", ""))
        if not username or not password:
            self.send_json(*json_error("Введите логин и пароль."))
            return

        try:
            with connect_db() as db:
                existing = db.execute(
                    "SELECT id FROM users WHERE lower(username) = ?",
                    (username,),
                ).fetchone()
                if existing:
                    self.send_json(*json_error("Такой пользователь уже существует.", 409))
                    return
                cursor = db.execute(
                    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, password_hash(password), now_ts()),
                )
                user = {"id": cursor.lastrowid, "username": username}
            self.send_json(201, {"user": user})
        except sqlite3.IntegrityError:
            self.send_json(*json_error("Такой пользователь уже существует.", 409))

    def handle_login(self):
        data = self.read_json()
        username = normalize_username(data.get("username", ""))
        password = str(data.get("password", ""))
        with connect_db() as db:
            row = db.execute(
                "SELECT id, username FROM users WHERE lower(username) = ? AND password_hash = ?",
                (username, password_hash(password)),
            ).fetchone()
        if not row:
            self.send_json(*json_error("Неверный логин или пароль.", 401))
            return
        self.send_json(200, {"user": {"id": row["id"], "username": row["username"]}})

    def handle_update_movie(self, path):
        movie_id = parse_path_id(path)
        if movie_id is None:
            self.send_json(*json_error("Фильм не найден.", 404))
            return
        data = self.read_json()
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("Нужно войти.", 401))
                return
            db.execute(
                "UPDATE movies SET watched = ? WHERE id = ? AND user_id = ?",
                (1 if data.get("watched") else 0, movie_id, user_id),
            )
            row = db.execute(
                "SELECT * FROM movies WHERE id = ? AND user_id = ?",
                (movie_id, user_id),
            ).fetchone()
        if not row:
            self.send_json(*json_error("Фильм не найден.", 404))
            return
        self.send_json(200, {"movie": row_to_movie(row)})

    def handle_delete_movie(self, path):
        movie_id = parse_path_id(path)
        if movie_id is None:
            self.send_json(*json_error("Фильм не найден.", 404))
            return
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("Нужно войти.", 401))
                return
            db.execute("DELETE FROM movies WHERE id = ? AND user_id = ?", (movie_id, user_id))
        self.send_json(200, {"ok": True})

    def handle_create_collection(self):
        data = self.read_json()
        name = str(data.get("name", "")).strip()
        movie_ids = safe_ids(data.get("movieIds", []))
        if not name:
            self.send_json(*json_error("Введите название коллекции."))
            return

        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("Нужно войти.", 401))
                return
            timestamp = now_ts()
            cursor = db.execute(
                "INSERT INTO collections (user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (user_id, name, timestamp, timestamp),
            )
            collection_id = cursor.lastrowid
            replace_collection_movies(db, user_id, collection_id, movie_ids)
            row = db.execute("SELECT * FROM collections WHERE id = ?", (collection_id,)).fetchone()
            ids = get_collection_movie_ids(db, collection_id)
        self.send_json(201, {"collection": row_to_collection(row, ids)})

    def handle_update_collection(self, path):
        collection_id = parse_path_id(path)
        if collection_id is None:
            self.send_json(*json_error("Коллекция не найдена.", 404))
            return
        data = self.read_json()
        name = str(data.get("name", "")).strip()
        movie_ids = safe_ids(data.get("movieIds", []))
        if not name:
            self.send_json(*json_error("Введите название коллекции."))
            return

        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("Нужно войти.", 401))
                return
            db.execute(
                "UPDATE collections SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                (name, now_ts(), collection_id, user_id),
            )
            replace_collection_movies(db, user_id, collection_id, movie_ids)
            row = db.execute(
                "SELECT * FROM collections WHERE id = ? AND user_id = ?",
                (collection_id, user_id),
            ).fetchone()
            ids = get_collection_movie_ids(db, collection_id)
        if not row:
            self.send_json(*json_error("Коллекция не найдена.", 404))
            return
        self.send_json(200, {"collection": row_to_collection(row, ids)})

    def handle_delete_collection(self, path):
        collection_id = parse_path_id(path)
        if collection_id is None:
            self.send_json(*json_error("Коллекция не найдена.", 404))
            return
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("Нужно войти.", 401))
                return
            db.execute(
                "DELETE FROM collections WHERE id = ? AND user_id = ?",
                (collection_id, user_id),
            )
        self.send_json(200, {"ok": True})

    def handle_library(self, parsed):
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            movies = get_user_movies(db, user_id)
            collections = get_user_collections(db, user_id)
            payload = get_library_payload(movies, collections, read_query(parsed))
        self.send_json(200, payload)

    def handle_library_movie_picker(self, parsed):
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            movies = get_user_movies(db, user_id)
            query = read_query(parsed).get("search", "")
            if query:
                payload = get_library_payload(
                    movies,
                    get_user_collections(db, user_id),
                    {"search": query, "limit": str(max(len(movies), 1))},
                )
                movies = payload["movies"]
        self.send_json(200, {"movies": movies})

    def handle_catalog_search(self, parsed):
        query = read_query(parsed).get("q", "").strip()
        if not query:
            self.send_json(*json_error("Р’РІРµРґРёС‚Рµ РЅР°Р·РІР°РЅРёРµ С„РёР»СЊРјР°."))
            return
        try:
            self.send_json(200, {"candidates": search_movie_candidates(query)})
        except Exception as error:
            self.send_json(*json_error(str(error)))

    def handle_catalog_details(self):
        data = self.read_json()
        candidate = data.get("candidate") or data
        if not isinstance(candidate, dict):
            self.send_json(*json_error("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґР°РЅРЅС‹С… С„РёР»СЊРјР°."))
            return
        try:
            self.send_json(200, {"movie": fetch_movie_details(candidate)})
        except Exception as error:
            self.send_json(*json_error(str(error)))

    def handle_movie_details(self, path):
        movie_id = parse_path_id(path.removesuffix("/details"))
        if movie_id is None:
            self.send_json(*json_error("Р¤РёР»СЊРј РЅРµ РЅР°Р№РґРµРЅ.", 404))
            return
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            row = db.execute(
                "SELECT * FROM movies WHERE id = ? AND user_id = ?",
                (movie_id, user_id),
            ).fetchone()
        if not row:
            self.send_json(*json_error("Р¤РёР»СЊРј РЅРµ РЅР°Р№РґРµРЅ.", 404))
            return
        self.send_json(200, {"movie": get_expanded_movie(row_to_movie(row))})

    def handle_create_movie(self):
        data = self.read_json()
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            try:
                result = save_movie_for_user(db, user_id, normalize_movie(data), data.get("collectionId"))
            except Exception as error:
                self.send_json(*json_error(str(error)))
                return
        self.send_json(200 if result["alreadyInLibrary"] else 201, result)

    def handle_create_movie_from_candidate(self):
        data = self.read_json()
        candidate = data.get("candidate") or {}
        if not isinstance(candidate, dict):
            self.send_json(*json_error("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґР°РЅРЅС‹С… С„РёР»СЊРјР°."))
            return
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            existing = find_matching_local_movie(get_user_movies(db, user_id), movie_lookup_from_candidate(candidate))
            try:
                movie = existing if existing else fetch_movie_details(candidate)
                result = save_movie_for_user(db, user_id, movie, data.get("collectionId"))
            except Exception as error:
                self.send_json(*json_error(str(error)))
                return
        self.send_json(200 if result["alreadyInLibrary"] else 201, result)

    def handle_random_discovery(self):
        data = self.read_json()
        source = data.get("source") or "library"
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            movies = get_user_movies(db, user_id)
            collections = get_user_collections(db, user_id)
        try:
            if source == "external":
                result = pick_external_random(movies, data)
            else:
                result = pick_library_random(movies, collections, data)
            self.send_json(200, result)
        except Exception as error:
            self.send_json(*json_error(str(error)))

    def handle_import_preview(self):
        data = self.read_json()
        text = str(data.get("text") or "")
        if not text.strip():
            self.send_json(*json_error("Р’ С„Р°Р№Р»Рµ РЅРµ РЅР°Р№РґРµРЅРѕ РЅР°Р·РІР°РЅРёР№ С„РёР»СЊРјРѕРІ."))
            return
        with connect_db() as db:
            user_id = self.require_user(db)
            if not user_id:
                self.send_json(*json_error("РќСѓР¶РЅРѕ РІРѕР№С‚Рё.", 401))
                return
            movies = get_user_movies(db, user_id)
        try:
            self.send_json(200, preview_import(text, movies))
        except Exception as error:
            self.send_json(*json_error(str(error)))


def parse_path_id(path):
    try:
        return int(path.rsplit("/", 1)[-1])
    except (TypeError, ValueError):
        return None


def read_query(parsed):
    return {
        key: values[-1]
        for key, values in parse_qs(parsed.query, keep_blank_values=True).items()
    }


def get_user_movies(db, user_id):
    return [
        row_to_movie(row)
        for row in db.execute(
            "SELECT * FROM movies WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            (user_id,),
        )
    ]


def get_user_collections(db, user_id):
    collection_rows = list(
        db.execute(
            "SELECT * FROM collections WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
            (user_id,),
        )
    )
    membership = {}
    for row in db.execute(
        """
        SELECT cm.collection_id, cm.movie_id
        FROM collection_movies cm
        JOIN collections c ON c.id = cm.collection_id
        WHERE c.user_id = ?
        """,
        (user_id,),
    ):
        membership.setdefault(row["collection_id"], []).append(row["movie_id"])
    return [
        row_to_collection(row, membership.get(row["id"], []))
        for row in collection_rows
    ]


def save_movie_for_user(db, user_id, movie, collection_id=None):
    imdb_id = str(movie.get("imdbId", "")).strip()
    title = str(movie.get("title", "")).strip()
    if not imdb_id or not title:
        raise ValueError("РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґР°РЅРЅС‹С… С„РёР»СЊРјР°.")

    existing = db.execute(
        "SELECT * FROM movies WHERE user_id = ? AND imdb_id = ?",
        (user_id, imdb_id),
    ).fetchone()
    already_exists = bool(existing)

    if existing:
        row = existing
    else:
        cursor = db.execute(
            """
            INSERT INTO movies (
              user_id, imdb_id, title, original_title, year, poster, rating,
              runtime, genre, director, cast, plot, watched, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                imdb_id,
                title,
                movie.get("originalTitle") or "",
                movie.get("year") or "",
                movie.get("poster") or "",
                movie.get("rating") or "",
                movie.get("runtime") or "",
                movie.get("genre") or "",
                movie.get("director") or "",
                movie.get("cast") or "",
                movie.get("plot") or "",
                1 if movie.get("watched") else 0,
                now_ts(),
            ),
        )
        row = db.execute("SELECT * FROM movies WHERE id = ?", (cursor.lastrowid,)).fetchone()

    attachment = attach_movie_to_collection(db, user_id, row["id"], collection_id)
    return {
        "movie": row_to_movie(row),
        "alreadyInLibrary": already_exists,
        "collectionName": attachment["name"],
        "attachedToCollection": attachment["added"],
    }


def attach_movie_to_collection(db, user_id, movie_id, collection_id):
    parsed_collection_id = parse_optional_int(collection_id)
    if not parsed_collection_id:
        return {"name": "", "added": False}

    collection = db.execute(
        "SELECT * FROM collections WHERE id = ? AND user_id = ?",
        (parsed_collection_id, user_id),
    ).fetchone()
    if not collection:
        return {"name": "", "added": False}

    existing = db.execute(
        "SELECT 1 FROM collection_movies WHERE collection_id = ? AND movie_id = ?",
        (parsed_collection_id, movie_id),
    ).fetchone()
    if existing:
        return {"name": collection["name"], "added": False}

    db.execute(
        "INSERT OR IGNORE INTO collection_movies (collection_id, movie_id) VALUES (?, ?)",
        (parsed_collection_id, movie_id),
    )
    db.execute(
        "UPDATE collections SET updated_at = ? WHERE id = ? AND user_id = ?",
        (now_ts(), parsed_collection_id, user_id),
    )
    return {"name": collection["name"], "added": True}


def parse_optional_int(value):
    if value in (None, "", "all"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def movie_lookup_from_candidate(candidate):
    return {
        "imdbId": candidate.get("imdbId"),
        "title": candidate.get("ruTitle") or candidate.get("title"),
        "originalTitle": candidate.get("enTitle") or candidate.get("title"),
        "year": candidate.get("year"),
    }


def safe_ids(values):
    ids = []
    for value in values if isinstance(values, list) else []:
        try:
            ids.append(int(value))
        except (TypeError, ValueError):
            pass
    return ids


def replace_collection_movies(db, user_id, collection_id, movie_ids):
    collection = db.execute(
        "SELECT id FROM collections WHERE id = ? AND user_id = ?",
        (collection_id, user_id),
    ).fetchone()
    if not collection:
        return

    db.execute("DELETE FROM collection_movies WHERE collection_id = ?", (collection_id,))
    if not movie_ids:
        return

    owned_ids = {
        row["id"]
        for row in db.execute(
            f"SELECT id FROM movies WHERE user_id = ? AND id IN ({','.join('?' for _ in movie_ids)})",
            [user_id, *movie_ids],
        )
    }
    db.executemany(
        "INSERT OR IGNORE INTO collection_movies (collection_id, movie_id) VALUES (?, ?)",
        [(collection_id, movie_id) for movie_id in movie_ids if movie_id in owned_ids],
    )


def get_collection_movie_ids(db, collection_id):
    return [
        row["movie_id"]
        for row in db.execute(
            "SELECT movie_id FROM collection_movies WHERE collection_id = ? ORDER BY movie_id",
            (collection_id,),
        )
    ]


def main():
    parser = argparse.ArgumentParser(description="Film Randomizer local server")
    parser.add_argument("command", nargs="?", choices=["serve", "export", "import"], default="serve")
    parser.add_argument("path", nargs="?")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    if args.command == "export":
        if not args.path:
            print("Укажите путь JSON-файла для экспорта.", file=sys.stderr)
            sys.exit(2)
        export_database(args.path)
        print(f"Экспортировано: {args.path}")
        return

    if args.command == "import":
        if not args.path:
            print("Укажите путь JSON-файла для импорта.", file=sys.stderr)
            sys.exit(2)
        import_database(args.path)
        print(f"Импортировано: {args.path}")
        return

    init_db()
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Film Randomizer: http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
