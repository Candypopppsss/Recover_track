# Development

Use the existing checkout; cloud tasks are isolated. Create a worktree only if requested.

- Node.js 24+, Python 3.12 and Tesseract are required. Run `bash scripts/setup.sh`, then `npm run dev`.
- Run `npm test`, `.venv/bin/python -m unittest discover -s services/intelligence -p 'test_*.py'`, `npm run test:e2e` and `npm run build` for relevant changes.
- Enforce household access, prescription review and scheduling rules in the API, not only the UI.
- OCR fields remain drafts until confirmed. Leave uncertain fields blank; do not invent medication instructions.
- The rules-based attention score is experimental. Do not describe it as a diagnosis or a clinically validated prediction.
- Use fictional test data. Keep `.env`, `.data`, credentials and patient records out of commits and logs.
