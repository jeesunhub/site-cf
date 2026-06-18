/**
 * 오픈뱅킹 전체 테스트 실행기
 * 
 * 실행: node test-openbank/run_all.js
 * 
 * 환경변수:
 *   API_URL            - API 서버 주소 (기본값: http://localhost:3000)
 *   TEST_CONTRACT_ID   - 결제 테스트용 계약 ID
 *   TEST_USER_ID       - 테스트용 사용자 ID (기본값: 1)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

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

async function apiCall(method, path, body = null) {
    const opts = { method, headers: {} };
    if (body) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(`${BASE_URL}${path}`, opts);
    const data = await res.json();
    return { status: res.status, data };
}

// ===== 1. Health Check =====
async function testHealthCheck() {
    console.log('\n━━━ 1. 서버 상태 확인 ━━━');
    try {
        const { status, data } = await apiCall('GET', '/api/health');
        assert(status === 200, 'API 서버 응답');
        assert(data.status === 'ok', 'Health check 정상');
    } catch (e) {
        assert(false, `API 서버 연결 실패: ${e.message}`);
    }
}

// ===== 2. OAuth 상태 =====
async function testOAuthStatus() {
    console.log('\n━━━ 2. OAuth 인증 상태 ━━━');
    const userId = process.env.TEST_USER_ID || 1;

    const { status, data } = await apiCall('GET', `/api/openbank/sync/status?user_id=${userId}`);
    assert(status === 200, '동기화 상태 API 응답');

    if (status === 200) {
        assert(typeof data.has_token === 'boolean', '토큰 존재 여부 반환');
        assert(Array.isArray(data.accounts), '계좌 목록 배열 반환');
        assert(typeof data.unprocessed_count === 'number', '미처리 건수 반환');

        if (!data.has_token) {
            console.log('  ⚠ 오픈뱅킹 토큰이 없습니다. OAuth 인증이 필요합니다.');
            console.log(`  → 브라우저에서 ${BASE_URL}/api/openbank/authorize?user_id=${userId} 접속`);
            skipped += 3;
        } else {
            assert(true, '오픈뱅킹 토큰 존재');
        }
    }
}

// ===== 3. 계좌 CRUD =====
async function testAccountCRUD() {
    console.log('\n━━━ 3. 계좌 CRUD ━━━');
    const userId = process.env.TEST_USER_ID || 1;

    // Create
    const { status: createStatus, data: createData } = await apiCall('POST', '/api/openbank/accounts', {
        user_id: userId,
        bank_code: '020',
        bank_name: '테스트은행',
        account_num: 'TEST1234567890',
        account_alias: '자동테스트계좌',
        is_primary: false
    });
    assert(createStatus === 200 || createStatus === 201, '계좌 등록');

    const accountId = createData.id;
    if (!accountId) {
        console.log('  ⚠ 계좌 생성 실패, 이후 테스트 건너뜀');
        skipped += 3;
        return;
    }

    // Read
    const { status: listStatus, data: listData } = await apiCall('GET', `/api/openbank/accounts?user_id=${userId}`);
    assert(listStatus === 200, '계좌 목록 조회');
    assert(Array.isArray(listData) && listData.length > 0, '계좌 1개 이상 존재');

    // Update
    const { status: updateStatus } = await apiCall('PUT', `/api/openbank/accounts/${accountId}`, {
        sync_interval: '1h',
        account_alias: '자동테스트계좌 (수정됨)'
    });
    assert(updateStatus === 200, '계좌 설정 변경 (동기화 주기)');

    // Delete
    const { status: deleteStatus } = await apiCall('DELETE', `/api/openbank/accounts/${accountId}`);
    assert(deleteStatus === 200, '계좌 삭제');
}

// ===== 4. 건물/호수 권한 =====
async function testBuildingPermissions() {
    console.log('\n━━━ 4. 건물/호수 권한 ━━━');
    const userId = process.env.TEST_USER_ID || 1;

    // Admin buildings
    const { status: adminStatus, data: adminData } = await apiCall('GET', `/api/buildings/for-user?user_id=${userId}&role=admin`);
    assert(adminStatus === 200, 'Admin 건물 목록 조회');
    assert(Array.isArray(adminData), '건물 목록 배열 반환');

    if (adminData.length > 0) {
        const buildingId = adminData[0].id;

        // Rooms for building
        const { status: roomStatus, data: roomData } = await apiCall('GET', `/api/buildings/${buildingId}/rooms`);
        assert(roomStatus === 200, '건물 호수 목록 조회');
        assert(Array.isArray(roomData), '호수 목록 배열 반환');
    } else {
        console.log('  ⚠ 건물이 없어 호수 조회 테스트 건너뜀');
        skipped += 2;
    }

    // Landlord buildings (다른 user_id로 테스트)
    const { status: llStatus } = await apiCall('GET', `/api/buildings/for-user?user_id=99999&role=landlord`);
    assert(llStatus === 200, 'Landlord 건물 목록 조회 (빈 결과여도 200)');
}

// ===== 5. 수동 결제 + 재배정 =====
async function testManualPayment() {
    console.log('\n━━━ 5. 수동 결제 + Invoice 재배정 ━━━');
    const userId = process.env.TEST_USER_ID || 1;
    const contractId = process.env.TEST_CONTRACT_ID ? parseInt(process.env.TEST_CONTRACT_ID) : null;

    if (!contractId) {
        // 계약 자동 검색
        const { data: contracts } = await apiCall('GET', '/api/contracts/list?role=admin');
        if (!contracts || !contracts.length) {
            console.log('  ⚠ 계약이 없어 결제 테스트 건너뜀');
            skipped += 4;
            return;
        }
        const c = contracts[0];
        const cid = c.contract_id;
        console.log(`  테스트 계약: ${c.building} ${c.room_number}호 (ID: ${cid})`);

        // 정상 결제
        const today = new Date().toISOString().slice(0, 10);
        const { status: payStatus, data: payData } = await apiCall('POST', '/api/payments/manual', {
            user_id: userId,
            contract_id: cid,
            paid_at: today,
            amount: 300000,
            memo: '자동테스트 결제'
        });
        assert(payStatus === 200, '수동 결제 추가');
        assert(payData.payment_id > 0, 'Payment ID 반환');
        assert(payData.reallocation !== undefined, '재배정 결과 반환');

        // 부분 납부
        const { status: partialStatus } = await apiCall('POST', '/api/payments/manual', {
            user_id: userId,
            contract_id: cid,
            paid_at: today,
            amount: 100000,
            memo: '자동테스트 부분납부'
        });
        assert(partialStatus === 200, '부분 납부 추가');
    } else {
        const today = new Date().toISOString().slice(0, 10);
        const { status, data } = await apiCall('POST', '/api/payments/manual', {
            user_id: userId,
            contract_id: contractId,
            paid_at: today,
            amount: 300000,
            memo: '자동테스트 결제'
        });
        assert(status === 200, '수동 결제 추가 (지정 계약)');
        assert(data.payment_id > 0, 'Payment ID 반환');
        assert(data.reallocation !== undefined, '재배정 결과 반환');
    }
}

// ===== 6. 동기화 상태 최종 확인 =====
async function testFinalSyncStatus() {
    console.log('\n━━━ 6. 최종 동기화 상태 ━━━');
    const userId = process.env.TEST_USER_ID || 1;

    const { status, data } = await apiCall('GET', `/api/openbank/sync/status?user_id=${userId}`);
    assert(status === 200, '최종 동기화 상태 조회');
    if (status === 200) {
        console.log(`  📊 계좌: ${data.accounts?.length || 0}개`);
        console.log(`  📊 미처리: ${data.unprocessed_count || 0}건`);
        console.log(`  📊 토큰: ${data.has_token ? '있음' : '없음'}`);
    }
}

// ===== Main =====
async function runAll() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║  오픈뱅킹 통합 테스트                      ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  서버: ${BASE_URL.padEnd(30)}║`);
    console.log('╚══════════════════════════════════════════╝');

    await testHealthCheck();
    await testOAuthStatus();
    await testAccountCRUD();
    await testBuildingPermissions();
    await testManualPayment();
    await testFinalSyncStatus();

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
