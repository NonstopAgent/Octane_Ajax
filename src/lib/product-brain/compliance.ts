/**
 * Compliance rules — deterministic keyword scanning.
 *
 * These implement the "Blocked Product Rules" from AGENTS.md §5.
 * No LLM calls; pattern matching only. Designed for speed and auditability.
 */

import type { ComplianceFlags } from "./types";

// ---------------------------------------------------------------------------
// Signal word lists (case-insensitive substring match)
// ---------------------------------------------------------------------------

const MEDICAL_SIGNALS = [
  "diagnos",
  "treatment",
  "cure",
  "symptom",
  "prescription",
  "medication",
  "disease",
  "chronic",
  "medical advice",
  "health condition",
  "clinical",
  "therapy",
];

const LEGAL_SIGNALS = [
  "legal advice",
  "lawsuit",
  "sue",
  "file a claim",
  "court",
  "attorney",
  "lawyer",
  "contract template",
  "legal document",
  "notariz",
];

const FINANCIAL_SIGNALS = [
  "investment advice",
  "tax advice",
  "trading strategy",
  "stock pick",
  "portfolio advice",
  "cryptocurrency investment",
  "financial planning advice",
  "get rich",
];

const IP_BRAND_SIGNALS = [
  "disney",
  "marvel",
  "nike",
  "gucci",
  "louis vuitton",
  "harry potter",
  "star wars",
  "pokemon",
  "nfl",
  "nba",
  "mlb",
  "ncaa",
  "university of",
  "harvard",
  "stanford",
  "official",
];

const MISLEADING_SIGNALS = [
  "guaranteed result",
  "guaranteed income",
  "get rich quick",
  "overnight success",
  "official outcome",
  "100% success",
  "scientifically proven to",
];

const IMPERSONATION_SIGNALS = [
  "irs form",
  "government form",
  "official government",
  "bank statement",
  "bank document",
  "social security",
  "passport template",
  "driver license template",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function containsAny(text: string, signals: string[]): string[] {
  const lower = text.toLowerCase();
  return signals.filter((s) => lower.includes(s));
}

function checkText(text: string): {
  flags: ComplianceFlags;
  warnings: string[];
} {
  const flags: ComplianceFlags = {
    medical: false,
    legal: false,
    financial: false,
    ip_brand: false,
    misleading: false,
    impersonation: false,
  };
  const warnings: string[] = [];

  const medHits = containsAny(text, MEDICAL_SIGNALS);
  if (medHits.length > 0) {
    flags.medical = true;
    warnings.push(`Medical content signals: ${medHits.join(", ")}`);
  }

  const legalHits = containsAny(text, LEGAL_SIGNALS);
  if (legalHits.length > 0) {
    flags.legal = true;
    warnings.push(`Legal content signals: ${legalHits.join(", ")}`);
  }

  const finHits = containsAny(text, FINANCIAL_SIGNALS);
  if (finHits.length > 0) {
    flags.financial = true;
    warnings.push(`Financial advice signals: ${finHits.join(", ")}`);
  }

  const ipHits = containsAny(text, IP_BRAND_SIGNALS);
  if (ipHits.length > 0) {
    flags.ip_brand = true;
    warnings.push(`IP/brand signals: ${ipHits.join(", ")}`);
  }

  const misleadHits = containsAny(text, MISLEADING_SIGNALS);
  if (misleadHits.length > 0) {
    flags.misleading = true;
    warnings.push(`Misleading claims signals: ${misleadHits.join(", ")}`);
  }

  const impersonHits = containsAny(text, IMPERSONATION_SIGNALS);
  if (impersonHits.length > 0) {
    flags.impersonation = true;
    warnings.push(`Impersonation risk signals: ${impersonHits.join(", ")}`);
  }

  return { flags, warnings };
}

export function checkCompliance(
  text: string,
): { flags: ComplianceFlags; warnings: string[] } {
  return checkText(text);
}

export function isBlocked(flags: ComplianceFlags): boolean {
  return Object.values(flags).some(Boolean);
}
