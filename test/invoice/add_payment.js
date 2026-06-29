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
    const opts = { type: 'add', contract_id: null, date: null, amount: null, memo: '', payment_id: null };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-t' && args[i + 1]) opts.type = args[++i];
        else if (args[i] === '-c' && args[i + 1]) opts.contract_id = parseInt(args[++i]);
        else if (args[i] === '-d' && args[i + 1]) opts.date = args[++i];
        else if (args[i] === '-a' && args[i + 1]) opts.amount = parseInt(args[++i]);
        else if (args[i] === '-m' && args[i + 1]) opts.memo = args[++i];
        else if (args[i] === '-p' && args[i + 1]) opts.payment_id = parseInt(args[++i]);
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

async function reallocateAll(contractId) {
    console.log(`\n🔄 결제일 기준 전체 재할당 진행 중 (Contract ID: ${contractId})...`);
    
    // 1. 기존 allocation 모두 삭제
    await runDbCommand(
        `DELETE FROM payment_allocation WHERE invoice_id IN (SELECT id FROM invoices WHERE contract_id = ?)`,
        [contractId]
    );

    // 2. Invoice 목록 가져오기
    const invoices = await queryDbAll(
        `SELECT id, type, billing_month, amount as due_amount
         FROM invoices
         WHERE contract_id = ?
         ORDER BY CASE WHEN type = 'deposit' THEN 0 ELSE 1 END, billing_month ASC`,
        [contractId]
    );

    // 3. Payment 목록 가져오기 (결제일순 정렬!)
    const payments = await queryDbAll(
        `SELECT id, amount, paid_at FROM payments
         WHERE contract_id = ?
         ORDER BY paid_at ASC, id ASC`,
        [contractId]
    );

    // 4. 할당 진행
    let invoiceIdx = 0;
    const invStatusMap = {};
    for (const inv of invoices) {
        invStatusMap[inv.id] = { paid: 0, last_paid_at: null };
    }

    for (const p of payments) {
        let remaining = p.amount;
        while (remaining > 0 && invoiceIdx < invoices.length) {
            const inv = invoices[invoiceIdx];
            const owed = inv.due_amount - invStatusMap[inv.id].paid;
            
            if (owed <= 0) {
                invoiceIdx++;
                continue;
            }

            const alloc = Math.min(remaining, owed);
            
            await runDbCommand(
                `INSERT INTO payment_allocation(payment_id, invoice_id, amount) VALUES(?, ?, ?)`,
                [p.id, inv.id, alloc]
            );

            invStatusMap[inv.id].paid += alloc;
            invStatusMap[inv.id].last_paid_at = p.paid_at;
            remaining -= alloc;

            if (invStatusMap[inv.id].paid >= inv.due_amount) {
                invoiceIdx++;
            }
        }
    }

    // 5. Invoice 상태 갱신
    for (const inv of invoices) {
        const stats = invStatusMap[inv.id];
        let newStatus;
        if (stats.paid >= inv.due_amount) {
            const billingMonth = inv.billing_month || '';
            const paidMonth = stats.last_paid_at ? stats.last_paid_at.substring(0, 7) : '';
            if (paidMonth < billingMonth) newStatus = '완납(선납)';
            else if (paidMonth > billingMonth) newStatus = '완납(후납)';
            else newStatus = '완납';
        } else if (stats.paid > 0) {
            newStatus = '부분납부';
        } else {
            newStatus = '정산대기';
        }
        await runDbCommand(`UPDATE invoices SET status = ? WHERE id = ?`, [newStatus, inv.id]);
    }
    
    console.log(`✅ 결제일순 전체 재할당 완료`);
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
                COALESCE((SELECT SUM(pa.amount) FROM payment_allocation pa WHERE pa.invoice_id = i.id), 0) as paid_amount,
                (SELECT MAX(p.paid_at) FROM payment_allocation pa JOIN payments p ON pa.payment_id = p.id WHERE pa.invoice_id = i.id) as last_paid_at
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

    // MD 파일 내용 생성 준비
    const mdLines = [];
    mdLines.push(`# 계약 #${contractId} 결제 내역`);
    mdLines.push('');
    mdLines.push(`- **건물/호실**: ${contract.building_name || '-'} ${contract.room_number || ''}호`);
    mdLines.push(`- **조건**: 보증금 ${formatNumber(contract.deposit)}원 | 월세 ${formatNumber(totalMonthly)}원/월`);
    mdLines.push(`- **기간**: ${contract.contract_start_date} ~ ${contract.contract_end_date || '-'}`);
    mdLines.push('');

    // 계약 정보 출력
    console.log('');
    console.log('════════════════════════════════════════════════════');
    console.log(`  계약 #${contractId} | ${contract.building_name || '-'} ${contract.room_number || ''}호`);
    console.log(`  보증금: ${formatNumber(contract.deposit)}원 | 월세: ${formatNumber(totalMonthly)}원/월`);
    console.log(`  기간: ${contract.contract_start_date} ~ ${contract.contract_end_date || '-'}`);
    console.log('════════════════════════════════════════════════════');

    console.log('');
    console.log('| 구분 | 청구월 | 예정일 | 예정액 | 실입금일 | 실입금액 | 차액(누적) | 상태 | Payment ID |');
    console.log('|------|--------|--------|--------|----------|----------|------------|------|------------|');
    
    mdLines.push('| 구분 | 청구월 | 예정일 | 예정액 | 실입금일 | 실입금액 | 차액(누적) | 상태 | Payment ID |');
    mdLines.push('|------|--------|--------|--------|----------|----------|------------|------|------------|');

    let depositPaid = 0, depositDue = 0;
    let rentPaid = 0, rentPartial = 0, rentPending = 0;
    let cumBalance = 0;

    for (const inv of invoices) {
        const label = inv.type === 'deposit' ? '보증금' : '월세';
        
        if (inv.type === 'deposit') {
            depositPaid = inv.paid_amount;
            depositDue = inv.due_amount;
        } else {
            if (inv.status.startsWith('완납')) rentPaid++;
            else if (inv.status === '부분납부') rentPartial++;
            else rentPending++;
        }

        const allocs = allocations.filter(a => a.invoice_id === inv.id);

        if (allocs.length === 0) {
            cumBalance -= inv.due_amount;
            const cumStr = cumBalance > 0 ? `+${formatNumber(cumBalance)}` : cumBalance < 0 ? formatNumber(cumBalance) : '0';
            const row = `| ${label} | ${inv.billing_month} | ${inv.due_date || '-'} | ${formatNumber(inv.due_amount)} | - | 0 | ${cumStr} | ${inv.status} | - |`;
            console.log(row);
            mdLines.push(row);
        } else {
            let cumAlloc = 0;
            for (let ai = 0; ai < allocs.length; ai++) {
                const alloc = allocs[ai];
                cumAlloc += alloc.allocated_amount;
                const payment = payments.find(p => p.id === alloc.payment_id);
                const paidDate = payment && payment.paid_at ? payment.paid_at.substring(0, 10) : '-';
                const payIdStr = alloc.payment_id || '-';

                if (ai === 0) {
                    cumBalance += cumAlloc - inv.due_amount;
                } else {
                    cumBalance += alloc.allocated_amount;
                }

                const cumStr = cumBalance > 0 ? `+${formatNumber(cumBalance)}` : cumBalance < 0 ? formatNumber(cumBalance) : '0';

                if (ai === 0) {
                    const row = `| ${label} | ${inv.billing_month} | ${inv.due_date || '-'} | ${formatNumber(inv.due_amount)} | ${paidDate} | ${formatNumber(alloc.allocated_amount)} | ${cumStr} | ${inv.status} | ${payIdStr} |`;
                    console.log(row);
                    mdLines.push(row);
                } else {
                    const row = `| " | " | " | " | ${paidDate} | ${formatNumber(alloc.allocated_amount)} | ${cumStr} | " | ${payIdStr} |`;
                    console.log(row);
                    mdLines.push(row);
                }
            }
        }
    }

    // 요약
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const totalAllocated = allocations.reduce((s, a) => s + a.allocated_amount, 0);
    const depositStatus = depositPaid >= depositDue ? '완납' : depositPaid > 0 ? '부분납부' : '정산대기';

    console.log('');
    console.log(`  📊 보증금: ${depositStatus} | 월세 완납: ${rentPaid} | 부분납부: ${rentPartial} | 정산대기: ${rentPending}`);
    console.log(`  💰 총 결제액: ${formatNumber(totalPaid)}원 | 총 배정액: ${formatNumber(totalAllocated)}원`);
    console.log(`  ℹ️  미배정 잔액(초과 입금): ${formatNumber(totalPaid - totalAllocated)}원`);
    console.log('');
    
    // 전체 입금 내역 출력
    console.log('════════════════════════════════════════════════════');
    console.log('  💸 전체 입금 내역 (Payments)');
    console.log('════════════════════════════════════════════════════');
    console.log('| 결제 ID | 입금일 | 입금액 | 메모 |');
    console.log('|---------|--------|--------|------|');
    mdLines.push('');
    mdLines.push(`### 💸 전체 입금 내역 (Payments)`);
    mdLines.push('');
    mdLines.push('| 결제 ID | 입금일 | 입금액 | 메모 |');
    mdLines.push('|---------|--------|--------|------|');
    
    for (const p of payments) {
        const pDate = p.paid_at ? p.paid_at.substring(0, 10) : '-';
        const pMemo = p.memo || '-';
        const row = `| ${p.id} | ${pDate} | ${formatNumber(p.amount)} | ${pMemo} |`;
        console.log(row);
        mdLines.push(row);
    }
    console.log('');

    mdLines.push('');
    mdLines.push(`**요약**`);
    mdLines.push(`- 보증금: ${depositStatus} | 월세 완납: ${rentPaid} | 부분납부: ${rentPartial} | 정산대기: ${rentPending}`);
    mdLines.push(`- 총 결제액: ${formatNumber(totalPaid)}원 | 총 배정액: ${formatNumber(totalAllocated)}원`);
    mdLines.push(`- 미배정 잔액(초과 입금): ${formatNumber(totalPaid - totalAllocated)}원`);

    const fs = require('fs');
    const mdFilePath = path.join(__dirname, `payment_result_${contractId}.md`);
    fs.writeFileSync(mdFilePath, mdLines.join('\n'), 'utf8');
    console.log(`📄 마크다운 결과가 저장되었습니다: ${mdFilePath}`);
}

