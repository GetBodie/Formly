# Feat: List missing documents for client uploads (#116)

*2026-02-21T15:02:25Z*

```bash
grep -n '#116\|missingItems\|missing.*item\|REQUIRED\|ul.*mt-3' apps/web/src/pages/EngagementDetail.tsx
```

```output
323:  const missingItems = checklist.filter(item => item.status === 'pending')
434:          {/* #116: Expanded to list missing documents so clients know what to upload */}
438:              <span className={`text-2xl font-semibold tracking-tight ${missingItems.length > 0 ? 'text-red-600' : 'text-green-600'}`}>
439:                {missingItems.length}
441:              {missingItems.length > 0 && (
443:                  {missingItems.filter(i => i.priority === 'high').length} required
447:            {missingItems.length > 0 && (
448:              <ul className="mt-3 w-full space-y-1 text-sm border-t border-gray-100 pt-3">
449:                {missingItems
456:                        <span className="text-[10px] text-red-500 font-medium flex-shrink-0">REQUIRED</span>
```

```bash
cd apps/web && npx tsc --noEmit 2>&1 | tail -5
```

```output
npm notice
npm notice New major version of npm available! 10.9.4 -> 11.10.1
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.10.1
npm notice To update run: npm install -g npm@11.10.1
npm notice
```
