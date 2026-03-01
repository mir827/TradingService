# TradingService

TradingView 유사 UI를 목표로 한 웹/API 모노레포입니다.

- Web: `apps/web` (Vite)
- API: `apps/api` (Fastify + tsx)

## 요구사항

- Node.js 22+
- npm

## 개발 서버 시작 (재부팅 후 포함)

프로젝트 루트에서:

```bash
cd /Users/mir827/Dev/TradingService
npm install
npm run dev
```

`npm run dev`는 API와 Web을 동시에 실행합니다.

- Web: `http://localhost:5173`
- API: `http://localhost:4100`

## 개별 실행

API만 실행:

```bash
npm run dev:api
```

Web만 실행:

```bash
npm run dev:web
```

## 빌드/테스트

```bash
npm run lint
npm run build
npm test
```

## 프로덕션(간단)

```bash
npm run build
npm run start
```

> `start`는 API 서버를 실행합니다.

## 상태 점검 빠른 명령

```bash
# 포트 확인
lsof -nP -iTCP:5173 -sTCP:LISTEN
lsof -nP -iTCP:4100 -sTCP:LISTEN

# API 헬스성 확인 예시
curl -s "http://localhost:4100/api/market-status" | jq
```

## 종료

`npm run dev` 실행 터미널에서 `Ctrl + C`.
