/**
 * Read-only client for Spine HR's EmployeeService (https://v2.spineapi.in).
 *
 * Only two calls are made: GenerateAccessKey and EmployeeService/Get. Spine's SalaryJV,
 * DailyMuster, ExpenseVoucherJV and Payment endpoints are out of scope — and Payment/Update
 * writes — so nothing here can reach them.
 *
 * Responses are reduced to the 11 fields in SPINE_FIELDS inside this module, before any
 * caller sees them. Never log or persist a response body: it carries caste, bank and Aadhaar
 * data. Errors are sanitised (Spine echoes the client key back in its error text).
 *
 * No `server-only` import: this runs from scripts/hr-ingest.ts under tsx, outside Next.
 */
import type { IsoDate } from "../dates";
import {
  SpineApiError,
  extractEmployeeRecords,
  formatReqDate,
  pickSpineFields,
  type SpineRawEmployee,
} from "./spine-core";

// SIHL is provisioned on v2 (vendor, 2026-10-07). The Postman collection still shows v1,
// which rejects SIHL's key with SP4002 "Key Not Found".
const DEFAULT_BASE_URL = "https://v2.spineapi.in";
const TIMEOUT_MS = 60_000;

export type SpineReqType = "Created" | "Modified";

export interface SpineCredentials {
  baseUrl: string;
  clientKey: string;
  productKey: string;
  clientSecret: string;
}

/**
 * Credentials from the environment. SPINE_-prefixed names are preferred; the unprefixed
 * CLIENT_KEY / PRODUCT_KEY / CLIENT_SECRET are accepted because that is how .env has them.
 */
export function spineCredentialsFromEnv(env: NodeJS.ProcessEnv = process.env): SpineCredentials {
  const clientKey = env.SPINE_CLIENT_KEY ?? env.CLIENT_KEY;
  const productKey = env.SPINE_PRODUCT_KEY ?? env.PRODUCT_KEY;
  const clientSecret = env.SPINE_CLIENT_SECRET ?? env.CLIENT_SECRET;
  if (!clientKey || !productKey || !clientSecret) {
    throw new Error("Spine credentials missing: set SPINE_CLIENT_KEY, SPINE_PRODUCT_KEY, SPINE_CLIENT_SECRET");
  }
  return { baseUrl: env.SPINE_BASE_URL ?? DEFAULT_BASE_URL, clientKey, productKey, clientSecret };
}

async function fetchJson(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new SpineApiError("NETWORK", e instanceof Error ? e.message : String(e));
  }
  const body = await res.text();
  if (!res.ok) {
    // The body may be an error envelope or a payload; only an envelope's msg is surfaced.
    let msg = `HTTP ${res.status}`;
    try {
      const j = JSON.parse(body) as { msg?: unknown };
      if (typeof j.msg === "string") msg += ` ${j.msg}`;
    } catch {}
    throw new SpineApiError(`HTTP${res.status}`, msg);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new SpineApiError("SHAPE", "Response was not JSON");
  }
}

export class SpineClient {
  private token: string | null = null;

  constructor(
    private readonly creds: SpineCredentials,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** One token per client instance; a sync run creates one client. */
  private async getToken(): Promise<string> {
    if (this.token) return this.token;
    const body = await fetchJson(
      `${this.creds.baseUrl}/Api/v1/Token/GenerateAccessKey`,
      {
        method: "POST",
        headers: {
          ClientKey: this.creds.clientKey,
          ProductKey: this.creds.productKey,
          ClientSecret: this.creds.clientSecret,
        },
      },
      this.fetchImpl,
    );
    const b = (body ?? {}) as { isSuccess?: unknown; msg?: unknown; data?: unknown; statusCode?: unknown };
    if (b.isSuccess !== true || typeof b.data !== "string" || b.data === "") {
      throw new SpineApiError(String(b.statusCode ?? "TOKEN"), String(b.msg ?? "Token request failed"));
    }
    this.token = b.data;
    return this.token;
  }

  /**
   * Employees created or modified on `reqDate`, already reduced to the 11 synced fields —
   * the full record never leaves this method. Values are as sent; curation comes later.
   */
  async getEmployees(reqType: SpineReqType, reqDate: IsoDate): Promise<SpineRawEmployee[]> {
    const token = await this.getToken();
    const url =
      `${this.creds.baseUrl}/Api/v1/EmployeeService/Get` +
      `?ReqType=${reqType}&ReqDate=${encodeURIComponent(formatReqDate(reqDate))}`;
    const body = await fetchJson(url, { headers: { Authorization: `Bearer ${token}` } }, this.fetchImpl);
    return extractEmployeeRecords(body).map(pickSpineFields);
  }
}
