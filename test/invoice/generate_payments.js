/**
 * 랜덤 결제(Payments) JSON 생성기
 * 
 * test_invoice.js 결과 파일에서 계약/Invoice 정보를 읽어 랜덤 결제 생성
 * 서버가 자동 FIFO 매핑하므로 allocations 없이 amount/paid_at/memo만 생성
 * 
 * 실행: node test/invoice/generate_payments.js -i test_result.json [-o payments.json]
 * 
 * 옵션:
 *   -i  Invoice 테스트 결과 JSON (필수)
 *   -o  출력 파일 경로 (기본값: test/invoice/payments.json)
 */

const path = require('path');
const fs = require('fs');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { input: null, output: path.join(__dirname, 'payments.json') };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-i' && args[i + 1]) opts.input = args[++i];
        else if (args[i] === '-o' && args[i + 1]) opts.output = args[++i];
    }
    return opts;
}

function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generatePaymentsForContract(contractData) {
    const { contract_id, contract, invoices } = contractData;
    const payments = [];
    const totalMonthly = contract.monthly_rent + contract.management_fee;

    const rentInvoices = invoices.filter(inv => inv.type === 'monthly_rent');

    // ── 보증금 결제 시나리오 ──
    // 십만원 단위 랜덤 분할 (최대 3회), 월세 동시 납부 가능
    const UNIT = 100000; // 십만원 단위
    const depositScenario = randomChoice(['full', 'split', 'with_rent', 'partial', 'split_rent']);
    const startDate = contract.contract_start_date;
    const depositUnits = contract.deposit / UNIT;

    switch (depositScenario) {
        case 'full':
            payments.push({
                contract_id, amount: contract.deposit,
                paid_at: startDate + 'T10:00:00.000Z',
                memo: '보증금 전액 납부',
            });
            break;
        case 'split': {
            const splitCount = randomInt(2, 3);
            const splits = [];
            let remaining = depositUnits;
            for (let si = 0; si < splitCount - 1; si++) {
                const maxVal = remaining - (splitCount - si - 1);
                const val = randomInt(1, maxVal);
                splits.push(val * UNIT);
                remaining -= val;
            }
            splits.push(remaining * UNIT);

            const times = ['T10:00:00.000Z', 'T14:00:00.000Z', 'T18:00:00.000Z'];
            splits.forEach((amount, idx) => {
                payments.push({
                    contract_id, amount,
                    paid_at: startDate + times[idx],
                    memo: `보증금 ${idx + 1}/${splitCount} 차 납부`,
                });
            });
            break;
        }
        case 'with_rent':
            if (rentInvoices.length > 0) {
                payments.push({
                    contract_id, amount: contract.deposit + totalMonthly,
                    paid_at: startDate + 'T10:00:00.000Z',
                    memo: '보증금 + 첫 월세',
                });
            }
            break;
        case 'partial': {
            // 부분 납부 후 잔액을 1~2회 더 내서 3회 내 완납
            const pct = randomInt(70, 90) / 100;
            const firstAmount = Math.round(contract.deposit * pct / UNIT) * UNIT;
            const restAmount = contract.deposit - firstAmount;
            const restUnits = restAmount / UNIT;

            payments.push({
                contract_id, amount: firstAmount,
                paid_at: startDate + 'T10:00:00.000Z',
                memo: '보증금 1차 납부 (부분)',
            });

            // 잔액을 1~2회로 분할
            const restSplitCount = randomInt(1, 2);
            const restSplits = [];
            let restRemaining = restUnits;
            for (let si = 0; si < restSplitCount - 1; si++) {
                const maxVal = restRemaining - (restSplitCount - si - 1);
                const val = randomInt(1, maxVal);
                restSplits.push(val * UNIT);
                restRemaining -= val;
            }
            restSplits.push(restRemaining * UNIT);

            const times = ['T14:00:00.000Z', 'T18:00:00.000Z'];
            restSplits.forEach((amount, idx) => {
                payments.push({
                    contract_id, amount,
                    paid_at: startDate + times[idx],
                    memo: `보증금 ${idx + 2}/${restSplitCount + 1} 차 납부`,
                });
            });
            break;
        }
        case 'split_rent': {
            if (rentInvoices.length > 0) {
                const splitCount = randomInt(2, 3);
                const splits = [];
                let remaining = depositUnits;
                for (let si = 0; si < splitCount - 1; si++) {
                    const maxVal = remaining - (splitCount - si - 1);
                    const val = randomInt(1, maxVal);
                    splits.push(val * UNIT);
                    remaining -= val;
                }
                splits.push(remaining * UNIT);

                const times = ['T10:00:00.000Z', 'T14:00:00.000Z', 'T18:00:00.000Z'];
                splits.forEach((amount, idx) => {
                    if (idx === 0) {
                        payments.push({
                            contract_id, amount: amount + totalMonthly,
                            paid_at: startDate + times[idx],
                            memo: `보증금 ${idx + 1}/${splitCount} + 첫 월세`,
                        });
                    } else {
                        payments.push({
                            contract_id, amount,
                            paid_at: startDate + times[idx],
                            memo: `보증금 ${idx + 1}/${splitCount} 차 납부`,
                        });
                    }
                });
            }
            break;
        }
    }

    // ── 월세 결제 시나리오 ──
    // 서버가 자동 FIFO 매핑하므로 amount/paid_at만 생성
    const rentStartIdx = ['with_rent', 'split_rent'].includes(depositScenario) ? 1 : 0;

    for (let i = rentStartIdx; i < rentInvoices.length; i++) {
        const inv = rentInvoices[i];
        const scenario = randomChoice(['full', 'double', 'partial', 'overpay', 'split', 'skip', 'catchup']);

        switch (scenario) {
            case 'full':
                payments.push({
                    contract_id, amount: totalMonthly,
                    paid_at: inv.due_date + 'T10:00:00.000Z',
                    memo: `${inv.billing_month} 월세 납부`,
                });
                break;
            case 'double':
                payments.push({
                    contract_id, amount: totalMonthly * 2,
                    paid_at: inv.due_date + 'T10:00:00.000Z',
                    memo: `${inv.billing_month} 2개월치 납부`,
                });
                i++; // 다음 월 건너뜀
                break;
            case 'partial': {
                const rentPct = randomInt(70, 90) / 100;
                const partialRent = Math.floor(totalMonthly * rentPct);
                payments.push({
                    contract_id, amount: partialRent,
                    paid_at: inv.due_date + 'T10:00:00.000Z',
                    memo: `${inv.billing_month} 부분납부`,
                });
                break;
            }
            case 'overpay': {
                const overpayPct = randomInt(110, 150) / 100;
                const overpayAmount = Math.floor(totalMonthly * overpayPct);
                payments.push({
                    contract_id, amount: overpayAmount,
                    paid_at: inv.due_date + 'T10:00:00.000Z',
                    memo: `${inv.billing_month} 초과납부`,
                });
                break;
            }
            case 'split': {
                // 분할 납부 - 월세를 2~3일에 걸쳐 만원 단위로 나누어 납부
                const RENT_UNIT = 10000;
                const splitCount = randomInt(2, 3);
                const totalUnits = totalMonthly / RENT_UNIT;
                const splits = [];
                let splitRemaining = totalUnits;
                for (let si = 0; si < splitCount - 1; si++) {
                    const maxVal = splitRemaining - (splitCount - si - 1);
                    const val = randomInt(1, maxVal);
                    splits.push(val * RENT_UNIT);
                    splitRemaining -= val;
                }
                splits.push(splitRemaining * RENT_UNIT);

                for (let si = 0; si < splitCount; si++) {
                    const splitDate = new Date(inv.due_date);
                    splitDate.setDate(splitDate.getDate() + si);
                    const splitDateStr = splitDate.toISOString().split('T')[0];

                    payments.push({
                        contract_id, amount: splits[si],
                        paid_at: splitDateStr + 'T10:00:00.000Z',
                        memo: `${inv.billing_month} 분할납부 (${si + 1}/${splitCount})`,
                    });
                }
                break;
            }
            case 'skip':
                // 미납 - payment 생성 안함
                break;
            case 'catchup': {
                // 밀린 월세 일괄 납부 (이전 skip된 월세 포함)
                // 이전 skip된 개수를 추정 (rentStartIdx부터 현재까지 skip이 아닌 것의 개수)
                const skippedCount = i - rentStartIdx - payments.filter(p => p.memo.includes('월세') || p.memo.includes('납부')).length + 1;
                const catchupMonths = Math.max(1, skippedCount > 0 ? Math.min(skippedCount, 3) : 1);
                const catchupAmount = totalMonthly * catchupMonths;

                const paidDate = new Date(inv.due_date);
                paidDate.setDate(paidDate.getDate() + randomInt(5, 20));
                const paidDateStr = paidDate.toISOString().split('T')[0];

                payments.push({
                    contract_id, amount: catchupAmount,
                    paid_at: paidDateStr + 'T10:00:00.000Z',
                    memo: `밀린 월세 일괄 납부`,
                });
                break;
            }
        }
    }

    // paid_at 순서로 정렬 (시간 순서 보장)
    payments.sort((a, b) => a.paid_at.localeCompare(b.paid_at));

    return { contract_id, deposit_scenario: depositScenario, payments };
}

// ===== Main =====

const opts = parseArgs();

if (!opts.input) {
    console.log('❌ 사용법: node test/invoice/generate_payments.js -i test_result.json');
    console.log('   Invoice 테스트 결과 JSON 파일이 필요합니다.');
    process.exit(1);
}

let inputData;
try {
    inputData = JSON.parse(fs.readFileSync(opts.input, 'utf8'));
} catch (e) {
    console.log(`❌ 파일 로드 실패: ${e.message}`);
    process.exit(1);
}

const contracts = inputData.contracts || [];
const allPayments = [];

for (const c of contracts) {
    const result = generatePaymentsForContract(c);
    allPayments.push(result);
}

const output = {
    timestamp: new Date().toISOString(),
    source: opts.input,
    count: allPayments.length,
    contracts: allPayments,
};

fs.writeFileSync(opts.output, JSON.stringify(output, null, 2), 'utf8');

console.log(`💳 결제 데이터 ${allPayments.length}건 생성 완료`);
console.log(`📄 저장: ${opts.output}`);
allPayments.forEach((c, i) => {
    console.log(`  #${i + 1} (계약 ${c.contract_id}): ${c.payments.length}건 결제 | 보증금: ${c.deposit_scenario}`);
});
