import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { app, ipcMain } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { devicePreviewPage } from "./page.js";
import {
  connectPreview,
  controlPreview,
  disconnectAllPreviews,
  disconnectPreview,
  listPreviewDevices,
  previewFrame,
} from "./devices.js";
import { previewAction } from "./input.js";

const sessionId = z.string().uuid();
const connectRequest = z.object({ deviceId: z.string().min(1).max(512) });
const disconnectRequest = z.object({ sessionId });
const actionRequest = z.object({ sessionId, action: previewAction });
let server: Server | null = null;
let opening: Promise<string> | null = null;

const endpointSchema = z.object({
  port: z.number().int().min(1).max(65535),
  capability: z.string().regex(/^[a-f0-9]{64}$/),
});
type PreviewEndpoint = z.infer<typeof endpointSchema>;

function endpointPath(): string {
  return path.join(app.getPath("userData"), "device-preview-endpoint.json");
}

async function readEndpoint(): Promise<PreviewEndpoint | null> {
  try {
    return endpointSchema.parse(JSON.parse(await readFile(endpointPath(), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function openPreview(): Promise<string> {
  opening ??= readEndpoint()
    .then(startPreviewServer)
    .catch((error: unknown) => {
      opening = null;
      throw error;
    });
  return opening;
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) {
    if (typeof chunk !== "string") throw new Error("Invalid request encoding.");
    body += chunk;
    if (body.length > 8192) throw new Error("Request exceeds the input size limit.");
  }
  return JSON.parse(body);
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

async function startPreviewServer(endpoint: PreviewEndpoint | null): Promise<string> {
  const capability = endpoint?.capability ?? randomBytes(32).toString("hex");
  const base = `/${capability}/`;
  const instance = createServer((request, response) => {
    void dispatch(request, response).catch((error: unknown) => {
      if (!response.headersSent)
        json(response, 400, {
          error: error instanceof Error ? error.message : "Device request failed.",
        });
      else response.end();
    });
  });
  let origin = "";
  async function dispatch(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const allowedHost = origin.slice("http://".length);
    const sameOrigin = request.headers.origin === undefined || request.headers.origin === origin;
    if (request.headers.host !== allowedHost || !sameOrigin || !request.url) {
      json(response, 403, { error: "Local preview access denied." });
      return;
    }
    const url = new URL(request.url, origin);
    if (!url.pathname.startsWith(base)) {
      json(response, 403, { error: "Preview capability is required." });
      return;
    }
    const route = url.pathname.slice(base.length);
    if (request.method === "GET" && route === "") {
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "content-security-policy":
          "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'",
      });
      response.end(devicePreviewPage);
      return;
    }
    if (request.method === "GET" && route === "api/devices") {
      json(response, 200, await listPreviewDevices());
      return;
    }
    if (request.method === "POST" && route === "api/connect") {
      const input = connectRequest.parse(await readBody(request));
      const id = await connectPreview(input.deviceId);
      if (response.destroyed) {
        await disconnectPreview(id);
        return;
      }
      json(response, 200, { sessionId: id });
      return;
    }
    if (request.method === "GET" && route.startsWith("api/frame/")) {
      const id = sessionId.parse(route.slice("api/frame/".length));
      const image = await previewFrame(id);
      response.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "no-store",
        "content-length": image.length,
      });
      response.end(image);
      return;
    }
    if (request.method === "POST" && route === "api/action") {
      const input = actionRequest.parse(await readBody(request));
      await controlPreview(input.sessionId, input.action);
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && route === "api/disconnect") {
      const input = disconnectRequest.parse(await readBody(request));
      await disconnectPreview(input.sessionId);
      json(response, 200, { ok: true });
      return;
    }
    json(response, 404, { error: "Unknown preview operation." });
  }
  const listening = once(instance, "listening");
  instance.listen(endpoint?.port ?? 0, "127.0.0.1");
  await listening;
  const address = instance.address();
  if (!address || typeof address === "string")
    throw new Error("Cannot determine device preview address.");
  origin = `http://127.0.0.1:${address.port}`;
  if (!endpoint) {
    try {
      await mkdir(app.getPath("userData"), { recursive: true });
      const temporary = `${endpointPath()}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ port: address.port, capability }), {
        mode: 0o600,
      });
      await rename(temporary, endpointPath());
    } catch (error) {
      instance.close();
      throw error;
    }
  }
  server = instance;
  return `${origin}${base}`;
}

export async function registerDevicePreviewHandlers(): Promise<void> {
  ipcMain.handle("paseo:simulator:open", openPreview);
  const endpoint = await readEndpoint();
  if (endpoint) {
    opening = startPreviewServer(endpoint).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    await opening;
  }
}

export async function closeDevicePreviews(): Promise<void> {
  await disconnectAllPreviews();
  const current = server;
  server = null;
  opening = null;
  if (current)
    await new Promise<void>((resolve, reject) => {
      current.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
}
