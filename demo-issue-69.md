# Fix: Ability to clear dashboard

*2026-02-17T19:37:19Z*

```bash
grep -n 'clear-dashboard-btn\|Clear All\|handleClearDemo' apps/web/src/pages/Dashboard.tsx
```

```output
62:      handleClearDemo()
71:  const handleClearDemo = async () => {
128:              onClick={handleClearDemo}
131:              data-testid="clear-dashboard-btn"
136:              {clearing ? 'Clearing...' : 'Clear All'}
```

```bash
cd apps/web && npx vitest run src/pages/__tests__/Dashboard.test.tsx 2>&1 | tail -5
```

```output
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  14:38:07
   Duration  528ms (transform 39ms, setup 57ms, collect 55ms, tests 83ms, environment 118ms, prepare 42ms)

```
