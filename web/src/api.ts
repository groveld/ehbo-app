import type { ApiError } from '@ehbo/shared';

export class ApiRequestError extends Error {
  status: number;
  body: Partial<ApiError>;

  constructor(status: number, body: Partial<ApiError>) {
    super(body.error ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/** The server didn't really answer (gateway error, overloaded): try again later. Anything else with a status is its answer. */
export const noAnswer = (err: unknown) => !(err instanceof ApiRequestError) || err.status === 408 || err.status === 429 || err.status > 500;

/** JSON naar en van de server; gooit ApiRequestError bij een foutstatus. */
export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: object; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: init.timeoutMs ? AbortSignal.timeout(init.timeoutMs) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as T;
}