async function addPayment(opts) {
    if (!opts.contract_id || !opts.date || !opts.amount) {
        console.log('❌ 사용법 (추가): node test/invoice/add_payment.js -t add -c <contract_id> -d <date> -a <amount> [-m memo]');
        console.log('');
        console.log('옵션:');
        console.log('  -t  실행 타입 (add 또는 remove, 기본값: add)');
        console.log('  -c  계약 ID (필수)');
        console.log('  -d  입금일 (필수, 예: 2024-06-09)');
        console.log('  -a  입금액 (필수, 예: 390000)');
        console.log('  -m  메모 (선택)');
        console.log('');
        console.log('예시:');
        console.log('  node test/invoice/add_payment.js -t add -c 123 -d 2024-06-09 -a 390000');
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

        // The API now automatically performs FIFO reallocation internally.

        // 결제 후 계약 테이블 출력
        await printContractTable(opts.contract_id);

    } catch (e) {
        console.log(`❌ 서버 연결 실패: ${e.message}`);
        process.exit(1);
    }
}

async function removePayment(opts) {
    if (!opts.payment_id) {
        console.log('❌ 사용법 (제거): node test/invoice/add_payment.js -t remove -p <payment_id>');
        process.exit(1);
    }

    const pid = opts.payment_id;
    console.log(`🗑️  결제 제거 시작 (Payment ID: ${pid})`);

    try {
        const payment = await queryDbSingle(`SELECT contract_id FROM payments WHERE id = ?`, [pid]);
        if (!payment) {
            console.log(`❌ 결제 ID ${pid}를 찾을 수 없습니다.`);
            process.exit(1);
        }
        
        const contractId = payment.contract_id;

        // 찾을 allocation들
        const allocs = await queryDbAll(`SELECT invoice_id FROM payment_allocation WHERE payment_id = ?`, [pid]);
        const invoiceIds = [...new Set(allocs.map(a => a.invoice_id))];

        // allocation 삭제
        await runDbCommand(`DELETE FROM payment_allocation WHERE payment_id = ?`, [pid]);

        // payments 삭제
        await runDbCommand(`DELETE FROM payments WHERE id = ?`, [pid]);

        // 결제일(입금일) 기준으로 전체 재할당 수행
        await reallocateAll(contractId);

        console.log(`✅ 결제 제거 완료 (Payment ID: ${pid})`);
        
        await printContractTable(contractId);

    } catch (e) {
        console.log(`❌ 결제 제거 실패: ${e.message}`);
        process.exit(1);
    }
}

async function main() {
    const opts = parseArgs();
    
    if (opts.type === 'add') {
        await addPayment(opts);
    } else if (opts.type === 'remove') {
        await removePayment(opts);
    } else {
        console.log('❌ 알 수 없는 type입니다. add 또는 remove를 사용하세요.');
        process.exit(1);
    }
}

main();
