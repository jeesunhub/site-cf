/**
 * 랜덤 계약서 JSON 생성기
 * 
 * 실행: node test/invoice/generate_contracts.js [-n 개수] [-o 출력파일]
 * 
 * 옵션:
 *   -n  생성할 계약 수 (기본값: 3)
 *   -o  출력 파일 경로 (기본값: test/invoice/contracts.json)
 */

const path = require('path');
const fs = require('fs');

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = { count: 3, output: path.join(__dirname, 'contracts.json') };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-n' && args[i + 1]) { opts.count = parseInt(args[++i]); }
        else if (args[i] === '-o' && args[i + 1]) { opts.output = args[++i]; }
    }
    return opts;
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function formatDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function generateContract(index) {
    const periodMonths = randomChoice([6, 12, 24]);
    const periodLabel = periodMonths === 6 ? '6개월' : periodMonths === 12 ? '1년' : '2년';

    const startYear = randomInt(2023, 2025);
    const startMonth = randomInt(0, 11);
    const startDay = randomInt(1, 28);
    const startDate = new Date(startYear, startMonth, startDay);
    const endDate = new Date(startYear, startMonth + periodMonths, startDay - 1);

    const paymentType = randomChoice(['prepaid', 'postpaid']);
    const paymentLabel = paymentType === 'prepaid' ? '선불' : '후불';

    // 총 계약금액: 1억~1억5천 사이
    const totalAmount = randomInt(100, 150) * 1000000;
    // 보증금: 총액의 40~70%, 천만원 단위 절사
    const depositPct = randomInt(40, 70) / 100;
    const deposit = Math.floor(totalAmount * depositPct / 10000000) * 10000000;
    // 월세 = (총액 - 보증금) / 200, 만원 단위 절사
    const monthlyRent = Math.floor((totalAmount - deposit) / 200 / 10000) * 10000;
    const managementFee = 90000;
    const cleaningFee = 100000;

    return {
        index,
        payment_type: paymentType,
        payment_label: paymentLabel,
        contract_start_date: formatDate(startDate),
        contract_end_date: formatDate(endDate),
        period_label: periodLabel,
        period_months: periodMonths,
        deposit,
        monthly_rent: monthlyRent,
        management_fee: managementFee,
        cleaning_fee: cleaningFee,
    };
}

const opts = parseArgs();
const contracts = [];

for (let i = 0; i < opts.count; i++) {
    contracts.push(generateContract(i + 1));
}

const output = {
    timestamp: new Date().toISOString(),
    count: opts.count,
    contracts,
};

fs.writeFileSync(opts.output, JSON.stringify(output, null, 2), 'utf8');

console.log(`📋 계약서 ${opts.count}건 생성 완료`);
console.log(`📄 저장: ${opts.output}`);
contracts.forEach((c, i) => {
    console.log(`  #${i + 1}: ${c.payment_label} | ${c.contract_start_date} ~ ${c.contract_end_date} (${c.period_label}) | 보증금 ${(c.deposit / 10000).toLocaleString()}만원 | 월세 ${(c.monthly_rent / 10000).toLocaleString()}만원`);
});
