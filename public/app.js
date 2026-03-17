const controlsForm = document.querySelector("#controls");
const horizonInput = document.querySelector("#horizon");
const horizonValue = document.querySelector("#horizonValue");
const statusEl = document.querySelector("#status");
const submitButton = document.querySelector("#submitButton");
const chartMount = document.querySelector("#chartMount");
const tooltip = document.querySelector("#tooltip");
const rowsEl = document.querySelector("#rows");

const statIds = {
  matchedPoints: document.querySelector("#matchedPoints"),
  maeValue: document.querySelector("#maeValue"),
  medianValue: document.querySelector("#medianValue"),
  p95Value: document.querySelector("#p95Value")
};

function formatInputValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function parseUtcInput(value) {
  return new Date(`${value}:00Z`);
}

function formatUtc(value) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(new Date(value));
}

function formatMw(value) {
  return Number.isFinite(value) ? `${Math.round(value).toLocaleString()} MW` : "n/a";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#a44a3f" : "";
}

function updateStats(summary) {
  statIds.matchedPoints.textContent = summary.matchedPoints ?? "-";
  statIds.maeValue.textContent = Number.isFinite(summary.meanAbsoluteError) ? `${summary.meanAbsoluteError} MW` : "-";
  statIds.medianValue.textContent = Number.isFinite(summary.medianAbsoluteError) ? `${summary.medianAbsoluteError} MW` : "-";
  statIds.p95Value.textContent = Number.isFinite(summary.p95AbsoluteError) ? `${summary.p95AbsoluteError} MW` : "-";
}

function buildPath(points, xScale, yScale, accessor) {
  const commands = [];
  let pendingMove = true;

  for (const point of points) {
    const value = accessor(point);
    if (!Number.isFinite(value)) {
      pendingMove = true;
      continue;
    }

    const x = xScale(Date.parse(point.startTime));
    const y = yScale(value);
    commands.push(`${pendingMove ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`);
    pendingMove = false;
  }

  return commands.join(" ");
}

function renderChart(points) {
  chartMount.innerHTML = "";
  tooltip.hidden = true;

  if (!points.length) {
    chartMount.innerHTML = "<p>No data returned for the selected range.</p>";
    return;
  }

  const width = chartMount.clientWidth || 900;
  const height = Math.max(320, Math.min(460, Math.round(width * 0.45)));
  const margin = { top: 24, right: 20, bottom: 48, left: 62 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const timestamps = points.map((point) => Date.parse(point.startTime));
  const numericValues = points.flatMap((point) => [point.actualGeneration, point.forecastGeneration]).filter(Number.isFinite);
  const minX = Math.min(...timestamps);
  const maxX = Math.max(...timestamps);
  const minY = Math.min(...numericValues);
  const maxY = Math.max(...numericValues);
  const paddedMinY = Math.max(0, minY - (maxY - minY) * 0.08);
  const paddedMaxY = maxY + (maxY - minY) * 0.08 || maxY + 1;

  const xScale = (value) => margin.left + ((value - minX) / Math.max(1, maxX - minX)) * innerWidth;
  const yScale = (value) => margin.top + innerHeight - ((value - paddedMinY) / Math.max(1, paddedMaxY - paddedMinY)) * innerHeight;

  const yTicks = 5;
  const xTicks = Math.min(6, points.length);
  const actualPath = buildPath(points, xScale, yScale, (point) => point.actualGeneration);
  const forecastPath = buildPath(points, xScale, yScale, (point) => point.forecastGeneration);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "chart-svg");

  const gridLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  for (let tick = 0; tick <= yTicks; tick += 1) {
    const ratio = tick / yTicks;
    const value = paddedMinY + (paddedMaxY - paddedMinY) * ratio;
    const y = margin.top + innerHeight - innerHeight * ratio;
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", margin.left);
    line.setAttribute("x2", width - margin.right);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(20, 49, 42, 0.12)");
    line.setAttribute("stroke-width", "1");
    gridLayer.appendChild(line);

    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", margin.left - 10);
    label.setAttribute("y", y + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "12");
    label.setAttribute("fill", "#48655d");
    label.textContent = `${Math.round(value / 1000)}k`;
    gridLayer.appendChild(label);
  }

  for (let tick = 0; tick < xTicks; tick += 1) {
    const point = points[Math.floor((tick / Math.max(1, xTicks - 1)) * (points.length - 1))];
    const x = xScale(Date.parse(point.startTime));
    const label = document.createElementNS(svg.namespaceURI, "text");
    label.setAttribute("x", x);
    label.setAttribute("y", height - 14);
    label.setAttribute("text-anchor", tick === 0 ? "start" : tick === xTicks - 1 ? "end" : "middle");
    label.setAttribute("font-size", "12");
    label.setAttribute("fill", "#48655d");
    label.textContent = new Intl.DateTimeFormat("en-GB", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "UTC"
    }).format(new Date(point.startTime));
    gridLayer.appendChild(label);
  }

  const actual = document.createElementNS(svg.namespaceURI, "path");
  actual.setAttribute("d", actualPath);
  actual.setAttribute("fill", "none");
  actual.setAttribute("stroke", "#1070c8");
  actual.setAttribute("stroke-width", "3");
  actual.setAttribute("stroke-linecap", "round");
  actual.setAttribute("stroke-linejoin", "round");

  const forecast = document.createElementNS(svg.namespaceURI, "path");
  forecast.setAttribute("d", forecastPath);
  forecast.setAttribute("fill", "none");
  forecast.setAttribute("stroke", "#1e9d63");
  forecast.setAttribute("stroke-width", "3");
  forecast.setAttribute("stroke-linecap", "round");
  forecast.setAttribute("stroke-linejoin", "round");

  const hoverLayer = document.createElementNS(svg.namespaceURI, "g");
  points.forEach((point) => {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    circle.setAttribute("cx", xScale(Date.parse(point.startTime)));
    circle.setAttribute("cy", yScale(point.actualGeneration ?? point.forecastGeneration ?? paddedMinY));
    circle.setAttribute("r", "8");
    circle.setAttribute("fill", "transparent");

    circle.addEventListener("mouseenter", () => {
      tooltip.hidden = false;
      tooltip.innerHTML = `
        <strong>${formatUtc(point.startTime)}</strong><br>
        Actual: ${formatMw(point.actualGeneration)}<br>
        Forecast: ${formatMw(point.forecastGeneration)}<br>
        Error: ${formatMw(point.error)}<br>
        Published: ${point.publishTime ? formatUtc(point.publishTime) : "n/a"}<br>
        Horizon: ${point.appliedHorizonHours ?? "n/a"}h
      `;
    });

    circle.addEventListener("mousemove", (event) => {
      tooltip.style.left = `${event.clientX + 18}px`;
      tooltip.style.top = `${event.clientY + 18}px`;
    });

    circle.addEventListener("mouseleave", () => {
      tooltip.hidden = true;
    });

    hoverLayer.appendChild(circle);
  });

  svg.append(gridLayer, actual, forecast, hoverLayer);
  chartMount.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "legend";
  legend.innerHTML = '<span class="actual">Actual generation</span><span class="forecast">Selected forecast generation</span>';
  chartMount.appendChild(legend);
}

