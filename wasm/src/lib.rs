#![allow(clippy::needless_range_loop)]

//! Price-aware 1D cutting-stock solver.
//!
//! Model: enumerate maximal patterns (a maximal multiset of parts that fits a
//! stock piece), then branch and bound board by board, always placing the
//! longest remaining part. The residual state (remaining part counts and
//! remaining limited stock) is memoised as a mixed-radix integer so equivalent
//! board orders are explored only once.
//!
//! Objectives are lexicographic:
//!   price mode: total price, then total stock length, then reusable offcut
//!   waste mode: total stock length, then total price, then reusable offcut
//!
//! Lengths are integer micrometres and prices integer cents, so all arithmetic
//! is exact. A result is marked `proven` only when the search completes without
//! hitting its time or pattern limits.

use std::{
    cmp::Ordering,
    collections::HashMap,
    hash::{BuildHasherDefault, Hasher},
};

use js_sys::Date;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

type Memo = HashMap<u128, (i64, i64, i64), BuildHasherDefault<U128Hasher>>;

const DEFAULT_PATTERN_LIMIT: usize = 250_000;
const MEMO_CAP: usize = 1_500_000;

// ---------------------------------------------------------------------------
// Wire format (mirrors src/lib/solver.ts)
// ---------------------------------------------------------------------------

