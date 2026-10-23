#!/usr/bin/env python3
"""Measure raw OCR field accuracy on generated, fictional prescription cards."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import random
import subprocess
import sys
import time

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.intelligence.app import parse_prescription, tesseract_ocr  # noqa: E402

FIELDS = ("name", "strength", "dose", "frequency", "durationDays")
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")


def references() -> list[dict]:
    return json.loads((ROOT / "tests/ocr/references.json").read_text())


def draw_card(row: dict) -> Image.Image:
    small = row["condition"] == "Small text"
    font = ImageFont.truetype(str(FONT), 21 if small else 43)
    label = ImageFont.truetype(str(FONT), 19)
    image = Image.new("RGB", (1300, 480), "white")
    draw = ImageDraw.Draw(image)
    draw.text((50, 36), f"FICTIONAL TEST CARD {row['case']} - NOT MEDICAL ADVICE", font=label, fill=(80, 80, 80))
    r = row["reference"]
    draw.text((70, 145), f"{r['name']} | {r['strength']} | {r['dose']}", font=font, fill=(20, 20, 20))
    draw.text((70, 245), f"{r['frequency']} | {r['durationDays']} days", font=font, fill=(20, 20, 20))
    condition = row["condition"]
    if condition == "Skew 15 degrees":
        image = image.rotate(15, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white")
    elif condition == "Soft blur":
        image = image.filter(ImageFilter.GaussianBlur(1.5))
    elif condition == "Low light":
        image = ImageEnhance.Brightness(image).enhance(0.22)
    elif condition == "Shadow":
        shade = Image.new("RGB", image.size, "black")
        mask = Image.new("L", image.size, 0)
        md = ImageDraw.Draw(mask)
        md.polygon([(540,0),(1010,0),(760,480),(290,480)], fill=155)
        mask = mask.filter(ImageFilter.GaussianBlur(24))
        image = Image.composite(shade, image, mask)
    elif condition == "Uneven crop":
        image = image.crop((45, 95, 1185, 380))
    elif condition == "Skew + blur":
        image = image.rotate(-11, resample=Image.Resampling.BICUBIC, expand=True, fillcolor="white").filter(ImageFilter.GaussianBlur(1.2))
    elif condition == "Faint print":
        image = ImageEnhance.Contrast(image).enhance(0.13)
        image = ImageEnhance.Brightness(image).enhance(1.45)
    elif condition == "Glare":
        mask = Image.new("L", image.size, 0)
        ImageDraw.Draw(mask).ellipse((480,60,850,410),fill=210)
        mask = mask.filter(ImageFilter.GaussianBlur(45))
        image = Image.composite(Image.new("RGB",image.size,"white"),image,mask)
    elif condition == "Busy background":
        rng = random.Random(20)
        background = Image.new("RGB", (1500, 640), (215, 220, 222))
        bd = ImageDraw.Draw(background)
        for _ in range(280):
            x,y = rng.randrange(1500),rng.randrange(640)
            bd.line((x,y,x+rng.randrange(-55,55),y+rng.randrange(-55,55)),fill=(120,135,140),width=2)
        background.paste(image, (105, 75))
        image = background
    return image


def equivalent(left, right) -> bool:
    """Only trim/collapse whitespace; no fuzzy matching, spellcheck, or case repair."""
    if isinstance(right, int):
        return left == right
    return isinstance(left, str) and " ".join(left.split()) == " ".join(right.split())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--generate-only", action="store_true")
    parser.add_argument("--strict", action="store_true", help="Exit 1 if any raw reference field mismatches")
    args = parser.parse_args()
    directory = ROOT / "tests/ocr"
    cards = directory / "cards"
    cards.mkdir(parents=True, exist_ok=True)
    rows = references()
    total = len(rows)
    for row in rows:
        draw_card(row).save(cards / f"case-{row['case']}.png")
    if args.generate_only:
        print(f"Generated {len(rows)} fictional printed cards.")
        return 0
    outcomes = []
    for row in rows:
        started = time.perf_counter()
        with Image.open(cards / f"case-{row['case']}.png") as image:
            text, confidence = tesseract_ocr(image)
        drafts = parse_prescription(text)
        # One medicine per card: extra candidates are a failure, not hidden away.
        actual = drafts[0] if len(drafts) == 1 else {}
        matches = {field: equivalent(actual.get(field), row["reference"][field]) for field in FIELDS}
        outcomes.append({**row, "rawText": text, "drafts": drafts,
                         "candidateCount": len(drafts), "ocrWordConfidence": confidence,
                         "matches": matches, "allFieldsMatch": all(matches.values()) and len(drafts)==1,
                         "ocrAndParseSeconds": round(time.perf_counter()-started, 3)})
        print(f"Case {row['case']}: {sum(matches.values())}/5 raw fields; {row['condition']}")
    counts = {field: sum(outcome["matches"][field] for outcome in outcomes) for field in FIELDS}
    report = {
        "runAtUtc": datetime.now(timezone.utc).isoformat(),
        "engine": "tesseract",
        "engineVersion": subprocess.run(["tesseract", "--version"], capture_output=True,text=True,check=True).stdout.splitlines()[0],
        "cases": total, "fieldExactMatches": counts,
        "fullyMatchedCards": sum(outcome["allFieldsMatch"] for outcome in outcomes),
        "normalization": "Whitespace collapsed only; no fuzzy correction or case conversion. Duration is compared as integer days.",
        "humanReview": "Not performed. No post-review accuracy or correction-time claim.",
        "limitations": ["Generated printed synthetic cards are not photographs or handwriting.",
                        "Degradations are deterministic engineering simulations, not held-out capture conditions.",
                        "Not a clinical validation or evidence of safe automatic prescription interpretation."],
        "results": outcomes,
    }
    (ROOT / "docs/ocr-evaluation.json").write_text(json.dumps(report, indent=2) + "\n")
    human = f'''# OCR evaluation

Run: {report['runAtUtc']} using `{report['engineVersion']}`.

Raw extraction from {total} generated, printed cards based on the project's fictional reference cases. These results cover the local OCR/parser pipeline, not handwriting or real prescriptions.

Reproduce from the repository root:

```sh
.venv/bin/python scripts/evaluate-ocr.py
```

`--generate-only` writes the cards without running OCR. `--strict` returns a nonzero exit code for any field mismatch. The default command writes the results below. References are in [references.json](../tests/ocr/references.json); raw text, candidates, confidence and timings are in [ocr-evaluation.json](ocr-evaluation.json).

| Field | Exact raw matches | Total |
| --- | ---: | ---: |
'''
    for field in FIELDS:
        human += f"| {field} | {counts[field]} | {total} |\n"
    human += f"\nAll five fields matched on **{report['fullyMatchedCards']}/{total} cards**. Comparison collapses whitespace and compares duration as integer days. Spelling and case must match; multiple candidates fail the card. Engine confidence is recorded separately from correctness.\n\n"
    human += "| Case | Simulated condition | Raw exact fields | All fields correct |\n| --- | --- | ---: | --- |\n"
    for outcome in outcomes:
        human += f"| {outcome['case']} | {outcome['condition']} | {sum(outcome['matches'].values())}/5 | {'Yes' if outcome['allFieldsMatch'] else 'No'} |\n"
    human += '''
Image transformations and random seeds are fixed in the script. Extracted fields still require caregiver review before scheduling.

The planned human study remains **pending**: 5 volunteers, 4 cases each; all fields correct after review and every correction task under 30 seconds. Report median/P90, errors, rejected reads and retakes. Processing times in the JSON are machine timings, not human correction times. No clinical outcome has been evaluated.
'''
    (ROOT / "docs/OCR_EVALUATION.md").write_text(human)
    print(f"\nAll fields: {report['fullyMatchedCards']}/{total}; per-field: {counts}")
    return 1 if args.strict and report["fullyMatchedCards"] != total else 0


if __name__ == "__main__":
    raise SystemExit(main())
