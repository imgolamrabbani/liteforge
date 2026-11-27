import type { LicenseManager } from './licenseManager';

export type ProFeatureId = 'inline_edit' | 'schema_erd' | 'db_diff' | 'sql_dump';

export const PRO_FEATURE_LABELS: Record<
  ProFeatureId,
  { title: string; summary: string }
> = {
  inline_edit: {
    title: 'Transactional Inline Cell & Row Editor',
    summary:
      'Stage cell updates, row inserts, and deletes with exact SQL diff preview and atomic disk write-back.',
  },
  schema_erd: {
    title: 'Visual Schema & Foreign-Key ERD Inspector',
    summary:
      'Explore table columns, primary/foreign keys, indexes, and an interactive foreign-key relationship graph.',
  },
  db_diff: {
    title: 'Local 2-File SQLite Schema Diff & Migration Generator',
    summary:
      'Compare two .sqlite files locally and generate deterministic CREATE/ALTER/INDEX migration SQL.',
  },
  sql_dump: {
    title: 'Full .sql Schema + Data Dump & Multi-Table Export',
    summary:
      'Export complete transactional .sql scripts (including BLOB hex literals) and multi-table JSON bundles.',
  },
};

export class FeatureGate {
  constructor(
    private readonly licenseManager: LicenseManager,
    private readonly checkoutUrl: string
  ) {}

  isAllowed(feature: ProFeatureId): boolean {
    void feature;
    return this.licenseManager.isPro();
  }

  requirePro(
    feature: ProFeatureId,
    onBlocked?: (feature: ProFeatureId, checkoutUrl: string) => void
  ): boolean {
    if (this.isAllowed(feature)) {
      return true;
    }
    onBlocked?.(feature, this.checkoutUrl);
    return false;
  }

  getCheckoutUrl(): string {
    return this.checkoutUrl;
  }
}
