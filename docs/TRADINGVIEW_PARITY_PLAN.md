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
- M4-2 completed: paper-trading workflows are now available via `GET /api/trading/state`, `POST /api/trading/orders`, and `POST /api/trading/orders/:id/cancel` with runtime-state persistence, deterministic market fills from latest quote, and a functional `트레이딩 패널` UI (order entry, positions, order/fill history, refresh/loading/error states, in-flight submit locking).
- M4-3 completed: chart/layout UI state now uses unified versioned persistence with migration-safe reads (legacy `tradingservice.chartlayout.v1` -> current schema), explicit schema versioning, and fail-safe fallback to defaults on corrupt/unsupported payloads.
- M4-4 completed: operational telemetry + recovery hardening is now in place with strict telemetry ingestion (`GET/POST /api/ops/errors`, `POST /api/ops/recovery`), bounded in-memory/runtime-state retention (latest 500 errors and 500 recovery events), centralized web API error normalization, non-blocking recovery banners + retry actions across alerts/strategy/trading, and a compact right-panel operational log for recent error/recovery inspection.
- M4 status: complete.

DoD:
- Strategy outputs are reproducible for same input dataset/config.
- Trading workflows handle API failures without UI lockups or data loss.
- Layout schema includes versioned migration path.
- End-to-end smoke coverage for watchlist -> chart -> alert -> strategy/trading workflows.

## Execution Notes
- Keep `apps/web/src/App.tsx` changes incremental until chart features are split into modules.
- Prefer pure math utilities in `apps/web/src/lib` with tests before adding new overlays.
- Protect existing flows (watchlist, alerts, drawings) with regression checks on every milestone.

## M5 후보 - TradingView 실용 기능 갭 보완 (Sub-agent review)

### P0 (즉시 체감 + 운영 안정성 영향 큼)

1) 
- 기능명: 차트 작업 Undo/Redo 히스토리 (드로잉/지표/비교/레이아웃)
- 사용자 가치: 실수 복구가 즉시 가능해져 분석 탐색 속도가 올라가고, 드로잉/지표 실험에 대한 심리적 비용이 크게 줄어듦.
- 구현 난이도: 중간
- 선행조건: M4-3(통합 레이아웃 persistence) 완료, 차트 상태 변경 이벤트를 단일 액션 형태로 수집 가능해야 함.
- 완료기준(DoD):
  - `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` 단축키로 최근 액션 50개 이상 안정 복원.
  - 드로잉 추가/이동/삭제, 지표 on/off/파라미터 변경, 비교 종목 추가/삭제가 모두 히스토리 대상.
  - Undo/Redo 수행 후에도 저장 포맷 무결성 유지(새로고침 후 상태 동일).
  - 주요 액션 시나리오 회귀 테스트 추가.

Progress note (2026-02-28):
- M5 P0-1 completed (incremental v1): `apps/web`에 bounded undo/redo 히스토리 유틸(기본 depth 100, 최소 50), 키보드 단축키(`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl+Y`), 입력 포커스 가드, 드로잉/지표/비교/레이아웃 액션 히스토리 연결, Undo/Redo 상태 버튼 UI, 유틸 단위 테스트(경계/redo invalidation/빈 스택/스냅샷 복원 결정성)까지 반영됨.

2) 
- 기능명: 알림 운영화 v2 (상태 머신 + 중복 억제 + 인앱 알림센터)
- 사용자 가치: 알림 "왜 안 왔는지/왜 여러 번 왔는지"를 추적 가능하게 만들어 신뢰도를 높이고 실사용 가능성을 크게 개선.
- 구현 난이도: 중간
- 선행조건: M3-4(지표 기반 알림) 완료 상태 유지, M4-4(오류 telemetry)와 연동 가능한 이벤트 로깅 경로 필요.
- 완료기준(DoD):
  - Alert 상태(`active/triggered/cooldown/error`)와 마지막 트리거 메타데이터 저장.
  - 동일 조건 연속 발생 시 설정 가능한 cooldown으로 중복 알림 억제.
  - 우측 패널에 알림센터(최근 이벤트, 상태 필터, 실패 원인) 제공.
  - 백엔드/프론트 양쪽에서 상태 전이 테스트 통과.

