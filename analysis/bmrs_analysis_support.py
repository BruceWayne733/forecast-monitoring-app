from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

import pandas as pd
import requests

BMRS_BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
UTC = timezone.utc
START_DATE = datetime(2025, 1, 1, tzinfo=UTC)
END_DATE = datetime.now(tz=UTC).replace(minute=0, second=0, microsecond=0)
HOUR_MS = 3600


def chunk_range(start: datetime, end: datetime, days: int) -> Iterable[tuple[datetime, datetime]]:
    cursor = start
    while cursor < end:
        next_cursor = min(cursor + timedelta(days=days), end)
        yield cursor, next_cursor
        cursor = next_cursor


def fetch_actual_hourly(start: datetime = START_DATE, end: datetime = END_DATE) -> pd.DataFrame:
    rows: list[dict] = []
    for chunk_start, chunk_end in chunk_range(start, end, 30):
        response = requests.get(
            f"{BMRS_BASE}/FUELHH/stream",
            params={
                "settlementDateFrom": chunk_start.strftime("%Y-%m-%d"),
                "settlementDateTo": (chunk_end - timedelta(seconds=1)).strftime("%Y-%m-%d"),
                "fuelType": "WIND"
            },
            timeout=60
        )
        response.raise_for_status()
        rows.extend(response.json())

    actual = pd.DataFrame(rows)
    actual["startTime"] = pd.to_datetime(actual["startTime"], utc=True)
    actual["target_time"] = actual["startTime"].dt.floor("h")
    hourly = actual.groupby("target_time", as_index=False)["generation"].mean()
    hourly["actual_generation"] = hourly["generation"].round()
    return hourly[["target_time", "actual_generation"]]


def fetch_forecast_history(start: datetime = START_DATE, end: datetime = END_DATE) -> pd.DataFrame:
    rows: list[dict] = []
    publish_start = start - timedelta(hours=48)

    for chunk_start, chunk_end in chunk_range(publish_start, end, 14):
        response = requests.get(
            f"{BMRS_BASE}/WINDFOR/stream",
            params={
                "publishDateTimeFrom": chunk_start.isoformat().replace("+00:00", "Z"),
                "publishDateTimeTo": chunk_end.isoformat().replace("+00:00", "Z")
            },
            timeout=60
        )
        response.raise_for_status()
        rows.extend(response.json())

    forecast = pd.DataFrame(rows)
    forecast["startTime"] = pd.to_datetime(forecast["startTime"], utc=True)
    forecast["publishTime"] = pd.to_datetime(forecast["publishTime"], utc=True)
    forecast["horizon_hours"] = (
        forecast["startTime"] - forecast["publishTime"]
    ).dt.total_seconds() / HOUR_MS
    return forecast.loc[
        (forecast["horizon_hours"] >= 0) & (forecast["horizon_hours"] <= 48)
    ].copy()


def select_latest_eligible_forecast(forecast: pd.DataFrame, minimum_horizon_hours: int) -> pd.DataFrame:
    eligible = forecast.loc[forecast["horizon_hours"] >= minimum_horizon_hours].sort_values(
        ["startTime", "publishTime"]
    )
    selected = eligible.groupby("startTime").tail(1).copy()
    selected["target_time"] = selected["startTime"]
    selected.rename(columns={"generation": "forecast_generation"}, inplace=True)
    return selected[["target_time", "forecast_generation", "publishTime", "horizon_hours"]]


def build_matched_frame(
    actual_hourly: pd.DataFrame, forecast: pd.DataFrame, minimum_horizon_hours: int
) -> pd.DataFrame:
    selected = select_latest_eligible_forecast(forecast, minimum_horizon_hours)
    merged = actual_hourly.merge(selected, on="target_time", how="inner")
    merged["error"] = merged["forecast_generation"] - merged["actual_generation"]
    merged["absolute_error"] = merged["error"].abs()
    return merged


def summarize_horizons(actual_hourly: pd.DataFrame, forecast: pd.DataFrame) -> pd.DataFrame:
    summaries = []
    for minimum_horizon in [0, 4, 8, 12, 24, 36]:
        matched = build_matched_frame(actual_hourly, forecast, minimum_horizon)
        summaries.append(
            {
                "minimum_horizon_hours": minimum_horizon,
                "matched_points": int(len(matched)),
                "mae_mw": round(float(matched["absolute_error"].mean()), 1),
                "median_ae_mw": round(float(matched["absolute_error"].median()), 1),
                "p99_ae_mw": round(float(matched["absolute_error"].quantile(0.99)), 1),
                "bias_mw": round(float(matched["error"].mean()), 1)
            }
        )
    return pd.DataFrame(summaries)


def hourly_error_profile(matched: pd.DataFrame) -> pd.DataFrame:
    profile = (
        matched.assign(hour_of_day=matched["target_time"].dt.hour)
        .groupby("hour_of_day")
        .agg(
            mae_mw=("absolute_error", "mean"),
            bias_mw=("error", "mean")
        )
        .round(1)
        .reset_index()
    )
    return profile


def actual_reliability_summary(actual_hourly: pd.DataFrame) -> pd.DataFrame:
    thresholds = [2000, 2500, 3000, 3500, 4000, 5000, 6000]
    rows = []
    for threshold in thresholds:
        rows.append(
            {
                "threshold_mw": threshold,
                "share_of_hours_met_pct": round(
                    float((actual_hourly["actual_generation"] >= threshold).mean() * 100), 1
                )
            }
        )
    return pd.DataFrame(rows)


def actual_quantiles(actual_hourly: pd.DataFrame) -> pd.Series:
    return actual_hourly["actual_generation"].quantile([0.01, 0.05, 0.1, 0.2, 0.5, 0.8, 0.9, 0.95, 0.99]).round(0)


def seasonal_p10(actual_hourly: pd.DataFrame) -> pd.Series:
    return (
        actual_hourly.assign(month=actual_hourly["target_time"].dt.month)
        .groupby("month")["actual_generation"]
        .quantile(0.1)
        .round(0)
    )
