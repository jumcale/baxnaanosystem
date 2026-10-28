import { describe, it, expect } from 'vitest';
import { resources } from '../i18n';
import {
  BAXNAANO_BRANCHES,
  BRANCH_CODES,
  canAccessModule,
  usdToSlsh,
  slshToUsd,
} from '@baxnaano/shared';
import { getSavedBranchSettingsSync } from '../services/settings.offline';

describe('Baxnaano Client PWA Bilingual & Multi-Branch Verification', () => {
  it('provides complete Somali (so) and English (en) translation dictionaries', () => {
    expect(resources.so.translation.app.title).toBe('Nidaamka Maamulka Baxnaano');
    expect(resources.en.translation.app.title).toBe('Baxnaano Management System');
    expect(Object.keys(resources.so.translation.nav)).toEqual(
      Object.keys(resources.en.translation.nav)
    );
  });

  it('verifies all 3 Baxnaano branches (B1, B2, B3) are configured with accurate types', () => {
    expect(BRANCH_CODES).toHaveLength(3);
    expect(BAXNAANO_BRANCHES.B1.type).toBe('PHARMACY');
    expect(BAXNAANO_BRANCHES.B2.type).toBe('VETERINARY');
    expect(BAXNAANO_BRANCHES.B3.type).toBe('VETERINARY');
  });

  it('converts USD and SLSH currencies accurately for receipts and UI', () => {
    expect(usdToSlsh(10, 8500)).toBe(85000);
    expect(slshToUsd(85000, 8500)).toBe(10);
  });

  it('restricts UI sidebar modules according to role (vet_b2 & vet_b3 allowed modules)', () => {
    expect(canAccessModule('ADMIN', 'SETTINGS')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'DASHBOARD')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'SALES_POINT')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'QUOTATIONS')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'INVENTORY')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'EXPENSES')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'CREDIT_RECORDS')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'SETTINGS')).toBe(true);
    expect(canAccessModule('VET_OFFICER', 'APPOINTMENTS')).toBe(false);
    expect(canAccessModule('VET_OFFICER', 'REPORTS')).toBe(false);
  });

  it('returns default branch settings synchronously when no custom settings exist', () => {
    const settings = getSavedBranchSettingsSync(BAXNAANO_BRANCHES.B1.id);
    expect(settings.exchangeRate).toBe(8500);
    expect(settings.taxRate).toBe(0);
    expect(settings.receiptHeader).toContain('Baxnaano');
  });
});

