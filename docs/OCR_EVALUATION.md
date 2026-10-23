# OCR evaluation

Run: 2026-10-23T04:28:34.167567+00:00 using `tesseract 5.5.0`.

Raw extraction from 20 generated, printed cards based on the project's fictional reference cases. These results cover the local OCR/parser pipeline, not handwriting or real prescriptions.

Reproduce from the repository root:

```sh
.venv/bin/python scripts/evaluate-ocr.py
```

`--generate-only` writes the cards without running OCR. `--strict` returns a nonzero exit code for any field mismatch. The default command writes the results below. References are in [references.json](../tests/ocr/references.json); raw text, candidates, confidence and timings are in [ocr-evaluation.json](ocr-evaluation.json).

| Field | Exact raw matches | Total |
| --- | ---: | ---: |
| name | 15 | 20 |
| strength | 17 | 20 |
| dose | 15 | 20 |
| frequency | 17 | 20 |
| durationDays | 15 | 20 |

All five fields matched on **13/20 cards**. Comparison collapses whitespace and compares duration as integer days. Spelling and case must match; multiple candidates fail the card. Engine confidence is recorded separately from correctness.

| Case | Simulated condition | Raw exact fields | All fields correct |
| --- | --- | ---: | --- |
| 01 | Clear | 5/5 | Yes |
| 02 | Clear | 5/5 | Yes |
| 03 | Clear | 5/5 | Yes |
| 04 | Clear | 5/5 | Yes |
| 05 | Clear | 5/5 | Yes |
| 06 | Clear | 5/5 | Yes |
| 07 | Clear | 5/5 | Yes |
| 08 | Clear | 5/5 | Yes |
| 09 | Clear | 5/5 | Yes |
| 10 | Clear | 4/5 | No |
| 11 | Skew 15 degrees | 0/5 | No |
| 12 | Soft blur | 5/5 | Yes |
| 13 | Low light | 5/5 | Yes |
| 14 | Shadow | 3/5 | No |
| 15 | Uneven crop | 5/5 | Yes |
| 16 | Skew + blur | 1/5 | No |
| 17 | Faint print | 0/5 | No |
| 18 | Glare | 4/5 | No |
| 19 | Small text | 5/5 | Yes |
| 20 | Busy background | 2/5 | No |

Image transformations and random seeds are fixed in the script. Extracted fields still require caregiver review before scheduling.

The planned human study remains **pending**: 5 volunteers, 4 cases each; all fields correct after review and every correction task under 30 seconds. Report median/P90, errors, rejected reads and retakes. Processing times in the JSON are machine timings, not human correction times. No clinical outcome has been evaluated.
