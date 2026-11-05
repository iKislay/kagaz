import { type ZodType } from 'zod';
import { ApiErrorSchema, type PublicConfig, PublicConfigSchema } from '@kagaz/shared';

/** Base URL of the Kagaz API, e.g. http://localhost:4000/api */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(
  /\/$/,
  '',
);

export class ApiRequestError extends Error {
  override name = 'ApiRequestError';
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Typed fetch against the API. Responses are validated with the shared zod schema so the
 * web app never trusts an unexpected shape. Errors surface as ApiRequestError with the API code.
 */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...init?.headers },
      cache: 'no-store',
    });
  } catch {
    throw new ApiRequestError(0, 'API_UNREACHABLE', 'Cannot reach the Kagaz API');
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw parsed.success
      ? new ApiRequestError(res.status, parsed.data.error.code, parsed.data.error.message)
      : new ApiRequestError(res.status, 'HTTP_ERROR', `Request failed (${res.status})`);
  }
  return schema.parse(body);
}

export function getPublicConfig(): Promise<PublicConfig> {
  return apiFetch('/config', PublicConfigSchema);
}
