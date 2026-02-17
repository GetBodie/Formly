# Fix: Replace weird stroked exclamation icon with filled version

*2026-02-17T18:19:14Z*

```bash
grep -n 'fill="currentColor".*path.*M12 2C6.48' apps/web/src/pages/EngagementDetail.tsx
```

```output
426:              <svg className="w-5 h-5 text-red-600" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
479:                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
820:                      <svg className="w-4 h-4 flex-shrink-0 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" /></svg>
```

Replaced 3 stroked exclamation-circle SVGs with filled versions. The stroked icon at 12px rendered like a clock icon. Filled version is unmistakably an exclamation warning.
