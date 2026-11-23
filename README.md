# Cutlist

A price-aware **1D cutting-stock optimiser** for timber, pipe, tube, bar and any other linear material.

Most cut-list calculators minimise waste only. Cutlist prices every stock piece and finds the **cheapest shopping list**, then also solves the least-waste objective so you can see exactly what the cheaper plan costs in offcuts.

- **Price mode**: minimise total purchase price, then total material used, then prefer longer reusable offcuts.
- **Waste mode**: minimise total material purchased, then price, then prefer longer reusable offcuts.
- Both are solved on every run and compared side by side.

## Features

- Stock rows with length, **price per piece**, and an optional quantity limit (blank = unlimited).
- Parts with labels, lengths and quantities.
- Kerf / blade width, left and right end trims, and a minimum reusable offcut.
- Exact branch-and-bound search over cutting patterns.
- **Proven optimal** badge when the search completes; honest **best found** status otherwise.
- Visual board diagrams, per-board cut sequences, shopping list, and a material breakdown.
- Copy the plan as text, or print it for the workshop.
- Metric millimetres and AUD (prices per stock piece).
- Jobs are saved automatically in the browser.
- Responsive layout and print styles.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # solver correctness vs brute force
npm run build      # type-check and production build
npm run preview    # serve the production build
```

The app opens with a sample shelving job already solved. Press **Optimise** after editing.

## Why price optimisation is different

Choosing the cheapest *per metre* stock is not the same as choosing the cheapest *combination* of boards. Short offcuts, quantity limits and kerf all change the answer. Cutlist compares complete cutting plans:

- one long board versus several short ones
- cheap limited stock (offcuts) versus an unlimited length
- the extra material a lower price may cost you

The **Price vs waste** card shows both plans and the trade-off. For the sample job:

| Plan | Price | Waste |
| --- | ---: | ---: |
| Cheapest | $75.50 | 1,000 mm |
| Least waste | $79.20 | 400 mm |

The cheapest plan saves $3.70 and uses the four cheap 1.2 m offcuts; the least-waste plan buys 600 mm less material.

## How the solver works

The solver lives in `wasm/src/lib.rs`, compiled to WebAssembly and run in a Web Worker so the UI stays responsive.

1. **Enumerate maximal cutting patterns.** A pattern is a set of parts that fills one stock piece and cannot take another demanded part. Maximal patterns are sufficient for an optimum.
2. **Branch and bound on the longest remaining part.** Every board that contains it is tried. Boards are matched to stock with quantity limits.
3. **Exact transposition table.** The residual state is (remaining part counts, remaining limited stock). States are encoded as a mixed-radix integer and memoised with the best accumulated cost, so equivalent board orders and duplicate packings are explored once.
4. **Bounds.** Price mode uses a fractional knapsack lower bound priced per usable length, plus a board-count bound. Waste mode uses a kerf/trim-aware length bound. The transposition table and incumbent comparison apply the reusable-offcut tie-break.

The search reserves 40% of the effort budget for pattern generation and the rest for branch and bound. If a limit is reached, the best plan found is returned with `proven: false`; the UI shows **Best found** and a note. Typical jobs with around 30 parts and 10 part types are proved optimal within the 10 s default. Larger jobs benefit from the 30 s / 60 s effort settings.

Some conventions:

- Kerf is charged **between** parts on a board. The final saw cut comes out of the offcut.
- Trims are removed from both ends before packing.
- Offcuts at least as long as the minimum offcut are reported as reusable; shorter remnants are scrap.
- Lengths are integer micrometres and prices integer cents internally, so all arithmetic is exact.
- Stock price is per piece, in AUD.

## Rebuilding the WASM solver

The compiled module is in `src/wasm/pkg/`, so a normal `npm install && npm run dev` does **not** need Rust.

To rebuild it:

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.126
npm run build:wasm
```

The worker loads the WASM module when a job is solved. If the module cannot be loaded, the app reports the error instead of silently producing a plan.

## Tests

```bash
npm test
```

- `src/lib/wasm.test.ts` compares the Rust/WASM solver against an independent brute-force bin-packing oracle on **120 random small jobs**, covering price/waste objectives, kerf, trims, quantities and infeasible jobs.
- Fixed cases cover objective selection, reusable-offcut preference, kerf accounting, trims, stock limits, invalid parts and parts that are too long.

Browser smoke test (needs Chrome and the dev server running):

```bash
npm run dev
node scripts/check.mjs        # BASE_URL=... CHROME_PATH=... also accepted
```

Solver benchmark:

```bash
node scripts/bench-wasm.mjs
```

## Project layout

```
src/
  App.tsx                 app state, workers, persistence
  components/             inputs, results, board bars, icons
  lib/
    solverTypes.ts        shared wire types for the WASM solver
    solver.worker.ts      loads WASM and runs it off the main thread
    job.ts                rows, sample data, unit conversion
    format.ts             mm / m / AUD formatting
    planText.ts           copyable plan text
    *.test.ts             correctness tests
  wasm/pkg/               generated WASM + JS glue (committed)
wasm/
  Cargo.toml
  src/lib.rs              Rust solver
scripts/                  benchmark and browser smoke tools
```

## Not included (yet)

- Mitre/angle cuts, sheet cutting or circle packing.
- Multi-material grouping in one job (use separate jobs).
- Server-side accounts or shared plans.
- Currency selection (AUD is fixed in the UI; prices are currency-agnostic internally).
- A browser-independent CLI for the Rust solver.

## Licence

Private project. Add a licence before distributing.
