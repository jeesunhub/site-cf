/**
 * Invoice 자동 생성 테스트
 * 
 * 계약서 JSON 파일을 입력받아 계약 생성 → Invoice 자동 생성 검증
 * 
 * 실행: node test/invoice/test_invoice.js -i contracts.json
 * 서버 실행 필요: node server.js
 * 
 * 옵션:
 *   -i  계약서 JSON 파일 경로 (필수)
 *   -o  결과 출력 경로 (기본값: test/invoice/test_result)
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const DB_PATH = path.join(__dirname, '..', '..', 'sugar.db');

let passed = 0;
let failed = 0;

const jsonOutput = {
    timestamp: new Date().toISOString(),
    server: BASE_URL,
    contracts: [],
    test_results: [],
};

// ===== 파라미터 파싱 =====

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { input: null, output: path.join(__dirname, 'test_result') };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-i' && args[i + 1]) opts.input = args[++i];
        else if (args[i] === '-o' && args[i + 1]) opts.output = args[++i];
    }
    return opts;
}

// ===== 유틸리티 =====

function assert(condition, testName) {
    if (condition) { console.log(`  ✅ ${testName}`); passed++; }
    else { console.log(`  ❌ ${testName}`); failed++; }
    jsonOutput.test_results.push({ name: testName, passed: condition });
}

function formatNumber(num) { return num.toLocaleString('ko-KR'); }

// ===== DB 직접 조회 =====

function queryDb(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        db.all(sql, params, (err, rows) => { db.close(); if (err) reject(err); else resolve(rows); });
    });
}

// ===== API 호출 =====

async function apiPost(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: res.status, data: await res.json() };
}

async function apiGet(path) {
    const res = await fetch(`${BASE_URL}${path}`);
    return { status: res.status, data: await res.json() };
}

// ===== 필수 데이터 생성 =====

async function createPrerequisites(index) {
    const landlordRes = await apiPost('/api/users/quick', {
        login_id: `landlord_${Date.now()}_${index}`, password: 'test1234', nickname: `임대인${index}`, role: 'landlord',
    });
    const landlordId = landlordRes.data.id || landlordRes.data.userId;

    const buildingRes = await apiPost('/api/buildings', { landlord_id: landlordId, name: `테스트빌딩_${Date.now()}` });
    const buildingId = buildingRes.data.buildingId || buildingRes.data.id;

    const roomRes = await apiPost('/api/rooms', { building_id: buildingId, room_number: `${100 + index}` });
    const roomId = roomRes.data.roomId || roomRes.data.id;

    const tenantRes = await apiPost('/api/users/quick', {
        login_id: `tenant_${Date.now()}_${index}`, password: 'test1234', nickname: `임차인${index}`, role: 'tenant',
    });
    const tenantId = tenantRes.data.id || tenantRes.data.userId;

    return { landlordId, buildingId, roomId, tenantId };
}

// ===== 계약 생성 + Invoice 검증 =====

async function testContract(contract, index) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  계약 #${index}: Invoice 자동 생성 검증`);
    console.log(`${'═'.repeat(50)}`);

    console.log(`\n  📋 계약 조건:`);
    console.log(`     기간: ${contract.period_label} (${contract.contract_start_date} ~ ${contract.contract_end_date})`);
    console.log(`     결제: ${contract.payment_label} (${contract.payment_type})`);
    console.log(`     보증금: ${formatNumber(contract.deposit)}원`);
    console.log(`     월세: ${formatNumber(contract.monthly_rent)}원`);
    console.log(`     관리비: ${formatNumber(contract.management_fee)}원`);

    const prereq = await createPrerequisites(index);

    const { status, data } = await apiPost('/api/contracts/full', {
        tenant_id: prereq.tenantId,
        room_id: prereq.roomId,
        landlord_id: prereq.landlordId,
        payment_type: contract.payment_type,
        contract_start_date: contract.contract_start_date,
        contract_end_date: contract.contract_end_date,
        deposit: contract.deposit,
        monthly_rent: contract.monthly_rent,
        management_fee: contract.management_fee,
        cleaning_fee: contract.cleaning_fee,
    });

    assert(status === 200, `계약 생성 API 응답 (status: ${status})`);

    const contractId = data.contractId;
    if (!contractId) { assert(false, '계약 ID 반환 실패'); return null; }
    console.log(`  📌 계약 ID: ${contractId}`);

    await new Promise(resolve => setTimeout(resolve, 500));

    let invoices;
    try {
        invoices = await queryDb(
            'SELECT id, contract_id, type, billing_month, due_date, amount, status FROM invoices WHERE contract_id = ? ORDER BY type, billing_month',
            [contractId]
        );
        assert(Array.isArray(invoices), 'Invoice 배열 반환');
    } catch (e) {
        assert(false, `Invoice DB 조회 실패: ${e.message}`);
        return null;
    }

    // 보증금 Invoice 검증
    const depositInvoices = invoices.filter(inv => inv.type === 'deposit');
    assert(depositInvoices.length === 1,
        `보증금 Invoice 1건 (실제: ${depositInvoices.length}건, 금액: ${depositInvoices[0] ? formatNumber(depositInvoices[0].amount) : 'N/A'}원)`);

    if (depositInvoices.length > 0) {
        assert(depositInvoices[0].amount === contract.deposit, `보증금 금액 일치 (${formatNumber(depositInvoices[0].amount)}원)`);
        assert(depositInvoices[0].billing_month === contract.contract_start_date.substring(0, 7), `보증금 청구월: ${depositInvoices[0].billing_month}`);
    }

    // 월세 Invoice 검증
    const monthlyInvoices = invoices.filter(inv => inv.type === 'monthly_rent');
    const expectedMonths = contract.payment_type === 'prepaid' ? contract.period_months : contract.period_months - 1;
    assert(monthlyInvoices.length === expectedMonths,
        `월세 Invoice 개수 (예상: ${expectedMonths}건, 실제: ${monthlyInvoices.length}건)`);

    const expectedMonthlyAmount = contract.monthly_rent + contract.management_fee;
    if (monthlyInvoices.length > 0) {
        assert(monthlyInvoices.every(inv => inv.amount === expectedMonthlyAmount), `월세 금액 정확 (${formatNumber(expectedMonthlyAmount)}원/월)`);
    }

    // 납입일 검증
    if (monthlyInvoices.length > 0) {
        const startDay = parseInt(contract.contract_start_date.split('-')[2]);
        assert(monthlyInvoices.every(inv => parseInt(inv.due_date.split('-')[2]) === startDay),
            `납입일 검증 (${contract.payment_label}: 매월 ${startDay}일)`);
    }

    // Invoice 총액 검증
    const totalInvoiceAmount = invoices.reduce((sum, inv) => sum + inv.amount, 0);
    const expectedTotal = contract.deposit + (expectedMonthlyAmount * expectedMonths);
    assert(totalInvoiceAmount === expectedTotal,
        `Invoice 총액: ${formatNumber(totalInvoiceAmount)}원 (예상: ${formatNumber(expectedTotal)}원)`);

    // Invoice 목록 출력
    console.log(`\n  📊 생성된 Invoice 목록:`);
    invoices.forEach(inv => {
        const label = inv.type === 'deposit' ? '보증금' : '월세';
        console.log(`     [${label}] ${inv.billing_month} | 납입일: ${inv.due_date} | ${formatNumber(inv.amount)}원 | ${inv.status}`);
    });

    // JSON 출력용 데이터 수집
    const result = {
        contract_id: contractId,
        contract,
        invoices: invoices.map(inv => ({
            id: inv.id,
            type: inv.type,
            type_label: inv.type === 'deposit' ? '보증금' : '월세',
            billing_month: inv.billing_month,
            due_date: inv.due_date,
            amount: inv.amount,
            status: inv.status,
        })),
    };
    jsonOutput.contracts.push(result);

    return result;
}

// ===== MD 리포트 생성 =====

function generateMdReport() {
    const lines = [];
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);

    lines.push(`# Invoice 자동 생성 테스트 결과`);
    lines.push(``);
    lines.push(`- **실행시간**: ${ts}`);
    lines.push(`- **서버**: ${BASE_URL}`);
    lines.push(`- **결과**: ✅ ${passed} 통과 / ❌ ${failed} 실패`);
    lines.push(``);

    for (const c of jsonOutput.contracts) {
        const ct = c.contract;
        const totalMonthly = ct.monthly_rent + ct.management_fee;

        lines.push(`---`);
        lines.push(``);
        lines.push(`## 계약 #${c.contract_id}`);
        lines.push(``);
        lines.push(`| 항목 | 값 |`);
        lines.push(`|------|-----|`);
        lines.push(`| 결제방식 | ${ct.payment_label} (${ct.payment_type}) |`);
        lines.push(`| 계약기간 | ${ct.contract_start_date} ~ ${ct.contract_end_date} (${ct.period_label}) |`);
        lines.push(`| 보증금 | ${formatNumber(ct.deposit)}원 |`);
        lines.push(`| 월세 | ${formatNumber(ct.monthly_rent)}원 |`);
        lines.push(`| 관리비 | ${formatNumber(ct.management_fee)}원 |`);
        lines.push(`| 월납부액 | ${formatNumber(totalMonthly)}원 |`);
        lines.push(``);

        lines.push(`### 생성된 Invoice`);
        lines.push(``);
        lines.push(`| 구분 | 청구월 | 납입일 | 금액 | 상태 |`);
        lines.push(`|------|--------|--------|------|------|`);
        for (const inv of c.invoices) {
            lines.push(`| ${inv.type_label} | ${inv.billing_month} | ${inv.due_date || '-'} | ${formatNumber(inv.amount)}원 | ${inv.status} |`);
        }
        lines.push(``);
    }

    return lines.join('\n');
}

// ===== Main =====

async function runAll() {
    const opts = parseArgs();

    if (!opts.input) {
        console.log('❌ 사용법: node test/invoice/test_invoice.js -i contracts.json');
        console.log('   계약서 JSON 파일이 필요합니다.');
        console.log('   생성: node test/invoice/generate_contracts.js -n 3');
        process.exit(1);
    }

    // 계약서 JSON 로드
    let contractsData;
    try {
        contractsData = JSON.parse(fs.readFileSync(opts.input, 'utf8'));
    } catch (e) {
        console.log(`❌ 계약서 파일 로드 실패: ${e.message}`);
        process.exit(1);
    }

    const contracts = contractsData.contracts || contractsData;

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  Invoice 자동 생성 테스트                        ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  서버: ${BASE_URL.padEnd(40)}║`);
    console.log(`║  계약 수: ${String(contracts.length).padEnd(38)}║`);
    console.log(`║  입력: ${opts.input.padEnd(40)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // 서버 상태 확인
    try {
        const { status } = await apiGet('/api/health');
        if (status !== 200) throw new Error('Health check failed');
    } catch (e) {
        console.log(`\n⚠ 서버 연결 실패: ${e.message}`);
        process.exit(1);
    }

    // 각 계약 테스트
    for (let i = 0; i < contracts.length; i++) {
        await testContract(contracts[i], i + 1);
    }

    // 결과 출력
    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  테스트 결과                                      ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  ✅ 통과: ${String(passed).padEnd(38)}║`);
    console.log(`║  ❌ 실패: ${String(failed).padEnd(38)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

    // 결과 저장
    jsonOutput.passed = passed;
    jsonOutput.failed = failed;
    fs.writeFileSync(opts.output + '.json', JSON.stringify(jsonOutput, null, 2), 'utf8');
    console.log(`\n📄 JSON 결과: ${opts.output}.json`);

    const mdContent = generateMdReport();
    fs.writeFileSync(opts.output + '.md', mdContent, 'utf8');
    console.log(`📄 MD 리포트: ${opts.output}.md`);

    if (failed > 0) { console.log('\n⚠ 실패한 테스트가 있습니다.'); process.exit(1); }
}

runAll();
