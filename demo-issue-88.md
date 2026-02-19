# Fix #88: Engagement status + metrics confusion

*2026-02-17T18:42:05Z*

Changes: 1) Removed engagement status badge (PENDING/COLLECTING/READY) - redundant with progress %. 2) Replaced Time Saved tile with Missing Items count tile. 3) Removed separate Missing Documents banner - consolidated into tile. 4) Added Issues column to document table.

```bash
grep -n '#88' apps/web/src/pages/EngagementDetail.tsx
```

```output
23:// #88: Removed statusColors — engagement status badge removed (progress % is sufficient)
310:  // #88: Removed timeSaved metric — replaced by missingItems count in tiles
348:        {/* #88: Removed engagement status badge — progress % already conveys this */}
405:          {/* #88: Replaced "Time Saved" with "Missing Items" — consolidates the red banner into the tile */}
421:        {/* #88: Removed separate Missing Documents banner — info consolidated into "Missing Items" tile above */}
428:            {/* #88: Added Issues column for at-a-glance issue count */}
478:                      {/* #88: Issues count column */}
```

```bash
grep -n '#88' apps/web/src/pages/__tests__/EngagementDetail.test.tsx
```

```output
117:    // #88: Status badge removed — progress % is the primary indicator
```
