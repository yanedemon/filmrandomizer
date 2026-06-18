import unittest

from backend_services import (
    best_import_candidate,
    build_filter_options,
    build_local_movie_index,
    filter_library_movies,
    find_matching_local_movie,
    matches_random_settings,
    split_external_candidates_by_recency,
)


class BestImportCandidateTests(unittest.TestCase):
    def test_prefers_highest_scoring_candidate(self):
        candidates = [
            {"title": "Casino Royale", "imdbId": "tt0381061"},
            {"ruTitle": "Казино", "title": "Casino", "imdbId": "tt0112641"},
            {"title": "Heat", "imdbId": "tt0113277"},
        ]

        self.assertIs(best_import_candidate("Казино", candidates), candidates[1])

    def test_keeps_first_candidate_when_scores_tie(self):
        candidates = [
            {"title": "Alien", "imdbId": "tt0078748"},
            {"enTitle": "Alien", "imdbId": "tt9999999"},
        ]

        self.assertIs(best_import_candidate("Alien", candidates), candidates[0])

    def test_empty_candidates_preserves_index_error(self):
        with self.assertRaises(IndexError):
            best_import_candidate("Alien", [])


class LocalMovieIndexTests(unittest.TestCase):
    def test_indexed_lookup_matches_by_imdb_id_first(self):
        movies = [
            {"imdbId": "tt001", "title": "Same Title", "year": "1999", "watched": True},
            {"imdbId": "tt002", "title": "Same Title", "year": "1999", "watched": False},
        ]
        movie_index = build_local_movie_index(movies)

        self.assertIs(
            find_matching_local_movie(movies, {"imdbId": "tt002", "title": "Same Title", "year": "1999"}, movie_index),
            movies[1],
        )

    def test_indexed_lookup_preserves_first_title_year_match(self):
        movies = [
            {"imdbId": "tt001", "title": "Alien", "year": "1979"},
            {"imdbId": "tt002", "originalTitle": "Alien", "year": "1979"},
        ]
        movie_index = build_local_movie_index(movies)

        self.assertIs(
            find_matching_local_movie(movies, {"title": "Alien", "year": "1979"}, movie_index),
            movies[0],
        )

    def test_matches_random_settings_uses_index_for_watched_external_match(self):
        movies = [
            {"imdbId": "tt001", "title": "Alien", "year": "1979", "watched": True},
        ]
        movie_index = build_local_movie_index(movies)
        settings = {
            "includeWatched": False,
            "durationFilterEnabled": False,
            "durationRange": "standard",
            "ratingRange": "any",
            "genreFilters": set(),
        }

        self.assertFalse(matches_random_settings(
            {"imdbId": "tt001", "title": "Alien", "year": "1979"},
            "external",
            movies,
            settings,
            movie_index,
        ))


class ExternalCandidateRecencyTests(unittest.TestCase):
    def test_split_external_candidates_by_recency_preserves_order(self):
        candidates = [
            {"imdbId": "tt001", "title": "Fresh"},
            {"imdbId": "tt002", "title": "Recent"},
            {"title": "Fallback", "year": "2001"},
        ]

        fresh, recent = split_external_candidates_by_recency(candidates, {"tt002"})

        self.assertEqual(fresh, [candidates[0], candidates[2]])
        self.assertEqual(recent, [candidates[1]])


class LibraryFilterTests(unittest.TestCase):
    def test_filter_library_movies_combines_filters_and_preserves_order(self):
        movies = [
            {
                "title": "Alien",
                "originalTitle": "Alien",
                "year": "1979",
                "rating": "8.5",
                "genre": "Horror, Sci-Fi",
                "director": "Ridley Scott",
                "watched": False,
            },
            {
                "title": "Aliens",
                "originalTitle": "Aliens",
                "year": "1986",
                "rating": "8.4",
                "genre": "Action, Sci-Fi",
                "director": "James Cameron",
                "watched": False,
            },
            {
                "title": "Alien 3",
                "originalTitle": "Alien 3",
                "year": "1992",
                "rating": "6.4",
                "genre": "Horror, Sci-Fi",
                "director": "David Fincher",
                "watched": True,
            },
        ]

        filtered = filter_library_movies(movies, {
            "hideWatched": True,
            "search": "alien",
            "year": "",
            "rating": "high",
            "genre": "Sci-Fi",
            "director": "",
        })

        self.assertEqual(filtered, movies[:2])

    def test_build_filter_options_keeps_existing_sorting(self):
        movies = [
            {"year": "1999", "genre": "Drama, Action", "director": "B Director"},
            {"year": "2001", "genre": "Action; Comedy", "director": "A Director"},
            {"year": "unknown", "genre": "", "director": ""},
        ]

        options = build_filter_options(movies)

        self.assertEqual(options["years"], ["2001", "1999", "unknown"])
        self.assertEqual(options["genres"], ["Action", "Comedy", "Drama"])
        self.assertEqual(options["directors"], ["A Director", "B Director"])


if __name__ == "__main__":
    unittest.main()
