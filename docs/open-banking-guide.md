# 오픈뱅킹 추가 방법 — 상세 구현 가이드

현재 시스템은 **SMS 문자 수동 붙여넣기**로 입금 내역을 등록하는 방식입니다. 금융결제원 오픈뱅킹 API를 연동하면 **은행 거래내역을 자동으로 가져와** 세입자 매칭과 Invoice 배당을 자동화할 수 있습니다.

---

## 구현 전 고려사항

오픈뱅킹 연동과 함께 반드시 보장되어야 할 기능입니다.

### 1. 계좌 조회 주기 설정

- 집주인이 **자동 동기화 주기를 직접 설정**할 수 있어야 합니다.
- 지원 주기 옵션:
  - **실시간** (5분 간격 폴링)
  - **1시간마다**
  - **3시간마다**
  - **매일 1회** (지정 시간)
  - **수동만** (자동 동기화 끔)
- 설정은 `bank_accounts.sync_interval` 컬럼 또는 별도 `sync_settings` 테이블에 저장합니다.
- Cloudflare Cron Trigger가 주기별로 실행되며, 각 사용자의 설정에 따라 동기화를 수행합니다.

#### 주기별 조회 시 마지막 조회 이후만 조회

- 자동 동기화(Cron) 실행 시 **항상 마지막 동기화 시간 이후의 거래만 조회**합니다.
- `bank_accounts.last_synced_at`을 기준으로 `from_date`를 설정:
  ```
  from_date = last_synced_at || (7일 전)  // last_synced_at이 없으면 최초 7일치
  to_date = 오늘
  ```
- 이를 통해 중복 조회를 방지하고 API 호출량을 최소화합니다.

### 2. 수동 동기화 버튼 (자동 주기와 별개)

- **자동 동기화 주기와 완전히 별개**인 수동 기능입니다.
- 납부 관리 페이지(`payments.html`) 상단에 **"수동 조회"** 버튼 배치
- 자동 주기 설정과 무관하게 언제든 수동으로 계좌를 조회할 수 있습니다.

#### 수동 조회 흐름

```
[수동 조회] 버튼 클릭
    ↓
┌──────────────────────────────────────┐
│  계좌 조회 기간 선택                     │
│                                        │
│  시작일: [2026-05-01  📅]              │
│  종료일: [2026-05-31  📅]              │
│                                        │
│  [취소]          [조회 시작]            │
└──────────────────────────────────────┘
    ↓
해당 기간의 입금 내역을 하나씩 조회
    ↓
┌─ 중복 의심 없음 → 자동 매칭 진행
└─ 중복 의심됨 → 팝업으로 확인 요청
```

#### 수동 조회 시 기간 선택 팝업

- 버튼 클릭 시 **기간 선택 팝업**이 먼저 표시됩니다.
- 시작일/종료일을 캘린더 팝업으로 선택
- 기본값: 이번 달 1일 ~ 오늘
- API: `/api/openbank/transactions?from_date=20260501&to_date=20260531`

#### 입금 내역 하나씩 조회 + 중복 확인

- 조회된 입금 내역을 **하나씩 순차적으로 처리**합니다.
- 각 입금에 대해 기존 `payments` 테이블과 비교하여 중복 여부 확인:
  - 같은 계좌 + 같은 금액 + 같은 날짜 → 중복 의심
  - 같은 메모(입금자명) + 같은 금액 ± 1일 → 중복 의심
- **중복이 의심되면 팝업으로 사용자에게 확인 요청:**

```
┌──────────────────────────────────────────────┐
│  ⚠ 중복 납부 의심                               │
│                                                │
│  조회된 입금:                                   │
│  2026-05-15  홍길동  300,000원                  │
│                                                │
│  기존 납부 기록:                                │
│  2026-05-15  홍길동  300,000원 (이미 등록됨)      │
│                                                │
│  이 입금을 어떻게 처리하시겠습니까?               │
│                                                │
│  [건너뛰기 (중복)]    [새 납부로 등록]            │
└──────────────────────────────────────────────┘
```

- **건너뛰기**: 해당 입금을 무시하고 다음으로 진행
- **새 납부로 등록**: 중복이어도 별도 납부로 처리 (예: 월세+관리비를 따로 받은 경우)

### 3. 수동 결제 추가 (현금 수령 / 파싱 오류 해결)

- 오픈뱅킹 자동 연동으로 모든 케이스가 커버되지 않습니다:
  - **현금으로 받은 경우** — 은행 거래내역에 나오지 않음
  - **파싱 오류** — 입금자명이 매칭되지 않거나 금액이 다르게 인식된 경우
  - **계좌 이체가 아닌 경우** — 타행 이체 지연 등
- 따라서 **결제를 직접 추가**할 수 있어야 합니다.
- 수동 추가 시 **건물, 호수, 날짜, 금액**이 필수 입력 항목입니다.

#### 건물/호수 선택 — 권한별 필터링

- **Admin**: 모든 건물이 건물 목록에 표시됨
- **임대인(Landlord)**: 자신이 관리하는 건물만 표시됨 (`landlord_buildings` 기준)
- 건물 선택 후 해당 건물의 호수만 표시됨 (cascade)

#### Invoice 자동 재배정 (중간 납부 삽입 시)

수동으로 납부를 추가할 때, 기존 납부 기록 사이에 날짜가 끼어들면 Invoice 배정이 자동으로 조정됩니다.

**선불(prepaid) 예시:**
```
기존 상태:
  3월10일 납부 300,000원 → 3월 Invoice 매칭
  5월11일 납부 300,000원 → 4월 Invoice 매칭 (3월 이후 다음 미납 Invoice)

수동 추가: 4월 3일 납부 300,000원
  → 3월10일 납부 → 3월 Invoice 매칭 (변동 없음)
  → 4월 3일 납부 → 4월 Invoice 매칭 (신규)
  → 5월11일 납부 → 5월 Invoice 매칭으로 변경 (4월→5월)
```

