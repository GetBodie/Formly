# Fix #61: Connect account stuck in loading state

*2026-02-17T17:56:12Z*

```bash
grep -n 'pageshow\|visibilitychange\|isConnecting.*false\|bfcache' apps/web/src/pages/NewEngagement.tsx
```

```output
107:  const [isConnecting, setIsConnecting] = useState(false)
136:  // Reset isConnecting when user returns via back/forward cache (bfcache)
138:  // then cancels/closes and navigates back — the bfcache restores JS state with isConnecting=true
145:    window.addEventListener('pageshow', handlePageShow)
146:    return () => window.removeEventListener('pageshow', handlePageShow)
156:    document.addEventListener('visibilitychange', handleVisibilityChange)
157:    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
```

Bug: handleOAuthConnect sets isConnecting=true then redirects via window.location.href. If user cancels OAuth and returns via back button, bfcache restores JS state with isConnecting still true, leaving the button stuck in 'Connecting...' spinner. Fix: Added pageshow event listener (fires on bfcache restore) and visibilitychange listener to reset isConnecting when user returns to the page.
