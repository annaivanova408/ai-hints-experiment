import json
import random
import sqlite3
import unittest
from collections import Counter

from app.main import CONFIG, CONDITIONS, build_assignment, constrained_conditions, validate_config


class ConfigurationTests(unittest.TestCase):
    def test_source_counts_and_config_validity(self):
        validate_config()
        self.assertEqual(len(CONFIG["segments"]), 27)
        self.assertEqual(sum(len(video["clips"]) for video in CONFIG["videos"]), 30)
        self.assertEqual(len(CONFIG["final_test"]), 27)
        self.assertEqual([item["id"] for item in CONFIG["anxiety"]["items"]], list(range(1, 33)))

    def test_condition_sequences_are_balanced(self):
        for count in (6, 9, 12):
            expected = count // len(CONDITIONS)
            for seed in range(50):
                sequence = constrained_conditions(count, random.Random(seed), "AI")
                self.assertNotEqual(sequence[0], "AI")
                self.assertEqual(Counter(sequence), Counter({condition: expected for condition in CONDITIONS}))
                self.assertFalse(any(sequence[i] == sequence[i + 1] == sequence[i + 2] for i in range(len(sequence) - 2)))

    def test_assignment_is_complete_and_stable(self):
        connection = sqlite3.connect(":memory:")
        connection.execute("CREATE TABLE sessions (assignment_json TEXT NOT NULL)")
        first = build_assignment(connection, "PILOT-001")
        second = build_assignment(connection, "PILOT-001")
        self.assertEqual(first, second)
        self.assertEqual(Counter(first["segment_conditions"].values()), Counter({"AI": 9, "EXPERT": 9, "CONTROL": 9}))
        self.assertEqual(len(first["final_test_order"]), 27)
        self.assertEqual(len(first["anxiety_order"]), 32)


if __name__ == "__main__":
    unittest.main()