Progress note (2026-02-28):
- M5 P0-2 completed (incremental v2): `apps/api`에 alert lifecycle 상태 모델(`active/triggered/cooldown/error`), 상태 전이 메타데이터/마지막 트리거/오류 메타데이터 persistence, cooldown 중복 억제 결과(`suppressedByCooldown` + 상세 suppressed payload), 에러 이벤트(`type=error`) 기록 및 history 상태/타입 필터가 추가됨.
- `apps/web` 우측 Alerts 탭에 compact 알림센터(상태 카운트, state/type/symbol 필터, 최근 이벤트, 오류 사유 표시)가 통합되었고 기존 규칙 생성/수동 체크/watchlist auto-check 흐름은 유지됨.
- M5 P0 interim status: P0-1, P0-2 complete.

3) 
- 기능명: 트레이딩 패널 고급 주문 (지정가/스탑 + 브래킷 TP/SL)
- 사용자 가치: 단순 시장가 중심에서 벗어나 실제 매매 습관에 가까운 리스크 관리(손절/익절) 연습 가능.
- 구현 난이도: 높음
- 선행조건: M4-2(주문 상태/체결 엔진) 안정화, 가격 피드 기준 체결 규칙(캔들 high/low 기반) 명세 확정.
- 완료기준(DoD):
  - 지정가/스탑 주문 생성/취소/체결 처리 및 브래킷(TP/SL) 연결 지원.
  - 주문 간 연결관계(OCO 유사) 무결성 유지 및 예외 케이스(갭, 급변) 처리.
  - UI에서 주문 유형/조건 입력, 주문 리스트 상태 표시, 실패 사유 노출.
  - 체결 시뮬레이션 회귀 테스트 + API 계약 테스트 추가.

Progress note (2026-02-28):
- M5 P0-3 completed (incremental v3): `apps/api` paper trading 주문 모델이 `market/limit/stop` + 브래킷(`takeProfitPrice/stopLossPrice`)를 지원하도록 확장되었고, pending 주문 트리거 평가/체결, parent-child 링크 무결성(브래킷 자식 생성, sibling 정리), deterministic same-tick 우선순위 규칙(브래킷 SL -> TP -> 기타 pending)이 반영됨.
- `/api/trading/orders`, `/api/trading/orders/:id/cancel`, `/api/trading/state`가 확장 페이로드/응답 메타데이터(조건가/링크/상태)를 제공하며 기존 market payload 호환성은 유지됨.
- `apps/web` `트레이딩 패널`에 주문유형(시장가/지정가/스탑) 입력, 조건부 가격 필드, 브래킷 TP/SL 토글/입력, 주문 링크/상태 표시가 추가되었고 기존 로딩/에러/복구 UX 흐름은 유지됨.
- M5 P0 status: complete (P0-1, P0-2, P0-3).
- M5 progress note (2026-02-28): P1 started, P1-4(드로잉 오브젝트 패널) + P1-5(비교 오버레이 확장) completed.
- M5 progress note (2026-02-28): P1-6(백테스트 현실화 옵션) completed.
- M5 progress note (2026-02-28): P2-7(Data Window / Crosshair 인스펙터) completed.
- M5 progress note (2026-02-28): P2-8(탐색 속도 개선 UX: 타임프레임 즐겨찾기 + 단축키) completed.
- M5 status: complete.

### P1 (분석 생산성/활용도 확장)

4) 
- 기능명: 드로잉 오브젝트 패널 (목록/잠금/숨김)
- 사용자 가치: 드로잉이 많아져도 차트 정리와 재사용이 쉬워져 장기 분석 워크플로우가 안정화됨.
- 구현 난이도: 중간
- 선행조건: M2 직렬화 포맷에서 엔티티 ID 일관성 확보, 선택 상태 관리 로직 재사용 가능해야 함.
- 완료기준(DoD):
  - 오브젝트 목록에서 선택/이름표시/타입표시 지원.
  - 개별 잠금(lock)/숨김(visibility) 토글 및 상태 persistence.
  - 잠금된 오브젝트는 드래그/삭제 불가, 숨김 오브젝트는 렌더 제외.
  - 대량 오브젝트(100개+)에서도 조작 지연이 허용 범위 내 유지.

Progress note (2026-02-28):
- M5 P1-4 completed (incremental): `apps/web` 우측 패널에 compact 드로잉 오브젝트 목록(UI 선택/타입+ID 표시/잠금/표시 토글) 추가, `apps/web`+`apps/api` 드로잉 모델에 `locked/visible` 상태 확장 및 persistence 반영, 구버전 payload 기본값(`visible=true`, `locked=false`) 호환, 숨김 렌더 제외/잠금 드래그·삭제 보호 동작까지 반영됨.

