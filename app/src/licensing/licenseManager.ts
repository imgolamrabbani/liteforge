import * as os from 'node:os';

export type Thenable<T> = PromiseLike<T>;

export interface LicenseState {
  tier: 'free' | 'pro';
  keyMask?: string;
  activationId?: string;
  validatedAtIso?: string;
  graceUntilIso?: string;
  offlineGraceActive: boolean;
}

export interface PolarApiClient {
  activate(
    key: string,
    organizationId: string,
    label: string
  ): Promise<{ status: string; id: string; key: string }>;
  validate(
    key: string,
    organizationId: string,
    activationId?: string
  ): Promise<{ status: string }>;
  deactivate(
    key: string,
    organizationId: string,
    activationId: string
  ): Promise<void>;
}

export interface SecretStore {
  get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
  store(key: string, value: string): Thenable<void> | Promise<void>;
  delete(key: string): Thenable<void> | Promise<void>;
}

export interface StateStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface LicenseManagerConfig {
  organizationId: string;
  apiBaseUrl?: string;
}

export const DEFAULT_POLAR_ORGANIZATION_ID =
  'c9b3a57f-c07f-4f81-b9b8-aa9f5b497a1e';
export const LICENSE_SECRET_KEY = 'liteforge.licenseKey';
export const LICENSE_STATE_KEY = 'liteforge.licenseState';
export const DEFAULT_POLAR_API_BASE_URL = 'https://api.polar.sh';
export const REVALIDATE_INTERVAL_MS = 72 * 60 * 60 * 1000; // 72 hours
export const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

const FREE_STATE: LicenseState = {
  tier: 'free',
  offlineGraceActive: false,
};

export class PolarApiError extends Error {
  public readonly statusCode?: number;
  public readonly isRevokedOrInvalid: boolean;
  public readonly isTransient: boolean;
  public readonly responseBody?: string;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      isRevokedOrInvalid: boolean;
      isTransient: boolean;
      responseBody?: string;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'PolarApiError';
    this.statusCode = options.statusCode;
    this.isRevokedOrInvalid = options.isRevokedOrInvalid;
    this.isTransient = options.isTransient;
    this.responseBody = options.responseBody;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function maskLicenseKey(rawKey: string): string {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return '****';
  }
  const parts = trimmed.split('-').filter(Boolean);
  if (parts.length >= 2) {
    const prefix = parts[0];
    const lastPart = parts[parts.length - 1];
    const suffix = lastPart.length >= 4 ? lastPart.slice(-4) : lastPart;
    return `${prefix}-****-${suffix}`;
  }
  if (trimmed.length > 8) {
    return `${trimmed.slice(0, 4)}-****-${trimmed.slice(-4)}`;
  }
  return `****-${trimmed.slice(-4)}`;
}

type FetchLike = typeof fetch;

interface PolarActivateRawResponse {
  id?: string;
  status?: string;
  key?: string;
  license_key?: {
    status?: string;
    key?: string;
  };
}

interface PolarValidateRawResponse {
  status?: string;
  license_key?: {
    status?: string;
  };
}

export class HttpPolarApiClient implements PolarApiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(
    baseUrl: string = DEFAULT_POLAR_API_BASE_URL,
    fetchFn: FetchLike = globalThis.fetch,
    timeoutMs = 10_000
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetchFn = fetchFn;
    this.timeoutMs = timeoutMs;
  }

  async activate(
    key: string,
    organizationId: string,
    label: string
  ): Promise<{ status: string; id: string; key: string }> {
    const data = await this.postJson<PolarActivateRawResponse>(
      '/v1/customer-portal/license-keys/activate',
      {
        key,
        organization_id: organizationId,
        label,
      }
    );

    const status = String(data.license_key?.status ?? data.status ?? '');
    const id = String(data.id ?? '');
    const resolvedKey = String(data.license_key?.key ?? data.key ?? key);

    return { status, id, key: resolvedKey };
  }

  async validate(
    key: string,
    organizationId: string,
    activationId?: string
  ): Promise<{ status: string }> {
    const payload: Record<string, string> = {
      key,
      organization_id: organizationId,
    };
    if (activationId) {
      payload.activation_id = activationId;
    }

    const data = await this.postJson<PolarValidateRawResponse>(
      '/v1/customer-portal/license-keys/validate',
      payload
    );

    const status = String(data.status ?? data.license_key?.status ?? '');
    return { status };
  }

  async deactivate(
    key: string,
    organizationId: string,
    activationId: string
  ): Promise<void> {
    await this.postJson<unknown>(
      '/v1/customer-portal/license-keys/deactivate',
      {
        key,
        organization_id: organizationId,
        activation_id: activationId,
      },
      true
    );
  }

  private async postJson<T>(
    path: string,
    body: Record<string, string>,
    allowEmptyBody = false
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      const message =
        error instanceof Error ? error.message : 'Network request failed';
      throw new PolarApiError(`Polar API network error: ${message}`, {
        isRevokedOrInvalid: false,
        isTransient: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      let responseBody = '';
      try {
        responseBody = await response.text();
      } catch {
        responseBody = '';
      }

      const isRevokedOrInvalid =
        response.status === 400 ||
        response.status === 404 ||
        response.status === 422;

      throw new PolarApiError(
        `Polar API responded with HTTP ${response.status}`,
        {
          statusCode: response.status,
          isRevokedOrInvalid,
          isTransient: !isRevokedOrInvalid,
          responseBody,
        }
      );
    }

    if (allowEmptyBody || response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (!text.trim()) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new PolarApiError('Polar API returned malformed JSON', {
        statusCode: response.status,
        isRevokedOrInvalid: false,
        isTransient: true,
        responseBody: text,
        cause: error,
      });
    }
  }
}

