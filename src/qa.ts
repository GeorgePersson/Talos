import { session, net, type Session } from "electron";
import { randomUUID } from "node:crypto";
import { normalizeURL } from "./url";
import type { APIRequest, APIResponse } from "./shared";
const MAX_RESPONSE = 2 * 1024 * 1024;
interface RequestGroup {
  session: Session;
  api: Set<AbortController>;
}
const groups = new Map<string, RequestGroup>();
export function registerRequestGroup(accountId: string, session: Session) {
  groups.set(accountId, { session, api: new Set() });
}
function requestGroup(accountId: string) {
  const group = groups.get(accountId);
  if (!group) throw new Error("Group no longer exists.");
  return group;
}
export function stopRequests(accountId: string) {
  for (const controller of requestGroup(accountId).api) controller.abort();
}
export function forgetRequestGroup(accountId: string) {
  stopRequests(accountId);
  groups.delete(accountId);
}
const headers = (input: Record<string, string | string[]> = {}) =>
  Object.fromEntries(
    Object.entries(input).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.join("\n") : value,
    ]),
  );
export async function sendRequest(raw: unknown): Promise<APIResponse> {
  if (!raw || typeof raw !== "object") throw new Error("Invalid API request.");
  const request = raw as APIRequest;
  if (
    typeof request.accountId !== "string" ||
    typeof request.url !== "string" ||
    request.url.length > 8192 ||
    typeof request.useSession !== "boolean" ||
    typeof request.body !== "string" ||
    Buffer.byteLength(request.body) > MAX_RESPONSE ||
    !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(
      request.method,
    )
  )
    throw new Error("Invalid method, address or request body (maximum 2 MiB).");
  const url = normalizeURL(request.url);
  if (url === "about:blank")
    throw new Error("Enter an HTTP or HTTPS API address.");
  if (
    !request.headers ||
    typeof request.headers !== "object" ||
    Array.isArray(request.headers) ||
    Object.keys(request.headers).length > 100
  )
    throw new Error("Headers must be a JSON object.");
  for (const [name, value] of Object.entries(request.headers)) {
    if (
      !/^[!#$%&'*+.^_`|~\w-]+$/.test(name) ||
      typeof value !== "string" ||
      value.length > 8192 ||
      /[\r\n]/.test(value) ||
      /^(host|content-length|connection|transfer-encoding)$/i.test(name)
    )
      throw new Error(`Invalid or reserved header: ${name}`);
  }
  const capture = requestGroup(request.accountId);
  if (capture.api.size >= 5)
    throw new Error("Wait for one of this group’s requests to finish.");
  const controller = new AbortController();
  capture.api.add(controller);
  const timeout = setTimeout(() => controller.abort(), 30000);
  const started = Date.now();
  const ses = request.useSession
    ? capture.session
    : session.fromPartition(`qa-request-${randomUUID()}`, { cache: false });
  try {
    return await new Promise<APIResponse>((resolve, reject) => {
      // net.request exposes redirect status/headers; session.fetch cancels manual redirects in Electron.
      const req = net.request({
        url,
        method: request.method,
        session: ses,
        useSessionCookies: request.useSession,
        credentials: request.useSession ? "include" : "omit",
        redirect: "manual",
      });
      let settled = false;
      const finish = (response: APIResponse) => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", abort);
        resolve(response);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        controller.signal.removeEventListener("abort", abort);
        reject(error);
      };
      const abort = () => {
        fail(new Error("Request cancelled by timeout or group reset."));
        req.abort();
      };
      controller.signal.addEventListener("abort", abort, { once: true });
      req.on("error", fail);
      req.on("redirect", (status, _method, _url, responseHeaders) => {
        finish({
          status,
          statusText: "Redirect",
          headers: headers(responseHeaders),
          body: "",
          duration: Date.now() - started,
          bytes: 0,
          truncated: false,
        });
        req.abort();
      });
      req.on("response", (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        const result = (truncated: boolean) => ({
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: headers(response.headers),
          body: Buffer.concat(chunks).toString("utf8"),
          duration: Date.now() - started,
          bytes,
          truncated,
        });
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          const remaining = MAX_RESPONSE - bytes;
          chunks.push(chunk.subarray(0, remaining));
          bytes += Math.min(chunk.length, remaining);
          if (chunk.length > remaining || bytes >= MAX_RESPONSE) {
            finish(result(true));
            req.abort();
          }
        });
        response.on("end", () => finish(result(false)));
        response.on("error", fail);
      });
      req.setHeader("Cache-Control", "no-cache");
      for (const [name, value] of Object.entries(request.headers))
        req.setHeader(name, value);
      if (!["GET", "HEAD"].includes(request.method) && request.body)
        req.write(request.body);
      req.end();
    });
  } finally {
    clearTimeout(timeout);
    capture.api.delete(controller);
    if (!request.useSession) {
      await ses.closeAllConnections();
      await ses.clearStorageData();
    }
  }
}
