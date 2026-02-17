# Fix: Typeform back button navigation

*2026-02-17T19:38:33Z*

Issue #75: Typeform intake form needs a back button so users can go back and fix incorrect selections. Root cause: form settings did not explicitly set hide_navigation: false, which may default to hiding navigation arrows in Typeform.

```bash
grep -n 'hide_navigation' scripts/create-typeform.ts scripts/create-demo-typeform.ts
```

```output
scripts/create-demo-typeform.ts:27:    hide_navigation: false,
```

```bash
grep -n 'show_key_hint' scripts/create-typeform.ts scripts/create-demo-typeform.ts
```

```output
scripts/create-demo-typeform.ts:28:    show_key_hint_on_choices: true,
```
