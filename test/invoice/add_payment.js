/**
 * 수동 결제 추가 스크립트
 * 
 * 서버 /api/payments/allocate에 결제를 추가 (자동 FIFO 매핑)
 * 결제 후 계약의 청구 vs 입금 비교표를 출력
 * 
 * 실행: node test/invoice/add_payment.js -c <contract_id> -d <date> -a <amount> [-m memo]
 * 
 * 옵션:
 *   -c  계약 ID (필수)
 *   -d  입금일 (필수, 예: 2024-06-09)
 *   -a  입금액 (필수, 예: 390000)
 *   -m  메모 (선택)
 * 
 * 예시:
 *   node test/invoice/add_payment.js -c 123 -d 2024-06-09 -a 390000
 *   node test/invoice/add_payment.js -c 123 -d 2024-06-09 -a 390000 -m "6월 월세"
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, '..', '..', 'sugar.db');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { contract_id: null, date: null, amount: null, memo: '' };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-c' && args[i + 1]) opts.contract_id = parseInt(args[++i]);
        else if (args[i] === '-d' && args[i + 1]) opts.date = args[++i];
        else if (args[i] === '-a' && args[i + 1]) opts.amount = parseInt(args[++i]);
        else if (args[i] === '-m' && args[i + 1]) opts.memo = args[++i];
    }
    return opts;
}

function formatNumber(num) { return num.toLocaleString('ko-KR'); }

function queryDbAll(sql, params = []) {
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

async function printContractTable(contractId) {
    // 계약 정보
    const contract = await queryDbSingle(
        `SELECT c.*, r.room_number, b.name as building_name
         FROM contracts c
         LEFT JOIN rooms r ON c.room_id = r.id
         LEFT JOIN buildings b ON r.building_id = b.id
         WHERE c.id = ?`, [contractId]
    );

    if (!contract) {
        console.log('⚠ 계약을 찾을 수 없습니다.');
        return;
    }

    const totalMonthly = (contract.monthly_rent || 0) + (contract.maintenance_fee || 0);

    // Invoice + allocation 정보
    const invoices = await queryDbAll(
        `SELECT i.id, i.type, i.billing_month, i.due_date, i.amount as due_amount, i.status,
                COALESCE((SELECT SUM(pa.amount) FROM payment_allocation pa WHERE pa.invoice_id = i.id), 0) as paid_amount
         FROM invoices i
         WHERE i.contract_id = ?
         ORDER BY CASE WHEN i.type = 'deposit' THEN 0 ELSE 1 END, i.billing_month ASC`,
        [contractId]
    );

    const payments = await queryDbAll(
        `SELECT id, amount, paid_at, memo FROM payments WHERE contract_id = ? ORDER BY id`,
        [contractId]
    );

    const allocations = await queryDbAll(
        `SELECT pa.payment_id, pa.invoice_id, pa.amount as allocated_amount,
                i.type as invoice_type, i.billing_month
         FROM payment_allocation pa
         JOIN invoices i ON pa.invoice_id = i.id
         JOIN payments p ON pa.payment_id = p.id
         WHERE p.contract_id = ?
         ORDER BY pa.id`,
        [contractId]
    );

    // 계약 정보 출력
    console.log('');
    console.log('════════════════════════════════════════════════════');
    console.log(`  계약 #${contractId} | ${contract.building_name || '-'} ${contract.room_number || ''}호`);
    console.log(`  보증금: ${formatNumber(contract.deposit)}원 | 월세: ${formatNumber(totalMonthly)}원/월`);
    console.log(`  기간: ${contract.contract_start_date} ~ ${contract.contract_end_date || '-'}`);
    console.log('════════════════════════════════════════════════════');

    // 청구 vs 입금 비교표
    console.log('');
    console.log('| 구분 | 청구월 | 예정일 | 예정액 | 기납부액 | 미납액 | 상태 |');
    console.log('|------|--------|--------|--------|----------|--------|------|');

    let depositPaid = 0, depositDue = 0;
    let rentPaid = 0, rentPartial = 0, rentPending = 0;

    for (const inv of invoices) {
        const label = inv.type === 'deposit' ? '보증금' : '월세';
        const unpaid = inv.due_amount - inv.paid_amount;
        const unpaidStr = unpaid > 0 ? formatNumber(unpaid) : '0';

        console.log(`| ${label} | ${inv.billing_month} | ${inv.due_date || '-'} | ${formatNumber(inv.due_amount)} | ${formatNumber(inv.paid_amount)} | ${unpaidStr} | ${inv.status} |`);

        if (inv.type === 'deposit') {
            depositPaid = inv.paid_amount;
            depositDue = inv.due_amount;
        } else {
            if (inv.status.startsWith('완납')) rentPaid++;
            else if (inv.status === '부분납부') rentPartial++;
            else rentPending++;
        }
    }

    // 요약
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const totalAllocated = allocations.reduce((s, a) => s + a.allocated_amount, 0);
    const depositStatus = depositPaid >= depositDue ? '완납' : depositPaid > 0 ? '부분납부' : '정산대기';

    console.log('');
    console.log(`  📊 보증금: ${depositStatus} | 월세 완납: ${rentPaid} | 부분납부: ${rentPartial} | 정산대기: ${rentPending}`);
    console.log(`  💰 총 결제액: ${formatNumber(totalPaid)}원 | 총 배정액: ${formatNumber(totalAllocated)}원`);
    console.log('');
}

async function addPayment() {
    const opts = parseArgs();

    if (!opts.contract_id || !opts.date || !opts.amount) {
        console.log('❌ 사용법: node test/invoice/add_payment.js -c <contract_id> -d <date> -a <amount> [-m memo]');
        console.log('');
        console.log('옵션:');
        console.log('  -c  계약 ID (필수)');
        console.log('  -d  입금일 (필수, 예: 2024-06-09)');
        console.log('  -a  입금액 (필수, 예: 390000)');
        console.log('  -m  메모 (선택)');
        console.log('');
        console.log('예시:');
        console.log('  node test/invoice/add_payment.js -c 123 -d 2024-06-09 -a 390000');
        process.exit(1);
    }

    const paidAt = opts.date + 'T10:00:00.000Z';

    console.log(`💳 결제 추가`);
    console.log(`  계약 ID: ${opts.contract_id}`);
    console.log(`  입금일: ${opts.date}`);
    console.log(`  입금액: ${formatNumber(opts.amount)}원`);
    if (opts.memo) console.log(`  메모: ${opts.memo}`);
    console.log('');

    try {
        const res = await fetch(`${BASE_URL}/api/payments/allocate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contract_id: opts.contract_id,
                amount: opts.amount,
                paid_at: paidAt,
                memo: opts.memo || '',
            }),
        });

        const data = await res.json();

        if (res.status !== 200) {
            console.log(`❌ 실패 (status: ${res.status}): ${JSON.stringify(data)}`);
            process.exit(1);
        }

        console.log(`✅ 결제 추가 성공 (paymentId: ${data.paymentId})`);

        if (data.allocations && data.allocations.length > 0) {
            console.log('');
            console.log('📊 자동 FIFO 매핑 결과:');
            data.allocations.forEach((alloc, i) => {
                const typeLabel = alloc.type === 'deposit' ? '보증금' : '월세';
                console.log(`  ${i + 1}. ${typeLabel} ${alloc.billing_month}: ${formatNumber(alloc.amount)}원`);
            });
        }

        // 결제 후 계약 테이블 출력
        await printContractTable(opts.contract_id);

    } catch (e) {
        console.log(`❌ 서버 연결 실패: ${e.message}`);
        process.exit(1);
    }
}

addPayment();
