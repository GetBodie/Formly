#!/usr/bin/env tsx
/**
 * Formly Eval Script
 *
 * Runs document classification evaluation against ground truth.
 *
 * Usage:
 *   pnpm eval           # Full evaluation
 *   pnpm eval:quick     # Quick mode (subset of docs)
 */

import fs from "fs";
import path from "path";

interface GroundTruthEntry {
  docPath: string;
  expectedType: string;
  expectedYear?: string;
  expectedFields?: Record<string, unknown>;
  shouldHaveIssues?: boolean;
  notTypes?: string[];
  invalidFields?: string[];
}

interface EvalResult {
  docPath: string;
  passed: boolean;
  expectedType: string;
  actualType?: string;
  errors: string[];
}

interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  accuracy: number;
  results: EvalResult[];
}

const QUICK_LIMIT = 5;
const DEFAULT_FAIL_THRESHOLD = 80;

function parseArgs(): { quick: boolean; ci: boolean; failThreshold: number } {
  const args = process.argv.slice(2);
  return {
    quick: args.includes("--quick"),
    ci: args.includes("--ci"),
    failThreshold: parseInt(
      args.find((a) => a.startsWith("--fail-threshold="))?.split("=")[1] ||
        String(DEFAULT_FAIL_THRESHOLD),
      10
    ),
  };
}

async function loadGroundTruth(): Promise<GroundTruthEntry[]> {
  const gtPath = path.join(import.meta.dirname, "ground-truth.json");
  const content = fs.readFileSync(gtPath, "utf-8");
  return JSON.parse(content);
}

async function classifyDocument(
  _docPath: string
): Promise<{ type: string; fields: Record<string, unknown> } | null> {
  // TODO: Implement actual API call to classifier
  // For now, return null to indicate not implemented
  return null;
}

async function evaluateDocument(
  entry: GroundTruthEntry
): Promise<EvalResult> {
  const errors: string[] = [];

  try {
    const result = await classifyDocument(entry.docPath);

    if (!result) {
      return {
        docPath: entry.docPath,
        passed: false,
        expectedType: entry.expectedType,
        errors: ["Classifier not implemented yet"],
      };
    }

    // Check type classification
    if (result.type !== entry.expectedType) {
      errors.push(
        `Type mismatch: expected ${entry.expectedType}, got ${result.type}`
      );
    }

    // Check negative types (should NOT match these)
    if (entry.notTypes?.includes(result.type)) {
      errors.push(`Incorrectly matched forbidden type: ${result.type}`);
    }

    // Check expected fields
    if (entry.expectedFields) {
      for (const [key, value] of Object.entries(entry.expectedFields)) {
        if (result.fields[key] !== value) {
          errors.push(
            `Field mismatch for ${key}: expected ${value}, got ${result.fields[key]}`
          );
        }
      }
    }

    // Check invalid fields (should be null/undefined)
    if (entry.invalidFields) {
      for (const field of entry.invalidFields) {
        if (result.fields[field] != null) {
          errors.push(
            `Field ${field} should be null but got ${result.fields[field]}`
          );
        }
      }
    }

    return {
      docPath: entry.docPath,
      passed: errors.length === 0,
      expectedType: entry.expectedType,
      actualType: result.type,
      errors,
    };
  } catch (error) {
    return {
      docPath: entry.docPath,
      passed: false,
      expectedType: entry.expectedType,
      errors: [`Error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

async function runEval(): Promise<void> {
  const { quick, ci, failThreshold } = parseArgs();

  console.log("🧪 Formly Document Classifier Evaluation");
  console.log("=========================================\n");

  let groundTruth = await loadGroundTruth();

  if (groundTruth.length === 0) {
    console.log("⚠️  No ground truth entries found.");
    console.log("   Add test documents to eval/docs/ and entries to ground-truth.json\n");
    process.exit(0);
  }

  if (quick) {
    console.log(`📋 Quick mode: testing ${QUICK_LIMIT} of ${groundTruth.length} documents\n`);
    groundTruth = groundTruth.slice(0, QUICK_LIMIT);
  } else {
    console.log(`📋 Testing ${groundTruth.length} documents\n`);
  }

  const results: EvalResult[] = [];

  for (const entry of groundTruth) {
    process.stdout.write(`  Testing ${entry.docPath}... `);
    const result = await evaluateDocument(entry);
    results.push(result);

    if (result.passed) {
      console.log("✅");
    } else {
      console.log("❌");
      for (const error of result.errors) {
        console.log(`     ${error}`);
      }
    }
  }

  const summary: EvalSummary = {
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    accuracy: (results.filter((r) => r.passed).length / results.length) * 100,
    results,
  };

  console.log("\n=========================================");
  console.log("📊 Results Summary");
  console.log("=========================================");
  console.log(`   Total:    ${summary.total}`);
  console.log(`   Passed:   ${summary.passed}`);
  console.log(`   Failed:   ${summary.failed}`);
  console.log(`   Accuracy: ${summary.accuracy.toFixed(1)}%`);
  console.log("");

  if (ci) {
    if (summary.accuracy < failThreshold) {
      console.log(
        `❌ CI FAILED: Accuracy ${summary.accuracy.toFixed(1)}% < threshold ${failThreshold}%`
      );
      process.exit(1);
    } else {
      console.log(`✅ CI PASSED: Accuracy ${summary.accuracy.toFixed(1)}% >= threshold ${failThreshold}%`);
    }
  }
}

runEval().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
