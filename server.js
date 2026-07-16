/**
 * Email Triage local server (Node.js)
 * Serves the app and saves actions back into the HTML file.
 *
 * Usage:  node server.js
 * Open:   http://localhost:8080/email-triage.html
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT    = 8080;
const ROOT    = __dirname;
const EMAIL_SOURCE  = "D:\\Gabriel\\OneDrive\\Claude\\Workspace\\Personal Assistance\\email-source\\email-source";
const EMAIL_TRIAGE  = "D:\\Gabriel\\OneDrive\\Claude\\Workspace\\Personal Assistance\\email-source\\email-triage";
                      

const MIME = {
  ".html": "text/html",
  ".json": "application/json",
  ".js":   "text/javascript",
  ".css":  "text/css",
};

const server = http.createServer((req, res) => {

  // ── GET /email-source/*.json → serve from Cowork workspace ───────────────
  if (req.method === "GET" && req.url.startsWith("/email-source/")) {
    const filename = path.basename(req.url);
    const filePath = path.join(EMAIL_SOURCE, filename);
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end("Not found"); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    });
    return;
  }

  // ── POST /save-actions ────────────────────────────────────────────────────
  if (req.method === "POST" && req.url === "/save-actions") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        const payload = JSON.parse(body);
        for (const src of ["gmail", "outlook"]) {
          const outPath = path.join(EMAIL_TRIAGE, `${src}-actions.json`);
          fs.writeFileSync(outPath, JSON.stringify(payload[src], null, 2), "utf8");
        }
        send(res, 200, { ok: true });
      } catch (err) {
        send(res, 500, { ok: false, error: err.message });
      }
    });
    return;
  }

  // ── Serve static files ────────────────────────────────────────────────────
  let filePath = path.join(ROOT, req.url === "/" ? "/email-triage.html" : req.url);

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    send(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

server.listen(PORT, "localhost", () => {
  console.log(`Email Triage running at http://localhost:${PORT}/email-triage.html`);
  console.log("Press Ctrl+C to stop.");
});
