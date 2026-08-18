// CORS 通用反向代理：/relay/<url-encoded 目标>  → 转发到目标并补 CORS 头，支持 SSE 流式
import http from "http";
import https from "https";

const PORT = Number(process.env.PORT || 8399);

const server = http.createServer((req, res) => {
    // 统一 CORS 头（浏览器跨域访问反代本身也不会被拦）
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "*");

    if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
    }

    // 解析 /relay/<encoded>
    const rawPath = (req.url || "").split("?")[0];
    const m = rawPath.match(/^\/relay\/(.+)$/);
    if (!m) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found, use /relay/<url-encoded target>" }));
        return;
    }

    let target;
    try {
        target = decodeURIComponent(m[1]);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid url encoding" }));
        return;
    }

    let targetUrl;
    try {
        targetUrl = new URL(target);
    } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "invalid target url" }));
        return;
    }

    // 只允许 http/https
    if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "only http/https allowed" }));
        return;
    }

    // 透传请求头（去掉会破坏转发的头）
    const headers = { ...req.headers };
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    delete headers["content-length"];

    const lib = targetUrl.protocol === "https:" ? https : http;
    const upstream = lib.request(
        { hostname: targetUrl.hostname, port: targetUrl.port, path: targetUrl.pathname + targetUrl.search, method: req.method, headers },
        (upRes) => {
            res.writeHead(upRes.statusCode || 502, upRes.headers);
            upRes.pipe(res);
        },
    );
    upstream.on("error", (e) => {
        if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "upstream unreachable", detail: String(e.message || e) }));
        } else {
            res.end();
        }
    });
    req.pipe(upstream);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`cors-relay listening on 0.0.0.0:${PORT}`);
});
