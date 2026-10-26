import { createServer } from "node:http";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { app, ipcMain } from "electron";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};
const csp =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' data: blob:; object-src 'none'; frame-src 'none'; frame-ancestors paseo://app http://localhost:* http://127.0.0.1:*; base-uri 'self'; form-action 'none'";
let server: Server | null = null;
let opening: Promise<string> | null = null;
let editorBase: string | null = null;

async function startEditor(): Promise<string> {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, "app-dist/drawio")
    : path.resolve(app.getAppPath(), "../app/public/drawio");
  if (!existsSync(path.join(root, "index.html")))
    throw new Error("Offline draw.io assets are missing. Run the desktop build preparation.");
  const base = `/${randomBytes(32).toString("hex")}/`;
  let origin = "";
  const instance = createServer((request, response) => {
    void (async () => {
      if (
        request.headers.host !== origin.slice(7) ||
        (request.headers.origin &&
          request.headers.origin !== origin &&
          request.headers.origin !== "null")
      ) {
        response.writeHead(403).end();
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405).end();
        return;
      }
      const url = new URL(request.url || "/", origin);
      if (!url.pathname.startsWith(base)) {
        response.writeHead(403).end();
        return;
      }
      const relative = decodeURIComponent(url.pathname.slice(base.length));
      const file = path.resolve(root, relative);
      const resolved = path.relative(root, file);
      if (
        resolved.startsWith("..") ||
        path.isAbsolute(resolved) ||
        resolved
          .split(path.sep)
          .some((part) => part.startsWith(".") || part === "WEB-INF" || part === "META-INF")
      ) {
        response.writeHead(403).end();
        return;
      }
      const info = await stat(file);
      if (!info.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": mime[path.extname(file).toLowerCase()] || "application/octet-stream",
        "content-length": info.size,
        "content-security-policy": csp,
        "access-control-allow-origin": "null",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "cache-control": "no-store",
      });
      if (request.method === "HEAD") response.end();
      else
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
    })().catch(() => {
      if (!response.headersSent) response.writeHead(404);
      response.end();
    });
  });
  const listening = once(instance, "listening");
  instance.listen(0, "127.0.0.1");
  await listening;
  const address = instance.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot determine diagram editor address.");
  origin = `http://127.0.0.1:${address.port}`;
  server = instance;
  editorBase = `${origin}${base}`;
  return `${origin}${base}index.html`;
}

export function registerDiagramEditor(): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-frame-navigate", (event) => {
      if (!editorBase) return;
      const fromEditor =
        event.frame?.url.startsWith(editorBase) || event.initiator?.url.startsWith(editorBase);
      if (fromEditor && !event.url.startsWith(editorBase)) event.preventDefault();
    });
  });
  ipcMain.handle("paseo:diagram:open", () => {
    opening ??= startEditor().catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  });
}

export function closeDiagramEditor(): void {
  server?.close();
  server = null;
  opening = null;
  editorBase = null;
}
