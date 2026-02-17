# Fix: Typeform back button for incorrect selections

*2026-02-17T19:46:12Z*

```bash
grep -n 'show_navigation' scripts/create-typeform.ts scripts/create-demo-typeform.ts
```

```output
scripts/create-typeform.ts:27:    show_navigation: true,
scripts/create-demo-typeform.ts:27:    show_navigation: true,
```

```bash
git diff --stat
```

```output
 apps/api/src/lib/agents/classifier-agent.ts | 1 +
 scripts/create-demo-typeform.ts             | 1 +
 scripts/create-typeform.ts                  | 1 +
 3 files changed, 3 insertions(+)
```

```bash
git diff
```

```output
diff --git a/apps/api/src/lib/agents/classifier-agent.ts b/apps/api/src/lib/agents/classifier-agent.ts
index 641fe95..a8eeefb 100644
--- a/apps/api/src/lib/agents/classifier-agent.ts
+++ b/apps/api/src/lib/agents/classifier-agent.ts
@@ -841,6 +841,7 @@ export async function classifyDocumentAgentic(
     const response = await anthropic.messages.create({
       model: 'claude-opus-4-20250514',
       max_tokens: 4096,
+      temperature: 0,
       system: systemPrompt,
       tools: availableTools,
       messages
diff --git a/scripts/create-demo-typeform.ts b/scripts/create-demo-typeform.ts
index 60900ae..d378969 100755
--- a/scripts/create-demo-typeform.ts
+++ b/scripts/create-demo-typeform.ts
@@ -24,6 +24,7 @@ const formDefinition = {
     is_public: true,
     progress_bar: 'proportion',
     show_progress_bar: true,
+    show_navigation: true,
     meta: {
       allow_indexing: false
     }
diff --git a/scripts/create-typeform.ts b/scripts/create-typeform.ts
index 97dabc6..5c8a584 100755
--- a/scripts/create-typeform.ts
+++ b/scripts/create-typeform.ts
@@ -24,6 +24,7 @@ const formDefinition = {
     is_public: true,
     progress_bar: 'proportion',
     show_progress_bar: true,
+    show_navigation: true,
     meta: {
       allow_indexing: false
     }
```
