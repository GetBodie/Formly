# Fix: Table UX and Friendly Titles #84 #118

*2026-02-19T16:33:33Z*

```bash
cd apps/web && npx tsc --noEmit 2>&1; echo 'TypeScript: OK'
```

```output
TypeScript: OK
```

```bash
grep -n 'getFriendlyDocType' apps/web/src/utils/documentTypes.ts
```

```output
21:export function getFriendlyDocType(type: string): string {
```

```bash
grep -c 'alert(' apps/web/src/pages/EngagementDetail.tsx || echo '0 alerts found'
```

```output
0
0 alerts found
```

```bash
grep -n 'border-l-\[#042f84\]' apps/web/src/pages/EngagementDetail.tsx
```

```output
493:                          ? 'bg-[#042f84]/[0.04] border-l-[3px] border-l-[#042f84] pl-[5px]'
```

```bash
grep -n 'fadeIn' apps/web/src/index.css
```

```output
4:@keyframes fadeIn {
```
