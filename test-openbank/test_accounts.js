/**
 * 오픈뱅킹 계좌 CRUD 테스트
 * 
 * 실행: node test-openbank/test_accounts.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_USER_ID = 1;

let createdAccountId = null;

async function testCreateAccount() {
    console.log('\n=== TEST: 계좌 등록 ===');
    const res = await fetch(`${BASE_URL}/api/openbank/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: TEST_USER_ID,
            bank_code: '020',
            bank_name: '우리은행',
            account_num: '1234567890123456',
            account_alias: '테스트 수금계좌',
            is_primary: true
        })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    if (data.id) createdAccountId = data.id;
    return { status: res.status, data };
}

async function testListAccounts() {
    console.log('\n=== TEST: 계좌 목록 조회 ===');
    const res = await fetch(`${BASE_URL}/api/openbank/accounts?user_id=${TEST_USER_ID}`);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('계좌 수:', Array.isArray(data) ? data.length : 0);
    data.forEach(a => console.log(`  - ${a.bank_name} ${a.account_alias} (sync: ${a.sync_interval})`));
    return { status: res.status, data };
}

async function testUpdateAccount() {
    if (!createdAccountId) {
        console.log('⚠ 계좌가 생성되지 않아 업데이트 테스트 건너뜀');
        return;
    }
    console.log('\n=== TEST: 계좌 설정 변경 (동기화 주기) ===');
    const res = await fetch(`${BASE_URL}/api/openbank/accounts/${createdAccountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            sync_interval: '1h',
            account_alias: '테스트 수금계좌 (수정)'
        })
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { status: res.status, data };
}

async function testDeleteAccount() {
    if (!createdAccountId) {
        console.log('⚠ 계좌가 생성되지 않아 삭제 테스트 건너뜀');
        return;
    }
    console.log('\n=== TEST: 계좌 삭제 ===');
    const res = await fetch(`${BASE_URL}/api/openbank/accounts/${createdAccountId}`, {
        method: 'DELETE'
    });
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    createdAccountId = null;
    return { status: res.status, data };
}

async function runAccountTests() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  오픈뱅킹 계좌 CRUD 테스트            ║');
    console.log('╚══════════════════════════════════════╝');

    await testCreateAccount();
    await testListAccounts();
    await testUpdateAccount();
    await testListAccounts(); // 변경 확인
    await testDeleteAccount();
    await testListAccounts(); // 삭제 확인

    console.log('\n✅ 계좌 CRUD 테스트 완료');
}

runAccountTests();
