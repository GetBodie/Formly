// This file previously contained the Claude agent-based assessment system.
// We've switched to the fast assessment path in assessment-fast.ts for better performance.
// 
// If you need to restore the agent-based assessment, the code is available in git history.
// 
// For now, this file contains only utility types and exports that might be needed elsewhere.

// Re-export the assessment trigger type for backwards compatibility
export type AssessmentTrigger = 'document_uploaded' | 'reupload_after_issue'