// Minimal local server: serves public/ and runs api/*.js like Vercel does.
// Usage: npm run dev        (reads EBIRD_API_KEY from .env)
//        npm run dev:mock   (built-in sample data, no key or network needed)
// `vercel dev` also works if you have the Vercel CLI installed.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 3000;

// Load .env without a dependency.
try {
  for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env */ }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname.startsWith("/api/")) {
    const file = path.join(root, "api", pathname.slice(5).replace(/[^a-z0-9-]/gi, "") + ".js");
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end("Not found"); }
    const mod = await import(pathToFileURL(file).href + "?t=" + Date.now());
    return mod.default(req, res);
  }
  let file = path.join(root, "public", pathname === "/" ? "index.html" : pathname);
  if (!file.startsWith(path.join(root, "public")) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "public", "index.html");
  res.setHeader("Content-Type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Bird Flashcards on http://localhost:${PORT}${process.env.EBIRD_MOCK === "1" ? " (mock data)" : ""}`));
