# Fix #88: Engagement status + metrics confusion

*2026-02-17T18:26:14Z*

Changes to clarify engagement status and metrics UI per issue #88

```bash
grep -n 'statusLabels' apps/web/src/pages/EngagementDetail.tsx
```

```output
31:const statusLabels: Record<string, string> = {
372:              {statusLabels[engagement.status] || engagement.status.replace(/_/g, ' ')}
```

```bash
grep -n 'Missing Documents\|Missing documents\|timeSaved\|Time Saved\|Receipt Status\|Issues' apps/web/src/pages/EngagementDetail.tsx
```

```output
315:  const timeSaved = Math.round(visibleDocuments.length * 0.75)
415:          {/* Time Saved */}
417:            <div className="text-sm text-gray-500">Time Saved</div>
418:            <div className="text-2xl font-semibold tracking-tight">{timeSaved}hrs</div>
422:        {/* Missing Documents Alert */}
430:              <span className="font-medium text-red-800">Missing Documents ({missingItems.length})</span>
679:  const hasUnresolvedIssues = doc.issues.length > 0 && !doc.approvedAt
681:  const friendlyIssues: FriendlyIssue[] = doc.issueDetails || doc.issues.map(issue => {
806:        {/* Issues section - #92: Removed "See All" button, users scroll within container */}
807:        {friendlyIssues.length > 0 && (
810:              <h3 className="text-base font-semibold text-gray-900">Issues</h3>
814:              {friendlyIssues.map((issue, idx) => {
866:      {hasUnresolvedIssues && !doc.archivedAt && (
```

```bash
grep -n 'statusLabels\|Receipt Status\|Action Needed\|Pending Review\|Missing Documents\|#88' apps/web/src/pages/EngagementDetail.tsx | head -20
```

```output
30:// #88: Human-readable status labels instead of internal codes
31:const statusLabels: Record<string, string> = {
277:      setSubjectInput(`Action Needed: Document`)
372:              {statusLabels[engagement.status] || engagement.status.replace(/_/g, ' ')}
422:          {/* #88: Replaced "Time Saved" with "Missing Documents" count — more actionable */}
424:            <div className="text-sm text-gray-500">Missing Documents</div>
436:        {/* #88: Removed redundant Missing Documents banner — info now in stat tile above + Issues column in table */}
445:              <div>Receipt Status</div>
475:                        {/* #88: Receipt-oriented status: Received / Action Needed / Pending Review */}
484:                            Action Needed
489:                            Pending Review
498:                      {/* #88: Issues count column */}
798:                {doc.approvedAt ? 'Approved' : 'Pending Review'}
```

```bash
grep -n '#88\|StatusBadge\|ProgressBar\|colSpan' apps/web/src/pages/Dashboard.tsx | head -10
```

```output
7:function StatusBadge({ completion }: { completion: number }) {
36:function ProgressBar({ value }: { value: number }) {
181:                <td colSpan={5} className="text-center py-12 text-gray-500">
210:                      <StatusBadge completion={completion} />
213:                      <ProgressBar value={completion} />
```
