# Fix: Visual bug on Approve CTA (#76)

*2026-02-17T17:58:42Z*

Fix: Added min-w-0 to both action buttons in EngagementDetail.tsx to override CSS min-width:auto default on flex items, ensuring equal width distribution. Also updated button text from 'Approve' to 'Approve Anyway' to match the context (approving despite unresolved issues).

```bash
grep -n 'min-w-0.*flex-1\|flex-1.*min-w-0' apps/web/src/pages/EngagementDetail.tsx
```

```output
871:            className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors whitespace-nowrap"
879:            className="flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 h-9 px-3 bg-[#171717] text-white text-sm font-medium rounded-lg hover:bg-black disabled:opacity-50 transition-colors whitespace-nowrap"
```

```bash
grep -n 'Approve Anyway' apps/web/src/pages/EngagementDetail.tsx
```

```output
874:            {actionInProgress === 'approve' ? 'Approving...' : 'Approve Anyway'}
```