5) 
- 기능명: 비교 오버레이 확장 (다중 종목 + 스케일 모드)
- 사용자 가치: 업종/테마 상대강도 비교가 가능해져 실전 의사결정(무엇이 더 강한가)에 직접 도움.
- 구현 난이도: 중간
- 선행조건: M1 비교 오버레이 파이프라인 유지, 색상/범례 시스템 확장 가능해야 함.
- 완료기준(DoD):
  - 비교 종목 최대 3개 동시 표시, 개별 on/off/remove 지원.
  - `% 정규화`와 `절대값` 모드 전환 제공(기준 시점 명확화).
  - 한 종목 fetch 실패 시 다른 오버레이/기본 차트 영향 없음.
  - 범례에서 종목별 값/색상 일관성 유지.

Progress note (2026-02-28):
- M5 P1-5 completed (incremental): `apps/web` 비교 오버레이를 최대 3개 슬롯(개별 표시 on/off + 제거)으로 확장하고, `% 정규화`/`절대값` 스케일 모드 토글을 추가했으며, 정규화 모드 기준을 첫 공통 캔들(anchor time/base/compare close)로 고정해 결정론적으로 계산하도록 반영함.
- 비교 심볼 단건 실패 시 해당 슬롯만 경량 오류를 노출하고 나머지 비교 오버레이/기본 차트 렌더는 유지되도록 fetch 결과를 심볼별로 분리 처리함.
- 범례/상태 영역에 슬롯 색상 고정과 종목별 현재 비교값(또는 상태)을 일관되게 표기함.

6) 
- 기능명: 백테스트 현실화 옵션 (수수료/슬리피지/포지션 사이징)
- 사용자 가치: 과최적화된 성과 착시를 줄이고 전략 결과를 실제에 더 가깝게 해석 가능.
- 구현 난이도: 중간
- 선행조건: M4-1 전략 엔진의 체결/손익 계산 모듈 분리, 입력 검증 스키마 확장.
- 완료기준(DoD):
  - 수수료율, 슬리피지(tick 또는 %) 옵션 입력 및 저장.
  - 고정 수량/자본 비율 기반 포지션 사이징 선택 가능.
  - 결과 화면에서 gross vs net 성과를 분리 표시.
  - 동일 입력 재실행 시 결정론적 결과 보장 테스트 통과.

Progress note (2026-02-28):
- M5 P1-6 completed (incremental): `apps/api` 전략 백테스트 입력 스키마가 fee(`bps/%`) + slippage(`tick/%`) + 포지션 사이징(`fixed-percent`/`fixed-qty`)을 지원하도록 확장되었고, 기존 `feeBps + fixed-percent` payload는 그대로 호환됨.
- 백테스트 엔진은 진입/청산 시 수수료/슬리피지를 일관 적용하며 요약/체결 결과에 gross vs net 지표(총손익/순손익, 비용 합계, 수수료/슬리피지 분리)를 additive 필드로 반환함.
- `apps/web` 전략 테스터에 fee/slippage/sizing 입력 컨트롤, localStorage 마이그레이션-safe 기본값 처리, gross/net 구분 요약 카드가 반영되었고 동일 입력 재실행 결정론성 테스트가 보강됨.

### P2 (완성도/편의성 보강)

7) 
- 기능명: Data Window / Crosshair 인스펙터
- 사용자 가치: 특정 캔들의 OHLCV·지표값을 정밀 확인/복사할 수 있어 리뷰·공유 품질 향상.
- 구현 난이도: 낮음
- 선행조건: 현재 crosshair 이벤트에서 시점별 지표 계산값 접근 가능해야 함.
- 완료기준(DoD):
  - 커서 위치 기준 OHLCV + 활성 지표값 표시.
  - 단일 클릭으로 값 복사(클립보드) 지원.
  - replay/multi-chart 모드에서도 동일 동작.
  - 렌더 성능 저하 없이 동작(기존 FPS budget 유지).

