/* eslint-disable @typescript-eslint/no-require-imports -- файл подключается через node --require */
// Подключается при запуске сайта (Dockerfile). Node обрывает приём запроса через 5 минут, считая и
// тело: проба на 512 МБ с телефона идёт дольше. Next этот предел не настраивает.
// Предел в Node один на весь сервер, поэтому общий поднят до часа, а всем адресам, кроме загрузки,
// прежние 5 минут возвращаются здесь.
const http = require("node:http");

const UPLOAD_LIMIT_MS = 60 * 60 * 1000;
const OTHER_LIMIT_MS = 5 * 60 * 1000;
const UPLOAD_PATH = /^\/api\/projects\/[^/]+\/uploads\/(?:video|file)$/;

function isUploadPath(url) {
  return UPLOAD_PATH.test((url ?? "").split("?")[0]);
}

/** Запрос не с адреса загрузки, не принятый целиком за `otherMs`, обрывается. */
function applyLimits(server, { uploadMs = UPLOAD_LIMIT_MS, otherMs = OTHER_LIMIT_MS } = {}) {
  server.requestTimeout = uploadMs;
  server.prependListener("request", (request) => {
    if (isUploadPath(request.url)) return;
    const timer = setTimeout(() => {
      if (!request.complete) request.socket.destroy();
    }, otherMs);
    timer.unref();
    request.once("close", () => clearTimeout(timer));
  });
  return server;
}

const createServer = http.createServer;
http.createServer = (...args) => applyLimits(createServer(...args));

module.exports = { applyLimits, isUploadPath };
