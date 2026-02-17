# Fix #78: OAuth clears previous selections in engagement form

*2026-02-17T17:55:38Z*

```bash
grep -n 'SESSION_STORAGE_KEY\|saveFormState\|loadAndClearFormState\|restoredClient\|defaultValue.*restored' apps/web/src/pages/NewEngagement.tsx
```

```output
67:const SESSION_STORAGE_KEY = 'formly_new_engagement_form_state'
77:function saveFormState(state: SavedFormState) {
79:    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state))
83:function loadAndClearFormState(): SavedFormState | null {
85:    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
87:      sessionStorage.removeItem(SESSION_STORAGE_KEY)
102:  const [restoredClientName, setRestoredClientName] = useState('')
103:  const [restoredClientEmail, setRestoredClientEmail] = useState('')
167:    const saved = loadAndClearFormState()
233:      saveFormState({
393:                defaultValue={restoredClientName}
408:                defaultValue={restoredClientEmail}
```
