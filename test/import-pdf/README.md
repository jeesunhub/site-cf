# PDF Import 테스트 가이드

은행 거래내역 PDF 파일을 import하고 파싱하는 기능의 테스트 코드 모음입니다.

## 📋 테스트 파일

| 파일 | 설명 | 서버 필요 |
|------|------|----------|
| `test_pdf_parse.js` | parsePdfText 함수 유닛 테스트 | ❌ |
| `test_pdf_api.js` | PDF Import API 통합 테스트 | ✅ |

## 🚀 테스트 실행

### 유닛 테스트 (서버 없이)

```bash
# 기본 유닛 테스트만 실행
node test/import-pdf/test_pdf_parse.js

# 실제 PDF 파일로 테스트 (-i 플래그)
node test/import-pdf/test_pdf_parse.js -i sample.pdf
node test/import-pdf/test_pdf_parse.js -i test/import-pdf/sample.pdf
```

기본 유닛 테스트 검증 항목:
- 기본 입금/출금 라인 파싱
- 여러 라인 파싱
- 헤더 라인 스킵
- 입금/출금 키워드 없이 위치 기반 파싱
- 빈 입력 처리
- 날짜 이어짐 (carry-over)
- 입금/출금 혼합 라인

`-i` 플래그 사용 시:
- pdf-parse로 실제 PDF 파일을 읽어 텍스트 추출
- 추출된 텍스트를 parsePdfText로 파싱
- 파싱 결과를 테이블 형태로 출력
- 총 입금액/출금액 요약

### 통합 테스트 (서버 실행 필요)

```bash
# 서버 실행
node server.js

# 다른 터미널에서
node test/import-pdf/test_pdf_api.js
```

API 엔드포인트를 테스트합니다:
- `POST /api/payments/import-pdf` — PDF 파일 업로드 및 파싱
- `POST /api/payments/manual` — 수동 결제 추가

### 환경변수

```bash
# 다른 서버 주소로 테스트
API_URL=https://your-server.com node test/import-pdf/test_pdf_api.js
```

## 📊 PDF 파싱 로직

PDF에서 추출한 텍스트를 다음 규칙으로 파싱합니다:

1. **날짜 인식**: `YYYY.MM.DD` 또는 `YYYY-MM-DD` 형식
2. **시간 인식**: `HH:MM` 형식
3. **금액 인식**: 콤마가 포함된 숫자 (예: `300,000`)
4. **입금/출금 구분**:
   - `입금` 키워드가 있으면 해당 금액을 입금액으로
   - `출금` 키워드가 있으면 해당 금액을 출금액으로
   - 키워드가 없으면 위치 기반으로 추론
5. **헤더 스킵**: `거래일자`, `입금액`, `출금액` 등이 포함된 라인은 스킵
6. **메모 추출**: 날짜, 시간, 금액을 제거한 나머지 텍스트
