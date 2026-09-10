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
        self.assertEqual(len(CONFIG["assignment_slots"]), 30)

    def test_pregenerated_slots_are_balanced_per_segment(self):
        slots = CONFIG["assignment_slots"]
        for segment in CONFIG["segments"]:
            counts = Counter(slot["segment_conditions"][segment["id"]] for slot in slots)
            self.assertEqual(counts, Counter({"AI": 10, "EXPERT": 10, "CONTROL": 10}))
        self.assertEqual(
            set(Counter(tuple(slot["video_order"]) for slot in slots).values()),
            {5},
        )
        for slot in slots:
            sequence = []
            for video_id in slot["video_order"]:
                sequence.extend(
                    slot["segment_conditions"][item["id"]]
                    for item in CONFIG["segments"]
                    if item["video_id"] == video_id
                )
            self.assertFalse(any(sequence[i] == sequence[i + 1] == sequence[i + 2] for i in range(len(sequence) - 2)))

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

    def test_first_thirty_sessions_fill_every_slot_once(self):
        connection = sqlite3.connect(":memory:")
        connection.execute("CREATE TABLE sessions (assignment_json TEXT NOT NULL)")
        selected = []
        for index in range(30):
            assignment = build_assignment(connection, f"PARTICIPANT-{index + 1:02d}")
            selected.append(assignment["assignment_slot"])
            connection.execute(
                "INSERT INTO sessions (assignment_json) VALUES (?)",
                (json.dumps(assignment),),
            )
        self.assertEqual(sorted(selected), list(range(30)))


if __name__ == "__main__":
    unittest.main()
