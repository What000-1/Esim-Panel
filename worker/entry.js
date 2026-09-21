import assets from "./generated-ui.js";
export { EsimStore } from "./store.js";

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; font-src https://cdnjs.cloudflare.com; img-src 'self' https://flagcdn.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function responseHeaders(response, origin) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(securityHeaders))
    headers.set(key, value);
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, If-Match, X-Data-Revision",
    );
    headers.set("Access-Control-Expose-Headers", "ETag, X-Data-Revision");
  }
  return new Response(response.body, { status: response.status, headers });
}
function store(env) {
  if (!env.ESIM_STORE) throw new Error("Missing ESIM_STORE binding");
  return env.ESIM_STORE.get(env.ESIM_STORE.idFromName("esim-panel-v2"));
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin)
      return responseHeaders(
        Response.json({ message: "来源不被允许" }, { status: 403 }),
      );
    if (request.method === "OPTIONS")
      return responseHeaders(new Response(null, { status: 204 }), origin);
    const asset = assets[url.pathname === "/index.html" ? "/" : url.pathname];
    if (asset) {
      if (!["GET", "HEAD"].includes(request.method))
        return responseHeaders(new Response(null, { status: 405 }), origin);
      return responseHeaders(
        new Response(request.method === "HEAD" ? null : asset.body, {
          headers: { "Content-Type": asset.type },
        }),
        origin,
      );
    }
    if (!url.pathname.startsWith("/api/"))
      return responseHeaders(
        new Response("Not Found", { status: 404 }),
        origin,
      );
    try {
      return responseHeaders(await store(env).fetch(request), origin);
    } catch {
      return responseHeaders(
        Response.json(
          { message: "存储尚未就绪，请检查绑定和迁移日志" },
          { status: 503 },
        ),
        origin,
      );
    }
  },
  async scheduled(event, env, ctx) {
    const response = await store(env).fetch(
      new Request("https://internal.invalid/internal/scheduled", {
        method: "POST",
      }),
    );
    if (!response.ok)
      throw new Error("Failed to queue scheduled notifications");
  },
};
