from datetime import datetime, timedelta, timezone
import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from app import app, calculate_risk, parse_prescription, RiskInput


class ParserTests(unittest.TestCase):
    def test_fictional_reference_card_is_extracted_without_assumed_clock_time(self):
        meds = parse_prescription("MED-A | 10 mg | 1 tablet\nMorning | 5 days")
        self.assertEqual(len(meds), 1)
        self.assertEqual(meds[0]["name"], "MED-A")
        self.assertEqual(meds[0]["strength"], "10 mg")
        self.assertEqual(meds[0]["dose"], "1 tablet")
        self.assertEqual(meds[0]["durationDays"], 5)
        self.assertEqual(meds[0]["frequency"], "Morning")
        self.assertEqual(meds[0]["times"], [])
        self.assertTrue(meds[0]["reviewRequired"])

    def test_two_medicines_do_not_merge(self):
        meds = parse_prescription("Tab. MED-A 10mg 1 tablet twice daily for 7 days\nCap MED-B 5mg 2 capsules evening 3 days")
        self.assertEqual([m["name"] for m in meds], ["MED-A", "MED-B"])
        self.assertEqual([m["durationDays"] for m in meds], [7, 3])

    def test_missing_fields_stay_missing(self):
        med = parse_prescription("Amoxicillin 500 mg")[0]
        self.assertEqual(med["dose"], "")
        self.assertEqual(med["frequency"], "")
        self.assertIsNone(med["durationDays"])
        self.assertEqual(med["times"], [])

    def test_header_numbers_are_not_medicines(self):
        self.assertEqual(parse_prescription("Patient: Jane\nAge 44\nPrescription\nTake 500 mg after food"), [])

    def test_explicit_clock_times_only(self):
        med = parse_prescription("MED-C 20 mg 1 tablet 08:00 20:00 for 2 weeks after food")[0]
        self.assertEqual(med["times"], ["08:00", "20:00"])
        self.assertEqual(med["durationDays"], 14)
        self.assertEqual(med["instructions"], "after food")

    def test_empty_ocr_has_no_fabricated_medications(self):
        self.assertEqual(parse_prescription(""), [])
        self.assertEqual(parse_prescription("unreadable scribble"), [])


class RiskTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 23, 10, tzinfo=timezone.utc)

    def doses(self, states):
        return [{"scheduledAt": (self.now - timedelta(hours=len(states) - i)).isoformat(), "status": s} for i, s in enumerate(states)]

    def score(self, states=(), checkins=(), **extra):
        payload = RiskInput(doses=self.doses(states), checkIns=list(checkins), **extra)
        return calculate_risk(payload, self.now)

    def test_no_history_is_unavailable_not_zero(self):
        result = self.score()
        self.assertIsNone(result["score"])
        self.assertEqual(result["level"], "unavailable")

    def test_short_history_is_unavailable(self):
        self.assertIsNone(self.score(["taken", "missed"])["score"])

    def test_consistent_adherence_has_low_attention(self):
        result = self.score(["taken"] * 10)
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["level"], "low")
        self.assertTrue(result["experimental"])
        self.assertEqual(result["modelVersion"], "attention-rules-v1")

    def test_missed_streak_raises_attention(self):
        good = self.score(["taken"] * 10)
        bad = self.score(["missed"] * 10)
        self.assertGreater(bad["score"], good["score"])
        self.assertEqual(bad["score"], 65)
        self.assertEqual(bad["level"], "high")
        self.assertEqual(bad["features"]["currentMissedStreak"], 10)
        self.assertTrue(any("latest 10" in reason for reason in bad["explanation"]))

    def test_current_streak_resets_when_latest_taken(self):
        result = self.score(["missed", "missed", "taken"])
        self.assertEqual(result["features"]["currentMissedStreak"], 0)

    def test_future_old_and_in_grace_window_records_ignored(self):
        payload = RiskInput(doses=self.doses(["taken"] * 3) + [
            {"scheduledAt": (self.now + timedelta(days=1)).isoformat(), "status": "missed"},
            {"scheduledAt": (self.now - timedelta(days=20)).isoformat(), "status": "missed"},
            {"scheduledAt": (self.now - timedelta(minutes=5)).isoformat(), "status": "due"},
        ])
        result = calculate_risk(payload, self.now)
        self.assertEqual(result["features"]["observedDoses"], 3)
        self.assertEqual(result["score"], 0)

    def test_pain_and_mobility_changes_are_explained(self):
        checkins = [{"date": "2026-10-22", "pain": 3, "mobility": "independent"},
                    {"date": "2026-10-23", "pain": 8, "mobility": "resting"}]
        result = self.score(checkins=checkins)
        self.assertEqual(result["score"], 60)
        self.assertEqual(result["level"], "high")
        self.assertTrue(any("rose by 5" in r for r in result["explanation"]))
        self.assertTrue(any("independent to resting" in r for r in result["explanation"]))
        self.assertTrue(any("not a diagnosis" in r for r in result["explanation"]))

    def test_duplicate_day_does_not_inflate_history(self):
        repeated = [{"date": "2026-10-23", "pain": 1, "mobility": "independent"}] * 3
        self.assertIsNone(self.score(checkins=repeated)["score"])

    def test_future_and_old_checkins_ignored(self):
        checkins = [{"date": "2026-10-24", "pain": 10, "mobility": "resting"},
                    {"date": "2026-09-10", "pain": 10, "mobility": "resting"}]
        result = self.score(["taken"] * 3, checkins)
        self.assertEqual(result["score"], 0)
        self.assertEqual(result["features"]["recentCheckIns"], 0)


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health_identifies_real_engine_and_rules(self):
        result = self.client.get("/health")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["ocr"], "tesseract")
        self.assertEqual(result.json()["risk"], "attention-rules-v1")

    def test_missing_token_rejected_when_configured(self):
        with patch.dict(os.environ, {"INTERNAL_SERVICE_TOKEN": "test-only-token"}):
            self.assertEqual(self.client.post("/risk", json={}).status_code, 401)
            self.assertEqual(self.client.post("/risk", json={}, headers={"X-Internal-Token": "wrong"}).status_code, 401)
            self.assertEqual(self.client.post("/risk", json={}, headers={"X-Internal-Token": "test-only-token"}).status_code, 200)

    def test_invalid_pain_and_timezone_rejected(self):
        result = self.client.post("/risk", json={"checkIns": [{"date": "2026-10-23", "pain": 11, "mobility": "resting"}]})
        self.assertEqual(result.status_code, 422)
        self.assertEqual(self.client.post("/risk", json={"timeZone": "Wrong/TimeZone"}).status_code, 422)
        self.assertEqual(self.client.post("/risk", json={"doses": [{"scheduledAt": "2026-10-23T10:00:00", "status": "taken"}]}).status_code, 422)

    def test_fake_image_rejected(self):
        result = self.client.post("/ocr", files={"file": ("fake.png", b"not really an image", "image/png")})
        self.assertEqual(result.status_code, 415)

    def test_unsupported_file_and_empty_file_rejected(self):
        self.assertEqual(self.client.post("/ocr", files={"file": ("test.pdf", b"pdf", "application/pdf")}).status_code, 415)
        self.assertEqual(self.client.post("/ocr", files={"file": ("empty.png", b"", "image/png")}).status_code, 400)

    def test_real_ocr_extracts_printed_fictional_card(self):
        image = Image.new("RGB", (1500, 220), "white")
        draw = ImageDraw.Draw(image)
        fontpath = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
        font = ImageFont.truetype(fontpath, 38) if Path(fontpath).exists() else ImageFont.load_default(size=38)
        draw.text((35, 40), "MED-A 10 mg 1 tablet Morning 5 days", font=font, fill="black")
        stream = io.BytesIO()
        image.save(stream, format="PNG")
        result = self.client.post("/ocr", files={"file": ("fictional-card.png", stream.getvalue(), "image/png")})
        self.assertEqual(result.status_code, 200, result.text)
        data = result.json()
        self.assertEqual(data["engine"], "tesseract")
        self.assertIn("MED-A", data["text"])
        self.assertEqual(data["medications"][0]["name"], "MED-A")
        self.assertEqual(data["medications"][0]["durationDays"], 5)
        self.assertTrue(data["criticalityFlag"])
        self.assertGreater(data["confidenceScore"], 0)
        self.assertTrue(data["medications"][0]["reviewRequired"])


if __name__ == "__main__":
    unittest.main()