export class LicenseManager {
  private readonly apiClient: PolarApiClient;
  private readonly nowFn: () => number;

  constructor(
    private readonly secrets: SecretStore,
    private readonly globalState: StateStore,
    private readonly config: LicenseManagerConfig = {
      organizationId: DEFAULT_POLAR_ORGANIZATION_ID,
    },
    apiClient?: PolarApiClient,
    nowFn: () => number = () => Date.now()
  ) {
    this.apiClient =
      apiClient ??
      new HttpPolarApiClient(
        config.apiBaseUrl ?? DEFAULT_POLAR_API_BASE_URL
      );
    this.nowFn = nowFn;
  }

  getState(): LicenseState {
    const stored = this.globalState.get<LicenseState>(LICENSE_STATE_KEY);
    if (!stored || stored.tier !== 'pro') {
      return { ...FREE_STATE };
    }
    return {
      tier: 'pro',
      keyMask: stored.keyMask,
      activationId: stored.activationId,
      validatedAtIso: stored.validatedAtIso,
      graceUntilIso: stored.graceUntilIso,
      offlineGraceActive: Boolean(stored.offlineGraceActive),
    };
  }

  isPro(): boolean {
    return this.getState().tier === 'pro';
  }

  async activate(rawKey: string, label?: string): Promise<LicenseState> {
    const trimmedKey = rawKey.trim();
    if (!trimmedKey) {
      throw new PolarApiError('License key cannot be empty', {
        statusCode: 400,
        isRevokedOrInvalid: true,
        isTransient: false,
      });
    }

    const deviceLabel = label?.trim() || os.hostname() || 'liteforge-device';
    const response = await this.apiClient.activate(
      trimmedKey,
      this.config.organizationId,
      deviceLabel
    );

    if (response.status !== 'granted') {
      throw new PolarApiError(
        `License key is not active (status: ${response.status || 'unknown'})`,
        {
          statusCode: 422,
          isRevokedOrInvalid: true,
          isTransient: false,
        }
      );
    }

    const effectiveKey = (response.key || trimmedKey).trim();
    const now = this.nowFn();
    const nextState: LicenseState = {
      tier: 'pro',
      keyMask: maskLicenseKey(effectiveKey),
      activationId: response.id || undefined,
      validatedAtIso: new Date(now).toISOString(),
      graceUntilIso: new Date(now + OFFLINE_GRACE_MS).toISOString(),
      offlineGraceActive: false,
    };

    await this.secrets.store(LICENSE_SECRET_KEY, effectiveKey);
    await this.globalState.update(LICENSE_STATE_KEY, nextState);
    return { ...nextState };
  }

  async refreshIfNeeded(force = false): Promise<LicenseState> {
    const current = this.getState();
    if (current.tier !== 'pro') {
      return { ...FREE_STATE };
    }

    const now = this.nowFn();
    const validatedAtMs = current.validatedAtIso
      ? Date.parse(current.validatedAtIso)
      : Number.NaN;
    const graceUntilMs = current.graceUntilIso
      ? Date.parse(current.graceUntilIso)
      : Number.NaN;

    if (
      !force &&
      !Number.isNaN(validatedAtMs) &&
      now - validatedAtMs < REVALIDATE_INTERVAL_MS
    ) {
      return current;
    }

    const storedKey = await this.secrets.get(LICENSE_SECRET_KEY);
    if (!storedKey || !storedKey.trim()) {
      return this.downgradeToFree(true);
    }

    try {
      const result = await this.apiClient.validate(
        storedKey.trim(),
        this.config.organizationId,
        current.activationId
      );

      if (result.status !== 'granted') {
        return this.downgradeToFree(true);
      }

      const refreshed: LicenseState = {
        tier: 'pro',
        keyMask: current.keyMask ?? maskLicenseKey(storedKey),
        activationId: current.activationId,
        validatedAtIso: new Date(now).toISOString(),
        graceUntilIso: new Date(now + OFFLINE_GRACE_MS).toISOString(),
        offlineGraceActive: false,
      };
      await this.globalState.update(LICENSE_STATE_KEY, refreshed);
      return { ...refreshed };
    } catch (error) {
      if (error instanceof PolarApiError && error.isRevokedOrInvalid) {
        return this.downgradeToFree(true);
      }

      if (!Number.isNaN(graceUntilMs) && now <= graceUntilMs) {
        const graceState: LicenseState = {
          ...current,
          offlineGraceActive: true,
        };
        await this.globalState.update(LICENSE_STATE_KEY, graceState);
        return { ...graceState };
      }

      return this.downgradeToFree(false);
    }
  }

  async deactivate(): Promise<LicenseState> {
    const current = this.getState();
    const storedKey = await this.secrets.get(LICENSE_SECRET_KEY);

    if (storedKey && current.activationId) {
      try {
        await this.apiClient.deactivate(
          storedKey.trim(),
          this.config.organizationId,
          current.activationId
        );
      } catch {
        // Best-effort remote deactivation; always clear local state.
      }
    }

    return this.downgradeToFree(true);
  }

  private async downgradeToFree(clearSecret: boolean): Promise<LicenseState> {
    if (clearSecret) {
      await this.secrets.delete(LICENSE_SECRET_KEY);
    }
    const freeState: LicenseState = { ...FREE_STATE };
    await this.globalState.update(LICENSE_STATE_KEY, freeState);
    return freeState;
  }
}
