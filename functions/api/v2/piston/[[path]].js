const API_BASE = "https://api.onlinecompiler.io/api/v2/piston";
const MAX_REQUEST_BYTES = 6 * 1024 * 1024;

function jsonResponse(data, status, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data), { status, headers });
}

function upstreamResponse(response, origin) {
  const headers = {
    "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(response.body, { status: response.status, headers });
}

async function readBoundedBody(request) {
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
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

export async function onRequest({ request, env, params }) {
  const allowedOrigin = env.SITE_ORIGIN;
  if (!allowedOrigin) return jsonResponse({ message: "The hosted execution proxy is not configured." }, 503);

  const origin = request.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return jsonResponse({ message: "Origin not allowed." }, 403);

  const route = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  if (route === "runtimes" && request.method === "GET") {
    try {
      const response = await fetch(API_BASE + "/runtimes");
      return upstreamResponse(response, origin === allowedOrigin ? origin : null);
    } catch (error) {
      console.error("OnlineCompiler runtimes request failed:", error);
      return jsonResponse({ message: "The execution provider is unavailable." }, 502);
    }
  }

  if (route !== "execute") return jsonResponse({ message: "Not found." }, 404);
  if (request.method === "OPTIONS") {
    if (origin !== allowedOrigin) return jsonResponse({ message: "Origin not allowed." }, 403);
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin"
      }
    });
  }
  if (request.method !== "POST") {
    return jsonResponse({ message: "Method not allowed." }, 405, origin === allowedOrigin ? origin : null);
  }
  if (origin !== allowedOrigin) return jsonResponse({ message: "Origin not allowed." }, 403);
  if (!env.ONLINECOMPILER_API_KEY) {
    return jsonResponse({ message: "The hosted execution provider is not configured by the site owner." }, 503, origin);
  }
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return jsonResponse({ message: "Expected an application/json request." }, 415, origin);
  }

  let body;
  try {
    body = await readBoundedBody(request);
  } catch (error) {
    return jsonResponse({ message: "Request body must be valid UTF-8." }, 400, origin);
  }
  if (body === null) return jsonResponse({ message: "Request body is too large." }, 413, origin);

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    return jsonResponse({ message: "Request body must be valid JSON." }, 400, origin);
  }
  if (!payload || typeof payload !== "object" || typeof payload.language !== "string" ||
      !Array.isArray(payload.files) || !payload.files.length ||
      !payload.files[0] || typeof payload.files[0].content !== "string") {
    return jsonResponse({ message: "A language and at least one source file are required." }, 400, origin);
  }

  try {
    const response = await fetch(API_BASE + "/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": env.ONLINECOMPILER_API_KEY
      },
      body,
      signal: request.signal
    });
    return upstreamResponse(response, origin);
  } catch (error) {
    console.error("OnlineCompiler execution request failed:", error);
    return jsonResponse({ message: "The execution provider is unavailable." }, 502, origin);
  }
}
