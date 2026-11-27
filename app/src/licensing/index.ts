export {
  DEFAULT_POLAR_API_BASE_URL,
  DEFAULT_POLAR_ORGANIZATION_ID,
  HttpPolarApiClient,
  LICENSE_SECRET_KEY,
  LICENSE_STATE_KEY,
  LicenseManager,
  OFFLINE_GRACE_MS,
  PolarApiError,
  REVALIDATE_INTERVAL_MS,
  maskLicenseKey,
} from './licenseManager';
export type {
  LicenseManagerConfig,
  LicenseState,
  PolarApiClient,
  SecretStore,
  StateStore,
  Thenable,
} from './licenseManager';

export { FeatureGate, PRO_FEATURE_LABELS } from './featureGate';
export type { ProFeatureId } from './featureGate';
