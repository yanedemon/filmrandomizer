import unittest

from server import insert_table_rows


class FakeDb:
    backend = "sqlite"

    def __init__(self):
        self.calls = []

    def executemany(self, sql, params):
        self.calls.append((sql, params))


class InsertTableRowsTests(unittest.TestCase):
    def test_batches_consecutive_rows_with_same_columns(self):
        db = FakeDb()

        insert_table_rows(db, "movies", [
            {"id": 1, "title": "A"},
            {"id": 2, "title": "B"},
            {"id": 3, "title": "C", "year": "1999"},
            {"id": 4, "title": "D", "year": "2000"},
        ])

        self.assertEqual(len(db.calls), 2)
        self.assertEqual(db.calls[0][0], "INSERT INTO movies (id, title) VALUES (?, ?)")
        self.assertEqual(db.calls[0][1], [[1, "A"], [2, "B"]])
        self.assertEqual(db.calls[1][0], "INSERT INTO movies (id, title, year) VALUES (?, ?, ?)")
        self.assertEqual(db.calls[1][1], [[3, "C", "1999"], [4, "D", "2000"]])

    def test_empty_rows_do_not_execute(self):
        db = FakeDb()

        insert_table_rows(db, "movies", [])

        self.assertEqual(db.calls, [])


if __name__ == "__main__":
    unittest.main()
