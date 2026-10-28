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

/** JSON naar en van de server; gooit ApiRequestError bij een foutstatus. */
export async function api<T>(path: string, init: { method?: 'GET' | 'POST' | 'DELETE'; body?: object } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiRequestError(res.status, body);
  return body as T;
}
