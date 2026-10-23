export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: "same-origin",
  });
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(
      "The server returned an unexpected response. Please try again.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      (result as { error?: string }).error ||
        "Something went wrong. Please try again.",
      response.status,
    );
  return result as T;
}
export const post = <T = unknown>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
export const patch = <T = unknown>(path: string, body: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(body) });
