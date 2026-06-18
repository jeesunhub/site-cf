/**
 * 수동 결제 추가 + Invoice 자동 재배정 테스트
 * 
 * 실행: node test-openbank/test_payment.js
 * 
 * 핵심 시나리오:
 * 1. 중간 납부 삽입 → 이후 Invoice 자동 재배정
 * 2. 과소 납부 → 부분납부 상태
 * 3. 초과 납부 → 다음 Invoice 자동 생성
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_USER_ID = 1;

// 테스트용 contract_id (실제 DB에 존재해야 함)
// 실행 전 DB에서 유효한 contract_id를 확인하세요
const TEST_CONTRACT_ID = process.env.TEST_CONTRACT_ID ? parseInt(process.env.TEST_CONTRACT_ID) : null;

async function findTestContract() {
    if (TEST_CONTRACT_ID) return TEST_CONTRACT_ID;

    console.log('유효한 계약을 검색 중...');
    const res = await fetch(`${BASE_URL}/api/contracts/list?role=admin`);
    const contracts = await res.json();

    if (contracts.length === 0) {
        console.log('⚠ 테스트할 계약이 없습니다. 먼저 계약을 생성하세요.');
        return null;
    }

    const contract = contracts[0];
    console.log(`테스트 계약 선택: ${contract.building} ${contract.room_number}호 (ID: ${contract.contract_id})`);
    return contract.contract_id;
}

async function testManualPayment(contractId) {
    console.log('\n=== TEST: 수동 결제 추가 ===');
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${BASE_URL}/api/payments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: TEST_USER_ID,
            contract_id: contractId,
            paid_at: today,
            amount: 300000,
            memo: '테스트 수동 결제'
        })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.reallocation) {
        console.log('\n  📊 재배정 결과:');
        console.log(`  - 재배정 여부: ${data.reallocation.reallocated ? '✅' : '❌'}`);
        console.log(`  - 결제 수: ${data.reallocation.payment_count}`);
        console.log(`  - 배정 수: ${data.reallocation.allocation_count}`);
        if (data.reallocation.details) {
            data.reallocation.details.forEach(d => {
                console.log(`  → Payment #${d.payment_id} → Invoice #${d.invoice_id} (${d.billing_month}): ${d.amount}원`);
            });
        }
    }
    return { status: res.status, data, paymentId: data.payment_id };
}

async function testMidInsertPayment(contractId) {
    console.log('\n=== TEST: 중간 납부 삽입 (과거 날짜) ===');
    console.log('→ 이후 납부의 Invoice 배정이 자동 조정되어야 함');

    // 2개월 전 날짜로 삽입
    const pastDate = new Date();
    pastDate.setMonth(pastDate.getMonth() - 2);
    const paidAt = pastDate.toISOString().slice(0, 10);

    const res = await fetch(`${BASE_URL}/api/payments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: TEST_USER_ID,
            contract_id: contractId,
            paid_at: paidAt,
            amount: 300000,
            memo: '중간 삽입 테스트 (과거 결제)'
        })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.reallocation?.details) {
        console.log('\n  📊 재배정 상세:');
        data.reallocation.details.forEach(d => {
            console.log(`  → Payment #${d.payment_id} → Invoice #${d.invoice_id} (${d.billing_month}): ${d.amount}원`);
        });
    }
    return { status: res.status, data };
}

async function testPartialPayment(contractId) {
    console.log('\n=== TEST: 부분 납부 ===');
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${BASE_URL}/api/payments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: TEST_USER_ID,
            contract_id: contractId,
            paid_at: today,
            amount: 100000, // 월세보다 적은 금액
            memo: '부분 납부 테스트'
        })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { status: res.status, data };
}

async function testOverPayment(contractId) {
    console.log('\n=== TEST: 초과 납부 → 다음 Invoice 자동 생성 ===');
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${BASE_URL}/api/payments/manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: TEST_USER_ID,
            contract_id: contractId,
            paid_at: today,
            amount: 600000, // 월세의 2배
            memo: '초과 납부 테스트'
        })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { status: res.status, data };
}

async function runPaymentTests() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  수동 결제 + Invoice 재배정 테스트    ║');
    console.log('╚══════════════════════════════════════╝');

    const contractId = await findTestContract();
    if (!contractId) {
        console.log('\n❌ 테스트할 계약을 찾을 수 없습니다.');
        console.log('  환경변수 TEST_CONTRACT_ID를 설정하거나 계약을 먼저 생성하세요.');
        return;
    }

    await testManualPayment(contractId);
    await testMidInsertPayment(contractId);
    await testPartialPayment(contractId);
    await testOverPayment(contractId);

    console.log('\n✅ 결제 테스트 완료');
    console.log('\n⚠ 주의: 테스트 데이터가 실제 DB에 저장되었습니다.');
    console.log('  필요시 계약 리셋: POST /api/contracts/{id}/reset');
}

runPaymentTests();
