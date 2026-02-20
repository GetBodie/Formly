/**
 * Friendly document type labels for display throughout the UI.
 * Keys match DOCUMENT_TYPES from api/client.ts.
 */
export const FRIENDLY_DOCUMENT_LABELS: Record<string, string> = {
  'W-2': 'W-2 · Wage Statement',
  '1099-NEC': '1099-NEC · Non-Employee Compensation',
  '1099-MISC': '1099-MISC · Miscellaneous Income',
  '1099-INT': '1099-INT · Interest Income',
  'K-1': 'K-1 · Partnership Income',
  'RECEIPT': 'Receipt',
  'STATEMENT': 'Statement',
  'OTHER': 'Other',
  'PENDING': 'Processing…',
}

/**
 * Get a friendly label for a document type.
 * Falls back to the raw type if no mapping exists.
 * Coerces to string defensively — Prisma JSON fields may return unexpected types at runtime.
 */
export function getFriendlyDocType(type: string | unknown): string {
  if (typeof type !== 'string') return String(type ?? 'Unknown')
  return FRIENDLY_DOCUMENT_LABELS[type] || type
}

/**
 * Get a short friendly label (without the explanation after ·)
 * for use in compact contexts like table cells.
 */
export function getShortDocType(type: string): string {
  if (type === 'PENDING') return 'Processing…'
  return type
}
