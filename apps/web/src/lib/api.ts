import { type ZodType } from 'zod';
import {
  ApiErrorSchema,
  type CreateOrderResponse,
  CreateOrderResponseSchema,
  type PayResponse,
  PayResponseSchema,
  type PrintOptions,
  type PublicConfig,
  PublicConfigSchema,
  type PublicOrder,
  PublicOrderSchema,
  type ShopSummary,
  ShopListSchema,
  TRACKING_TOKEN_HEADER,
  type UploadUrlResponse,
  UploadUrlResponseSchema,
} from '@kagaz/shared';

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
    /** Optional machine-readable extras from the error envelope (e.g. `{ after }`). */
    readonly details?: unknown,
  ) {
    super(message);
  }
}

interface FetchOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Order tracking token; sent as a header (the API also accepts its httpOnly cookie). */
  token?: string | null;
}

/**
 * Typed fetch against the API. Responses are validated with the shared zod schemas so the
 * web app never trusts an unexpected shape. Errors surface as ApiRequestError with the API code.
 */
export async function apiFetch<T>(
  path: string,
  schema: ZodType<T>,
  { body, token, headers, ...init }: FetchOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: 'include',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { [TRACKING_TOKEN_HEADER]: token } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError(
      0,
      'API_UNREACHABLE',
      'Can’t reach Kagaz right now. Check your connection and try again.',
    );
  }

  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw parsed.success
      ? new ApiRequestError(
          res.status,
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.details,
        )
      : new ApiRequestError(res.status, 'HTTP_ERROR', `Something went wrong (${res.status})`);
  }
  return schema.parse(json);
}

// ─── Endpoints (PRD §11.1) ───

export const getPublicConfig = (): Promise<PublicConfig> => apiFetch('/config', PublicConfigSchema);

export const listShops = async (): Promise<ShopSummary[]> =>
  (await apiFetch('/shops', ShopListSchema)).shops;

export const createOrder = (shopId: string, options: PrintOptions): Promise<CreateOrderResponse> =>
  apiFetch('/orders', CreateOrderResponseSchema, {
    method: 'POST',
    body: { shopId, options: cleanOptions(options) },
  });

export const getOrder = (id: string, token?: string | null): Promise<PublicOrder> =>
  apiFetch(`/orders/${id}`, PublicOrderSchema, { token });

export const updateOptions = (
  id: string,
  options: PrintOptions,
  token: string,
): Promise<PublicOrder> =>
  apiFetch(`/orders/${id}/options`, PublicOrderSchema, {
    method: 'PATCH',
    body: { options: cleanOptions(options) },
    token,
  });

export const requestUploadUrl = (
  id: string,
  bytes: number,
  token: string,
): Promise<UploadUrlResponse> =>
  apiFetch(`/orders/${id}/upload-url`, UploadUrlResponseSchema, {
    method: 'POST',
    body: { bytes },
    token,
  });

export const completeUpload = (id: string, fileId: string, token: string): Promise<PublicOrder> =>
  apiFetch(`/orders/${id}/upload-complete`, PublicOrderSchema, {
    method: 'POST',
    body: { fileId },
    token,
  });

/** No body: the server decides the amount (FR-CUST-08). */
export const payOrder = (id: string, token: string): Promise<PayResponse> =>
  apiFetch(`/orders/${id}/pay`, PayResponseSchema, { method: 'POST', token });

/** Blank page range means "all pages" — don't send an empty string. */
function cleanOptions(options: PrintOptions): PrintOptions {
  const pageRange = options.pageRange?.trim();
  const { pageRange: _ignored, ...rest } = options;
  return pageRange ? { ...rest, pageRange } : rest;
}

/**
 * Direct browser → storage upload with progress (the API never proxies file bytes).
 * The signed URL fixes Content-Type and Content-Length.
 */
export function uploadToSignedUrl(
  upload: UploadUrlResponse,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(upload.method, upload.uploadUrl);
    for (const [name, value] of Object.entries(upload.headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(
            new ApiRequestError(
              xhr.status,
              'UPLOAD_FAILED',
              'The upload failed. Please try again.',
            ),
          );
    xhr.onerror = () =>
      reject(new ApiRequestError(0, 'UPLOAD_FAILED', 'The upload failed. Check your connection.'));
    xhr.send(file);
  });
}
