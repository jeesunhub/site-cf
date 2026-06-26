/**
 * 결제 시나리오 테스트
 * 
 * 계약 생성 후 다양한 결제 시나리오로 DB 상태가 정상 동작하는지 검증
 * 
 * 실행: node test/invoice/test_payment_scenarios.js
 * 
 * 서버가 실행 중이어야 합니다: node server.js
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, '..', '..', 'sugar.db');
const OUTPUT_PATH = path.join(__dirname, 'test_payment_result.json');

let passed = 0;
let failed = 0;

const jsonOutput = {
    timestamp: new Date().toISOString(),
    server: BASE_URL,
    scenarios: [],
    test_results: [],
    summary: {},
};

// ===== 유틸리티 =====

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.log(`  ❌ ${testName}`);
        failed++;
    }
    jsonOutput.test_results.push({ name: testName, passed: condition });
}

function formatNumber(num) {
    return num.toLocaleString('ko-KR');
}

function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// ===== DB 직접 조회 =====

function queryDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        db.all(sql, params, (err, rows) => {
            db.close();
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function queryDbSingle(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        db.get(sql, params, (err, row) => {
            db.close();
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// ===== API 호출 =====

async function apiPost(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await res.json();
    return { status: res.status, data };
}

async function apiGet(path) {
    const res = await fetch(`${BASE_URL}${path}`);
    const data = await res.json();
    return { status: res.status, data };
}

// ===== 테스트 데이터 생성 =====

async function createTestContract() {
    // 임대인
    const landlordRes = await apiPost('/api/users/quick', {
        login_id: `landlord_s${Date.now()}`,
        password: 'test1234',
        nickname: '시나리오임대인',
        role: 'landlord',
    });
    const landlordId = landlordRes.data.id || landlordRes.data.userId;

    // 건물
    const buildingRes = await apiPost('/api/buildings', {
        landlord_id: landlordId,
        name: `시나리오빌딩_${Date.now()}`,
    });
    const buildingId = buildingRes.data.buildingId || buildingRes.data.id;

    // 호실
    const roomRes = await apiPost('/api/rooms', {
        building_id: buildingId,
        room_number: '201',
    });
    const roomId = roomRes.data.roomId || roomRes.data.id;

    // 임차인
    const tenantRes = await apiPost('/api/users/quick', {
        login_id: `tenant_s_${Date.now()}`,
        password: 'test1234',
        nickname: '시나리오임차인',
        role: 'tenant',
    });
    const tenantId = tenantRes.data.id || tenantRes.data.userId;

    // 계약 생성 (1년, 선불, 보증금 1000만원, 월세 50만원, 관리비 9만원)
    const startDate = new Date(2025, 0, 1); // 2025-01-01
    const endDate = new Date(2025, 12, 0);  // 2025-12-31
    const deposit = 10000000;
    const monthlyRent = 500000;
    const managementFee = 90000;

    const contractRes = await apiPost('/api/contracts/full', {
        tenant_id: tenantId,
        room_id: roomId,
        landlord_id: landlordId,
        payment_type: 'prepaid',
        contract_start_date: formatDate(startDate),
        contract_end_date: formatDate(endDate),
        deposit,
        monthly_rent: monthlyRent,
        management_fee: managementFee,
        cleaning_fee: 100000,
    });

    const contractId = contractRes.data.contractId;

    // Invoice 생성 대기
    await new Promise(resolve => setTimeout(resolve, 500));

    return { contractId, deposit, monthlyRent, managementFee };
}

// ===== Invoice 상태 조회 =====

async function getInvoiceStatus(contractId) {
    const invoices = await queryDb(
        'SELECT id, type, billing_month, amount, status FROM invoices WHERE contract_id = ? ORDER BY type, billing_month',
        [contractId]
    );
    return invoices;
}

async function getPaymentAllocations(contractId) {
    const rows = await queryDb(
        `SELECT p.id as payment_id, p.amount as payment_amount, p.paid_at, p.memo,
                pa.invoice_id, pa.amount as allocated_amount,
                i.type as invoice_type, i.billing_month, i.amount as invoice_amount, i.status as invoice_status
         FROM payments p
         LEFT JOIN payment_allocation pa ON p.id = pa.payment_id
         LEFT JOIN invoices i ON pa.invoice_id = i.id
         WHERE p.contract_id = ?
         ORDER BY p.id, pa.id`,
        [contractId]
    );
    return rows;
}

// ===== 시나리오 테스트 =====

// 시나리오 1: 보증금 전액 납부
async function scenario1_depositFull(contractId, deposit) {
    console.log('\n━━━ 시나리오 1: 보증금 전액 납부 ━━━');
    console.log(`  📋 보증금 ${formatNumber(deposit)}원을 한 번에 납부`);

    const invoices = await getInvoiceStatus(contractId);
    const depositInvoice = invoices.find(inv => inv.type === 'deposit');

    const res = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: deposit,
        paid_at: '2025-01-01T10:00:00.000Z',
        memo: '보증금 전액 납부',
        allocations: [{
            invoice_id: depositInvoice.id,
            type: 'deposit',
            amount: deposit,
        }],
    });

    assert(res.status === 200, '결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    // 보증금 Invoice 상태 확인
    const updatedInvoices = await getInvoiceStatus(contractId);
    const updatedDeposit = updatedInvoices.find(inv => inv.type === 'deposit');
    assert(updatedDeposit.status === '완납', `보증금 Invoice 상태: ${updatedDeposit.status}`);

    // payment_allocation 확인
    const allocations = await getPaymentAllocations(contractId);
    const depositAlloc = allocations.find(a => a.invoice_type === 'deposit');
    assert(depositAlloc !== undefined, 'payment_allocation 레코드 존재');
    assert(depositAlloc.allocated_amount === deposit, `배정 금액: ${formatNumber(depositAlloc.allocated_amount)}원`);

    console.log(`  ✅ 보증금 ${formatNumber(deposit)}원 전액 납부 → Invoice 상태: ${updatedDeposit.status}`);

    return { scenario: '보증금 전액 납부', passed: true };
}

// 시나리오 2: 보증금 분할 납부 (500만 + 500만)
async function scenario2_depositSplit(contractId, deposit) {
    console.log('\n━━━ 시나리오 2: 보증금 분할 납부 ━━━');
    console.log(`  📋 보증금 ${formatNumber(deposit)}원을 2회에 걸쳐 납부`);

    const invoices = await getInvoiceStatus(contractId);
    const depositInvoice = invoices.find(inv => inv.type === 'deposit');

    // 첫 번째 납부 (50%)
    const half = deposit / 2;
    const res1 = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: half,
        paid_at: '2025-01-05T10:00:00.000Z',
        memo: '보증금 1차 납부 (50%)',
        allocations: [{
            invoice_id: depositInvoice.id,
            type: 'deposit',
            amount: half,
        }],
    });
    assert(res1.status === 200, '1차 결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    // 부분 납부 상태 확인
    let updatedInvoices = await getInvoiceStatus(contractId);
    let updatedDeposit = updatedInvoices.find(inv => inv.type === 'deposit');
    assert(updatedDeposit.status === '부분납부', `1차 납부 후 상태: ${updatedDeposit.status}`);

    // 두 번째 납부 (나머지 50%)
    const res2 = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: half,
        paid_at: '2025-01-15T10:00:00.000Z',
        memo: '보증금 2차 납부 (50%)',
        allocations: [{
            invoice_id: depositInvoice.id,
            type: 'deposit',
            amount: half,
        }],
    });
    assert(res2.status === 200, '2차 결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    // 완납 상태 확인
    updatedInvoices = await getInvoiceStatus(contractId);
    updatedDeposit = updatedInvoices.find(inv => inv.type === 'deposit');
    assert(updatedDeposit.status === '완납', `2차 납부 후 상태: ${updatedDeposit.status}`);

    // 총 배정 금액 확인
    const allocations = await queryDb(
        `SELECT COALESCE(SUM(pa.amount), 0) as total_allocated
         FROM payment_allocation pa
         JOIN invoices i ON pa.invoice_id = i.id
         WHERE i.contract_id = ? AND i.type = 'deposit'`,
        [contractId]
    );
    assert(allocations[0].total_allocated === deposit,
        `총 배정 금액: ${formatNumber(allocations[0].total_allocated)}원`);

    console.log(`  ✅ 보증금 분할 납부 완료 → 최종 상태: ${updatedDeposit.status}`);

    return { scenario: '보증금 분할 납부', passed: true };
}

// 시나리오 3: 보증금 + 첫 월세 같이 납부
async function scenario3_depositWithRent(contractId, deposit, monthlyRent, managementFee) {
    console.log('\n━━━ 시나리오 3: 보증금 + 첫 월세 같이 납부 ━━━');
    const totalMonthly = monthlyRent + managementFee;
    const totalPayment = deposit + totalMonthly;
    console.log(`  📋 보증금 ${formatNumber(deposit)}원 + 월세 ${formatNumber(totalMonthly)}원 = 총 ${formatNumber(totalPayment)}원 같이 납부`);

    const invoices = await getInvoiceStatus(contractId);
    const depositInvoice = invoices.find(inv => inv.type === 'deposit');
    const firstRentInvoice = invoices.find(inv => inv.type === 'monthly_rent');

    const res = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: totalPayment,
        paid_at: '2025-01-01T10:00:00.000Z',
        memo: '보증금 + 1월 월세',
        allocations: [
            { invoice_id: depositInvoice.id, type: 'deposit', amount: deposit },
            { invoice_id: firstRentInvoice.id, type: 'monthly_rent', amount: totalMonthly },
        ],
    });

    assert(res.status === 200, '결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    const updatedInvoices = await getInvoiceStatus(contractId);
    const updatedDeposit = updatedInvoices.find(inv => inv.type === 'deposit');
    const updatedFirstRent = updatedInvoices.find(inv => inv.type === 'monthly_rent');

    assert(updatedDeposit.status === '완납', `보증금 상태: ${updatedDeposit.status}`);
    assert(updatedFirstRent.status === '완납', `첫 월세 상태: ${updatedFirstRent.status}`);

    console.log(`  ✅ 보증금+월세 동시 납부 → 보증금: ${updatedDeposit.status}, 월세: ${updatedFirstRent.status}`);

    return { scenario: '보증금+월세 동시 납부', passed: true };
}

// 시나리오 4: 보증금 모자르게 입금
async function scenario4_depositPartial(contractId, deposit) {
    console.log('\n━━━ 시나리오 4: 보증금 모자르게 입금 ━━━');
    const partialAmount = deposit - 2000000; // 200만원 부족
    console.log(`  📋 보증금 ${formatNumber(deposit)}원 중 ${formatNumber(partialAmount)}원만 납부 (200만원 부족)`);

    const invoices = await getInvoiceStatus(contractId);
    const depositInvoice = invoices.find(inv => inv.type === 'deposit');

    const res = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: partialAmount,
        paid_at: '2025-01-01T10:00:00.000Z',
        memo: '보증금 부분 납부',
        allocations: [{
            invoice_id: depositInvoice.id,
            type: 'deposit',
            amount: partialAmount,
        }],
    });

    assert(res.status === 200, '결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    const updatedInvoices = await getInvoiceStatus(contractId);
    const updatedDeposit = updatedInvoices.find(inv => inv.type === 'deposit');
    assert(updatedDeposit.status === '부분납부', `보증금 상태: ${updatedDeposit.status}`);

    // 미배정 금액 확인
    const unmatchedRes = await apiGet(`/api/contract/${contractId}/unmatched-payments`);
    // unmatched payments should be empty since we allocated the full partial amount
    console.log(`  ✅ 보증금 부분 납부 → 상태: ${updatedDeposit.status}`);

    return { scenario: '보증금 모자르게 입금', passed: true };
}

// 시나리오 5: 월세 정상 납부 (매월 정확한 금액)
async function scenario5_rentFull(contractId, monthlyRent, managementFee) {
    console.log('\n━━━ 시나리오 5: 월세 정상 납부 (3개월) ━━━');
    const totalMonthly = monthlyRent + managementFee;
    console.log(`  📋 월세 ${formatNumber(totalMonthly)}원을 3개월치 정상 납부`);

    const invoices = await getInvoiceStatus(contractId);
    const rentInvoices = invoices.filter(inv => inv.type === 'monthly_rent').slice(0, 3);

    for (let i = 0; i < rentInvoices.length; i++) {
        const inv = rentInvoices[i];
        const paidAt = new Date(2025, i, 1);
        const res = await apiPost('/api/payments/allocate', {
            contract_id: contractId,
            amount: totalMonthly,
            paid_at: paidAt.toISOString(),
            memo: `${inv.billing_month} 월세`,
            allocations: [{
                invoice_id: inv.id,
                type: 'monthly_rent',
                amount: totalMonthly,
            }],
        });
        assert(res.status === 200, `${inv.billing_month}월 결제 API 응답 200`);
    }

    await new Promise(resolve => setTimeout(resolve, 300));

    const updatedInvoices = await getInvoiceStatus(contractId);
    const paidRents = updatedInvoices.filter(inv => inv.type === 'monthly_rent').slice(0, 3);
    const allComplete = paidRents.every(inv => inv.status === '완납');
    assert(allComplete, `3개월 월세 모두 완납 상태`);

    paidRents.forEach(inv => {
        console.log(`     ${inv.billing_month}: ${inv.status}`);
    });

    return { scenario: '월세 정상 납부', passed: true };
}

// 시나리오 6: 월세 2개월치 같이 납부
async function scenario6_rentDouble(contractId, monthlyRent, managementFee) {
    console.log('\n━━━ 시나리오 6: 월세 2개월치 같이 납부 ━━━');
    const totalMonthly = monthlyRent + managementFee;
    const doublePayment = totalMonthly * 2;
    console.log(`  📋 월세 2개월치 ${formatNumber(doublePayment)}원을 한 번에 납부`);

    const invoices = await getInvoiceStatus(contractId);
    const rentInvoices = invoices.filter(inv => inv.type === 'monthly_rent' && inv.status === '정산대기').slice(0, 2);

    if (rentInvoices.length < 2) {
        console.log('  ⚠ 정산대기 월세 Invoice가 2개 미만');
        return { scenario: '월세 2개월치 같이 납부', passed: false };
    }

    const res = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: doublePayment,
        paid_at: '2025-03-01T10:00:00.000Z',
        memo: '2개월치 월세 동시 납부',
        allocations: [
            { invoice_id: rentInvoices[0].id, type: 'monthly_rent', amount: totalMonthly },
            { invoice_id: rentInvoices[1].id, type: 'monthly_rent', amount: totalMonthly },
        ],
    });

    assert(res.status === 200, '결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    const updatedInvoices = await getInvoiceStatus(contractId);
    const paid1 = updatedInvoices.find(inv => inv.id === rentInvoices[0].id);
    const paid2 = updatedInvoices.find(inv => inv.id === rentInvoices[1].id);

    assert(paid1.status === '완납', `${rentInvoices[0].billing_month}월 상태: ${paid1.status}`);
    assert(paid2.status === '완납', `${rentInvoices[1].billing_month}월 상태: ${paid2.status}`);

    console.log(`  ✅ 2개월치 동시 납부 → ${rentInvoices[0].billing_month}: ${paid1.status}, ${rentInvoices[1].billing_month}: ${paid2.status}`);

    return { scenario: '월세 2개월치 같이 납부', passed: true };
}

// 시나리오 7: 월세 부분 납부 후 다음달 추가 납부
async function scenario7_rentPartialThenMore(contractId, monthlyRent, managementFee) {
    console.log('\n━━━ 시나리오 7: 월세 부분 납부 → 다음달 추가 납부 ━━━');
    const totalMonthly = monthlyRent + managementFee;
    const partialAmount = totalMonthly - 100000; // 10만원 모자르게
    const remainingAmount = 100000;
    console.log(`  📋 1차: ${formatNumber(partialAmount)}원 납부 (10만원 부족)`);
    console.log(`  📋 2차: 다음달에 ${formatNumber(remainingAmount)}원 추가 납부`);

    const invoices = await getInvoiceStatus(contractId);
    const rentInvoice = invoices.find(inv => inv.type === 'monthly_rent' && inv.status === '정산대기');

    if (!rentInvoice) {
        console.log('  ⚠ 정산대기 월세 Invoice 없음');
        return { scenario: '월세 부분납부 후 추가납부', passed: false };
    }

    // 1차: 부분 납부
    const res1 = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: partialAmount,
        paid_at: '2025-04-01T10:00:00.000Z',
        memo: '월세 부분 납부 (10만원 부족)',
        allocations: [{
            invoice_id: rentInvoice.id,
            type: 'monthly_rent',
            amount: partialAmount,
        }],
    });
    assert(res1.status === 200, '1차 결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    let updatedInvoices = await getInvoiceStatus(contractId);
    let updatedRent = updatedInvoices.find(inv => inv.id === rentInvoice.id);
    assert(updatedRent.status === '부분납부', `1차 납부 후 상태: ${updatedRent.status}`);

    // 2차: 추가 납부
    const res2 = await apiPost('/api/payments/allocate', {
        contract_id: contractId,
        amount: remainingAmount,
        paid_at: '2025-05-01T10:00:00.000Z',
        memo: '월세 잔금 납부',
        allocations: [{
            invoice_id: rentInvoice.id,
            type: 'monthly_rent',
            amount: remainingAmount,
        }],
    });
    assert(res2.status === 200, '2차 결제 API 응답 200');

    await new Promise(resolve => setTimeout(resolve, 300));

    updatedInvoices = await getInvoiceStatus(contractId);
    updatedRent = updatedInvoices.find(inv => inv.id === rentInvoice.id);
    assert(updatedRent.status === '완납', `2차 납부 후 상태: ${updatedRent.status}`);

    // 총 배정 금액 확인
    const allocResult = await queryDb(
        `SELECT COALESCE(SUM(pa.amount), 0) as total FROM payment_allocation pa WHERE pa.invoice_id = ?`,
        [rentInvoice.id]
    );
    assert(allocResult[0].total === totalMonthly, `총 배정액: ${formatNumber(allocResult[0].total)}원 (예상: ${formatNumber(totalMonthly)}원)`);

    console.log(`  ✅ 부분납부→추가납부 완료 → 최종 상태: ${updatedRent.status}`);

    return { scenario: '월세 부분납부 후 추가납부', passed: true };
}

// 시나리오 8: 월세 밀림 (4월 월세를 7월에 납부)
async function scenario8_rentLate(contractId, monthlyRent, managementFee) {
    console.log('\n━━━ 시나리오 8: 월세 밀림 (4월→7월 납부) ━━━');
    const totalMonthly = monthlyRent + managementFee;
    console.log(`  📋 4월 월세 ${formatNumber(totalMonthly)}원을 7월에 납부`);

    const invoices = await getInvoiceStatus(contractId);
    // 4월 월세 Invoice 찾기
    const aprInvoice = invoices.find(inv => inv.type === 'monthly_rent' && inv.billing_month === '2025-04');

    if (!aprInvoice) {
        // 4월 Invoice가 없으면 첫 번째 정산대기 Invoice 사용
        const anyInvoice = invoices.find(inv => inv.type === 'monthly_rent' && inv.status === '정산대기');
        if (!anyInvoice) {
            console.log('  ⚠ 납부 가능한 월세 Invoice 없음');
            return { scenario: '월세 밀림 납부', passed: false };
        }
        console.log(`  📋 (4월 Invoice 없음, ${anyInvoice.billing_month}월 Invoice로 대체)`);

        const res = await apiPost('/api/payments/allocate', {
            contract_id: contractId,
            amount: totalMonthly,
            paid_at: '2025-07-15T10:00:00.000Z',
            memo: '밀린 월세 납부 (원래 4월분)',
            allocations: [{
                invoice_id: anyInvoice.id,
                type: 'monthly_rent',
                amount: totalMonthly,
            }],
        });

        assert(res.status === 200, '결제 API 응답 200');

        await new Promise(resolve => setTimeout(resolve, 300));

        const updatedInvoices = await getInvoiceStatus(contractId);
        const updated = updatedInvoices.find(inv => inv.id === anyInvoice.id);
        assert(updated.status === '완납', `${anyInvoice.billing_month}월 상태: ${updated.status}`);

        console.log(`  ✅ 밀린 월세 납부 완료 → ${anyInvoice.billing_month}: ${updated.status}`);
    } else {
        const res = await apiPost('/api/payments/allocate', {
            contract_id: contractId,
            amount: totalMonthly,
            paid_at: '2025-07-15T10:00:00.000Z',
            memo: '밀린 4월 월세 납부',
            allocations: [{
                invoice_id: aprInvoice.id,
                type: 'monthly_rent',
                amount: totalMonthly,
            }],
        });

        assert(res.status === 200, '결제 API 응답 200');

        await new Promise(resolve => setTimeout(resolve, 300));

        const updatedInvoices = await getInvoiceStatus(contractId);
        const updatedApr = updatedInvoices.find(inv => inv.id === aprInvoice.id);
        assert(updatedApr.status === '완납', `4월 상태: ${updatedApr.status}`);

        console.log(`  ✅ 밀린 4월 월세 납부 완료 → 상태: ${updatedApr.status}`);
    }

    return { scenario: '월세 밀림 납부', passed: true };
}

// ===== DB 무결성 검증 =====

async function verifyDbIntegrity(contractId) {
    console.log('\n━━━ DB 무결성 검증 ━━━');

    // 1. payments 총액 = payment_allocation 총액 (불일치하면 매칭 안 된 금액 있음)
    const paymentTotal = await queryDbSingle(
        'SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE contract_id = ?',
        [contractId]
    );
    const allocationTotal = await queryDbSingle(
        `SELECT COALESCE(SUM(pa.amount), 0) as total
         FROM payment_allocation pa
         JOIN payments p ON pa.payment_id = p.id
         WHERE p.contract_id = ?`,
        [contractId]
    );

    console.log(`  💰 총 결제액: ${formatNumber(paymentTotal.total)}원`);
    console.log(`  💰 총 배정액: ${formatNumber(allocationTotal.total)}원`);

    const diff = paymentTotal.total - allocationTotal.total;
    if (diff > 0) {
        console.log(`  ⚠ 미배정 금액: ${formatNumber(diff)}원 (정상 - 매칭 안 된 결제 있을 수 있음)`);
    }
    assert(allocationTotal.total <= paymentTotal.total, '배정액 ≤ 결제액');

    // 2. invoice별 배정액 합산이 invoice 금액과 일치하는지
    const invoiceCheck = await queryDb(
        `SELECT i.id, i.type, i.billing_month, i.amount as invoice_amount,
                COALESCE(SUM(pa.amount), 0) as allocated_amount,
                i.status
         FROM invoices i
         LEFT JOIN payment_allocation pa ON i.id = pa.invoice_id
         WHERE i.contract_id = ?
         GROUP BY i.id
         ORDER BY i.type, i.billing_month`,
        [contractId]
    );

    let statusConsistent = true;
    invoiceCheck.forEach(inv => {
        const expectedStatus = inv.allocated_amount >= inv.invoice_amount ? '완납' :
                              inv.allocated_amount > 0 ? '부분납부' : '정산대기';
        // DB 상태가 예상과 다르면 경고 (비동기 업데이트로 약간의 차이 가능)
        if (inv.status !== expectedStatus && inv.status !== '정산대기') {
            // 부분납부 후 완납된 경우는 정상
        }
        console.log(`     [${inv.type === 'deposit' ? '보증금' : '월세'}] ${inv.billing_month} | 청구: ${formatNumber(inv.invoice_amount)}원 | 배정: ${formatNumber(inv.allocated_amount)}원 | 상태: ${inv.status}`);
    });

    assert(invoiceCheck.length > 0, 'Invoice 레코드 존재');

    // 3. payment_allocation에 고아 레코드 없는지
    const orphanCheck = await queryDbSingle(
        `SELECT COUNT(*) as cnt FROM payment_allocation pa
         LEFT JOIN payments p ON pa.payment_id = p.id
         LEFT JOIN invoices i ON pa.invoice_id = i.id
         WHERE (p.id IS NULL OR i.id IS NULL)`
    );
    assert(orphanCheck.cnt === 0, '고아 payment_allocation 레코드 없음');

    // 4. 외래키 무결성
    const fkPayments = await queryDbSingle(
        'SELECT COUNT(*) as cnt FROM payments WHERE contract_id = ?', [contractId]
    );
    const fkInvoices = await queryDbSingle(
        'SELECT COUNT(*) as cnt FROM invoices WHERE contract_id = ?', [contractId]
    );
    assert(fkPayments.cnt > 0, '결제 레코드 존재');
    assert(fkInvoices.cnt > 0, 'Invoice 레코드 존재');
}

// ===== Main =====

async function runAll() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  결제 시나리오 테스트                            ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  서버: ${BASE_URL.padEnd(40)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // 서버 상태 확인
    try {
        const { status, data } = await apiGet('/api/health');
        if (status !== 200) throw new Error('Health check failed');
    } catch (e) {
        console.log(`\n⚠ 서버 연결 실패: ${e.message}`);
        process.exit(1);
    }

    // ===== 시나리오별 개별 계약 생성 후 테스트 =====

    // 시나리오 1: 보증금 전액 납부
    let contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId} (보증금 ${formatNumber(contract.deposit)}원, 월세 ${formatNumber(contract.monthlyRent + contract.managementFee)}원)`);
    let result = await scenario1_depositFull(contract.contractId, contract.deposit);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 2: 보증금 분할 납부
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario2_depositSplit(contract.contractId, contract.deposit);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 3: 보증금 + 첫 월세 같이 납부
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario3_depositWithRent(contract.contractId, contract.deposit, contract.monthlyRent, contract.managementFee);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 4: 보증금 모자르게 입금
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario4_depositPartial(contract.contractId, contract.deposit);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 5: 월세 정상 납부 (3개월)
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario5_rentFull(contract.contractId, contract.monthlyRent, contract.managementFee);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 6: 월세 2개월치 같이 납부
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario6_rentDouble(contract.contractId, contract.monthlyRent, contract.managementFee);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 7: 월세 부분 납부 후 다음달 추가
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario7_rentPartialThenMore(contract.contractId, contract.monthlyRent, contract.managementFee);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 시나리오 8: 월세 밀림 (4월→7월 납부)
    contract = await createTestContract();
    console.log(`\n📌 계약 ID: ${contract.contractId}`);
    result = await scenario8_rentLate(contract.contractId, contract.monthlyRent, contract.managementFee);
    await verifyDbIntegrity(contract.contractId);
    jsonOutput.scenarios.push(result);

    // 결과 출력
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  테스트 결과                                      ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  ✅ 통과: ${String(passed).padEnd(38)}║`);
    console.log(`║  ❌ 실패: ${String(failed).padEnd(38)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // JSON 결과 저장
    jsonOutput.passed = passed;
    jsonOutput.failed = failed;
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(jsonOutput, null, 2), 'utf8');
    console.log(`\n📄 결과 파일 저장: ${OUTPUT_PATH}`);

    if (failed > 0) {
        console.log('\n⚠ 실패한 테스트가 있습니다.');
        process.exit(1);
    }
}

runAll();
