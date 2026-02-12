# Formly Eval

Document classification evaluation suite for testing the Formly document classifier.

## Structure

```
eval/
├── docs/               # Test PDF documents
├── ground-truth.json   # Expected results for each document
├── run-eval.ts         # Evaluation script
├── package.json        # Dependencies
└── README.md           # This file
```

## Usage

### From the API directory

```bash
cd apps/api
pnpm eval           # Run full evaluation
pnpm eval:quick     # Run quick eval (5 docs)
```

### From the eval directory

```bash
cd eval
pnpm install
pnpm eval
pnpm eval:quick
```

### CI Mode

```bash
pnpm eval -- --ci --fail-threshold=80
```

Exits with code 1 if accuracy falls below threshold.

## Ground Truth Format

Each entry in `ground-truth.json` should follow this schema:

```json
{
  "docPath": "docs/w2-sample-1.pdf",
  "expectedType": "W-2",
  "expectedYear": "2025",
  "expectedFields": {
    "employerName": "Acme Corp",
    "wages": 75000
  },
  "shouldHaveIssues": false,
  "notTypes": ["1099-NEC", "1099-MISC"],
  "invalidFields": ["dividends", "interest"]
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `docPath` | ✅ | Path to test document relative to eval/ |
| `expectedType` | ✅ | Expected document classification |
| `expectedYear` | | Tax year expected |
| `expectedFields` | | Key-value pairs that should match |
| `shouldHaveIssues` | | Whether document should flag issues |
| `notTypes` | | Types this doc should NOT match |
| `invalidFields` | | Fields that should be null/missing |

## Adding Test Documents

1. Add PDF to `docs/` folder
2. Create entry in `ground-truth.json`
3. Run `pnpm eval` to verify

## Metrics

The eval script reports:
- **Classification accuracy**: % of docs with correct type
- **Field extraction accuracy**: % of expected fields correct
- **Negative test pass rate**: % of forbidden types correctly rejected
