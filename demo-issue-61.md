# Fix #61: Connect account stuck in loading state

*2026-02-17T17:57:36Z*

```bash
grep -n 'pageshow\|visibilitychange\|isConnecting.*false\|bfcache' apps/web/src/pages/NewEngagement.tsx
```

```output
78:  const [isConnecting, setIsConnecting] = useState(false)
107:  // Reset isConnecting when user returns via back/forward cache (bfcache)
109:  // The bfcache restores the page with isConnecting=true, leaving the button stuck
116:    window.addEventListener('pageshow', handlePageShow)
117:    return () => window.removeEventListener('pageshow', handlePageShow)
127:    document.addEventListener('visibilitychange', handleVisibilityChange)
128:    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
```

Bug: handleOAuthConnect sets isConnecting=true then redirects via window.location.href. If user cancels and returns via back button, bfcache restores JS state with isConnecting=true. Fix: pageshow + visibilitychange event listeners to reset the state.
