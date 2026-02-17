# Fix #84: Table click interaction

*2026-02-17T19:38:07Z*

```bash
grep -n '#84' apps/web/src/pages/EngagementDetail.tsx
```

```output
312:  // #84: Auto-select first document so users never see empty "Select a document" state
430:        {/* Split Panel — #84: Only show when documents exist */}
520:            {/* #84: Always show document panel when a doc is selected (auto-selected via useEffect) */}
```

```bash
grep -A5 'Auto-select first' apps/web/src/pages/EngagementDetail.tsx
```

```output
```

```bash
grep -A5 '#84: Auto' apps/web/src/pages/EngagementDetail.tsx
```

```output
```

```bash
grep -A5 "Auto-select" apps/web/src/pages/EngagementDetail.tsx
```

```output
```

```bash
sed -n '312,320p' apps/web/src/pages/EngagementDetail.tsx
```

```output
  const selectedDoc = selectedDocId ? allDocuments.find(d => d.id === selectedDocId) : null

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-screen-xl mx-auto px-6 pt-[60px]">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm flex items-center justify-between">
            <span>{error}</span>
```
