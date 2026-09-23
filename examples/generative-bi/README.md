# Generative BI example

The M1 acceptance loop, end to end, on a synthetic fixture.

```bash
pnpm install && pnpm build
pnpm dev            # http://localhost:5173
```

No key, no account, no network call, no model invocation. The toolbar shows a
live **model calls** counter; nothing in this demo can increment it.

## What to try

1. **Change the environment filter to Development.** The metric, chart, and
   table update together in one evaluation epoch — the metric never shows a new
   number beside a stale table.
2. **Click a bar in "Cost by service".** The selection is a committed document
   change. The table filters; the chart *highlights* rather than filtering, so
   you keep your context.
3. **Change the reduction assumption from 20% to 30%.** Savings move
   `$1,200.00 → $1,800.00` and projected cost `$8,800.00 → $8,200.00`. Watch
   the query counter: it does not move, because no query depends on an
   assumption. The arithmetic is integer minor units, so this is exact.
4. **Type in a field without submitting, then press "Run scripted agent".** The
   agent appends a scene through the same command gateway. Your draft survives.
   If the agent had changed the same value, submitting would show you both.
5. **Switch presentation to Feed or Stack.** You get a stated reason and a
   working Document fallback, not a blank region.
6. **Reload.** Document, revision, and view preferences all come back.

## What this example is not

The fixture values are chosen to make the PRD's worked arithmetic exact. They
are **not** Azure pricing estimates, and the scenario is a projection under
stated assumptions — not a forecast, and not a change to any infrastructure.

## Files worth reading

| File | Why |
|---|---|
| `src/app.tsx` | Wiring: storage, authority, controller, registries |
| `src/scenario-renderer.tsx` | A custom renderer living outside the library |
| `src/storage.ts` | A `StoragePort` over `localStorage`, committing atomically |
