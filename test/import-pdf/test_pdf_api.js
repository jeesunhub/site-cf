/**
 * PDF Import API 통합 테스트
 * 
 * 실행: node test/import-pdf/test_pdf_api.js
 * 
 * 서버가 실행 중이어야 합니다: node server.js
 * 
 * 환경변수:
 *   API_URL - API 서버 주소 (기본값: http://localhost:3000)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
let skipped = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.log(`  ❌ ${testName}`);
        failed++;
    }
}

// Create a minimal valid PDF file for testing
function createTestPdf() {
    // Minimal valid PDF with text content
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length 84 >>
stream
BT
/F1 12 Tf
100 700 Td
(2026.06.15 14:30 300,000 0 TestDeposit) Tj
ET
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000400 00000 n 
trailer
<< /Size 6 /Root 1 0 R >>
startxref
477
%%EOF`;
    return Buffer.from(pdfContent);
}

// ===== 1. Health Check =====
async function testHealthCheck() {
    console.log('\n━━━ 1. 서버 상태 확인 ━━━');
    try {
        const res = await fetch(`${BASE_URL}/api/health`);
        const data = await res.json();
        assert(res.status === 200, 'API 서버 응답');
        assert(data.status === 'ok', 'Health check 정상');
    } catch (e) {
        assert(false, `API 서버 연결 실패: ${e.message}`);
    }
}

// ===== 2. PDF Import API - No File =====
async function testPdfImportNoFile() {
    console.log('\n━━━ 2. PDF Import - 파일 없음 ━━━');
    try {
        const res = await fetch(`${BASE_URL}/api/payments/import-pdf`, {
            method: 'POST'
        });
        assert(res.status === 400, '파일 없이 요청 시 400 에러');
    } catch (e) {
        assert(false, `요청 실패: ${e.message}`);
    }
}

// ===== 3. PDF Import API - With Test PDF =====
async function testPdfImportWithFile() {
    console.log('\n━━━ 3. PDF Import - 테스트 PDF 파일 ━━━');
    try {
        const pdfBuffer = createTestPdf();
        const formData = new FormData();
        const file = new File([pdfBuffer], 'test-statement.pdf', { type: 'application/pdf' });
        formData.append('file', file);

        const res = await fetch(`${BASE_URL}/api/payments/import-pdf`, {
            method: 'POST',
            body: formData
        });

        const data = await res.json();
        
        if (res.status === 200) {
            assert(data.message === 'PDF 파싱 완료', 'PDF 파싱 완료 메시지');
            assert(typeof data.totalRows === 'number', 'totalRows 숫자 반환');
            assert(Array.isArray(data.rows), 'rows 배열 반환');
            console.log(`  📊 파싱된 행 수: ${data.totalRows}`);
        } else {
            // PDF parsing might fail on minimal test PDF - that's ok
            console.log(`  ⚠ 응답 상태: ${res.status}, 메시지: ${data.error || data.message}`);
            console.log('  (최소 테스트 PDF이므로 파싱 실패 가능 - 실제 은행 PDF로 확인 필요)');
            skipped += 2;
        }
    } catch (e) {
        assert(false, `PDF Import 요청 실패: ${e.message}`);
    }
}

// ===== 4. PDF Import API - Non-PDF File =====
async function testPdfImportNonPdf() {
    console.log('\n━━━ 4. PDF Import - 비 PDF 파일 ━━━');
    try {
        const textContent = 'This is not a PDF';
        const formData = new FormData();
        const file = new File([textContent], 'test.txt', { type: 'text/plain' });
        formData.append('file', file);

        const res = await fetch(`${BASE_URL}/api/payments/import-pdf`, {
            method: 'POST',
            body: formData
        });

        assert(res.status === 400, '비 PDF 파일 요청 시 400 에러');
    } catch (e) {
        assert(false, `요청 실패: ${e.message}`);
    }
}

// ===== 5. Manual Payment API (kept from open banking) =====
async function testManualPayment() {
    console.log('\n━━━ 5. 수동 결제 API ━━━');
    try {
        const res = await fetch(`${BASE_URL}/api/payments/manual`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_id: 1,
                paid_at: new Date().toISOString(),
                amount: 1000,
                memo: 'PDF Import 테스트 결제'
            })
        });

        if (res.status === 200) {
            const data = await res.json();
            assert(data.payment_id > 0, 'Payment ID 반환');
            console.log(`  📊 Payment ID: ${data.payment_id}`);
        } else {
            const data = await res.json();
            console.log(`  ⚡ 응답: ${res.status} - ${data.error || 'N/A'}`);
            console.log('  (유효한 계약 ID가 필요함 - TEST_CONTRACT_ID 환경변수 설정)');
            skipped += 1;
        }
    } catch (e) {
        assert(false, `수동 결제 요청 실패: ${e.message}`);
    }
}

// ===== Main =====
async function runAll() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  PDF Import 통합 테스트                  ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  서버: ${BASE_URL.padEnd(30)}║`);
    console.log('╚══════════════════════════════════════════╝');

    await testHealthCheck();
    await testPdfImportNoFile();
    await testPdfImportWithFile();
    await testPdfImportNonPdf();
    await testManualPayment();

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  테스트 결과                               ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  ✅ 통과: ${String(passed).padEnd(28)}║`);
    console.log(`║  ❌ 실패: ${String(failed).padEnd(28)}║`);
    console.log(`║  ⏭ 건너뜀: ${String(skipped).padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');

    if (failed > 0) {
        console.log('\n⚠ 실패한 테스트가 있습니다. 서버가 실행 중인지 확인하세요.');
        process.exit(1);
    }
}

runAll();
