/**
 * 건물/호수 권한별 필터링 테스트
 * 
 * 실행: node test-openbank/test_permissions.js
 * 
 * 시나리오:
 * - Admin: 모든 건물 조회 가능
 * - Landlord: 자신이 관리하는 건물만 조회 가능
 * - Tenant: 접근 불가 (UI에서 버튼 숨김)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testBuildingsForAdmin() {
    console.log('\n=== TEST: Admin 건물 목록 ===');
    const adminUserId = 1; // 실제 admin 사용자 ID로 변경
    const res = await fetch(`${BASE_URL}/api/buildings/for-user?user_id=${adminUserId}&role=admin`);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('건물 수:', Array.isArray(data) ? data.length : 0);
    data.forEach(b => console.log(`  - ${b.name} (ID: ${b.id})`));
    return { status: res.status, data };
}

async function testBuildingsForLandlord() {
    console.log('\n=== TEST: Landlord 건물 목록 ===');
    const landlordUserId = 2; // 실제 landlord 사용자 ID로 변경
    const res = await fetch(`${BASE_URL}/api/buildings/for-user?user_id=${landlordUserId}&role=landlord`);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('건물 수:', Array.isArray(data) ? data.length : 0);
    data.forEach(b => console.log(`  - ${b.name} (ID: ${b.id})`));
    return { status: res.status, data };
}

async function testRoomsForBuilding() {
    console.log('\n=== TEST: 건물의 호수 목록 ===');
    // 먼저 건물 목록에서 ID 획득
    const bldRes = await fetch(`${BASE_URL}/api/buildings/for-user?user_id=1&role=admin`);
    const buildings = await bldRes.json();

    if (!buildings.length) {
        console.log('⚠ 건물이 없어 호수 조회 테스트 건너뜀');
        return;
    }

    const buildingId = buildings[0].id;
    console.log(`조회 건물: ${buildings[0].name} (ID: ${buildingId})`);

    const res = await fetch(`${BASE_URL}/api/buildings/${buildingId}/rooms`);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('호수 수:', Array.isArray(data) ? data.length : 0);
    data.forEach(r => {
        const tenant = r.tenant_name ? `← ${r.tenant_name}` : '(공실)';
        const contract = r.contract_id ? `[계약 #${r.contract_id}]` : '';
        console.log(`  - ${r.room_number}호 ${tenant} ${contract}`);
    });
    return { status: res.status, data };
}

async function testInvalidPermission() {
    console.log('\n=== TEST: 권한 없는 건물 접근 ===');
    // 존재하지 않는 건물 ID로 조회
    const res = await fetch(`${BASE_URL}/api/buildings/99999/rooms`);
    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));
    return { status: res.status, data };
}

async function runPermissionTests() {
    console.log('╔══════════════════════════════════════╗');
    console.log('║  건물/호수 권한별 필터링 테스트       ║');
    console.log('╚══════════════════════════════════════╝');

    await testBuildingsForAdmin();
    await testBuildingsForLandlord();
    await testRoomsForBuilding();
    await testInvalidPermission();

    console.log('\n✅ 권한 필터링 테스트 완료');
}

runPermissionTests();