**후불(postpaid) 예시:**
```
기존 상태:
  4월10일 납부 300,000원 → 3월 Invoice 매칭
  6월11일 납부 300,000원 → 5월 Invoice 매칭

수동 추가: 5월 3일 납부 300,000원
  → 4월10일 납부 → 3월 Invoice 매칭 (변동 없음)
  → 5월 3일 납부 → 4월 Invoice 매칭 (신규)
  → 6월11일 납부 → 5월 Invoice 매칭으로 변경
```

자동 재배정 알고리즘은 아래 3-9절에서 상세 설명합니다.

---

## 1단계: 금융결제원 오픈뱅킹 등록

### 사전 준비물

- 사업자등록증 (이미 보유: 640-31-00762)
- 핀테크 서비스 신청: https://developers.kftc.or.kr
- 테스트 환경 신청 후 운영 환경 승인

### 발급받아야 할 키

```
OPENBANK_CLIENT_ID=xxxxxxxxx
OPENBANK_CLIENT_SECRET=xxxxxxxxx
OPENBANK_CLIENT_NAME=슈가부동산
```

---

## 2단계: DB 스키마 추가

`migrate/schema.sql`에 아래 테이블을 추가합니다.

```sql
-- 오픈뱅킹 OAuth 토큰 저장
CREATE TABLE IF NOT EXISTS bank_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,           -- 집주인 user id
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_type TEXT DEFAULT 'Bearer',
    expires_at DATETIME,                -- 만료 시간
    scope TEXT,                          -- authorize 범위
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 오픈뱅킹 계좌 등록
CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,           -- 집주인 user id
    bank_code TEXT NOT NULL,            -- 은행코드 (020, 004 등)
    bank_name TEXT,                      -- 은행명
    account_num TEXT NOT NULL,           -- 핀테크 이용번호 (fintech_use_num)
    account_alias TEXT,                  -- 별칭 (예: "우리은행 수금계좌")
    account_type TEXT DEFAULT 'deposit', -- deposit/withdraw
    is_primary INTEGER DEFAULT 0,       -- 주 수금 계좌 여부
    sync_interval TEXT DEFAULT 'manual', -- manual / 5min / 1h / 3h / daily
    last_synced_at DATETIME,            -- 마지막 동기화 시간
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 자동 동기화된 거래 내역
CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL,        -- bank_accounts.id
    tran_date TEXT NOT NULL,             -- 거래일자
    tran_time TEXT,                      -- 거래시간
    tran_type TEXT,                      -- 입금/출금
    amount INTEGER NOT NULL,             -- 거래금액
    after_balance INTEGER,               -- 거래후잔액
    memo TEXT,                           -- 거래메모 (입금자명 등)
    branch_name TEXT,                    -- 점명
    source TEXT DEFAULT 'openbank',      -- openbank / manual (수동 추가 구분)
    is_processed INTEGER DEFAULT 0,      -- 매칭 처리 여부
    payment_id INTEGER,                  -- 연결된 payment id (매칭 후)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (account_id) REFERENCES bank_accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
);
```

---

## 3단계: 백엔드 API 엔드포인트 (Hono)

`functions/api/[[path]].js`에 추가할 엔드포인트:

### 엔드포인트 요약

| 메서드 | 경로 | 설명 |
|--------|------|------|
| `GET` | `/api/openbank/authorize` | 사용자를 은행 로그인으로 리다이렉트 |
| `GET` | `/api/openbank/callback` | 인증 코드를 토큰으로 교환 |
| `POST` | `/api/openbank/refresh` | 액세스 토큰 갱신 |
| `GET` | `/api/openbank/accounts` | 등록된 계좌 목록 조회 |
| `POST` | `/api/openbank/accounts` | 계좌 등록 (핀테크이용번호) |
| `PUT` | `/api/openbank/accounts/:id` | 계좌 설정 변경 (동기화 주기 등) |
| `DELETE` | `/api/openbank/accounts/:id` | 계좌 삭제 |
| `GET` | `/api/openbank/transactions` | 거래내역 조회 + DB 저장 |
| `POST` | `/api/openbank/sync` | 미처리 거래 자동 매칭 실행 (수동 버튼에서 호출) |
| `GET` | `/api/openbank/sync/status` | 동기화 상태 확인 (마지막 동기화 시간 등) |
| `POST` | `/api/payments/manual` | 수동 결제 추가 (건물/호수/날짜/금액 + 자동 재배정) |
| `GET` | `/api/buildings/for-user` | 건물 목록 (Admin: 전체, 임대인: 본인 건물만) |
| `GET` | `/api/buildings/:id/rooms` | 건물의 호수 목록 (활성 계약 기준) |

### 핵심 API 구현 예시

#### 3-1. OAuth 인증 시작

