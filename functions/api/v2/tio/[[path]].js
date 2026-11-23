import { execute, listRuntimes } from "../../../_lib/tio.mjs";

const MAX_REQUEST_BYTES = 256 * 1024;

function jsonResponse(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

async function readBoundedBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_REQUEST_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    return undefined;
  }
}

export async function onRequest({ request, params }) {
  const origin = request.headers.get("Origin");
  const ownOrigin = new URL(request.url).origin;
  if (origin && origin !== ownOrigin) return jsonResponse({ message: "Origin not allowed." }, 403);
  const route = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");

  if (route === "runtimes" && request.method === "GET") {
    try {
      return jsonResponse(await listRuntimes(), 200, origin);
    } catch (error) {
      console.error("TIO runtime discovery failed:", error);
      return jsonResponse({ message: error.message }, error.status || 502, origin);
    }
  }
  if (route !== "execute") return jsonResponse({ message: "Not found." }, 404, origin);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") return jsonResponse({ message: "Method not allowed." }, 405, origin);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return jsonResponse({ message: "Expected an application/json request." }, 415, origin);
  }

  let body;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    return jsonResponse({ message: "Could not read the request body." }, 400, origin);
  }
  if (body === null) return jsonResponse({ message: "Request body is too large (maximum 256 KB)." }, 413, origin);
  if (body === undefined) return jsonResponse({ message: "Request body must be valid UTF-8." }, 400, origin);
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    return jsonResponse({ message: "Request body must be valid JSON." }, 400, origin);
  }

  try {
    return jsonResponse(await execute(payload, fetch, request.signal), 200, origin);
  } catch (error) {
    console.error("TIO execution failed:", error);
    return jsonResponse({ message: error.message }, error.status || 502, origin);
  }
}
