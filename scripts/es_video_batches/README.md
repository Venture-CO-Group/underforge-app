# Spanish exercise video batches

Per-exercise `videoUrlEs` entries (no routing heuristics). Files are merged by
`scripts/merge_exercise_es_overrides.py`:

1. Reuse `exercises.json` `videoUrl` when it is YouTube and ≤60s (exercise-specific catalog demo).
2. Otherwise use the URL from these batch files (`batch_manual_fixes.json` last).

Regenerate app data:

```bash
python3 scripts/merge_exercise_es_overrides.py
```
