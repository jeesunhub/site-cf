# Invoice / 결제 테스트

## 파이프라인 흐름

```
generate_contracts.js → contracts.json → test_invoice.js → test_result.json
                                                              ↓
                                          generate_payments.js → payments.json → test_payment.js → test_payment_result.md
```

## 1. 계약서 생성

```bash
# 기본 (3건)
node test/invoice/generate_contracts.js

# 개수 지정
node test/invoice/generate_contracts.js -n 5

# 출력 경로 지정
node test/invoice/generate_contracts.js -n 3 -o my_contracts.json
```

**출력**: `contracts.json` - 랜덤 계약서 데이터 (선불/후불, 기간, 보증금, 월세 등)

## 2. Invoice 테스트

```bash
node test/invoice/test_invoice.js -i contracts.json
```

계약 생성 → `syncContractInvoices`로 Invoice 자동 생성 → DB 검증

**검증 항목**: 보증금 Invoice 1건, 월세 Invoice 개수, 금액, 납입일, 총액

**출력**: `test_result.json`, `test_result.md`

## 3. 결제 데이터 생성

```bash
node test/invoice/generate_payments.js -i test_result.json
```

Invoice 테스트 결과에서 계약/Invoice 정보를 읽어 랜덤 결제 시나리오 생성

**결제 시나리오**:
- 보증금: 전액(full)/분할(split, 2~3회 십만원단위 랜덤)/월세동시(with_rent)/분할+월세(split_rent) — 항상 완납, 최대 3회
- 월세: 정상(full)/2개월동시(double)/부분(partial)/초과납부(overpay)/분할납부(split)/스킵(밀림)/밀린월세일괄(catchup)
- FIFO 매핑: 보증금 잔액이 있으면 월세 납부 시 보증금 우선 채움
- 보증금에 전액 매핑 시 해당 월세 Invoice를 미납 목록에 추가

**출력**: `payments.json`

## 4. 결제 테스트

```bash
node test/invoice/test_payment.js -i payments.json
```

결제 실행 → DB 상태 검증 → MD 리포트 생성

**MD 리포트 내용**:
- 계약 정보 (결제방식, 보증금, 월세)
- 청구 vs 입금 비교표

| 구분 | 청구월 | 예정일 | 예정액 | 실입금일 | 실입금액 | 차액(누적) | 상태 |
|------|--------|--------|--------|----------|----------|------|------|

- 차액(누적): 이전 차액 + 입금액 - 예정액의 누적 합산
  - `+금액` (초과), `-금액` (부족), `0` (정확)
  - 부분납부 차액이 다음 행으로 승계됨
- 상태: 완납/완납(선납)/완납(후납)/부분납부/정산대기
- 상태 요약 (보증금 상태, 월세 완납/부분납부/정산대기 건수)

**출력**: `test_payment_result.json`, `test_payment_result.md`

## 전체 실행 예시

```bash
# 서버 실행
node server.js

# 파이프라인 실행
node test/invoice/generate_contracts.js -n 3
node test/invoice/test_invoice.js -i test/invoice/contracts.json
node test/invoice/generate_payments.js -i test/invoice/test_result.json
node test/invoice/test_payment.js -i test/invoice/payments.json
```

## 5. 수동 결제 추가

```bash
node test/invoice/add_payment.js -c <contract_id> -d <date> -a <amount> [-m memo]
```

서버에 결제를 추가하고 자동 FIFO 매핑 결과를 표시합니다.

**옵션**:
- `-c` 계약 ID (필수)
- `-d` 입금일 (필수, 예: 2024-06-09)
- `-a` 입금액 (필수, 예: 390000)
- `-m` 메모 (선택)

**예시**:
```bash
node test/invoice/add_payment.js -c 123 -d 2024-06-09 -a 390000
node test/invoice/add_payment.js -c 123 -d 2024-06-09 -a 390000 -m "6월 월세"
```

## 사전 조건

- 서버 실행 중: `node server.js`
- SQLite 모드 (`.env` 파일 없음)

## 환경변수

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `API_URL` | `http://localhost:3000` | API 서버 주소 |
