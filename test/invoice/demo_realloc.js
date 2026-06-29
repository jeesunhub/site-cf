const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const { execSync } = require('child_process');

async function apiPost(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
}

async function runDemo() {
    console.log('1. 사전 데이터(임대인, 빌딩, 방, 임차인) 생성 중...');
    const landlordRes = await apiPost('/api/users/quick', {
        login_id: `landlord_demo_${Date.now()}`, password: 'test1234', nickname: `임대인_데모`, role: 'landlord',
    });
    const landlordId = landlordRes.data.id || landlordRes.data.userId;

    const buildingRes = await apiPost('/api/buildings', { landlord_id: landlordId, name: `데모빌딩_${Date.now()}` });
    const buildingId = buildingRes.data.buildingId || buildingRes.data.id;

    const roomRes = await apiPost('/api/rooms', { building_id: buildingId, room_number: `101` });
    const roomId = roomRes.data.roomId || roomRes.data.id;

    const tenantRes = await apiPost('/api/users/quick', {
        login_id: `tenant_demo_${Date.now()}`, password: 'test1234', nickname: `임차인_데모`, role: 'tenant',
    });
    const tenantId = tenantRes.data.id || tenantRes.data.userId;

    console.log('2. 계약(월세 100,000원) 생성 중...');
    const contractRes = await apiPost('/api/contracts/full', {
        tenant_id: tenantId,
        room_id: roomId,
        landlord_id: landlordId,
        payment_type: 'prepaid',
        contract_start_date: '2024-01-01',
        contract_end_date: '2025-01-01',
        deposit: 0,
        monthly_rent: 100000,
        management_fee: 0,
        cleaning_fee: 0,
    });
    const contractId = contractRes.data.contractId;
    console.log(`✅ 계약 생성 완료! (Contract ID: ${contractId})`);

    console.log('\n======================================================');
    console.log('결제 1: 2024-01-10 100,000원 입금');
    console.log('======================================================');
    execSync(`node test/invoice/add_payment.js -t add -c ${contractId} -d 2024-01-10 -a 100000 -m "첫번째 결제"`, { stdio: 'inherit' });

    console.log('\n======================================================');
    console.log('결제 2: 2024-03-10 100,000원 입금');
    console.log('======================================================');
    execSync(`node test/invoice/add_payment.js -t add -c ${contractId} -d 2024-03-10 -a 100000 -m "두번째 결제(3월)"`, { stdio: 'inherit' });

    console.log('\n======================================================');
    console.log('결제 3: 2024-02-10 100,000원 입금 (과거 날짜로 끼워넣기!)');
    console.log('======================================================');
    execSync(`node test/invoice/add_payment.js -t add -c ${contractId} -d 2024-02-10 -a 100000 -m "세번째 결제(뒤늦게 찾은 2월 입금)"`, { stdio: 'inherit' });
    
    console.log('\n🎉 데모 스크립트 실행 완료!');
}

runDemo().catch(console.error);
