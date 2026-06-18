# 오픈뱅킹 테스트 가이드

오픈뱅킹 연동 기능의 API 엔드포인트를 테스트하는 코드 모음입니다.

## 📋 사전 준비

### 1. 서버 실행

테스트 전 API 서버가 실행 중이어야 합니다.

```bash
# 로컬 서버 실행
node server.js
# 또는
npm run dev
```

### 2. 환경변수 설정

이 프로젝트는 **Cloudflare Pages** 기반이므로 환경변수 설정 방식이 다릅니다:

#### `wrangler.toml` vs `.env` 차이

| 구분 | `wrangler.toml` | `.env` |
|------|----------------|--------|
| **용도** | Cloudflare 배포 환경 설정 | 로컬 개발용 (`node server.js`) |
| **접근 방식** | 코드에서 `c.env.XXX` | 코드에서 `process.env.XXX` |
| **공개 값** | `[vars]` 섹션에 평문 저장 | 평문 저장 (git에 올리지 않음) |
| **비밀 값** | `wrangler secret put` 또는 Dashboard | 파일에 평문 저장 |
| **적용 시점** | `wrangler pages deploy` 시 | `node server.js` 실행 시 |
| **우선순위** | 배포 환경에서만 적용 | 로컬 개발에서만 적용 |

#### 설정 방법

**배포 환경 (Cloudflare):**
```bash
# 비밀값은 wrangler secret으로 설정 (wrangler.toml에 평문 금지)
wrangler secret put OPENBANK_CLIENT_ID
wrangler secret put OPENBANK_CLIENT_SECRET
wrangler secret put DATABASE_URL

# 또는 Cloudflare Dashboard → Workers & Pages → 설정 → 환경변수에서 입력
```

**로컬 개발 환경:**
```bash
# .env 파일 생성 (이 파일은 .gitignore에 포함되어야 함)
cat > .env << EOF
DATABASE_URL=postgres://user:pass@host:5432/db
OPENBANK_CLIENT_ID=your_client_id
OPENBANK_CLIENT_SECRET=your_client_secret
OPENBANK_API_URL=https://testapi.openbanking.or.kr
EOF
```

#### 필수 환경변수

| 변수명 | 설명 | 필수 | 설정 위치 |
|--------|------|------|----------|
| `DATABASE_URL` | PostgreSQL 연결 문자열 | ✅ | secret / .env |
| `OPENBANK_CLIENT_ID` | 오픈뱅킹 클라이언트 ID | OAuth 시 | secret / .env |
| `OPENBANK_CLIENT_SECRET` | 오픈뱅킹 클라이언트 시크릿 | OAuth 시 | secret / .env |
| `OPENBANK_API_URL` | 오픈뱅킹 API URL | 선택 | [vars] / .env |

> ⚠️ **보안 주의:** `OPENBANK_CLIENT_SECRET`, `DATABASE_URL` 등 비밀값은 절대 `wrangler.toml`의 `[vars]`에 평문으로 적지 마세요. 항상 `wrangler secret put` 또는 Cloudflare Dashboard를 사용하세요.

### 3. DB 스키마 확인

`migrate/schema.sql`의 오픈뱅킹 관련 테이블이 생성되어 있어야 합니다:

- `bank_tokens` — OAuth 토큰 저장
- `bank_accounts` — 계좌 정보
- `bank_transactions` — 거래 내역

## 🚀 테스트 실행

### 전체 테스트 한 번에 실행

```bash
node test-openbank/run_all.js
```

6개 영역을 순차적으로 테스트하고 pass/fail/skip 결과를 출력합니다.

### 개별 테스트 실행

```bash
# 1. OAuth 인증 흐름
node test-openbank/test_oauth.js

# 2. 계좌 CRUD
node test-openbank/test_accounts.js

# 3. 거래내역 조회 + 자동 매칭
node test-openbank/test_sync.js

# 4. 수동 결제 + Invoice 재배정
node test-openbank/test_payment.js

# 5. 건물/호수 권한 필터링
node test-openbank/test_permissions.js
```

### 환경변수로 설정 변경

```bash
# 다른 서버 주소로 테스트
API_URL=https://your-server.com node test-openbank/run_all.js

# 특정 계약 ID로 결제 테스트
TEST_CONTRACT_ID=5 node test-openbank/test_payment.js

# 특정 사용자 ID로 테스트
TEST_USER_ID=3 node test-openbank/run_all.js
```

## 📁 테스트 파일 설명

### `test_oauth.js` — OAuth 인증 흐름

| 테스트 | 설명 |
|--------|------|
| OAuth 인증 시작 | `/api/openbank/authorize` URL 생성 및 브라우저 인증 안내 |
| 동기화 상태 조회 | `/api/openbank/sync/status` 로 토큰/계좌/미처리 건수 확인 |
| 토큰 갱신 | `/api/openbank/refresh` 로 만료 토큰 갱신 |

**OAuth 인증 흐름:**
1. 브라우저에서 `/api/openbank/authorize?user_id=1` 접속
2. 오픈뱅킹 인증 페이지에서 로그인
3. 콜백으로 돌아오면 `bank_tokens` 테이블에 토큰 자동 저장
4. 이후 API 호출 시 저장된 토큰 사용

