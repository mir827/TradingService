# TradingView Parity Plan (Engineering)

## Scope
This document defines practical feature-parity milestones for the current TradingService stack (`apps/web`, `apps/api`) with explicit delivery order and Definition of Done (DoD).

## Current Product Baseline
- Web chart: candlestick + volume via `lightweight-charts`
- Symbol + interval switching with persisted watchlist
- Right panel: watchlist/detail/alerts
- Drawing support: horizontal + vertical lines with persistence
- Alert rules: create/delete/check, watchlist auto-check, history

## Feature Matrix
| Area | TradingView Baseline | Current in this Repo | Gap | Target Milestone |
| --- | --- | --- | --- | --- |
| Top action buttons | Functional shortcuts (Indicators/Compare/Alerts/Replay) | Buttons rendered but mostly non-functional | Missing action wiring and user feedback | M1 |
| Moving-average overlays | Toggleable overlays with deterministic styles + legend | Candles + volume only | No SMA/EMA overlays, no overlay legend | M1 |
| Symbol comparison | Overlay compare symbol (normalized or % mode) | None | No compare picker/data fetch/overlay/removal flow | M1 |
| Chart indicator framework | Multiple indicators with reusable math + tests | No indicator math module | Utility layer absent | M1 |
| Layout behavior for overlays | Compact controls integrated in chart workflow | No controls for indicator/compare | Controls/panel integration missing | M1 |
| Replay | Bar replay mode with timeline controls | Placeholder only | No actionable feedback or state | M1 (placeholder UX), M3 (functional replay) |
| Drawing toolset | Expanded tools (trendline/ray/rect/text) | Horizontal/vertical only | Missing major drawing primitives and editing UX | M2 |
| Multi-chart / layout | Split layouts and synced symbols/timeframes | Single chart view | Missing layout orchestration/state sync | M3 |
| Indicator depth | RSI/MACD/Bollinger etc. + configurable params | No advanced indicator set | Missing indicator catalog + panel/params persistence | M3 |
| Alert depth | Rich conditions + UI management | Basic metric/operator/threshold alerts | Missing indicator-based/compound alerts + richer filters | M3 |
| Strategy/backtest parity | Strategy tester metrics/execution simulation | Bottom panel placeholder text | No strategy execution engine or report UI | M4 |
| Trading panel parity | Order ticket/positions/orders/trades workflows | Placeholder | Missing end-to-end trade lifecycle UI/API | M4 |
| Persistence/state resilience | Saved chart layouts/templates per user | Partial (watchlist/drawings/alert prefs) | No unified chart-layout model + migrations | M4 |

## Gap Summary (What Matters Next)
1. Chart context actions currently do not drive workflow, so users cannot discover/operate indicators/compare quickly.
2. Overlay architecture is missing reusable math and deterministic rendering rules.
3. Compare workflow needs normalization + error isolation so base chart never regresses.
4. Mid/late parity needs larger architectural work (multi-layout state, strategy runtime, trading workflow).

## Milestone Order
- M1: Actionable chart controls + baseline overlay parity
- M2: Drawing and chart-interaction parity expansion
- M3: Advanced analysis parity (replay runtime, indicator catalog, richer alerts, multi-chart)
- M4: Execution and strategy parity (strategy tester + trading panel + persistence hardening)

## Milestone Details and DoD

### M1 - Actionable Controls + Baseline Overlays
Deliverables:
- Top action buttons are wired:
  - `지표`: opens/toggles indicator controls
  - `비교`: opens/toggles comparison controls
  - `알림`: opens right panel and focuses alerts tab
  - `리플레이`: placeholder with clear `준비중` feedback
- Main chart overlay indicators:
  - SMA 20 toggle
  - SMA 60 toggle
  - EMA 20 toggle
  - deterministic colors + legend labels in chart header/meta zone
- Symbol comparison overlay:
  - picker from known UI symbols/watchlist
  - compare candles fetched for selected interval
  - normalized overlay rendering (relative movement comparable)
  - clear/remove compare symbol
  - compare failures do not break base candlestick/volume chart
- Reusable math helpers in `apps/web/src/lib` for SMA/EMA/normalization + unit tests

DoD:
- UI flows are reachable from top actions with no dead buttons.
- Base chart still renders and updates candles/volume exactly as before.
- Compare error states are surfaced in UI and base chart remains interactive.
- Unit tests cover SMA/EMA/normalization edge cases and pass.
- `npm run lint`, `npm run build`, `npm test` all pass.

