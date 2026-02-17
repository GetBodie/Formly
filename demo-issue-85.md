# Fix: Remove Step 1 label from welcome email

*2026-02-17T18:17:05Z*

```bash
grep -n 'Complete this intake' apps/api/src/lib/email.ts
```

```output
43:        <p>Complete this intake form to help us understand what documents we'll need:</p>
```

```bash
grep -c 'Step [0-9]' apps/api/src/lib/email.ts || echo 'No Step N references found'
```

```output
0
No Step N references found
```
