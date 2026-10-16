# TRAFFIC SAFETY POC KNOWLEDGE BASE

## OVERVIEW

Standalone campus safety-report proof of concept combining generated reports,
EasyOCR plate extraction, Korean sentence embeddings, contribution scoring,
CSV persistence, and a Streamlit dashboard.

## WHERE TO LOOK

| Task | Location | Notes |
|---|---|---|
| Seed report generation | `fake_data.py` | Writes `campus_safety_combined.csv` |
| OCR/NLP scoring pipeline | `process_data.py` | Reads seed data and test image |
| Dashboard | `dashboard.py` | Reads `final_merit_result.csv` |
| User grade simulation | `user_management.py` | Reads final results, writes profiles |
| Model probes | `test_ocr.py`, `test_nlp.py` | Manual scripts, not isolated unit tests |
| Input image | `test_car.jpg` | Relative-path OCR fixture |

## DATA FLOW

```text
fake_data.py
  -> campus_safety_combined.csv
  -> process_data.py
  -> final_merit_result.csv
  -> dashboard.py / user_management.py
  -> user_profiles_updated.csv
```

## CONVENTIONS

- Run scripts from `TrafficSafety/`; all CSV and image paths are cwd-relative.
- `process_data.py` loads EasyOCR and `jhgan/ko-sroberta-multitask` eagerly.
  First execution downloads/loads large models.
- Python 3.12 is recommended for EasyOCR and PyTorch wheel availability.
- CSVs are prototype persistence and some are checked in as scenario evidence.
- Korean labels, report IDs, grade weights, and scenario records are part of the
  demonstration, not shared contracts with the main dashboard.

## ANTI-PATTERNS

- Regenerating sample data rewrites the tracked `campus_safety_combined.csv`,
  `final_merit_result.csv`, and `user_profiles_updated.csv`; commit those changes
  intentionally or restore them with
  `git checkout -- TrafficSafety/*.csv`.
- Do not add fixed sleeps around model loading; use observable readiness when
  converting these scripts into services or tests.
- Do not call manual probe scripts automated tests without assertions and
  deterministic model/input contracts.
- Do not move these dependencies into `weather/requirements.txt`; this is a
  separate PoC with its own `TrafficSafety/requirements.txt`.

## INSTALLATION AND RUN ORDER

Install dependencies from the repository root:

```sh
python -m pip install -r TrafficSafety/requirements.txt
```

Run the dashboard using the committed sample CSVs; it only reads
`final_merit_result.csv`:

```sh
cd TrafficSafety && streamlit run dashboard.py
```

Optionally regenerate sample data from the `TrafficSafety/` directory:

```sh
python fake_data.py && python process_data.py && python user_management.py
```
