import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSeries } from "./lib/bmrs.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const resolvedPath = join(publicDir, normalizedPath);

  try {
    const fileInfo = await stat(resolvedPath);
    if (fileInfo.isDirectory()) {
      return serveStatic(join(requestedPath, "index.html"), response);
    }

    response.writeHead(200, {
      "content-type": contentTypes[extname(resolvedPath)] || "application/octet-stream",
      "cache-control": extname(resolvedPath) === ".html" ? "no-store" : "public, max-age=3600"
    });
    createReadStream(resolvedPath).pipe(response);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/series") {
    try {
      const start = url.searchParams.get("start");
      const end = url.searchParams.get("end");
      const horizon = Number(url.searchParams.get("horizon") ?? "4");

      if (!start || !end || Number.isNaN(horizon)) {
        sendJson(response, 400, { error: "start, end and horizon query parameters are required" });
        return;
      }

      const series = await buildSeries({
        start,
        end,
        horizonHours: horizon
      });

      sendJson(response, 200, series);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Unknown error" });
    }
    return;
  }

  if (url.pathname === "/README.md") {
    try {
      const content = await readFile(join(__dirname, "README.md"), "utf8");
      response.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(content);
    } catch {
      sendJson(response, 404, { error: "Not found" });
    }
    return;
  }

  await serveStatic(url.pathname, response);
});

server.listen(port, () => {
  console.log(`Forecast monitor running at http://localhost:${port}`);
});
