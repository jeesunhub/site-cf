/**
 * 오픈뱅킹 거래내역 조회 + 자동 매칭 테스트
 * 
 * 실행: node test-openbank/test_sync.js
 * 
 * 주의: 실제 오픈뱅킹 API 호출 대신 Mock 모드로 테스트
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_USER_ID = 1;

async function testSyncStatus() {
    console.log('\n=== TEST: 동기화 상태 조회 ===');
    const res = await fetch(`${BASE_URL}/api/openbank/sync/status?user_id=${TEST_USER_ID}`);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { status: res.status, data };
}

async function testManualSync() {
    console.log('\n=== TEST: 수동 동기화 + 자동 매칭 ===');
    console.log('(미처리 입금 내역을 계약 키워드와 매칭)');
    const res = await fetch(`${BASE_URL}/api/openbank/sync?user_id=${TEST_USER_ID}`, {
        method: 'POST'
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

    if (data.results) {
        const matched = data.results.filter(r => r.matched).length;
        const unmatched = data.results.filter(r => !r.matched).length;
        console.log(`\n  📊 매칭 결과: 자동매칭 ${matched}건 / 확인필요 ${unmatched}건`);
    }
    return { status: res.status, data };
}

async function testTransactionsWithDateRange() {
    console.log('\n=== TEST: 기간별 거래내역 조회 ===');
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const fromDate = weekAgo.toISOString().slice(0, 10).replace(/-/g, '');
    const toDate = today.toISOString().slice(0, 10).replace(/-/g, '');

    // 계좌 ID 필요 - 먼저 계좌 목록 조회
    const accRes = await fetch(`${BASE_URL}/api/openbank/accounts?user_id=${TEST_USER_ID}`);
    const accounts = await accRes.json();

    if (!accounts.length) {
        console.log('⚠ 등록된 계좌가 없어 거래내역 조회 테스트 건너뜀');
        console.log('  → 먼저 test_accounts.js로 계좌를 등록하세요');
        return;
    }

    const accountId = accounts[0].id;
    console.log(`조회 계좌: ${accounts[0].bank_name} (ID: ${accountId})`);
    console.log(`조회 기간: ${fromDate} ~ ${toDate}`);

    const res = await fetch(
        `${BASE_URL}/api/openbank/transactions?user_id=${TEST_USER_ID}&account_id=${accountId}&from_date=${fromDate}&to_date=${toDate}`
    );
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { status: res.status, data };
}

async function runSyncTests() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  오픈뱅킹 동기화 + 매칭 테스트        ║');
    console.log('╚══════════════════════════════════════╝');

    await testSyncStatus();
    await testTransactionsWithDateRange();
    await testManualSync();
    await testSyncStatus(); // 동기화 후 상태 재확인

    console.log('\n✅ 동기화 테스트 완료');
}

runSyncTests();
