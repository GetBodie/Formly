# Fix: Handle deleted Dropbox files

*2026-02-17T19:38:11Z*

When files are deleted from Dropbox, the poll-engagement sync now archives matching documents with archivedAt timestamp and reason. The Dropbox client already detected deleted entries but poll-engagement was ignoring them.

```bash
grep -n 'deletedFiles\|archivedAt\|archivedReason\|deleted from storage' apps/api/src/lib/poll-engagement.ts
```

```output
```

When files are deleted from Dropbox, poll-engagement now archives matching documents with archivedAt and reason.

```bash
grep -n "deletedFiles\|archivedAt\|archivedReason\|deleted from storage" apps/api/src/lib/poll-engagement.ts
```

```output
```

```bash
grep -n 'deleted' apps/api/src/lib/poll-engagement.ts
```

```output
44:    const newFiles = files.filter(file => !file.deleted && !existingIds.has(file.id))
```

```bash
grep -n 'deletedFiles\|archivedAt\|File deleted' apps/api/src/lib/poll-engagement.ts
```

```output
44:    const deletedFiles = files.filter(file => file.deleted)
45:    if (deletedFiles.length > 0) {
46:      const deletedStorageIds = deletedFiles.map(f => f.id)
47:      const deletedFileNames = deletedFiles.map(f => f.name)
53:          archivedAt: null,
66:            archivedAt: new Date(),
67:            archivedReason: 'File deleted from storage provider',
```

```bash
grep -n 'path_display\|path_lower' apps/api/src/lib/storage/dropbox.ts | head -10
```

```output
32:            // For shared folders, use path_display since download needs the path
34:              ? ((entry as { path_display: string }).path_display || `/${entry.name}`)
45:            // For shared folders, use path_display to match stored IDs; otherwise use path_lower
47:              ? ((entry as { path_display?: string }).path_display || `/${entry.name}`)
48:              : ((entry as { path_lower?: string }).path_lower || entry.name),
90:            // For shared folders, use path_display as ID since download needs the path
91:            id: (entry as { path_display: string }).path_display || `/${entry.name}`,
242:          return { folderId: response.result.path_lower || '' }
```

```bash
cd apps/api && npx vitest run --reporter=verbose 2>&1 | tail -5
```

```output
 Test Files  16 passed (16)
      Tests  223 passed (223)
   Start at  14:39:06
   Duration  1.33s (transform 474ms, setup 202ms, collect 2.09s, tests 1.14s, environment 3ms, prepare 890ms)

```
