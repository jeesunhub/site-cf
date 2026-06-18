/**
 * 오픈뱅킹 OAuth 인증 흐름 테스트
 * 
 * 실행: node test-openbank/test_oauth.js
 * 
 * 환경변수 필요:
 *   OPENBANK_CLIENT_ID
 *   OPENBANK_CLIENT_SECRET
 *   OPENBANK_API_URL (기본값: https://testapi.openbanking.or.kr)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testOAuthAuthorize() {
    console.log('\n=== TEST: OAuth 인증 시작 ===');
    const userId = 1; // 테스트용 user_id
    const url = `${BASE_URL}/api/openbank/authorize?user_id=${userId}`;
    console.log('인증 URL:', url);
    console.log('→ 브라우저에서 위 URL로 접속하여 인증 진행');
    console.log('  (콜백 후 bank_tokens에 토큰 저장됨)');
    return { status: 'manual', url };
}

async function testTokenRefresh() {
    console.log('\n=== TEST: 토큰 갱신 ===');
    const userId = 1;
    try {
        const res = await fetch(`${BASE_URL}/api/openbank/refresh?user_id=${userId}`, {
            method: 'POST'
        });
        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Response:', JSON.stringify(data, null, 2));
        return { status: res.status, data };
    } catch (e) {
        console.error('토큰 갱신 실패:', e.message);
        return { status: 'error', error: e.message };
    }
}

async function testSyncStatus() {
    console.log('\n=== TEST: 동기화 상태 조회 ===');
    const userId = 1;
    try {
        const res = await fetch(`${BASE_URL}/api/openbank/sync/status?user_id=${userId}`);
        const data = await res.json();
        console.log('Status:', res.status);
        console.log('Response:', JSON.stringify(data, null, 2));
        return { status: res.status, data };
    } catch (e) {
        console.error('상태 조회 실패:', e.message);
        return { status: 'error', error: e.message };
    }
}

async function runOAuthTests() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  오픈뱅킹 OAuth 인증 테스트           ║');
    console.log('╚══════════════════════════════════════╝');

    await testOAuthAuthorize();
    await testSyncStatus();
    await testTokenRefresh();

    console.log('\n✅ OAuth 테스트 완료');
}

runOAuthTests();
