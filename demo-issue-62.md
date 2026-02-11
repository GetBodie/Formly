# Fix: Remove Typeform socials

*2026-02-11T06:35:48Z*

Issue #62: Remove Typeform social sharing icons from the Thank You screen. The icons appear at the end of the form when users complete it.

Fix: Added share_icons: false to thankyou_screens in both create-typeform.ts and create-demo-typeform.ts. Also added a redirect button to https://getbodie.ai as a branding touchpoint.

```bash
grep -n 'share_icons' formly-repo/scripts/create-typeform.ts formly-repo/scripts/create-demo-typeform.ts
```

```output
formly-repo/scripts/create-typeform.ts:52:        share_icons: false
formly-repo/scripts/create-demo-typeform.ts:52:        share_icons: false
```

```bash
grep -n 'redirect_url\|button_text.*Bodie' formly-repo/scripts/create-typeform.ts formly-repo/scripts/create-demo-typeform.ts
```

```output
formly-repo/scripts/create-typeform.ts:49:        button_text: 'Visit Bodie',
formly-repo/scripts/create-typeform.ts:51:        redirect_url: 'https://getbodie.ai',
formly-repo/scripts/create-demo-typeform.ts:49:        button_text: 'Visit Bodie',
formly-repo/scripts/create-demo-typeform.ts:51:        redirect_url: 'https://getbodie.ai',
```

Note: To apply this change to the production Typeform, the form needs to be recreated using the updated script (requires TYPEFORM_API_KEY). Alternatively, the share_icons setting can be toggled directly in the Typeform UI under form settings.
