# Fix: Document classification consistency

*2026-02-17T19:41:39Z*

Three fixes for classification inconsistency (issue #67)

```bash
grep -n 'temperature: 0' apps/api/src/lib/agents/classifier-agent.ts
```

```output
380:    temperature: 0,
440:    temperature: 0,
489:    temperature: 0,
```

```bash
grep -n 'classify_type' apps/api/src/lib/agents/classifier-agent.ts | head -10
```

```output
```

```bash
grep -n 'normalizeIssue' apps/api/src/lib/issues.ts | head -5
```

```output
56:export function normalizeIssue(issue: string): string {
113:export function normalizeIssues(issues: string[]): string[] {
114:  return issues.map(normalizeIssue)
```

```bash
npx vitest run apps/api/src/lib/__tests__/issues.test.ts apps/api/src/lib/agents/__tests__/classifier-agent.test.ts apps/web/src/utils/__tests__/issues.test.ts 2>&1 | tail -5
```

```output
[2m Test Files [22m [1m[32m3 passed[39m[22m[90m (3)[39m
[2m      Tests [22m [1m[32m68 passed[39m[22m[90m (68)[39m
[2m   Start at [22m 14:41:40
[2m   Duration [22m 243ms[2m (transform 129ms, setup 0ms, import 249ms, tests 9ms, environment 0ms)[22m

```