Progress note (2026-02-28):
- M5 P2-7 completed (incremental): `apps/web` 차트 헤더에 compact Data Window 인스펙터를 추가해 crosshair 시점 OHLCV + 활성 지표값 + 표시 중 비교 오버레이 값을 표시하고, crosshair 데이터가 없을 때는 최신 캔들 fallback + 명시적 안내 문구를 노출하도록 반영함.
- primary/secondary 차트 모두 crosshair move 구독을 통해 인스펙터 상태를 갱신하고, chart re-init/unmount 시 unsubscribe/cleanup 처리로 안전성을 유지함.
- 기존 캔들 hover tooltip 동작은 그대로 유지하면서 인스펙터 렌더 경로를 분리해 비차단 업데이트를 보장함.

8) 
- 기능명: 탐색 속도 개선 UX (타임프레임 즐겨찾기 + 단축키)
- 사용자 가치: 반복 조회 시 클릭 수를 줄여 분석 리듬을 개선하고 초보자도 빠르게 익숙해짐.
- 구현 난이도: 낮음
- 선행조건: 기존 interval state/persistence 재사용, 전역 단축키 충돌 정책 정의.
- 완료기준(DoD):
  - 사용자 정의 즐겨찾기 interval 저장/정렬/삭제.
  - 숫자키 또는 커스텀 단축키로 interval 즉시 전환.
  - 전환 후 차트/지표/비교 상태가 안정적으로 유지.
  - 접근성(포커스 상태/툴팁) 및 기본 회귀 테스트 통과.

Progress note (2026-02-28):
- M5 P2-8 completed (incremental): `apps/web` 상단 interval 영역에 사용자 설정 즐겨찾기(추가/제거) UX를 추가하고, 즐겨찾기 목록을 localStorage(`tradingservice.intervalfavorites.v1`)에 schema-safe 방식으로 저장/복원하도록 반영함(legacy payload 마이그레이션 + 기본값 fallback 포함).
- 기존 고정 interval 버튼 동작은 유지하면서 즐겨찾기 여부를 개별 토글할 수 있고, 즐겨찾기-숫자키 매핑 힌트/툴팁(예: `1:1 · 2:5 ...`)을 compact UI로 제공함.
- 전역 키보드 처리에 즐겨찾기 숫자키 전환(`1..n`)을 추가하되 입력 요소(`input/textarea/select/contenteditable`) 포커스에서는 no-op 가드를 적용해 기존 도형/undo/redo 단축키 충돌 없이 공존하도록 처리함.
- interval 전환 경로를 공통 setter로 통일해 기존 차트/지표/비교/드로잉/replay 상태 관리 흐름을 유지하면서 불필요한 동일 interval 재선택 업데이트를 방지함.

## M6 - KOSPI/KOSDAQ NXT 정보 확장
Deliverables:
- KOSPI/KOSDAQ 종목에 대해 `KRX` + `NXT` 정보를 함께 다루는 데이터 모델/API 확장
- 시장 상태 API에서 KRX/NXT 세션 상태(장전/장중/장후/휴장) 분리 제공
- 우측 상세 패널에서 KRX 대비 NXT 가격/등락/거래대금(가능 범위)과 업데이트 시각 표시
- NXT 데이터 미제공/지연 시 graceful fallback(`N/A` + 이유 메타) 처리

Phased plan:
- M6-1: API/스키마 기반 구축 (`/api/quote`, `/api/market-status`에 NXT 필드 추가, KRX 호환 유지)
- M6-2: Web 상세 패널 UI 반영 (KRX/NXT 비교 카드, 세션 배지)
- M6-3: 워치리스트/알림 연계 (선택적 venue 필터, 기본은 기존 동작 유지)
- M6-4: 운영 검증/회귀 강화 (KRX-only 심볼, NXT unavailable, 장시간별 상태 테스트)

Progress note (2026-02-28):
- M6-1 완료: `/api/quote`와 `/api/market-status`에 KOSPI/KOSDAQ용 NXT optional 메타 필드를 추가했고, 기존 KRX/CRYPTO 응답 호환성을 유지함.
- M6-2 완료: `apps/web` 상세 패널에 KRX/NXT 비교 카드(가격/등락/업데이트 시각)와 venue 세션 배지(KRX/NXT)를 추가했고, venue 메타 누락 시에도 기본 배지/표시값으로 안전하게 폴백되도록 반영함.
- M6-3 완료: `apps/api`의 watchlist/alerts 경로에 optional `venue (KRX|NXT)` 힌트/필터를 추가하고, KR 심볼에만 venue를 저장/전파하도록 정규화했으며, alert check/history payload와 `apps/web`의 watchlist/alerts UI(선택 셀렉터 + venue 배지)에 연계함.
- M6-4 완료: `apps/api`/`apps/web` 회귀 테스트를 확장해 KRX-only(venue 생략) 호환 동작, NXT unavailable reason 메타데이터 안정성, venue별 watchlist/alerts 메타 persistence 호환성, 시장 상태 venue 세션 필드(OPEN/CLOSED/phase fallback) 케이스를 고정함.
- 운영 검증 유틸 추가: `apps/api/scripts/kr-regression-smoke.ts`에서 외부 의존 최소화(mock fetch + `app.inject`) 방식으로 `/api/quote`, `/api/market-status`, `/api/watchlist`, `/api/alerts/rules`, `/api/alerts/check`를 결정론적으로 검증함.
- M6 status: complete.

