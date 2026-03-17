# Forecast Monitoring App

This repository contains a UK wind forecast monitoring app and a supporting Jupyter notebook analysis for BMRS wind generation data.

AI assistance was used for implementation support and low-level coding help while building the application and repository materials.

## Repository structure

- `public/`: static frontend assets for the monitoring UI
- `lib/bmrs.mjs`: BMRS data-access and forecast-selection logic
- `server.mjs`: no-dependency Node server for the app and API endpoint
- `analysis/bmrs_analysis_support.py`: reusable Python helpers for fetching and analyzing BMRS data
- `analysis/bmrs_analysis.ipynb`: notebook covering forecast errors and dependable wind availability
- `render.yaml`: simple deployment manifest for Render

## How to run locally

1. Ensure Node.js 22+ is available.
2. Start the app:

```bash
node server.mjs
```

3. Open `http://localhost:3000`.

## App behavior

- The app compares hourly actual UK wind generation against the latest forecast that was published at least `N` hours before each target timestamp.
- Actuals come from `FUELHH` and are aggregated from 30-minute values to hourly averages.
- Forecasts come from `WINDFOR` and are filtered to horizons between 0 and 48 hours.
- Missing forecast values are left blank and are not plotted.

## Analysis notebook

The notebook:

- fetches historical data from January 1, 2025 onward
- measures error metrics across forecast-horizon thresholds
- reviews time-of-day error behavior
- quantifies historical wind availability
- recommends a dependable MW level for planning against demand

## Deployment

- Suggested host: Render or another Node-compatible platform
- Included config: `render.yaml`
- Live deployment link: not added in this workspace because deployment access is not available here

## Remaining submission steps outside this workspace

- deploy the app and add the live URL above
- record the unlisted demo video
- zip the git repo including `.git`
- upload the zip to Google Drive and share the public link
- submit the final form