```javascript
app.get('/api/openbank/authorize', async (c) => {
    const clientId = c.env.OPENBANK_CLIENT_ID;
    const redirectUri = `${c.env.SITE_URL}/api/openbank/callback`;
    const state = crypto.randomUUID(); // CSRF 방지

    // state를 DB나 KV에 임시 저장
    const userId = c.req.query('user_id');

    const authUrl = `https://testapi.openbanking.or.kr/oauth/2.0/authorize`
        + `?response_type=code`
        + `&client_id=${clientId}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}`
        + `&scope=login inquiry transfer`
        + `&state=${state}`
        + `&auth_type=0`; // 0: 개인, 1: 기업

    return c.redirect(authUrl);
});
```

#### 3-2. OAuth 콜백

```javascript
app.get('/api/openbank/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');

    // 토큰 교환
    const tokenRes = await fetch('https://testapi.openbanking.or.kr/oauth/2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: c.env.OPENBANK_CLIENT_ID,
            client_secret: c.env.OPENBANK_CLIENT_SECRET,
            redirect_uri: `${c.env.SITE_URL}/api/openbank/callback`,
            grant_type: 'authorization_code'
        })
    });

    const tokens = await tokenRes.json();
    // bank_tokens 테이블에 저장
    // 사용자를 설정 페이지로 리다이렉트
    return c.redirect('/settings_profile.html?bank=connected');
});
```

#### 3-3. 토큰 갱신

```javascript
app.post('/api/openbank/refresh', async (c) => {
    const userId = c.req.query('user_id');

    // bank_tokens에서 기존 refresh_token 조회
    const existingToken = await getToken(userId);
    if (!existingToken) {
        return c.json({ error: 'No token found' }, 404);
    }

    const tokenRes = await fetch('https://testapi.openbanking.or.kr/oauth/2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: c.env.OPENBANK_CLIENT_ID,
            client_secret: c.env.OPENBANK_CLIENT_SECRET,
            refresh_token: existingToken.refresh_token,
            grant_type: 'refresh_token'
        })
    });

    const newTokens = await tokenRes.json();
    // bank_tokens 업데이트
    return c.json({ message: 'Token refreshed', expires_at: newTokens.expires_at });
});
```

#### 3-4. 계좌 설정 변경 (동기화 주기)

```javascript
app.put('/api/openbank/accounts/:id', async (c) => {
    const accountId = c.req.params.id;
    const { sync_interval, account_alias, is_primary } = req.body;

    // sync_interval 검증
    const validIntervals = ['manual', '5min', '1h', '3h', 'daily'];
    if (sync_interval && !validIntervals.includes(sync_interval)) {
        return c.json({ error: 'Invalid sync_interval' }, 400);
    }

    await db.run(
        `UPDATE bank_accounts SET sync_interval = ?, account_alias = ?, is_primary = ? WHERE id = ?`,
        [sync_interval, account_alias, is_primary ? 1 : 0, accountId]
    );

    return c.json({ message: 'Account settings updated' });
});
```

#### 3-5. 거래내역 조회 + 자동 저장

```javascript
app.get('/api/openbank/transactions', async (c) => {
    const userId = c.req.query('user_id');
    const accountId = c.req.query('account_id');

    // 1) 유효한 토큰 확보 (갱신 필요시 refresh)
    const token = await getValidToken(userId, c.env);
    const account = await getAccount(accountId);

    // 2) 마지막 동기화 이후의 거래만 조회
    const fromDate = account.last_synced_at
        ? formatDate(account.last_synced_at)
        : formatDateDaysAgo(7);

    // 3) 금융결제원 API 호출
    const tranRes = await fetch(
        `https://testapi.openbanking.or.kr/v2.0/account/transaction_list`
        + `?fintech_use_num=${account.account_num}`
        + `&inquiry_type=1`          // 1: 입금, 2: 출금, 3: 전체
        + `&inquiry_base=D`          // D: 일별, T: 거래번호
        + `&from_date=${fromDate}`
        + `&to_date=${formatDateToday()}`
        + `&sort_order=D`,           // D: 내림차순
        {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token.access_token}`,
            }
        }
    );

    const transactions = await tranRes.json();

    // 4) bank_transactions에 저장 (중복 체크)
    let savedCount = 0;
    for (const t of transactions.res_list) {
        const exists = await checkTransactionExists(userId, accountId, t);
        if (!exists) {
            await saveTransaction(userId, accountId, t);
            savedCount++;
        }
    }

    // 5) 마지막 동기화 시간 업데이트
    await db.run(
        `UPDATE bank_accounts SET last_synced_at = datetime('now') WHERE id = ?`,
        [accountId]
    );

    return c.json({ synced: savedCount, total: transactions.res_list.length });
});
```

#### 3-6. 수동 동기화 + 자동 매칭

```javascript
app.post('/api/openbank/sync', async (c) => {
    const userId = c.req.query('user_id');

    // 1) 먼저 거래내역 최신화
    const accounts = await getUserAccounts(userId);
    for (const account of accounts) {
        await fetchTransactions(userId, account.id, c.env);
    }

    // 2) 미처리 입금 내역 조회
    const unprocessed = await getUnprocessedTransactions(userId);

    const results = [];
    for (const tran of unprocessed) {
        // 기존 parsePaymentText 로직 대신 bank_transactions의 메모 사용
        const parsed = {
            tokens: extractTokensFromMemo(tran.memo),
            keyword: extractKeywordFromMemo(tran.memo),
            amount: tran.amount,
            date: new Date(tran.tran_date + 'T' + tran.tran_time),
            originalText: tran.memo
        };

        // 기존 매칭 로직 재사용 (키워드 vs 계약 스코어링)
        const match = await findBestContractMatch(userId, parsed.keyword);

        if (match && match.matchScore >= 100) {
            // 자동 배정 (기존 calculateAllocation 로직과 동일)
            const allocation = await autoAllocate(match.contract_id, parsed);
            // 처리 완료 표시
            await markTransactionProcessed(tran.id, allocation.paymentId);
            results.push({ tran_id: tran.id, matched: true, allocation });
        } else {
            results.push({ tran_id: tran.id, matched: false, reason: 'low_score' });
        }
    }

    return c.json({ results });
});
```

#### 3-7. 동기화 상태 조회

```javascript
app.get('/api/openbank/sync/status', async (c) => {
    const userId = c.req.query('user_id');

    const accounts = await db.all(
        `SELECT id, bank_name, account_alias, sync_interval, last_synced_at FROM bank_accounts WHERE user_id = ?`,
        [userId]
    );

    const unprocessedCount = await db.get(
        `SELECT COUNT(*) as count FROM bank_transactions WHERE user_id = ? AND is_processed = 0 AND tran_type = '입금'`,
        [userId]
    );

    return c.json({
        accounts,
        unprocessed_count: unprocessedCount.count,
        has_token: !!(await getToken(userId))
    });
});
```

#### 3-8. 수동 결제 추가 (건물/호수/날짜/금액 선택)

수동 결제 추가는 **건물, 호수, 날짜, 금액**을 필수로 입력받습니다.
자유 형식 텍스트 입력도 지원하지만, 권장은 구조화된 폼 입력입니다.

```javascript
app.post('/api/payments/manual', async (c) => {
    const { user_id, contract_id, paid_at, amount, memo, text } = req.body;

    // 구조화된 입력 (권장)
    if (contract_id && paid_at && amount) {
        // 1. 결제 기록 생성
        const paymentResult = await db.run(
            `INSERT INTO payments (contract_id, amount, paid_at, memo, type) VALUES (?, ?, ?, ?, 'monthly_rent')`,
            [contract_id, amount, paid_at, memo || '수동 추가']
        );
        const paymentId = paymentResult.lastID;

        // 2. Invoice 자동 재배정 실행 (핵심!)
        const reallocationResult = await reallocateInvoices(contract_id, paymentId, amount, paid_at);

        return c.json({
            message: '수동 결제가 추가되었고 Invoice 배정이 조정되었습니다.',
            payment_id: paymentId,
            reallocation: reallocationResult
        });
    }

    // 자유 형식 텍스트 입력 (하위 호환)
    if (text) {
        const parsed = parseManualPaymentText(text);
        if (!parsed) {
            return c.json({ error: '파싱 실패: 형식을 확인해주세요.' }, 400);
        }

        // 건물/호수로 계약 찾기
        let contract = null;
        if (parsed.building && parsed.roomNumber) {
            contract = await findContractByBuildingRoom(user_id, parsed.building, parsed.roomNumber);
        }

        if (!contract) {
            return c.json({
                error: '매칭되는 계약을 찾을 수 없습니다.',
                parsed,
                hint: '건물명과 호수를 정확히 입력해주세요.'
            }, 404);
        }

        const paymentResult = await db.run(
            `INSERT INTO payments (contract_id, amount, paid_at, memo, type) VALUES (?, ?, ?, ?, 'monthly_rent')`,
            [contract.id, parsed.amount, parsed.date.toISOString(), parsed.originalText]
        );

        const reallocationResult = await reallocateInvoices(
            contract.id, paymentResult.lastID, parsed.amount, parsed.date.toISOString()
        );

        return c.json({
            message: '수동 결제가 추가되었고 Invoice 배정이 조정되었습니다.',
            payment_id: paymentResult.lastID,
            contract: { id: contract.id, building: contract.building, room_number: contract.room_number },
            reallocation: reallocationResult
        });
    }

    return c.json({ error: 'contract_id + paid_at + amount 또는 text가 필요합니다.' }, 400);
});
```

#### 3-8a. 건물/호수 조회 API (권한별 필터링)

수동 결제 추가 시 건물과 호수를 선택할 수 있는 API입니다.

```javascript
// 건물 목록 조회 (권한별 필터링)
app.get('/api/buildings/for-user', async (c) => {
    const userId = c.req.query('user_id');
    const userRole = c.req.query('role');

    let query, params;
    if (userRole === 'admin') {
        // Admin: 모든 건물
        query = `SELECT b.id, b.name FROM buildings b ORDER BY b.name`;
        params = [];
    } else {
        // 임대인: 자신이 관리하는 건물만
        query = `
            SELECT b.id, b.name FROM buildings b
            JOIN landlord_buildings lb ON b.id = lb.building_id
            WHERE lb.landlord_id = ?
            ORDER BY b.name
        `;
        params = [userId];
    }

    const buildings = await db.all(query, params);
    return c.json(buildings);
});

// 건물의 호수 목록 조회 (활성 계약 기준)
app.get('/api/buildings/:id/rooms', async (c) => {
    const buildingId = c.req.params.id;

    const rooms = await db.all(`
        SELECT r.id, r.room_number, c.id as contract_id, c.tenant_id,
               u.nickname as tenant_name
        FROM rooms r
        LEFT JOIN contracts c ON r.id = c.room_id AND c.tenant_id IS NOT NULL
        LEFT JOIN users u ON c.tenant_id = u.id
        WHERE r.building_id = ?
        ORDER BY CAST(r.room_number AS INTEGER)
    `, [buildingId]);

    return c.json(rooms);
});
```

#### 3-9. Invoice 자동 재배정 알고리즘 (중간 납부 삽입 시)

수동으로 납부를 추가할 때, 기존 납부 기록 사이에 날짜가 끼어들면
**해당 계약의 모든 납부를 날짜순으로 재정렬하여 Invoice를 재배정**합니다.

**핵심 원리:**
- 납부는 **paid_at 날짜순**으로 정렬
- 각 납부는 **정렬된 순서대로 미납 Invoice에 순차 배정**
- 선불(prepaid): 납부일이 속한 달 또는 다음 미납 달의 Invoice에 배정
- 후불(postpaid): 납부일의 전 달 또는 다음 미납 달의 Invoice에 배정

```javascript
async function reallocateInvoices(contractId, newPaymentId, newPaymentAmount, newPaidAt) {
    // 1. 해당 계약의 모든 납부 기록을 날짜순으로 조회
    const allPayments = await db.all(
        `SELECT p.id, p.amount, p.paid_at, p.type
         FROM payments p
         WHERE p.contract_id = ?
         ORDER BY p.paid_at ASC, p.id ASC`,
        [contractId]
    );

    // 2. 해당 계약의 계약 정보 조회 (선불/후불 구분)
    const contract = await db.get(
        `SELECT * FROM contracts WHERE id = ?`,
        [contractId]
    );
    const isPostpaid = contract.payment_type === 'postpaid';

    // 3. 해당 계약의 모든 Invoice 조회 (월별 오름차순)
    const allInvoices = await db.all(
        `SELECT i.id, i.type, i.billing_month, i.amount as due_amount, i.due_date
         FROM invoices i
         WHERE i.contract_id = ? AND i.type != 'deposit'
         ORDER BY i.billing_month ASC`,
        [contractId]
    );

    // 4. 기존 payment_allocation 모두 삭제 (재배정을 위해)
    await db.run(
        `DELETE FROM payment_allocation
         WHERE payment_id IN (
             SELECT id FROM payments WHERE contract_id = ?
         )`,
        [contractId]
    );

    // 5. 날짜순으로 재배정
    let invoiceIdx = 0;
    const results = [];

    for (const payment of allPayments) {
        let remaining = payment.amount;

        // 이 납부가 배정될 Invoice 찾기
        // 선불: 납부일이 속한 달 이후의 첫 번째 미납 Invoice
        // 후불: 납부일의 전 달 이후의 첫 번째 미납 Invoice
        const paidDate = new Date(payment.paid_at);
        const paidMonth = paidDate.toISOString().slice(0, 7); // YYYY-MM

        // 납부일 기준으로 배정할 첫 Invoice 결정
        let targetInvoiceIdx = invoiceIdx;

        // 아직 배정되지 않은 Invoice 중에서 납부일에 맞는 것 찾기
        for (let i = invoiceIdx; i < allInvoices.length; i++) {
            const inv = allInvoices[i];

            // 이 Invoice가 이미 이전 납부에서 완납되었는지 확인
            // (invoiceIdx가 가리키는 것이 다음 미납 Invoice)
            if (i > invoiceIdx) break;

            // 납부일과 Invoice의 청구월 관계 확인
            const isMatch = isPostpaid
                ? inv.billing_month <= paidMonth  // 후불: 납부월 >= 청구월
                : inv.billing_month >= paidMonth || true;  // 선불: 순서대로 배정

            if (isMatch) {
                targetInvoiceIdx = i;
                break;
            }
        }

        // 순차 배정: targetInvoiceIdx부터 미납 Invoice에 배정
        for (let i = targetInvoiceIdx; i < allInvoices.length && remaining > 0; i++) {
            const inv = allInvoices[i];

            // 이 Invoice에 이미 배정된 금액 계산
            const alreadyAllocated = results
                .filter(r => r.invoice_id === inv.id)
                .reduce((sum, r) => sum + r.amount, 0);

            const owed = inv.due_amount - alreadyAllocated;
            if (owed <= 0) continue;

            const allocate = Math.min(remaining, owed);

            results.push({
                payment_id: payment.id,
                invoice_id: inv.id,
                amount: allocate,
                billing_month: inv.billing_month
            });

            remaining -= allocate;

            // 다음 납부는 이 Invoice 다음부터 시작
            if (owed <= allocate) {
                invoiceIdx = i + 1;
            }
        }

        // 남은 금액이 있으면 다음 달 Invoice 생성
        if (remaining > 0) {
            const lastMonth = allInvoices.length > 0
                ? allInvoices[allInvoices.length - 1].billing_month
                : paidMonth;
            const nextMonth = incrementMonth(lastMonth);

            // 새 Invoice 생성
            const newInvResult = await db.run(
                `INSERT INTO invoices (contract_id, type, billing_month, amount, status, due_date)
                 VALUES (?, 'monthly_rent', ?, ?, '부분납부', ?)`,
                [contractId, nextMonth, contract.monthly_rent,
                 calculateDueDate(contract, nextMonth)]
            );

            results.push({
                payment_id: payment.id,
                invoice_id: newInvResult.lastID,
                amount: remaining,
                billing_month: nextMonth
            });

            allInvoices.push({
                id: newInvResult.lastID,
                type: 'monthly_rent',
                billing_month: nextMonth,
                due_amount: contract.monthly_rent
            });

            remaining = 0;
        }
    }

    // 6. payment_allocation에 재배정 결과 저장
    for (const r of results) {
        await db.run(
            `INSERT INTO payment_allocation (payment_id, invoice_id, amount) VALUES (?, ?, ?)`,
            [r.payment_id, r.invoice_id, r.amount]
        );
    }

    // 7. 모든 Invoice 상태 업데이트
    for (const inv of allInvoices) {
        const totalPaid = results
            .filter(r => r.invoice_id === inv.id)
            .reduce((sum, r) => sum + r.amount, 0);
        const newStatus = totalPaid >= inv.due_amount ? '완납' :
                         (totalPaid > 0 ? '부분납부' : '미납');
        await db.run(
            `UPDATE invoices SET status = ? WHERE id = ?`,
            [newStatus, inv.id]
        );
    }

    return {
        reallocated: true,
        payment_count: allPayments.length,
        allocation_count: results.length,
        details: results
    };
}

// 월 증가 헬퍼
function incrementMonth(yyyyMM) {
    const [y, m] = yyyyMM.split('-').map(Number);
    let nextY = y, nextM = m + 1;
    if (nextM > 12) { nextY++; nextM = 1; }
    return `${nextY}-${String(nextM).padStart(2, '0')}`;
}

// 납부일 기준 due date 계산
function calculateDueDate(contract, billingMonth) {
    if (!contract.contract_start_date) return null;
    const startDay = contract.contract_start_date.slice(8, 10);
    const isPostpaid = contract.payment_type === 'postpaid';
    let [y, m] = billingMonth.split('-').map(Number);
    if (isPostpaid) {
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return `${y}-${String(m).padStart(2, '0')}-${startDay}`;
}
```

**재배정 동작 예시 (선불):**

```
[Before] 3월10일 납부 300,000원 → 3월 Invoice
          5월11일 납부 300,000원 → 4월 Invoice

[수동 추가] 4월 3일 납부 300,000원

[재배정 프로세스]
1. 모든 납부를 날짜순 정렬: 3월10일, 4월3일, 5월11일
2. 기존 payment_allocation 삭제
3. 순차 재배정:
   - 3월10일 300,000원 → 3월 Invoice (첫 번째 미납)
   - 4월3일 300,000원 → 4월 Invoice (다음 미납)
   - 5월11일 300,000원 → 5월 Invoice (다음 미납)
4. Invoice 상태 업데이트

[After] 3월10일 납부 → 3월 Invoice
        4월3일 납부 → 4월 Invoice  ← 신규
        5월11일 납부 → 5월 Invoice  ← 4월에서 5월로 변경
```

---

## 4단계: wrangler.toml 환경변수 추가

```toml
[vars]
# Open Banking (테스트)
OPENBANK_API_URL = "https://testapi.openbanking.or.kr"
OPENBANK_CLIENT_ID = "your-client-id"
# 시크릿은 wrangler secret으로 설정:
# wrangler pages secret put OPENBANK_CLIENT_SECRET
```

### Cloudflare Workers Secrets 설정

```bash
npx wrangler pages secret put OPENBANK_CLIENT_SECRET
npx wrangler pages secret put OPENBANK_CLIENT_ID
```

---

## 5단계: 프론트엔드 변경

### 5-0. 대시보드 (dashboard.html)에 자동 동기화 결과 표시

자동 동기화(Cron)가 완료되면 **대시보드에 결과를 표시**합니다.

```
┌──────────────────────────────────────────────────────┐
│  대시보드                                              │
│                                                        │
│  ┌──────────────────────────────────────────────────┐ │
│  │ 📊 계좌 동기화 완료 (2026-06-18 12:00)            │ │
│  │                                                    │ │
│  │ 신규 입금: 5건                                     │ │
│  │ 자동 매칭 완료: 3건 ✅                              │ │
│  │ 확인 필요: 2건 ⚠️                                  │ │
│  │                                                    │ │
│  │ [확인하러 가기]                                     │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ... 기존 대시보드 내용 ...                              │
└──────────────────────────────────────────────────────┘
```

**표시 조건:**
- 마지막 자동 동기화 이후 **미확인 결과**가 있을 때만 카드 표시
- 사용자가 "확인하러 가기" 클릭 후 모든 건을 확인하면 카드 사라짐
- 확인 필요 건(매칭 점수 < 100)이 0건이면 "모든 입금이 자동 매칭되었습니다 ✅"로 표시

**데이터 흴득 API:**
- `GET /api/openbank/sync/status` — 미확인 건수, 마지막 동기화 시간 등
- `GET /api/openbank/unconfirmed` — 미확인 입금 목록 (상세)

**구현 방식:**
- 대시보드 로드 시 `/api/openbank/sync/status` 호출
- `unprocessed_count > 0`이면 동기화 결과 카드 표시
- "확인하러 가기" 클릭 시 `payments.html`로 이동 (미확인 건이 하이라이트됨)
- 사용자가 모든 미확인 건을 처리하면 `is_processed = 1`로 업데이트되어 카드 자동 소멸

---

### 5-1. 설정 페이지 (settings_profile.html)에 은행 연동 UI 추가

```
┌─────────────────────────────────────────────────┐
│  은행 계좌 연결                                    │
│                                                   │
│  [은행 연결하기]  ← /api/openbank/authorize 이동   │
│                                                   │
│  연결된 계좌:                                      │
│  ┌───────────────────────────────────────────┐   │
│  │ 우리은행 ****-****-****  [주 수금 계좌]      │   │
│  │ 동기화 주기: [3시간마다 ▾]  [지금 동기화]     │   │
│  │ 마지막 동기화: 2026-06-18 12:00             │   │
│  └───────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────┐   │
│  │ 국민은행 ****-****-****                      │   │
│  │ 동기화 주기: [매일 ▾]  [지금 동기화]          │   │
│  │ 마지막 동기화: 2026-06-18 09:00             │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

- **"은행 계좌 연결"** 버튼 → `/api/openbank/authorize`로 리다이렉트
- 연결된 계좌 목록 표시
- **계좌별 동기화 주기 설정** 드롭다운 (manual / 5min / 1h / 3h / daily)
- **"지금 동기화"** 버튼 → `/api/openbank/sync` 즉시 호출
- 마지막 동기화 시간 표시

### 5-2. 납부 관리 페이지 (payments.html) 개선

```
┌──────────────────────────────────────────────────────┐
│ 납부 관리       [수동 조회] [결제 추가] [문자 추가]      │
│                 ↑ 주기와 별개  ↑ 수동 입력  ↑ 기존 방식  │
└──────────────────────────────────────────────────────┘
```

- **"수동 조회"** 버튼 (상단) — 자동 주기와 별개
  - 클릭 시 **기간 선택 팝업** 표시 (시작일/종료일 캘린더 선택)
  - 기본 기간: 이번 달 1일 ~ 오늘
  - 조회 후 입금 내역을 **하나씩 순차 처리**:
    - 중복 의심 없음 → 자동 매칭 진행
    - 중복 의심 → 팝업으로 확인 요청 (건너뛰기 / 새 납부로 등록)
  - 완료 후 "N건 자동 매칭, M건 확인 필요" 알림
- **"결제 추가"** 버튼 (상단)
  - 클릭 시 수동 입력 모달 오픈 (아래 5-3절)
- **"문자 추가"** 버튼 (상단) — 기존 방식 유지 (하위 호환)
- 자동 매칭된 건: 초록색 "자동 완납" 배지
- 매칭 점수 낮은 건: 노란색 "확인 필요" 배지 → 클릭 시 `payments_keyword.html` 이동

### 5-3. 수동 결제 추가 모달 (구조화된 폼 + 자유 형식)

수동 결제 추가는 **건물, 호수, 날짜, 금액**을 필수로 입력하는 구조화된 폼과
자유 형식 텍스트 입력을 모두 지원합니다.

#### 구조화된 폼 (권장)

```
┌──────────────────────────────────────────────────────┐
│  결제 추가                                              │
│                                                        │
│  건물:  ┌─────────────────────┐                       │
│         │ a건물              ▾│  ← 드롭다운 (팝업 메뉴)   │
│         └─────────────────────┘                       │
│         Admin: 모든 건물 표시                            │
│         임대인: 로그인한 임대인의 건물만 표시               │
│                                                        │
│  호수:  ┌─────────────────────┐                       │
│         │ 203호              ▾│  ← 건물 선택 시 해당 호수만 │
│         └─────────────────────┘                       │
│         건물 선택 전: 비활성화                             │
│         건물 선택 후: 해당 건물의 호수 목록 로드             │
│                                                        │
│  날짜:  ┌─────────────────────┐                       │
│         │ 2026-04-03      📅 │  ← 캘린더 팝업으로 날짜 선택  │
│         └─────────────────────┘                       │
│         클릭 시 캘린더 팝업 표시                           │
│         월/년 이동 가능, 날짜 클릭으로 선택                  │
│                                                        │
│  금액:  ┌─────────────────────┐                       │
│         │ 300,000            │ 원                      │
│         └─────────────────────┘                       │
│                                                        │
│  메모:  ┌─────────────────────┐                       │
│         │ 현금 수령            │ (선택)                  │
│         └─────────────────────┘                       │
│                                                        │
│  ⚠ Invoice 재배정 안내:                                 │
│  이 납부가 기존 납부 사이에 삽입되면                       │
│  이후 납부의 Invoice 배정이 자동 조정됩니다.               │
│                                                        │
│  [취소]                            [저장 및 배정]        │
└──────────────────────────────────────────────────────┘
```

**건물 드롭다운 (팝업 메뉴):**
- 로그인한 사용자의 권한에 따라 건물 목록을 조회하여 드롭다운에 표시
- API: `GET /api/buildings/for-user?user_id=xxx&role=xxx`
  - **Admin**: 시스템의 모든 건물 표시
  - **임대인(Landlord)**: `landlord_buildings` 테이블에서 본인이 관리하는 건물만 표시
- 건물 선택 시 → 호수 드롭다운 활성화 + 해당 건물의 호수 로드

**호수 드롭다운 (팝업 메뉴):**
- 건물 선택 전: 비활성화 상태
- 건물 선택 후: `GET /api/buildings/:id/rooms` 로 해당 건물의 호수 목록 로드
- 호수 선택 시 contract_id 자동 설정 (해당 호수의 활성 계약)

**날짜 캘린더 팝업:**
- 날짜 입력 필드 클릭 시 캘린더 팝업 표시
- 월/년 이동 가능, 날짜 클릭으로 선택
- 기본값: 오늘 날짜
- HTML5 `<input type="date">` 또는 커스텀 캘린더 컴포넌트 사용

#### 자유 형식 텍스트 (대체 입력)

```
┌─────────────────────────────────────────────────┐
│  결제 추가                                         │
│                                                   │
│  [구조화 입력] [자유 형식]  ← 탭 전환               │
│                                                   │
│  ┌───────────────────────────────────────────┐   │
│  │ a건물 203호 4월12일 300,000원 입금          │   │
│  │                                           │   │
│  │ (건물명, 호수, 날짜, 금액을 자유롭게 입력)     │   │
│  └───────────────────────────────────────────┘   │
│                                                   │
│  파싱 결과:                                        │
│  건물: a건물 | 호수: 203호 | 날짜: 4월12일         │
│  금액: 300,000원 | 키워드: 203호                    │
│                                                   │
│  [취소]                    [매칭 및 배정하러 이동]   │
└─────────────────────────────────────────────────┘
```

**`parseManualPaymentText()` 함수:**

기존 `parsePaymentText()`는 "입금" 키워드 기반이었지만, 수동 입력을 지원하기 위해 **건물명, 호수, 날짜, 금액을 자유 형식에서 추출**하도록 확장합니다.

```javascript
function parseManualPaymentText(text) {
    // 1. 금액 추출 (다양한 패턴 지원)
    let amount = 0;
    const amountPatterns = [
        /([\d,]+)\s*원/,           // 300,000원 / 300000원
        /입금\s*([\d,]+)/,         // 입금 300,000
        /([\d,]+)\s*입금/,         // 300,000입금
    ];
    for (const pattern of amountPatterns) {
        const match = text.match(pattern);
        if (match) {
            amount = parseInt(match[1].replace(/,/g, ''), 10);
            break;
        }
    }
    if (amount === 0) return null;

    // 2. 날짜 추출 (다양한 형식 지원)
    let date = new Date();
    const datePatterns = [
        /(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/,          // 2026.06.15 / 2026-06-15
        /(\d{1,2})월\s*(\d{1,2})일/,                          // 6월15일 / 4월12일
        /(\d{1,2})[\/\-](\d{1,2})/,                            // 06/15 / 6-15
    ];

    for (const pattern of datePatterns) {
        const match = text.match(pattern);
        if (match) {
            if (match.length === 4) {
                // YYYY-MM-DD
                date = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
            } else if (match.length === 3) {
                // MM월 DD일 또는 MM/DD
                const today = new Date();
                const m = parseInt(match[1]);
                const d = parseInt(match[2]);
                date = new Date(today.getFullYear(), m - 1, d);
                // 과거 날짜 보정
                if (date > today) date.setFullYear(date.getFullYear() - 1);
            }
            break;
        }
    }

    // 3. 건물명 + 호수 추출
    let building = '';
    let roomNumber = '';
    const roomMatch = text.match(/(\S+)\s*(\d{1,4})호/);
    if (roomMatch) {
        building = roomMatch[1];
        roomNumber = roomMatch[2];
    }

    // 4. 키워드 추출 (기존 로직 + 건물/호수 기반)
    const depositIdx = text.indexOf('입금');
    let tokens = [];
    let keyword = '';

    if (depositIdx !== -1) {
        // 기존 로직: "입금" 앞 토큰 분리
        const beforeDeposit = text.substring(0, depositIdx).trim();
        tokens = beforeDeposit.split(/[<>\[\]\s\n]+/).filter(t => t.length > 0);
        keyword = tokens.length > 0 ? tokens[tokens.length - 1] : '';
    }

    // 건물/호수가 있으면 키워드에 추가
    if (roomNumber) {
        tokens.push(roomNumber + '호');
        if (!keyword) keyword = roomNumber + '호';
    }
    if (building) {
        tokens.push(building);
    }

    // "현금수령" 키워드 감지
    const isCash = /현금|cash/i.test(text);

    return {
        tokens: [...new Set(tokens)],
        keyword: keyword,
        amount: amount,
        date: date,
        originalText: text,
        building: building,
        roomNumber: roomNumber,
        isCash: isCash
    };
}
```

**수동 입력 사용 예시:**

| 입력 | 건물 | 호수 | 날짜 | 금액 | 키워드 |
|------|------|------|------|------|--------|
| `a건물 203호 4월12일 300,000원 입금` | a건물 | 203 | 04-12 | 300,000 | 203호 |
| `홍길동 현금수령 500,000원 2026-06-15` | - | - | 2026-06-15 | 500,000 | 홍길동 |
| `입금 450,000 06/17` | - | - | 06-17 | 450,000 | - |
| `b빌딩 501호 월세 600,000원` | b빌딩 | 501 | 오늘 | 600,000 | 501호 |

---

## 6단계: 전체 흐름도 (오픈뱅킹 추가 후)

```
[자동 흐름 — 오픈뱅킹]
은행 OAuth 인증 → 계좌 등록 → 설정한 주기로 자동 동기화
    ↓
bank_transactions에 저장 (source='openbank')
    ↓
자동 키워드 추출 (입금자명/memo 기반)
    ↓
계약 키워드와 스코어링 (기존 로직 재사용)
    ↓
┌─ 점수 ≥ 100: 자동 Invoice 배당 (보증금 → 미납 → 다음월세)
└─ 점수 < 100: 수동 확인 대기 → payments_keyword.html로 이동

[수동 흐름 1 — 기존 문자 붙여넣기]
SMS 문자 붙여넣기 → parsePaymentText → 키워드/금액 추출 → 세입자 매칭 → Invoice 배당

[수동 흐름 2 — 자유 형식 결제 추가]
"a건물 203호 4월12일 300,000원 입금" 입력
    ↓
parseManualPaymentText → 건물/호수/날짜/금액 추출
    ↓
bank_transactions에 저장 (source='manual')
    ↓
세입자 매칭 → Invoice 배당
```

---

## 7단계: 토큰 자동 갱신 + 주기별 동기화 (Cron Trigger)

Cloudflare Workers의 Cron Trigger를 사용하여 만료된 토큰을 자동 갱신하고, 사용자가 설정한 주기에 따라 동기화를 실행합니다.

### wrangler.toml 추가

```toml
[crons]
triggers = ["0 */5 * * *"]  # 5분마다 실행 (내부에서 주기 체크)
```

### Cron Handler 구현

```javascript
export default {
    async scheduled(event, env, ctx) {
        // 1. 만료 임박 토큰 갱신
        const expiringTokens = await db.all(
            `SELECT * FROM bank_tokens WHERE expires_at < datetime('now', '+1 hour')`
        );

        for (const token of expiringTokens) {
            try {
                const res = await fetch(`${env.OPENBANK_API_URL}/oauth/2.0/token`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({
                        client_id: env.OPENBANK_CLIENT_ID,
                        client_secret: env.OPENBANK_CLIENT_SECRET,
                        refresh_token: token.refresh_token,
                        grant_type: 'refresh_token'
                    })
                });
                const newToken = await res.json();
                await db.run(
                    `UPDATE bank_tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?`,
                    [newToken.access_token, newToken.refresh_token, newToken.expires_at, token.id]
                );
            } catch (e) {
                console.error(`Token refresh failed for user ${token.user_id}:`, e);
            }
        }

        // 2. 동기화 주기에 따른 계좌 동기화
        const accountsToSync = await db.all(
            `SELECT ba.*, bt.access_token
             FROM bank_accounts ba
             JOIN bank_tokens bt ON ba.user_id = bt.user_id
             WHERE ba.sync_interval != 'manual'
               AND (ba.last_synced_at IS NULL
                    OR (
                        (ba.sync_interval = '5min' AND ba.last_synced_at < datetime('now', '-5 minutes'))
                     OR (ba.sync_interval = '1h' AND ba.last_synced_at < datetime('now', '-1 hour'))
                     OR (ba.sync_interval = '3h' AND ba.last_synced_at < datetime('now', '-3 hours'))
                     OR (ba.sync_interval = 'daily' AND ba.last_synced_at < datetime('now', '-1 day'))
                    ))`
        );

        for (const account of accountsToSync) {
            try {
                // 거래내역 조회 + 저장
                await fetchAndSaveTransactions(account, env);
                // 마지막 동기화 시간 업데이트
                await db.run(
                    `UPDATE bank_accounts SET last_synced_at = datetime('now') WHERE id = ?`,
                    [account.id]
                );
            } catch (e) {
                console.error(`Sync failed for account ${account.id}:`, e);
            }
        }

        // 3. 미처리 거래 자동 매칭
        const unprocessed = await db.all(
            `SELECT * FROM bank_transactions WHERE is_processed = 0 AND tran_type = '입금'`
        );

        for (const tran of unprocessed) {
            const parsed = {
                tokens: extractTokensFromMemo(tran.memo),
                keyword: extractKeywordFromMemo(tran.memo),
                amount: tran.amount,
                date: new Date(tran.tran_date + 'T' + (tran.tran_time || '12:00')),
                originalText: tran.memo
            };

            const match = await findBestContractMatch(tran.user_id, parsed.keyword);

            if (match && match.matchScore >= 100) {
                await autoAllocate(match.contract_id, parsed);
                await db.run(
                    `UPDATE bank_transactions SET is_processed = 1 WHERE id = ?`,
                    [tran.id]
                );
            }
        }
    }
};
```

---

## 8단계: 구현 우선순위

| 순위 | 작업 | 예상 기간 |
|------|------|-----------|
| 1 | 금융결제원 개발자센터 가입 + 테스트 API 키 발급 | 1-2일 |
| 2 | DB 스키마 추가 (bank_tokens, bank_accounts, bank_transactions) | 0.5일 |
| 3 | OAuth 인증 흐름 구현 (authorize → callback → token 저장) | 1일 |
| 4 | 계좌 등록/조회/설정 API (동기화 주기 포함) | 0.5일 |
| 5 | 거래내역 조회 + DB 저장 | 1일 |
| 6 | 수동 결제 추가 API + parseManualPaymentText | 1일 |
| 7 | 자동 매칭 로직 (기존 스코어링 재사용) | 1일 |
| 8 | 프론트엔드 UI (설정, 동기화, 수동 추가, 결과 표시) | 2일 |
| 9 | 토큰 자동 갱신 + Cron 동기화 | 0.5일 |
| 10 | 테스트 환경 → 운영 환경 전환 | 별도 승인 필요 |

**총 예상 기간: 약 8-9일**

---

## 참고: 금융결제원 오픈뱅킹 API 주요 엔드포인트

| API | URL | 설명 |
|-----|-----|------|
| 인증 | `/oauth/2.0/authorize` | 사용자 로그인 |
| 토큰발급 | `/oauth/2.0/token` | 코드→토큰 교환 |
| 토큰갱신 | `/oauth/2.0/token` (refresh_token) | 만료 토큰 갱신 |
| 계좌목록 | `/v2.0/account/list` | 사용자 계좌 조회 |
| 잔액조회 | `/v2.0/account/balance` | 계좌 잔액 |
| 거래내역 | `/v2.0/account/transaction_list` | 입출금 내역 조회 |

### API 문서

- 금융결제원 개발자센터: https://developers.kftc.or.kr
- 오픈뱅킹 API 가이드: https://developers.kftc.or.kr/docs