---

### `test_accounts.js` — 계좌 CRUD

| 테스트 | API | 설명 |
|--------|-----|------|
| 계좌 등록 | `POST /api/openbank/accounts` | 은행코드, 계좌번호, 별칭 등록 |
| 계좌 목록 | `GET /api/openbank/accounts` | 사용자의 전체 계좌 조회 |
| 설정 변경 | `PUT /api/openbank/accounts/:id` | 동기화 주기 변경 (manual/5min/1h/3h/daily) |
| 계좌 삭제 | `DELETE /api/openbank/accounts/:id` | 계좌 및 관련 데이터 삭제 |

**동기화 주기 옵션:**
- `manual` — 수동만 (기본값)
- `5min` — 5분마다
- `1h` — 1시간마다
- `3h` — 3시간마다
- `daily` — 매일 1회

---

### `test_sync.js` — 거래내역 조회 + 자동 매칭

| 테스트 | API | 설명 |
|--------|-----|------|
| 동기화 상태 | `GET /api/openbank/sync/status` | 미처리 입금 건수 확인 |
| 기간별 거래내역 | `GET /api/openbank/transactions` | 지정 기간의 계좌 거래내역 조회 |
| 수동 동기화 | `POST /api/openbank/sync` | 미처리 입금을 계약 키워드와 자동 매칭 |

**자동 매칭 로직:**
1. 입금 내역의 메모(적요)를 공백으로 토큰화
2. 각 토큰을 계약의 `contract_keywords`와 비교
3. 키워드 매칭 시 +100점, 닉네임 포함 시 +10점, 호수 포함 시 +10점
4. 100점 이상이면 자동으로 해당 계약의 Invoice에 배정
5. 미달 시 "확인 필요"로 표시

---

### `test_payment.js` — 수동 결제 + Invoice 재배정

| 테스트 | 설명 |
|--------|------|
| 정상 결제 | 당일 날짜로 월세 결제 추가 |
| 중간 삽입 | 과거 날짜로 결제 추가 → 이후 Invoice 자동 재배정 |
| 부분 납부 | 월세보다 적은 금액 → "부분납부" 상태 |
| 초과 납부 | 월세의 2배 → 다음 달 Invoice 자동 생성 후 배정 |

**재배정(`reallocateInvoices`) 로직:**
1. 해당 계약의 모든 결제를 날짜순 정렬
2. 기존 `payment_allocation` 전체 삭제
3. 결제를 순서대로 Invoice에 재배정
4. 남은 금액이 있으면 다음 달 Invoice 자동 생성
5. 각 Invoice의 상태(완납/부분납부/미납) 업데이트

⚠️ **주의:** 테스트 데이터가 실제 DB에 저장됩니다. 필요시 `POST /api/contracts/{id}/reset` 으로 초기화하세요.

---

### `test_permissions.js` — 건물/호수 권한 필터링

| 테스트 | 설명 |
|--------|------|
| Admin 건물 | 모든 건물 조회 가능 |
| Landlord 건물 | 자신이 관리하는 건물만 조회 |
| 건물 호수 목록 | 건물 내 호수 + 계약 정보 조회 |
| 비권한 접근 | 존재하지 않는 건물 ID로 접근 시 빈 배열 반환 |

---

### `run_all.js` — 전체 통합 테스트

위 6개 영역을 순차 실행하고 결과를 집계합니다.

```
╔══════════════════════════════════════════╗
║  테스트 결과                               ║
╠══════════════════════════════════════════╣
║  ✅ 통과: 15                             ║
║  ❌ 실패: 0                              ║
║  ⏭ 건너뜀: 3                             ║
╚══════════════════════════════════════════╝
```

## 🔧 문제 해결

| 문제 | 해결 방법 |
|------|----------|
| `API 서버 연결 실패` | 서버가 실행 중인지 확인 (`node server.js`) |
| `No bank token found` | 먼저 OAuth 인증 진행 (브라우저에서 authorize URL 접속) |
| `계좌가 없어 건너뜀` | `test_accounts.js`를 먼저 실행하여 계좌 등록 |
| `계약이 없어 건너뜀` | DB에 유효한 계약이 있는지 확인, 또는 `TEST_CONTRACT_ID` 설정 |
| `Open Banking not configured` | `OPENBANK_CLIENT_ID` 환경변수 설정 필요 |

## 📊 전체 아키텍처

```
┌─────────────┐     OAuth      ┌──────────────────┐
│  오픈뱅킹     │ ←───────────── │  클라이언트 (브라우저) │
│  인증 서버    │ ─────────────→ │  /authorize      │
└─────────────┘     callback    └──────────────────┘
                                      │
┌─────────────┐     API        ┌──────┴───────────┐
│  오픈뱅킹     │ ←───────────── │  백엔드 API       │
│  거래내역 API │ ─────────────→ │  /transactions   │
└─────────────┘     JSON        │  /sync           │
                               └──────┬───────────┘
                                      │
                               ┌──────┴───────────┐
                               │  DB (SQLite/PG)   │
                               │  bank_tokens      │
                               │  bank_accounts    │
                               │  bank_transactions│
                               │  payments         │
                               │  invoices         │
                               │  payment_allocation│
                               └──────────────────┘
```
