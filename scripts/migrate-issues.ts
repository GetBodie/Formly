#!/usr/bin/env npx ts-node

/**
 * Migrates existing document issues to the new parseable format.
 *
 * Old format: [type] description
 * New format: [SEVERITY:TYPE:EXPECTED:DETECTED] description
 *
 * Usage:
 *   npx ts-node scripts/migrate-issues.ts
 *   npm run migrate:issues (if script added to package.json)
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface Document {
  id: string
  fileName: string
  storageItemId: string
  sharepointItemId?: string
  documentType: string
  confidence: number
  taxYear: number | null
  issues: string[]
  classifiedAt: string | null
  approved?: boolean | null
  approvedAt?: string | null
  override?: { originalType: string; reason: string } | null
}

// Issue types that should be treated as errors (block completion)
const ERROR_TYPES = ['wrong_year', 'wrong_type', 'incomplete', 'illegible']

function migrateIssue(issue: string): string {
  // Already in new format [SEVERITY:TYPE:...
  if (/^\[\w+:\w+:/.test(issue)) {
    return issue
  }

  // Old format: [type] description
  const legacyMatch = issue.match(/^\[(\w+)\]\s*(.+)$/)
  if (legacyMatch) {
    const [, type, description] = legacyMatch
    const severity = ERROR_TYPES.includes(type) ? 'ERROR' : 'WARNING'

    // Try to extract expected/detected values from description
    let expected = ''
    let detected = ''

    // Handle "document is from XXXX, expected YYYY" pattern
    const yearMatch = description.match(/from\s+(\d{4}),?\s+expected\s+(\d{4})/i)
    if (yearMatch) {
      detected = yearMatch[1]
      expected = yearMatch[2]
    }

    return `[${severity}:${type}:${expected}:${detected}] ${description}`
  }

  // Unknown format - wrap as warning with 'other' type
  return `[WARNING:other::] ${issue}`
}

async function main() {
  console.log('Starting issue format migration...')

  const engagements = await prisma.engagement.findMany({
    select: {
      id: true,
      clientName: true,
      documents: true,
    },
  })

  console.log(`Found ${engagements.length} engagements to check`)

  let migratedCount = 0
  let issueCount = 0

  for (const engagement of engagements) {
    const documents = (engagement.documents as Document[] | null) ?? []
    let updated = false

    for (const doc of documents) {
      if (!doc.issues || doc.issues.length === 0) continue

      const migratedIssues = doc.issues.map(issue => {
        const migrated = migrateIssue(issue)
        if (migrated !== issue) {
          issueCount++
          updated = true
        }
        return migrated
      })

      doc.issues = migratedIssues
    }

    if (updated) {
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { documents },
      })
      migratedCount++
      console.log(`  Migrated: ${engagement.clientName} (${engagement.id})`)
    }
  }

  console.log('\nMigration complete!')
  console.log(`  Engagements updated: ${migratedCount}`)
  console.log(`  Issues migrated: ${issueCount}`)
}

main()
  .catch(e => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
