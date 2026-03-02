# Implementation Validation Plan (M1 ~ M4-2)

## 1) Scope

This validation plan targets implemented milestones defined in `docs/TRADINGVIEW_PARITY_PLAN.md`:

- **M1**: Actionable top controls, baseline overlays (SMA/EMA), compare overlay, replay placeholder UX
- **M2**: Expanded drawing toolset + editing interactions + drawing persistence parity
- **M3-1**: Functional replay runtime (play/pause/step/speed/exit)
- **M3-2**: Indicator catalog depth (RSI/MACD/Bollinger) + settings persistence
- **M3-3**: Multi-chart layout skeleton + shared symbol/interval sync
- **M3-4**: Indicator-aware alerts + scoped filtering/history compatibility
- **M4-1**: Strategy tester API/UI integration (MA crossover backtest)
- **M4-2**: Trading panel API/UI workflows (paper orders/state/fills)

Out of scope in this pass:
- M4-3+ items (unified layout migration, operational hardening)
- Full manual exploratory UI run across all browsers/devices

---

## 2) Validation Goals

1. **Build integrity:** repo passes lint/build/test baseline (`npm run lint`, `npm run build`, `npm test`).
2. **API contract stability:** key endpoints for drawings/replay-support/indicators/alerts/strategy/trading respond with valid schema and expected status patterns.
3. **Persistence confidence:** existing persistence behavior (watchlist/drawings/alerts/trading state) remains intact via automated tests and targeted smoke interactions.
4. **Regression safety:** previously delivered milestones M1~M4-2 remain operational without breaking earlier functionality.

---

## 3) Test Matrix

| Category | Milestone Coverage | Validation Method | Pass Signal |
| --- | --- | --- | --- |
| **API** | M2, M3-1, M3-4, M4-1, M4-2 | `apps/api` vitest + targeted endpoint smoke checks (`/api/candles`, `/api/drawings`, `/api/alerts/*`, `/api/strategy/backtest`, `/api/trading/*`) | Status codes and response payloads meet expected contracts |
| **Web UI** | M1, M3-1, M3-2, M3-3, M4 panel integrations | `apps/web` unit tests (`chartMath`, `replay`, `indicatorSettings`, `chartLayout`, `symbol`) + build output validation | Web unit tests pass; production build succeeds |
| **Persistence** | M2, M3-2, M3-4, M4-2 | Existing API persistence tests (restart/reload cases) + smoke write/read cycle for drawings | Data survives save/load paths with normalized schema |
| **Regression** | M1 ~ M4-2 | Full lint/build/test and smoke flow run end-to-end in one environment | No failing command; no critical regression discovered |

---

## 4) Command Checklist

### Mandatory baseline
- [ ] `npm run lint`
- [ ] `npm run build`
- [ ] `npm test`

### Targeted API smoke checks (key endpoints)
- [ ] Start API with isolated runtime state:
  - `PORT=4110 TRADINGSERVICE_SKIP_KRX_PRELOAD=1 TRADINGSERVICE_STATE_FILE=<temp-file> node apps/api/dist/index.js`
- [ ] Replay-related stability check:
  - `GET /api/candles?symbol=BTCUSDT&interval=60&limit=120` (repeat twice, verify ordered candle timeline)
- [ ] Drawings API check:
  - `PUT /api/drawings` with mixed primitive payload
  - `GET /api/drawings?symbol=BTCUSDT&interval=60`
- [ ] Indicators + Alerts API check:
  - `POST /api/alerts/rules` with `indicatorConditions`
  - `POST /api/alerts/check` with `indicatorAwareOnly=true`
- [ ] Strategy backtest API check:
  - `POST /api/strategy/backtest`
- [ ] Trading panel API check:
  - `GET /api/trading/state`
  - `POST /api/trading/orders`
  - `POST /api/trading/orders/:id/cancel`

### Artifact updates
- [ ] Write/overwrite `docs/IMPLEMENTATION_VALIDATION_PLAN.md`
- [ ] Write/overwrite `docs/IMPLEMENTATION_VALIDATION_REPORT.md`

---

## 5) Exit Criteria

Validation is considered complete when:

1. **All mandatory commands pass:** lint/build/test all return exit code 0.
2. **Targeted smoke categories pass:** drawings, replay-related candle stability, indicators, alerts, strategy backtest, trading APIs all pass expected checks.
3. **No critical blockers remain:** no P0 issue that prevents milestone usage in normal flow.
4. **Known limits are documented:** any environment constraints (network/data source/UI-manual gaps) are clearly captured in the report with follow-up recommendations.