DoD:
- 기존 KRX-only 플로우가 깨지지 않고, NXT 필드가 optional/backward-compatible 하게 동작
- KOSPI/KOSDAQ 심볼에서 NXT 정보가 있을 때 UI/응답에 일관되게 노출
- NXT 미가용 상황에서도 오류 전파 없이 정상 렌더/응답
- lint/build/test + 핵심 스모크(quote/status/detail panel) 통과

## M7 - Pine Editor 실구현
Deliverables:
- 하단 `Pine Editor` 탭의 placeholder 제거 및 실제 편집 워크스페이스 제공
- 로컬 스크립트 라이브러리(생성/저장/복제/삭제) + active script 복원
- 버전드 localStorage 스키마 + 손상 payload 복구/마이그레이션 경로 확보
- 저장/로드 실패 시 비차단 UX + 경량 오류 상태 노출

Phased plan:
- M7-1: Editor workspace MVP
- M7-2: Script library/versioning
- M7-3: Strategy tester bridge
- M7-4: Validation & safety guardrails

Progress note (2026-02-28):
- M7-1 완료: `apps/web` 하단 `Pine Editor` 패널을 textarea 기반 MVP 워크스페이스로 교체했고, 스크립트 이름 입력 + `New/Save/Save As/Delete` 컨트롤 + 저장 스크립트 목록 + 상태/오류 메시지 영역을 추가함.
- `apps/web/src/lib/pineStorage.ts`에 버전드 스토리지 스키마(`tradingservice.pine.workspace.v1`)와 정규화/복구 유틸을 도입해 빈/손상 payload fallback, active script 복원 규칙, save/update/delete 상태 정합성을 보장함.
- `apps/web/src/lib/pineStorage.test.ts` 단위 테스트로 빈/손상 payload fallback, save/update/delete 동작, active script restoration 규칙을 고정함.
- M7-2 완료: 스크립트 라이브러리에 `Rename/Duplicate` 액션, 이름 검색 필터, `updatedAt/revision` 메타 표시를 추가했고, 저장 시 스크립트별 revision 증가 규칙을 도입함. 기존 `tradingservice.pine.workspace.v1` payload는 revision 누락 시 자동 마이그레이션(기본값 1)으로 호환성을 유지하며, rename/duplicate/delete 이후 active script 선택 규칙을 결정론적으로 고정함.
- M7-3 완료: Pine Editor 툴바에 `전략 테스터로 보내기` CTA를 추가해 클릭 시 `전략 테스터` 탭으로 전환되고, 선택된 Pine 스크립트 컨텍스트(`id/name/revision`)가 전략 폼 상태에 연결되도록 브리지했다. 전략 테스터에는 연결 상태 배지(연결/독립 실행)와 `연결 해제` 액션을 추가했으며, Pine 소스의 `//@ts_fast`, `//@ts_slow`, `//@ts_capital`, `//@ts_fee_bps` 지시어를 경량 파싱해 유효한 값만 전략 기본 파라미터에 주입하도록 반영했다. 전략 폼 localStorage 로딩/저장은 optional linked-script 필드를 additive하게 수용하도록 정규화했고, 지시어 파서/전략 폼 마이그레이션 테스트를 추가해 기존 저장 payload와의 호환을 고정했다.
- M7 status: in progress (M7-1, M7-2, M7-3 complete; M7-4 pending).

DoD:
- Pine 편집기 탭에서 스크립트 CRUD/선택/편집 흐름이 모두 동작
- localStorage payload 손상/버전 불일치 시 기본값으로 안전 복구
- 저장소 실패가 UI를 block하지 않고 상태 영역에 경량 오류를 노출
- 기존 `전략 테스터`, `트레이딩 패널` 동작 회귀 없음
