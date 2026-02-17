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
