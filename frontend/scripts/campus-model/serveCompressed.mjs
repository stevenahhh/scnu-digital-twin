// Connect middleware for vite.config.js (dev and preview): answers GET requests for the shipped campus model with its
// precompressed .br or .gz copy (written beside it by the publish gate, qa/candidate.mjs) when the client accepts that
// encoding and the copy is not older than the source. X-File-Size carries the uncompressed size: three's FileLoader reads it before Content-Length, so the
// dashboard's byte progress still counts against the decoded bytes. Anything else falls through to vite.
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import path from "node:path";

const CONTENT_TYPES = { ".glb": "model/gltf-binary", ".bin": "application/octet-stream" };

function accepted(acceptEncoding, token) {
  return String(acceptEncoding ?? "")
    .split(",")
    .map((part) => part.trim().split(";"))
    .some(([name, ...params]) => name.trim() === token && !params.some((p) => /^\s*q=0(\.0*)?\s*$/.test(p)));
}

// copyMtimes: { br, gz } modification times of the copies in ms, or null when a copy is missing.
export function chooseEncoding(acceptEncoding, sourceMtime, copyMtimes) {
  if (accepted(acceptEncoding, "br") && copyMtimes.br !== null && copyMtimes.br >= sourceMtime) return "br";
  if (accepted(acceptEncoding, "gzip") && copyMtimes.gz !== null && copyMtimes.gz >= sourceMtime) return "gz";
  return null;
}

const mtime = (file) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? null;

export function precompressedAssetMiddleware(publicDir, names) {
  const served = new Set(names.map((name) => `/${name}`));
  return (request, response, next) => {
    const [pathname, query = ""] = (request.url ?? "").split("?");
    // vite answers ?url / ?import requests for public files with a module, not the bytes
    const moduleRequest = /(^|&)(url|import|raw)(=|&|$)/.test(query);
    if ((request.method !== "GET" && request.method !== "HEAD") || !served.has(pathname) || moduleRequest) {
      next();
      return;
    }
    const source = path.join(publicDir, pathname.slice(1));
    const sourceStat = statSync(source, { throwIfNoEntry: false });
    const copies = { br: mtime(`${source}.br`), gz: mtime(`${source}.gz`) };
    const encoding = sourceStat && chooseEncoding(request.headers["accept-encoding"], sourceStat.mtimeMs, copies);
    if (!encoding) {
      next();
      return;
    }
    // 복사본과 원본의 크기·수정 시각으로 만든 검증자: 새로 고침하면 304로 답해 15 MB를 다시 보내지 않는다.
    const etag = `W/"${encoding}-${sourceStat.size}-${Math.round(sourceStat.mtimeMs)}-${Math.round(copies[encoding])}"`;
    const setHeaders = () => {
      response.setHeader("ETag", etag);
      response.setHeader("Vary", "Accept-Encoding");
      response.setHeader("Cache-Control", "no-cache");
    };
    if (request.headers["if-none-match"] === etag) {
      setHeaders();
      response.statusCode = 304;
      response.end();
      return;
    }
    readFile(`${source}.${encoding}`).then(
      (bytes) => {
        setHeaders();
        response.setHeader("Content-Type", CONTENT_TYPES[path.extname(source)] ?? "application/octet-stream");
        response.setHeader("Content-Encoding", encoding === "br" ? "br" : "gzip");
        response.setHeader("Content-Length", bytes.length);
        response.setHeader("X-File-Size", sourceStat.size);
        response.end(request.method === "HEAD" ? undefined : bytes);
      },
      // 복사본을 읽지 못하면 vite가 원본을 그대로 보낸다.
      () => next(),
    );
  };
}
