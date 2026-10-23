export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  let response: Response;
  const timeout = AbortSignal.timeout(path === "/prescriptions/upload" ? 60_000 : 20_000);
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers,
      credentials: "same-origin",
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch {
    throw new ApiError(
      "We couldn’t reach RecoverTrack. Check your connection and try again.",
      0,
      "connection_unavailable",
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      "The server returned an unexpected response. Please try again.",
      response.status,
    );
  }
  if (result === null || typeof result !== "object" || Array.isArray(result))
    throw new ApiError(
      "The server returned an unexpected response. Please try again.",
      response.status,
    );
  const payload = result as { error?: string; code?: string };
  if (!response.ok) {
    const setupUnavailable = [
      "storage_config_missing",
      "encryption_key_missing",
      "database_unreachable",
    ].includes(payload.code || "");
    throw new ApiError(
      setupUnavailable
        ? "Sign-in is temporarily unavailable. Please try again shortly."
        : payload.error || "Something went wrong. Please try again.",
      response.status,
      payload.code,
    );
  }
  return result as T;
}
export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
