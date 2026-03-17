const BMRS_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets";
const JAN_2025_UTC = Date.parse("2025-01-01T00:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function assertValidDate(value, label) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return parsed;
}

function toIsoUtc(timestamp) {
  return new Date(timestamp).toISOString().replace(".000Z", "Z");
}

function buildUrl(dataset, params) {
  const url = new URL(`${BMRS_BASE_URL}/${dataset}/stream`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, value);
  }
  return url;
}

async function fetchDataset(dataset, params) {
  const url = buildUrl(dataset, params);
  const response = await fetch(url, {
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`BMRS ${dataset} request failed with ${response.status}: ${message.slice(0, 300)}`);
  }

  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(`Unexpected BMRS ${dataset} payload`);
  }
  return payload;
}

function splitRange(fromMs, toMs, windowDays) {
  const windows = [];
  let cursor = fromMs;

  while (cursor < toMs) {
    const next = Math.min(cursor + windowDays * DAY_MS, toMs);
    windows.push([cursor, next]);
    cursor = next;
  }

  return windows;
}

async function fetchChunked(dataset, fromMs, toMs, windowDays, extraParams = {}, formatter) {
  const windows = splitRange(fromMs, toMs, windowDays);
  const chunks = await Promise.all(
    windows.map(([chunkFrom, chunkTo]) => fetchDataset(dataset, formatter(chunkFrom, chunkTo, extraParams)))
  );

  return chunks.flat();
}

function toIsoDateUtc(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function fetchActualRecords(fromMs, toMs) {
  return fetchChunked("FUELHH", fromMs, toMs, 30, { fuelType: "WIND" }, (chunkFrom, chunkTo, extraParams) => ({
    settlementDateFrom: toIsoDateUtc(chunkFrom),
    settlementDateTo: toIsoDateUtc(Math.max(chunkFrom, chunkTo - 1)),
    ...extraParams
  }));
}

async function fetchForecastRecords(fromMs, toMs) {
  const publishFrom = fromMs - 48 * HOUR_MS;
  return fetchChunked("WINDFOR", publishFrom, toMs, 14, {}, (chunkFrom, chunkTo) => ({
    publishDateTimeFrom: toIsoUtc(chunkFrom),
    publishDateTimeTo: toIsoUtc(chunkTo)
  }));
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function normalizeActualsToHourly(records) {
  const grouped = new Map();

  for (const record of records) {
    if (typeof record.generation !== "number" || typeof record.startTime !== "string") {
      continue;
    }

    const timestamp = Date.parse(record.startTime);
    if (Number.isNaN(timestamp)) {
      continue;
    }

    const hourBucket = Math.floor(timestamp / HOUR_MS) * HOUR_MS;
    const bucket = grouped.get(hourBucket) ?? [];
    bucket.push(record.generation);
    grouped.set(hourBucket, bucket);
  }

  return new Map(
    [...grouped.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([hourBucket, values]) => [
        hourBucket,
        {
          startTime: toIsoUtc(hourBucket),
          actualGeneration: Math.round(average(values))
        }
      ])
  );
}

export function selectForecastsByMinimumHorizon(records, minimumHorizonHours) {
  const selected = new Map();

  for (const record of records) {
    if (
      typeof record.generation !== "number" ||
      typeof record.startTime !== "string" ||
      typeof record.publishTime !== "string"
    ) {
      continue;
    }

    const targetMs = Date.parse(record.startTime);
    const publishMs = Date.parse(record.publishTime);
    if (Number.isNaN(targetMs) || Number.isNaN(publishMs)) {
      continue;
    }

    const horizonHours = (targetMs - publishMs) / HOUR_MS;
    if (horizonHours < minimumHorizonHours || horizonHours < 0 || horizonHours > 48) {
      continue;
    }

    const existing = selected.get(targetMs);
    if (!existing || publishMs > existing.publishMs) {
      selected.set(targetMs, {
        startTime: toIsoUtc(targetMs),
        forecastGeneration: record.generation,
        publishTime: toIsoUtc(publishMs),
        horizonHours: Number(horizonHours.toFixed(1)),
        publishMs
      });
    }
  }

  return new Map(
    [...selected.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([targetMs, forecast]) => [targetMs, forecast])
  );
}

function computeSummary(points) {
  const paired = points.filter((point) => Number.isFinite(point.actualGeneration) && Number.isFinite(point.forecastGeneration));
  if (!paired.length) {
    return {
      points: points.length,
      matchedPoints: 0,
      meanAbsoluteError: null,
      medianAbsoluteError: null,
      p95AbsoluteError: null,
      bias: null
    };
  }

  const absoluteErrors = paired
    .map((point) => Math.abs(point.error))
    .sort((left, right) => left - right);
  const biases = paired.map((point) => point.error);

  const quantile = (values, q) => {
    const index = Math.min(values.length - 1, Math.floor(q * values.length));
    return values[index];
  };

  return {
    points: points.length,
    matchedPoints: paired.length,
    meanAbsoluteError: Math.round(absoluteErrors.reduce((sum, value) => sum + value, 0) / absoluteErrors.length),
    medianAbsoluteError: Math.round(quantile(absoluteErrors, 0.5)),
    p95AbsoluteError: Math.round(quantile(absoluteErrors, 0.95)),
    bias: Math.round(biases.reduce((sum, value) => sum + value, 0) / biases.length)
  };
}

export async function buildSeries({ start, end, horizonHours }) {
  const startMs = assertValidDate(start, "start");
  const endMs = assertValidDate(end, "end");

  if (startMs < JAN_2025_UTC) {
    throw new Error("Start time must be on or after 2025-01-01T00:00:00Z");
  }
  if (endMs <= startMs) {
    throw new Error("End time must be after start time");
  }
  if (endMs - startMs > 90 * DAY_MS) {
    throw new Error("Please request 90 days or less per query");
  }
  if (horizonHours < 0 || horizonHours > 48) {
    throw new Error("Forecast horizon must be between 0 and 48 hours");
  }

  const [actualRecords, forecastRecords] = await Promise.all([
    fetchActualRecords(startMs, endMs),
    fetchForecastRecords(startMs, endMs)
  ]);

  const hourlyActuals = normalizeActualsToHourly(actualRecords);
  const selectedForecasts = selectForecastsByMinimumHorizon(forecastRecords, horizonHours);

  const timestamps = new Set([...hourlyActuals.keys(), ...selectedForecasts.keys()]);
  const points = [...timestamps]
    .sort((left, right) => left - right)
    .map((timestamp) => {
      const actual = hourlyActuals.get(timestamp) ?? {};
      const forecast = selectedForecasts.get(timestamp) ?? {};
      const actualGeneration = actual.actualGeneration ?? null;
      const forecastGeneration = forecast.forecastGeneration ?? null;
      const error =
        Number.isFinite(actualGeneration) && Number.isFinite(forecastGeneration)
          ? forecastGeneration - actualGeneration
          : null;

      return {
        startTime: actual.startTime ?? forecast.startTime ?? toIsoUtc(timestamp),
        actualGeneration,
        forecastGeneration,
        publishTime: forecast.publishTime ?? null,
        appliedHorizonHours: forecast.horizonHours ?? null,
        error
      };
    })
    .filter((point) => {
      const timestamp = Date.parse(point.startTime);
      return timestamp >= startMs && timestamp <= endMs;
    });

  return {
    meta: {
      start: toIsoUtc(startMs),
      end: toIsoUtc(endMs),
      horizonHours,
      source: BMRS_BASE_URL
    },
    summary: computeSummary(points),
    points
  };
}