#[derive(Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Objective {
    Price,
    Waste,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolverPart {
    id: String,
    length_um: i64,
    qty: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolverStock {
    id: String,
    length_um: i64,
    price_cents: i64,
    qty: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolverOptions {
    mode: Objective,
    kerf_um: i64,
    left_trim_um: i64,
    right_trim_um: i64,
    min_remnant_um: i64,
    time_limit_ms: f64,
    pattern_limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SolverInput {
    parts: Vec<SolverPart>,
    stocks: Vec<SolverStock>,
    options: SolverOptions,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CutPlanItem {
    part_id: String,
    length_um: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BoardPlan {
    stock_id: String,
    stock_length_um: i64,
    price_cents: i64,
    cuts: Vec<CutPlanItem>,
    pieces: u32,
    parts_um: i64,
    kerf_um: i64,
    trim_um: i64,
    offcut_um: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UnmakeablePart {
    part_id: String,
    qty: u32,
    length_um: i64,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SolveResult {
    mode: String,
    boards: Vec<BoardPlan>,
    total_price_cents: i64,
    total_stock_um: i64,
    total_parts_um: i64,
    total_kerf_um: i64,
    total_trim_um: i64,
    waste_um: i64,
    offcut_um: i64,
    offcut_count: u32,
    board_counts: HashMap<String, u32>,
    proven: bool,
    timed_out: bool,
    patterns_incomplete: bool,
    nodes: u64,
    elapsed_ms: f64,
    unmakeable: Vec<UnmakeablePart>,
    notes: Vec<String>,
    infeasible: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

// ---------------------------------------------------------------------------
// Internal model
// ---------------------------------------------------------------------------

struct PrepStock {
    id: String,
    length_um: i64,
    price_cents: i64,
    qty: Option<u32>,
    usable_um: i64,
}

#[derive(Clone)]
struct Pattern {
    stock: usize,
    counts: Vec<u32>,
    pieces: u32,
    used_um: i64,
}

struct PlanBoard {
    stock: usize,
    counts: Vec<u32>,
}

struct Plan {
    boards: Vec<PlanBoard>,
    price: i64,
    length: i64,
    /// Total length of offcuts at least `min_remnant` long.
    offcut: i64,
}

// ---------------------------------------------------------------------------
// Pattern enumeration
// ---------------------------------------------------------------------------

struct Gen<'a> {
    lens: &'a [i64],
    demands: &'a [u32],
    patterns: Vec<Pattern>,
    stock: usize,
    usable: i64,
    kerf: i64,
    counts: Vec<u32>,
    limit: usize,
    deadline: f64,
    node_count: u32,
    incomplete: bool,
    cap_hit: bool,
    cut_short: bool,
}

// ---------------------------------------------------------------------------
// Branch and bound
// ---------------------------------------------------------------------------

#[derive(Default)]
struct U128Hasher(u64);

struct Search<'a> {
    lens: &'a [i64],
    patterns: &'a [Pattern],
    by_part: &'a [Vec<usize>],
    stocks: &'a [PrepStock],
    mode: Objective,
    kerf: i64,
    trim: i64,
    min_remnant: i64,
    rem: Vec<u32>,
    stock_left: Vec<Option<u32>>,
    stack: Vec<(usize, usize)>,
    best: Option<Plan>,
    nodes: u64,
    timed_out: bool,
    aborted: bool,
    deadline: f64,
    ratio_order: Vec<usize>,
    memo: Memo,
    memo_enabled: bool,
    rem_mult: Vec<u128>,
    stock_mult: Vec<(usize, u128)>,
}

impl Gen<'_> {
    /// Returns true when generation should stop.
    fn walk(&mut self, start: usize, used: i64, pieces: u32) -> bool {
        self.node_count = self.node_count.wrapping_add(1);

        if self.patterns.len() >= self.limit {
            self.incomplete = true;
            self.cap_hit = true;
            return true;
        }
        if self.node_count & 511 == 0 && now_ms() > self.deadline {
            self.incomplete = true;
            self.cut_short = true;
            return true;
        }

        let m = self.lens.len();
        let mut can_extend = false;
        for i in 0..m {
            if self.counts[i] >= self.demands[i] {
                continue;
            }
            let add = (if pieces > 0 { self.kerf } else { 0 }) + self.lens[i];
            if used + add <= self.usable {
                can_extend = true;
                break;
            }
        }

        if !can_extend {
            if pieces > 0 {
                self.patterns.push(Pattern {
                    stock: self.stock,
                    counts: self.counts.clone(),
                    pieces,
                    used_um: used,
                });
            }
            return false;
        }

        for i in start..m {
            if self.counts[i] >= self.demands[i] {
                continue;
            }
            let add = (if pieces > 0 { self.kerf } else { 0 }) + self.lens[i];
            if used + add > self.usable {
                continue;
            }
            self.counts[i] += 1;
            let stop = self.walk(i, used + add, pieces + 1);
            self.counts[i] -= 1;
            if stop {
                return true;
            }
        }
        false
    }
}

impl Hasher for U128Hasher {
    fn finish(&self) -> u64 {
        self.0
    }

    fn write(&mut self, bytes: &[u8]) {
        let mut h = 0xcbf29ce484222325u64;
        for &b in bytes {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
        self.0 = h;
    }

    fn write_u128(&mut self, value: u128) {
        let mut x = (value as u64) ^ ((value >> 64) as u64).rotate_left(29);
        x ^= x >> 33;
        x = x.wrapping_mul(0xff51afd7ed558ccd);
        x ^= x >> 33;
        self.0 = x;
    }
}

impl Search<'_> {
    fn stock_available(&self, si: usize) -> bool {
        stock_available(&self.stock_left[si])
    }

    fn min_price_available(&self) -> Option<i64> {
        self.stocks
            .iter()
            .enumerate()
            .filter(|(i, _)| self.stock_available(*i))
            .map(|(_, s)| s.price_cents)
            .min()
    }

    fn max_usable_available(&self) -> i64 {
        self.stocks
            .iter()
            .enumerate()
            .filter(|(i, _)| self.stock_available(*i))
            .map(|(_, s)| s.usable_um)
            .max()
            .unwrap_or(0)
    }

    fn objective(&self, price: i64, length: i64, offcut: i64) -> (i64, i64, i64) {
        match self.mode {
            Objective::Price => (price, length, -offcut),
            Objective::Waste => (length, price, -offcut),
        }
    }

    fn is_better(&self, price: i64, length: i64, offcut: i64) -> bool {
        let Some(best) = &self.best else {
            return true;
        };
        let current = self.objective(price, length, offcut);
        let stored = self.objective(best.price, best.length, best.offcut);
        current < stored
    }

    /// Mixed-radix code of (remaining parts, remaining limited stock).
    fn encode_state(&self) -> u128 {
        let mut code = 0u128;
        for i in 0..self.rem.len() {
            let count = self.rem[i];
            if count > 0 {
                code += count as u128 * self.rem_mult[i];
            }
        }
        for &(si, mult) in &self.stock_mult {
            if let Some(q) = self.stock_left[si] {
                if q > 0 {
                    code += q as u128 * mult;
                }
            }
        }
        code
    }

    fn search(&mut self, acc_price: i64, acc_length: i64, acc_offcut: i64) {
        self.nodes += 1;
        if self.nodes & 127 == 0 && now_ms() > self.deadline {
            self.timed_out = true;
            self.aborted = true;
            return;
        }

        let m = self.lens.len();
        let mut pick: Option<usize> = None;
        let mut rem_length: i64 = 0;
        let mut rem_pieces: u64 = 0;
        for i in 0..m {
            let r = self.rem[i];
            if r > 0 {
                rem_pieces += r as u64;
                rem_length += (r as i64) * self.lens[i];
                if pick.is_none() || self.lens[i] > self.lens[pick.unwrap()] {
                    pick = Some(i);
                }
            }
        }

        let Some(j) = pick else {
            if self.is_better(acc_price, acc_length, acc_offcut) {
                let patterns = self.patterns;
                let boards = self
                    .stack
                    .iter()
                    .map(|&(si, pi)| PlanBoard {
                        stock: si,
                        counts: patterns[pi].counts.clone(),
                    })
                    .collect();
                self.best = Some(Plan {
                    boards,
                    price: acc_price,
                    length: acc_length,
                    offcut: acc_offcut,
                });
            }
            return;
        };

        // Exact transposition table: reaching the same residual state with an
        // equal or worse accumulated objective can never improve the answer.
        if self.memo_enabled {
            let code = self.encode_state();
            let current = self.objective(acc_price, acc_length, acc_offcut);
            match self.memo.get(&code).copied() {
                Some(stored) => {
                    if stored <= current {
                        return;
                    }
                    self.memo.insert(code, current);
                }
                None => {
                    if self.memo.len() < MEMO_CAP {
                        self.memo.insert(code, current);
                    }
                }
            }
        }

        // ---- bounds ------------------------------------------------------
        let stocks = self.stocks;
        let (primary_lb, secondary_lb) = match self.mode {
            Objective::Price => {
                let mut need = rem_length as f64;
                let mut cost = 0.0f64;
                for &si in &self.ratio_order {
                    if need <= 0.0 {
                        break;
                    }
                    if !self.stock_available(si) {
                        continue;
                    }
                    let s = &stocks[si];
                    let avail = match s.qty {
                        None => need,
                        Some(_) => self.stock_left[si].unwrap_or(0) as f64 * s.usable_um as f64,
                    };
                    let take = need.min(avail);
                    cost += take * s.price_cents as f64 / s.usable_um as f64;
                    need -= take;
                }
                if need > 1e-9 {
                    return;
                }
                let Some(min_price) = self.min_price_available() else {
                    return;
                };
                let max_usable = self.max_usable_available();
                if max_usable <= 0 {
                    return;
                }
                let board_lb = (rem_length as f64 / max_usable as f64).ceil();
                (cost.max(board_lb * min_price as f64), rem_length as f64)
            }
            Objective::Waste => {
                let max_usable = self.max_usable_available();
                if max_usable <= 0 {
                    return;
                }
                let board_lb = (rem_length as f64 / max_usable as f64).ceil() as i64;
                let overhead = self.trim - self.kerf;
                let best_boards = if overhead >= 0 {
                    board_lb
                } else {
                    rem_pieces as i64
                };
                let kerfs = (rem_pieces as i64 - best_boards).max(0);
                let primary = rem_length + self.kerf * kerfs + best_boards * self.trim;
                let Some(min_price) = self.min_price_available() else {
                    return;
                };
                (primary as f64, (board_lb * min_price) as f64)
            }
        };

        let (total_price_lb, total_length_lb) = match self.mode {
            Objective::Price => (
                acc_price as f64 + primary_lb,
                acc_length as f64 + secondary_lb,
            ),
            Objective::Waste => (
                acc_price as f64 + secondary_lb,
                acc_length as f64 + primary_lb,
            ),
        };

        if let Some(best) = &self.best {
            let bp = best.price as f64;
            let bl = best.length as f64;
            match self.mode {
                Objective::Price => {
                    if total_price_lb > bp + 1e-6 {
                        return;
                    }
                    if (total_price_lb - bp).abs() < 1e-6 && total_length_lb > bl + 1e-6 {
                        return;
                    }
                }
                Objective::Waste => {
                    if total_length_lb > bl + 1e-6 {
                        return;
                    }
                    if (total_length_lb - bl).abs() < 1e-6 && total_price_lb > bp + 1e-6 {
                        return;
                    }
                }
            }
        }

        let patterns = self.patterns;
        let by_part = self.by_part;
        let list = &by_part[j];

        for pos in 0..list.len() {
            let pi = list[pos];
            let p = &patterns[pi];
            let stock = &stocks[p.stock];
            if !self.stock_available(p.stock) {
                continue;
            }

            let counts = &p.counts;
            let mut fits = true;
            for i in 0..m {
                if counts[i] > self.rem[i] {
                    fits = false;
                    break;
                }
            }
            if !fits {
                continue;
            }

            for i in 0..m {
                if counts[i] > 0 {
                    self.rem[i] -= counts[i];
                }
            }
            take_stock(&mut self.stock_left[p.stock]);
            self.stack.push((p.stock, pi));

            let board_offcut = stock.usable_um - p.used_um;
            let added_offcut = if board_offcut >= self.min_remnant && board_offcut > 0 {
                board_offcut
            } else {
                0
            };

            self.search(
                acc_price + stock.price_cents,
                acc_length + stock.length_um,
                acc_offcut + added_offcut,
            );

            self.stack.pop();
            give_stock(&mut self.stock_left[p.stock]);
            for i in 0..m {
                if counts[i] > 0 {
                    self.rem[i] += counts[i];
                }
            }

            if self.aborted {
                return;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[wasm_bindgen]
pub fn solve(input_json: &str) -> Result<String, JsValue> {
    let input: SolverInput = serde_json::from_str(input_json)
        .map_err(|e| JsValue::from_str(&format!("Invalid solver input: {e}")))?;
    let result = run(input);
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}

fn give_stock(left: &mut Option<u32>) {
    if let Some(q) = left.as_mut() {
        *q += 1;
    }
}

// ---------------------------------------------------------------------------
// Greedy incumbent
// ---------------------------------------------------------------------------

fn greedy_plan(
    lens: &[i64],
    demands: &[u32],
    stocks: &[PrepStock],
    kerf: i64,
    min_remnant: i64,
    mode: Objective,
) -> Option<Plan> {
    let m = lens.len();
    let mut rem = demands.to_vec();
    let mut left: Vec<Option<u32>> = stocks.iter().map(|s| s.qty).collect();
    let mut part_order: Vec<usize> = (0..m).collect();
    part_order.sort_by(|&a, &b| lens[b].cmp(&lens[a]));

    let mut boards: Vec<PlanBoard> = Vec::new();
    let mut price = 0i64;
    let mut length = 0i64;
    let mut offcut_total = 0i64;
    let mut left_pieces: u64 = demands.iter().map(|&q| q as u64).sum();
    let guard_limit = left_pieces + 10;
    let mut guard = 0u64;

    while left_pieces > 0 {
        guard += 1;
        if guard > guard_limit {
            return None;
        }

        let mut choice: Option<(usize, Vec<u32>, i64)> = None;
        let mut choice_score = f64::INFINITY;

        for si in 0..stocks.len() {
            if !stock_available(&left[si]) {
                continue;
            }
            let stock = &stocks[si];
            let mut counts = vec![0u32; m];
            let mut temp = rem.clone();
            let mut used = 0i64;
            let mut pieces = 0u32;
            let mut parts_um = 0i64;

            for &i in &part_order {
                while temp[i] > 0 {
                    let add = (if pieces > 0 { kerf } else { 0 }) + lens[i];
                    if used + add > stock.usable_um {
                        break;
                    }
                    counts[i] += 1;
                    pieces += 1;
                    used += add;
                    parts_um += lens[i];
                    temp[i] -= 1;
                }
            }
            if pieces == 0 {
                continue;
            }

            let primary = if mode == Objective::Price {
                stock.price_cents
            } else {
                stock.length_um
            };
            let score = primary as f64 / parts_um as f64;
            if score < choice_score {
                choice_score = score;
                choice = Some((si, counts, used));
            }
        }

        let (si, counts, used) = choice?;
        for i in 0..m {
            rem[i] -= counts[i];
        }
        let pieces: u32 = counts.iter().sum();
        left_pieces -= pieces as u64;
        take_stock(&mut left[si]);
        price += stocks[si].price_cents;
        length += stocks[si].length_um;
        let board_offcut = stocks[si].usable_um - used;
        if board_offcut >= min_remnant && board_offcut > 0 {
            offcut_total += board_offcut;
        }
        boards.push(PlanBoard { stock: si, counts });
    }

    Some(Plan {
        boards,
        price,
        length,
        offcut: offcut_total,
    })
}

fn mode_name(mode: Objective) -> String {
    match mode {
        Objective::Price => "price".to_string(),
        Objective::Waste => "waste".to_string(),
    }
}

fn now_ms() -> f64 {
    Date::now()
}

fn run(input: SolverInput) -> SolveResult {
    let start = now_ms();
    let opts = input.options;
    let mode = opts.mode;
    let time_limit = if opts.time_limit_ms.is_finite() {
        opts.time_limit_ms.max(0.0)
    } else {
        0.0
    };
    let deadline = if time_limit > 0.0 {
        start + time_limit
    } else {
        f64::INFINITY
    };
    let pattern_limit = opts.pattern_limit.unwrap_or(DEFAULT_PATTERN_LIMIT).max(1);

    let mut notes: Vec<String> = Vec::new();
    let mut unmakeable: Vec<UnmakeablePart> = Vec::new();
    let kerf = opts.kerf_um.max(0);
    let trim = opts.left_trim_um.max(0) + opts.right_trim_um.max(0);
    let min_remnant = opts.min_remnant_um.max(0);

    let empty = |notes: Vec<String>,
                 unmakeable: Vec<UnmakeablePart>,
                 error: Option<String>,
                 timed_out: bool|
     -> SolveResult {
        SolveResult {
            mode: mode_name(mode),
            boards: vec![],
            total_price_cents: 0,
            total_stock_um: 0,
            total_parts_um: 0,
            total_kerf_um: 0,
            total_trim_um: 0,
            waste_um: 0,
            offcut_um: 0,
            offcut_count: 0,
            board_counts: HashMap::new(),
            proven: !timed_out,
            timed_out,
            patterns_incomplete: false,
            nodes: 0,
            elapsed_ms: now_ms() - start,
            unmakeable,
            notes,
            infeasible: error.is_some(),
            error,
        }
    };

    // -- stock -------------------------------------------------------------
    let mut stocks: Vec<PrepStock> = Vec::new();
    for s in &input.stocks {
        if let Some(q) = s.qty {
            if q == 0 {
                continue;
            }
        }
        let usable_um = s.length_um - opts.left_trim_um - opts.right_trim_um;
        if usable_um <= 0 {
            notes.push(format!(
                "Stock “{}” is shorter than the trims and was ignored.",
                s.id
            ));
            continue;
        }
        stocks.push(PrepStock {
            id: s.id.clone(),
            length_um: s.length_um,
            price_cents: s.price_cents,
            qty: s.qty,
            usable_um,
        });
    }

    let max_usable = stocks.iter().map(|s| s.usable_um).max().unwrap_or(0);

    let raw_parts: Vec<&SolverPart> = input.parts.iter().filter(|p| p.qty > 0).collect();
    let mut parts: Vec<&SolverPart> = Vec::new();
    for p in &raw_parts {
        if p.length_um <= 0 {
            unmakeable.push(UnmakeablePart {
                part_id: p.id.clone(),
                qty: p.qty,
                length_um: p.length_um,
                reason: "invalid".to_string(),
            });
        } else if p.length_um > max_usable {
            unmakeable.push(UnmakeablePart {
                part_id: p.id.clone(),
                qty: p.qty,
                length_um: p.length_um,
                reason: "too-long".to_string(),
            });
        } else {
            parts.push(p);
        }
    }

    if stocks.is_empty() {
        for p in &raw_parts {
            if !unmakeable.iter().any(|u| u.part_id == p.id) {
                unmakeable.push(UnmakeablePart {
                    part_id: p.id.clone(),
                    qty: p.qty,
                    length_um: p.length_um,
                    reason: "too-long".to_string(),
                });
            }
        }
        return empty(
            notes,
            unmakeable,
            Some("No usable stock. Add stock longer than the trims.".to_string()),
            false,
        );
    }

    let m = parts.len();
    if m == 0 {
        let no_unmakeable = unmakeable.is_empty();
        return empty(
            notes,
            unmakeable,
            if no_unmakeable {
                None
            } else {
                Some("None of the required parts fit the available stock.".to_string())
            },
            false,
        );
    }

    let lens: Vec<i64> = parts.iter().map(|p| p.length_um).collect();
    let demands: Vec<u32> = parts.iter().map(|p| p.qty).collect();
    let total_parts_requested: i64 = lens
        .iter()
        .zip(demands.iter())
        .map(|(&l, &q)| l.saturating_mul(q as i64))
        .sum();

    // Capacity check ignoring kerf (rejects clearly impossible jobs only).
    let mut capacity: Option<i64> = Some(0);
    for s in &stocks {
        match s.qty {
            None => capacity = None,
            Some(q) => {
                if let Some(c) = capacity {
                    capacity = Some(c.saturating_add((q as i64).saturating_mul(s.usable_um)));
                }
            }
        }
    }
    if let Some(cap) = capacity {
        if cap < total_parts_requested {
            return empty(
                notes,
                unmakeable,
                Some("The available stock does not provide enough material for all required parts. Increase stock quantities or enable unlimited stock.".to_string()),
                false,
            );
        }
    }

    // -- patterns ----------------------------------------------------------
    // Reserve time for the search: enumeration gets at most 40% of the budget.
    let generation_deadline = if time_limit > 0.0 {
        start + time_limit * 0.4
    } else {
        f64::INFINITY
    };

    let mut gen = Gen {
        lens: &lens,
        demands: &demands,
        patterns: Vec::new(),
        stock: 0,
        usable: 0,
        kerf,
        counts: vec![0; m],
        limit: pattern_limit,
        deadline: generation_deadline,
        node_count: 0,
        incomplete: false,
        cap_hit: false,
        cut_short: false,
    };
    let mut patterns: Vec<Pattern> = Vec::new();
    for si in 0..stocks.len() {
        gen.stock = si;
        gen.usable = stocks[si].usable_um;
        gen.counts.iter_mut().for_each(|c| *c = 0);
        gen.walk(0, 0, 0);
        patterns.append(&mut gen.patterns);
        if gen.incomplete {
            break;
        }
    }
    let (mut patterns_incomplete, pattern_cap_hit, generation_cut_short) =
        (gen.incomplete, gen.cap_hit, gen.cut_short);

    if pattern_cap_hit {
        notes.push(
            "Pattern space was very large, so the search used a pruned pattern set. The plan is valid but optimality is not proven.".to_string(),
        );
    } else if generation_cut_short {
        notes.push(
            "Pattern generation was cut short to leave time for the cutting search. The plan is valid but optimality is not proven.".to_string(),
        );
    }

    let mut by_part: Vec<Vec<usize>> = vec![Vec::new(); m];
    for (pi, p) in patterns.iter().enumerate() {
        for i in 0..m {
            if p.counts[i] > 0 {
                by_part[i].push(pi);
            }
        }
    }

    // Safety net when enumeration was cut short: make sure every part can be
    // placed somewhere.
    for i in 0..m {
        if !by_part[i].is_empty() {
            continue;
        }
        let mut best_stock: Option<usize> = None;
        for (si, s) in stocks.iter().enumerate() {
            if lens[i] <= s.usable_um
                && best_stock.is_none_or(|b| s.usable_um > stocks[b].usable_um)
            {
                best_stock = Some(si);
            }
        }
        if let Some(si) = best_stock {
            let mut counts = vec![0u32; m];
            let mut used = 0i64;
            let mut pieces = 0u32;
            while pieces < demands[i] {
                let add = if pieces > 0 { kerf } else { 0 } + lens[i];
                if used + add > stocks[si].usable_um {
                    break;
                }
                counts[i] += 1;
                pieces += 1;
                used += add;
            }
            if pieces > 0 {
                let pi = patterns.len();
                patterns.push(Pattern {
                    stock: si,
                    counts,
                    pieces,
                    used_um: used,
                });
                by_part[i].push(pi);
                patterns_incomplete = true;
            }
        } else {
            unmakeable.push(UnmakeablePart {
                part_id: parts[i].id.clone(),
                qty: demands[i],
                length_um: lens[i],
                reason: "too-long".to_string(),
            });
        }
    }

    let score: Vec<f64> = patterns
        .iter()
        .map(|p| {
            let s = &stocks[p.stock];
            let primary = if mode == Objective::Price {
                s.price_cents
            } else {
                s.length_um
            };
            primary as f64 / p.pieces.max(1) as f64
        })
        .collect();
    for list in by_part.iter_mut() {
        list.sort_by(|&a, &b| score[a].partial_cmp(&score[b]).unwrap_or(Ordering::Equal));
    }

    // -- transposition table ----------------------------------------------
    // Encode (remaining demand, remaining stock) as a mixed-radix integer.
    // If the state space is too large to encode, the table is simply disabled;
    // correctness never depends on it.
    let mut rem_mult: Vec<u128> = Vec::with_capacity(m);
    let mut stock_mult: Vec<(usize, u128)> = Vec::new();
    let mut memo_enabled = true;
    let mut radix = 1u128;
    for i in 0..m {
        rem_mult.push(radix);
        match radix.checked_mul(demands[i] as u128 + 1) {
            Some(next) => radix = next,
            None => {
                memo_enabled = false;
                break;
            }
        }
    }
    if memo_enabled {
        for (si, s) in stocks.iter().enumerate() {
            if let Some(q) = s.qty {
                stock_mult.push((si, radix));
                match radix.checked_mul(q as u128 + 1) {
                    Some(next) => radix = next,
                    None => {
                        memo_enabled = false;
                        break;
                    }
                }
            }
        }
    }

    // -- greedy incumbent --------------------------------------------------
    let greedy = greedy_plan(&lens, &demands, &stocks, kerf, min_remnant, mode);
    let greedy_cost = greedy.as_ref().map(|p| (p.price, p.length, p.offcut));

    let mut ratio_order: Vec<usize> = (0..stocks.len()).collect();
    ratio_order.sort_by(|&a, &b| {
        let ra = stocks[a].price_cents as f64 / stocks[a].usable_um as f64;
        let rb = stocks[b].price_cents as f64 / stocks[b].usable_um as f64;
        ra.partial_cmp(&rb).unwrap_or(Ordering::Equal)
    });

    let mut search = Search {
        lens: &lens,
        patterns: &patterns,
        by_part: &by_part,
        stocks: &stocks,
        mode,
        kerf,
        trim,
        min_remnant,
        rem: demands.clone(),
        stock_left: stocks.iter().map(|s| s.qty).collect(),
        stack: Vec::new(),
        best: greedy,
        nodes: 0,
        timed_out: false,
        aborted: false,
        deadline,
        ratio_order,
        memo: HashMap::with_hasher(BuildHasherDefault::default()),
        memo_enabled,
        rem_mult,
        stock_mult,
    };
    search.search(0, 0, 0);

    let timed_out = search.timed_out;
    let nodes = search.nodes;
    let best = search.best;

    let Some(plan) = best else {
        let err = if timed_out {
            "No complete plan was found before the time limit. Try a longer solve time or check the part list."
        } else {
            "No feasible cutting plan exists with the current stock, trims and kerf."
        };
        return empty(notes, unmakeable, Some(err.to_string()), timed_out);
    };

    // -- assemble output ---------------------------------------------------
    let mut board_counts: HashMap<String, u32> = HashMap::new();
    let mut boards: Vec<BoardPlan> = Vec::new();
    let mut total_price = 0i64;
    let mut total_stock = 0i64;
    let mut total_kerf = 0i64;
    let mut total_trim = 0i64;
    let mut out_parts = 0i64;
    let mut offcut_total = 0i64;
    let mut offcut_count = 0u32;

    let mut order: Vec<usize> = (0..plan.boards.len()).collect();
    order.sort_by(|&a, &b| {
        let sa = &stocks[plan.boards[a].stock];
        let sb = &stocks[plan.boards[b].stock];
        sb.length_um
            .cmp(&sa.length_um)
            .then(sa.price_cents.cmp(&sb.price_cents))
    });

    for idx in order {
        let b = &plan.boards[idx];
        let stock = &stocks[b.stock];
        let mut cuts: Vec<CutPlanItem> = Vec::new();
        for i in 0..m {
            for _ in 0..b.counts[i] {
                cuts.push(CutPlanItem {
                    part_id: parts[i].id.clone(),
                    length_um: lens[i],
                });
            }
        }
        cuts.sort_by_key(|a| std::cmp::Reverse(a.length_um));

        let pieces = cuts.len() as u32;
        let parts_um: i64 = cuts.iter().map(|c| c.length_um).sum();
        let board_kerf = if pieces > 0 {
            (pieces - 1) as i64 * kerf
        } else {
            0
        };
        let offcut = (stock.usable_um - parts_um - board_kerf).max(0);

        boards.push(BoardPlan {
            stock_id: stock.id.clone(),
            stock_length_um: stock.length_um,
            price_cents: stock.price_cents,
            cuts,
            pieces,
            parts_um,
            kerf_um: board_kerf,
            trim_um: trim,
            offcut_um: offcut,
        });

        *board_counts.entry(stock.id.clone()).or_insert(0) += 1;
        total_price += stock.price_cents;
        total_stock += stock.length_um;
        total_kerf += board_kerf;
        total_trim += trim;
        out_parts += parts_um;
        if offcut >= min_remnant && offcut > 0 {
            offcut_total += offcut;
            offcut_count += 1;
        }
    }

    if timed_out {
        notes.push(
            "The time limit was reached, so this is the best plan found. Increase the solve time to continue the proof.".to_string(),
        );
    }
    if !timed_out {
        if let Some((gp, gl, go)) = greedy_cost {
            if plan.price == gp && plan.length == gl && plan.offcut == go {
                notes.push("Search confirmed the greedy plan was already optimal.".to_string());
            }
        }
    }

    SolveResult {
        mode: mode_name(mode),
        boards,
        total_price_cents: total_price,
        total_stock_um: total_stock,
        total_parts_um: out_parts,
        total_kerf_um: total_kerf,
        total_trim_um: total_trim,
        waste_um: total_stock - out_parts,
        offcut_um: offcut_total,
        offcut_count,
        board_counts,
        proven: !timed_out && !patterns_incomplete,
        timed_out,
        patterns_incomplete,
        nodes,
        elapsed_ms: now_ms() - start,
        unmakeable,
        notes,
        infeasible: false,
        error: None,
    }
}

fn stock_available(left: &Option<u32>) -> bool {
    match left {
        None => true,
        Some(q) => *q > 0,
    }
}

fn take_stock(left: &mut Option<u32>) {
    if let Some(q) = left.as_mut() {
        *q -= 1;
    }
}
