/**
 * 결제(Payment) 로직 테스트
 * 
 * payments JSON 파일을 입력받아 결제 실행 → DB 상태 검증 → MD 리포트 생성
 * 
 * 실행: node test/invoice/test_payment.js -i payments.json
 * 서버 실행 필요: node server.js
 * 
 * 옵션:
 *   -i  결제 JSON 파일 경로 (필수)
 *   -o  결과 출력 경로 (기본값: test/invoice/test_payment_result)
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
    const opts = { input: null, output: path.join(__dirname, 'test_payment_result') };
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

function queryDbSingle(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);
        db.get(sql, params, (err, row) => { db.close(); if (err) reject(err); else resolve(row); });
    });
}

function runDbCommand(sql, params = []) {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(DB_PATH);
        db.run(sql, params, function(err) {
            db.close();
            if (err) reject(err);
            else resolve(this);
        });
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

// ===== 결제 실행 + 검증 =====

async function testPaymentsForContract(contractPayments, index) {
    const { contract_id, payments } = contractPayments;

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  계약 #${index} (ID: ${contract_id}): 결제 로직 검증`);
    console.log(`${'═'.repeat(50)}`);

    // 기존 결제 데이터 초기화
    await runDbCommand("DELETE FROM payment_allocation WHERE invoice_id IN (SELECT id FROM invoices WHERE contract_id = ?)", [contract_id]);
    await runDbCommand("DELETE FROM payments WHERE contract_id = ?", [contract_id]);
    await runDbCommand("UPDATE invoices SET status = '정산대기' WHERE contract_id = ?", [contract_id]);

    console.log(`  🧹 기존 결제 내역 초기화 완료`);
    console.log(`  💳 결제 건수: ${payments.length}건`);

    // 결제 실행
    const paymentResults = [];
    for (const payment of payments) {
        const res = await apiPost('/api/payments/allocate', {
            contract_id,
            amount: payment.amount,
            paid_at: payment.paid_at,
            memo: payment.memo,
        });
        const ok = res.status === 200;
        if (!ok) console.log(`  ❌ 결제 실패: ${payment.memo} (status: ${res.status})`);
        paymentResults.push({ ...payment, success: ok, paymentId: res.data.paymentId });
    }

    const allSuccess = paymentResults.every(r => r.success);
    assert(allSuccess, `결제 API 모두 성공 (${payments.length}건)`);

    await new Promise(resolve => setTimeout(resolve, 500));

    // DB에서 Invoice 상태 조회
    const dbInvoices = await queryDb(
        'SELECT id, type, billing_month, due_date, amount, status FROM invoices WHERE contract_id = ? ORDER BY type, billing_month',
        [contract_id]
    );

    const dbPayments = await queryDb(
        'SELECT id, amount, paid_at, memo, type FROM payments WHERE contract_id = ? ORDER BY id',
        [contract_id]
    );

    const dbAllocations = await queryDb(
        `SELECT pa.payment_id, pa.invoice_id, pa.amount as allocated_amount,
                i.type as invoice_type, i.billing_month, i.amount as invoice_amount
         FROM payment_allocation pa
         JOIN invoices i ON pa.invoice_id = i.id
         JOIN payments p ON pa.payment_id = p.id
         WHERE p.contract_id = ?
         ORDER BY pa.id`,
        [contract_id]
    );

    // 결제 총액 검증
    const totalPaid = dbPayments.reduce((sum, p) => sum + p.amount, 0);
    const totalAllocated = dbAllocations.reduce((sum, a) => sum + a.allocated_amount, 0);
    console.log(`\n  💰 총 결제액: ${formatNumber(totalPaid)}원 | 총 배정액: ${formatNumber(totalAllocated)}원`);
    assert(totalAllocated <= totalPaid, '배정액 ≤ 결제액');

    // Invoice별 상태 검증
    let depositStatus = '정산대기', rentPaid = 0, rentPartial = 0, rentPending = 0;

    for (const inv of dbInvoices) {
        const allocs = dbAllocations.filter(a => a.invoice_id === inv.id);
        const totalAlloc = allocs.reduce((sum, a) => sum + a.allocated_amount, 0);
        const label = inv.type === 'deposit' ? '보증금' : '월세';

        const isPaidInFull = inv.status.startsWith('완납');
        const expectedBaseStatus = totalAlloc >= inv.amount ? '완납' : totalAlloc > 0 ? '부분납부' : '정산대기';
        if (!isPaidInFull && inv.status !== expectedBaseStatus && !(inv.status === '정산대기' && totalAlloc === 0)) {
            console.log(`  ⚠ ${label} ${inv.billing_month}: 상태=${inv.status}, 예상=${expectedBaseStatus}`);
        }

        if (inv.type === 'deposit') depositStatus = inv.status;
        if (inv.type === 'monthly_rent') {
            if (isPaidInFull) rentPaid++;
            else if (inv.status === '부분납부') rentPartial++;
            else rentPending++;
        }
    }

    assert(dbInvoices.length > 0, 'Invoice 레코드 존재');
    assert(dbPayments.length === payments.length, `Payment 레코드 수 일치 (${dbPayments.length}건)`);

    console.log(`\n  📊 보증금: ${depositStatus} | 월세 완납: ${rentPaid} | 부분납부: ${rentPartial} | 정산대기: ${rentPending}`);

    // 고아 레코드 검증
    const orphanCheck = await queryDbSingle(
        `SELECT COUNT(*) as cnt FROM payment_allocation pa
         LEFT JOIN payments p ON pa.payment_id = p.id
         LEFT JOIN invoices i ON pa.invoice_id = i.id
         WHERE (p.id IS NULL OR i.id IS NULL)`
    );
    assert(orphanCheck.cnt === 0, '고아 payment_allocation 레코드 없음');

    // JSON 출력용 데이터 수집
    jsonOutput.contracts.push({
        contract_id,
        deposit_scenario: contractPayments.deposit_scenario,
        invoices: dbInvoices.map(inv => ({
            id: inv.id, type: inv.type, type_label: inv.type === 'deposit' ? '보증금' : '월세',
            billing_month: inv.billing_month, due_date: inv.due_date, amount: inv.amount, status: inv.status,
        })),
        db_payments: dbPayments.map(p => ({ id: p.id, amount: p.amount, paid_at: p.paid_at, memo: p.memo })),
        db_allocations: dbAllocations.map(a => ({
            payment_id: a.payment_id, invoice_id: a.invoice_id,
            allocated_amount: a.allocated_amount, invoice_type: a.invoice_type, billing_month: a.billing_month,
        })),
        summary: { total_paid: totalPaid, total_allocated: totalAllocated, deposit_status: depositStatus, rent_paid: rentPaid, rent_partial: rentPartial, rent_pending: rentPending },
    });

    return { totalPaid, totalAllocated };
}

// ===== MD 리포트 생성 =====

function generateMdReport() {
    const lines = [];
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);

    lines.push(`# 결제(Payment) 로직 테스트 결과`);
    lines.push(``);
    lines.push(`- **실행시간**: ${ts}`);
    lines.push(`- **서버**: ${BASE_URL}`);
    lines.push(`- **결과**: ✅ ${passed} 통과 / ❌ ${failed} 실패`);
    lines.push(``);

    for (const c of jsonOutput.contracts) {
        lines.push(`---`);
        lines.push(``);
        lines.push(`## 계약 #${c.contract_id}`);
        lines.push(``);

        lines.push(`### 청구 vs 입금 비교`);
        lines.push(``);
        lines.push(`| 구분 | 청구월 | 예정일 | 예정액 | 실입금일 | 실입금액 | 차액(누적) | 상태 | Payment ID |`);
        lines.push(`|------|--------|--------|--------|----------|----------|------|------|------------|`);

        let cumBalance = 0; // 누적 차액
        for (const inv of c.invoices) {
            const allocs = c.db_allocations.filter(a => a.invoice_id === inv.id);

            if (allocs.length === 0) {
                cumBalance -= inv.amount;
                const cumStr = cumBalance > 0 ? `+${formatNumber(cumBalance)}` : cumBalance < 0 ? formatNumber(cumBalance) : '0';
                lines.push(`| ${inv.type_label} | ${inv.billing_month} | ${inv.due_date || '-'} | ${formatNumber(inv.amount)} | - | 0 | ${cumStr} | ${inv.status} | - |`);
            } else {
                let cumAlloc = 0;
                for (let ai = 0; ai < allocs.length; ai++) {
                    const alloc = allocs[ai];
                    cumAlloc += alloc.allocated_amount;
                    const payment = c.db_payments.find(p => p.id === alloc.payment_id);
                    const paidDate = payment ? payment.paid_at.substring(0, 10) : '-';
                    const payIdStr = alloc.payment_id || '-';

                    if (ai === 0) {
                        cumBalance += cumAlloc - inv.amount;
                    } else {
                        cumBalance += alloc.allocated_amount;
                    }

                    const cumStr = cumBalance > 0 ? `+${formatNumber(cumBalance)}` : cumBalance < 0 ? formatNumber(cumBalance) : '0';

                    if (ai === 0) {
                        lines.push(`| ${inv.type_label} | ${inv.billing_month} | ${inv.due_date || '-'} | ${formatNumber(inv.amount)} | ${paidDate} | ${formatNumber(alloc.allocated_amount)} | ${cumStr} | ${inv.status} | ${payIdStr} |`);
                    } else {
                        lines.push(`| " | " | " | " | ${paidDate} | ${formatNumber(alloc.allocated_amount)} | ${cumStr} | " | ${payIdStr} |`);
                    }
                }
            }
        }
        lines.push(``);

        // 상태 요약
        lines.push(`### 상태 요약`);
        lines.push(``);
        lines.push(`| 항목 | 값 |`);
        lines.push(`|------|-----|`);
        lines.push(`| 보증금 | ${c.summary.deposit_status} |`);
        lines.push(`| 월세 완납 | ${c.summary.rent_paid}건 |`);
        lines.push(`| 월세 부분납부 | ${c.summary.rent_partial}건 |`);
        lines.push(`| 월세 정산대기 | ${c.summary.rent_pending}건 |`);
        lines.push(`| 총 결제액 | ${formatNumber(c.summary.total_paid)}원 |`);
        lines.push(`| 총 배정액 | ${formatNumber(c.summary.total_allocated)}원 |`);
        lines.push(``);
    }

    // 전체 통계
    const totalPaid = jsonOutput.contracts.reduce((s, c) => s + c.summary.total_paid, 0);
    const totalAllocated = jsonOutput.contracts.reduce((s, c) => s + c.summary.total_allocated, 0);
    lines.push(`---`);
    lines.push(``);
    lines.push(`## 전체 통계`);
    lines.push(``);
    lines.push(`| 항목 | 값 |`);
    lines.push(`|------|-----|`);
    lines.push(`| 총 계약 수 | ${jsonOutput.contracts.length}건 |`);
    lines.push(`| 총 결제액 | ${formatNumber(totalPaid)}원 |`);
    lines.push(`| 총 배정액 | ${formatNumber(totalAllocated)}원 |`);
    lines.push(``);

    return lines.join('\n');
}

// ===== Main =====

async function runAll() {
    const opts = parseArgs();

    if (!opts.input) {
        console.log('❌ 사용법: node test/invoice/test_payment.js -i payments.json');
        console.log('   결제 JSON 파일이 필요합니다.');
        console.log('   생성: node test/invoice/generate_payments.js -i test_result.json');
        process.exit(1);
    }

    let paymentsData;
    try {
        paymentsData = JSON.parse(fs.readFileSync(opts.input, 'utf8'));
    } catch (e) {
        console.log(`❌ 결제 파일 로드 실패: ${e.message}`);
        process.exit(1);
    }

    const contracts = paymentsData.contracts || [];

    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  결제(Payment) 로직 테스트                       ║');
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

    let totalPaid = 0, totalAllocated = 0;
    for (let i = 0; i < contracts.length; i++) {
        const result = await testPaymentsForContract(contracts[i], i + 1);
        totalPaid += result.totalPaid;
        totalAllocated += result.totalAllocated;
    }

    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  총 결제액: ${formatNumber(totalPaid)}원 | 총 배정액: ${formatNumber(totalAllocated)}원`);

    console.log('\n╔══════════════════════════════════════════════════╗');
    console.log('║  테스트 결과                                      ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║  ✅ 통과: ${String(passed).padEnd(38)}║`);
    console.log(`║  ❌ 실패: ${String(failed).padEnd(38)}║`);
    console.log('╚══════════════════════════════════════════════════╝');

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
