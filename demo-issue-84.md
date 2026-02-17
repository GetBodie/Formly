# Fix #84: Table click interaction

*2026-02-17T19:39:14Z*

Changes: 1) Auto-select first document on load. 2) Show clean empty state when no docs exist. 3) Remove 'Select a document' placeholder.

```bash
grep -n '#84' apps/web/src/pages/EngagementDetail.tsx
```

```output
313:  // #84: Auto-select first document so users never see empty "Select a document" state
```

```bash
cd apps/web && npx tsc --noEmit && echo 'TypeScript OK'
```

```output
TypeScript OK
```