### M2 - Drawing and Interaction Parity
Deliverables:
- Additional drawing primitives (trendline, ray, rectangle, text notes)
- Select/move/delete interactions for existing drawings
- Consistent serialization format for all drawing entities
- Keyboard shortcuts for key drawing actions

Progress note (2026-02-27):
- M2-1 completed: trendline/rectangle/note drawing types, two-click + note prompt workflows, persistence/runtime restore, selection/deletion chips, and drawing tool keyboard shortcuts (`H/V/T/R/N`, `Esc`, `Delete/Backspace`).
- M2-2 completed: ray drawing type parity (API + Web), ray tool workflow + keyboard shortcut (`Y`), runtime persistence compatibility, and on-canvas selection/drag move editing for horizontal/vertical/trendline/ray/rectangle/note with persist-on-drag-end.
- M2 status: complete. No scope moved; next milestone remains M3 advanced analysis parity items (functional replay runtime, indicator catalog depth, multi-chart layout, extended alerts).

DoD:
- Every drawing type is persistable/restorable by symbol+interval.
- Edit interactions are deterministic and do not corrupt drawing state.
- Regression tests cover serialization compatibility with existing drawing data.
- No regression in current alert/watchlist/chart flows.

### M3 - Advanced Analysis Parity
Deliverables:
- Functional replay mode (play/pause/speed/step/exit)
- Indicator catalog + parameterized settings (e.g., RSI/MACD/Bollinger)
- Multi-chart layout skeleton with shared symbol/interval controls
- Extended alerts (indicator conditions and scoped filtering)

Progress note (2026-02-27):
- M3-1 completed: replay runtime is now functional in `apps/web` with top-action entry (`리플레이`), bounded historical subset start, play/pause/+1 bar progression, speed options (`x1/x2/x4`), explicit replay status (mode/step/speed), and clean exit back to full chart state.
- Replay integration is wired through chart candle slicing so existing overlays/drawings/indicator/compare interactions continue operating on the active visible range without introducing separate rendering paths.
- M3-2 completed: indicator catalog depth now includes RSI(14), MACD(12/26/9), and Bollinger Bands(20, 2) with lightweight parameter controls, safe input normalization/clamping, persisted enable-state/settings via localStorage (`tradingservice.indicators.v2`), and reactive chart-series updates without chart reset.
- M3-3 completed: multi-chart layout skeleton now supports persisted single/split mode toggling, shared global symbol/interval controls, a secondary candle/volume chart fed by the same symbol/interval dataset, and deterministic cross-chart visible-range synchronization with loop guards.

Progress note (2026-02-28):
- M3-4 completed: alerts now support optional indicator-aware conditions (RSI threshold, MACD cross/histogram sign, Bollinger band position), scoped check filtering (symbols/source/indicator-aware-only), bounded server-side indicator computation from recent candles, runtime-state compatibility for new fields, and UI controls for indicator-aware rule creation plus rule/history filtering.
- M3 status: complete. Next milestone focus is M4 (strategy tester + trading panel + persistence hardening).

DoD:
- Replay runs from historical candles and can be exited without full chart reset.
- Indicator settings are persisted per chart context.
- Multi-chart synchronization does not exceed agreed render/perf budget.
- Alert checks remain backward-compatible with current rule schema.

### M4 - Strategy and Trading Parity
Deliverables:
- Strategy tester runtime + result views (equity, drawdown, trade list)
- Trading panel workflows (order entry, position/order list, fill history)
- Unified chart layout persistence and migration versioning
- Operational hardening (error telemetry and recovery UX)

Progress note (2026-02-28):
- M4-1 completed: MA crossover strategy tester runtime is now available via `POST /api/strategy/backtest` with deterministic metrics/trade history/equity-drawdown curves, API validation tests + math utility tests, and a functional `전략 테스터` panel in `apps/web` (inputs, run/loading/error states, summary cards, mini charts, recent trades, localStorage input persistence).
- Remaining M4 items:
  - M4-2: Trading panel workflows (order entry, position/order list, fill history).
  - M4-3: Unified chart layout persistence + migration versioning.
  - M4-4: Operational hardening (error telemetry and recovery UX).

DoD:
- Strategy outputs are reproducible for same input dataset/config.
- Trading workflows handle API failures without UI lockups or data loss.
- Layout schema includes versioned migration path.
- End-to-end smoke coverage for watchlist -> chart -> alert -> strategy/trading workflows.

## Execution Notes
- Keep `apps/web/src/App.tsx` changes incremental until chart features are split into modules.
- Prefer pure math utilities in `apps/web/src/lib` with tests before adding new overlays.
- Protect existing flows (watchlist, alerts, drawings) with regression checks on every milestone.