function renderRows(points) {
  rowsEl.innerHTML = "";
  const matchedRows = points
    .filter((point) => Number.isFinite(point.actualGeneration) && Number.isFinite(point.forecastGeneration))
    .slice(-18)
    .reverse();

  if (!matchedRows.length) {
    rowsEl.innerHTML = '<tr><td colspan="6">No matched observations for this range and horizon.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const point of matchedRows) {
    const tr = document.createElement("tr");
    const errorClass = point.error > 0 ? "positive" : "negative";
    tr.innerHTML = `
      <td>${formatUtc(point.startTime)}</td>
      <td>${Math.round(point.actualGeneration).toLocaleString()}</td>
      <td>${Math.round(point.forecastGeneration).toLocaleString()}</td>
      <td class="${errorClass}">${Math.round(point.error).toLocaleString()}</td>
      <td>${point.publishTime ? formatUtc(point.publishTime) : "n/a"}</td>
      <td>${point.appliedHorizonHours ?? "n/a"}h</td>
    `;
    fragment.appendChild(tr);
  }
  rowsEl.appendChild(fragment);
}

async function loadSeries() {
  const start = parseUtcInput(document.querySelector("#startTime").value);
  const end = parseUtcInput(document.querySelector("#endTime").value);
  const horizon = horizonInput.value;

  setStatus("Loading BMRS data...");
  submitButton.disabled = true;

  try {
    const url = new URL("/api/series", window.location.origin);
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());
    url.searchParams.set("horizon", horizon);

    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    updateStats(payload.summary);
    renderChart(payload.points);
    renderRows(payload.points);
    setStatus(`Loaded ${payload.points.length} hourly points using a ${horizon}h minimum horizon.`);
  } catch (error) {
    updateStats({});
    renderChart([]);
    renderRows([]);
    setStatus(error instanceof Error ? error.message : "Unknown error", true);
  } finally {
    submitButton.disabled = false;
  }
}

function seedDefaults() {
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), 0, 0));
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);

  document.querySelector("#startTime").value = formatInputValue(start);
  document.querySelector("#endTime").value = formatInputValue(end);
  horizonValue.textContent = `${horizonInput.value}h`;
}

horizonInput.addEventListener("input", () => {
  horizonValue.textContent = `${horizonInput.value}h`;
});

controlsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadSeries();
});

window.addEventListener("resize", () => {
  if (chartMount.childElementCount) {
    controlsForm.dispatchEvent(new Event("submit"));
  }
});

seedDefaults();
loadSeries();
