/**
 * Types for the project validator.
 *
 * This module validates research.json and tree.gedcomx.json against their
 * published schemas, plus additional cross-file and sidecar checks.
 */

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationReport {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

// Helper to create a validation report
export function createReport(): ValidationReport {
  return {
    errors: [],
    warnings: []
  };
}

export function addError(report: ValidationReport, path: string, message: string): void {
  report.errors.push({ path, message });
}

export function addWarning(report: ValidationReport, path: string, message: string): void {
  report.warnings.push({ path, message });
}

export function isValid(report: ValidationReport): boolean {
  return report.errors.length === 0;
}
