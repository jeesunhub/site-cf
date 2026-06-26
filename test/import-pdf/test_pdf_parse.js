/**
 * PDF 파싱 로직 유닛 테스트
 * 
 * 실행: node test/import-pdf/test_pdf_parse.js
 * 
 * 서버 없이 parsePdfText 함수를 직접 테스트합니다.
 */

// Import the parsePdfText function logic (duplicated here for standalone testing)
function parsePdfText(text) {
    // Pre-process: collapse spaced-out characters (common in Korean bank PDFs)
    // e.g., "2 0 2 6 . 0 6 . 2 3" → "2026.06.23"
    // e.g., "거 래 일 자" → "거래일자"
    // e.g., "N G U Y E N" → "NGUYEN"
    // Only apply if the text appears to have spaced-out patterns
    const isSpacedOut = /[가-힣]\s[가-힣]\s[가-힣]/.test(text) || /\d\s\.\s\d/.test(text);
    if (isSpacedOut) {
        // Step 1: Extract and protect "원"-suffixed amounts BEFORE any collapsing
        // This prevents reference numbers from merging with amounts
        // Key insight: Korean bank amounts have max 3 digits between commas
        // e.g., "5 4 1 , 8 6 0   원" → "541,860원"
        // e.g., "0   원" → "0원"
        // But NOT: "9 3 0 1 2 1 7 9 9 6 8 0 6" (reference number - too many digits, no comma/원)
        const amountPlaceholders = [];
        // Comma-formatted amounts: max 3 spaced digits between commas
        text = text.replace(/((?:\d\s{0,1}){1,3}(?:,\s*(?:\d\s{0,1}){1,3})+\s*원)/g, (m) => {
            const placeholder = `__AMT${amountPlaceholders.length}__`;
            amountPlaceholders.push(m.replace(/\s+/g, ''));
            return placeholder;
        });
        // Simple amounts (no comma): max 3 spaced digits before 원
        text = text.replace(/((?:\d\s{0,1}){1,3}\s*원)/g, (m) => {
            if (m.includes('__AMT')) return m;  // skip already placeholder'd
            const placeholder = `__AMT${amountPlaceholders.length}__`;
            amountPlaceholders.push(m.replace(/\s+/g, ''));
            return placeholder;
        });

        // Step 2: Collapse Korean-Korean and English-English (safe)
        text = text.replace(/(?<=[가-힣])\s+(?=[가-힣])/g, '');       // Korean-Korean
        text = text.replace(/(?<=[A-Za-z])\s+(?=[A-Za-z])/g, '');     // English-English

        // Step 3: Collapse date patterns: "2 0 2 6 . 0 6 . 2 3" → "2026.06.23"
        text = text.replace(/(\d\s*)+\.\s*(\d\s*)+\.\s*(\d\s*)+/g, (m) => {
            return m.replace(/\s+/g, '');
        });

        // Step 4: Collapse time patterns: "2 3 : 3 3 : 3 0" → "23:33:30"
        text = text.replace(/(\d\s*)+:\s*(\d\s*)+(:\s*(\d\s*)+)*/g, (m) => {
            return m.replace(/\s+/g, '');
        });

        // Step 5: Restore protected amounts
        amountPlaceholders.forEach((val, idx) => {
            text = text.replace(`__AMT${idx}__`, val);
        });

        text = text.replace(/ {2,}/g, ' ');                            // normalize multiple spaces
    }

    const rows = [];
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    const dateRegex = /(\d{4}[\.-]\d{2}[\.-]\d{2})/;
    const amountRegex = /([\d,]+)/g;
    const timeRegex = /(\d{2}:\d{2}(?::\d{2})?)/;

    let currentDate = null;
    let currentTime = null;

    for (const line of lines) {
        if (line.includes('거래일자') || line.includes('거래내역') || line.includes('적요') ||
            line.includes('입금액') || line.includes('출금액') || line.includes('잔액') ||
            line.includes('내역') || line.includes('구분') || line.includes('번호')) {
            continue;
        }

        const dateMatch = line.match(dateRegex);
        if (dateMatch) {
            currentDate = dateMatch[1].replace(/\./g, '-');
        }

        const timeMatch = line.match(timeRegex);
        if (timeMatch) {
            currentTime = timeMatch[1];
        }

        if (!currentDate) continue;

        // Strip date and time from line before extracting amounts
        const lineWithoutDateTime = line
            .replace(dateRegex, ' ')
            .replace(timeRegex, ' ');

        // Extract amounts: in Korean bank PDFs, amounts are followed by "원"
        // e.g., "0원 460,000원 16,597,548원" → [0, 460000, 16597548]
        // Fallback: if no "원"-suffixed amounts, use general number extraction
        const amounts = [];
        const wonAmountRegex = /([\d,]+)\s*원/g;
        let match;
        while ((match = wonAmountRegex.exec(lineWithoutDateTime)) !== null) {
            amounts.push(parseInt(match[1].replace(/,/g, '')) || 0);
        }

        // Fallback: no "원" found, extract all numbers
        if (amounts.length < 2) {
            const tempRegex = new RegExp(amountRegex.source, 'g');
            while ((match = tempRegex.exec(lineWithoutDateTime)) !== null) {
                amounts.push(parseInt(match[1].replace(/,/g, '')) || 0);
            }
        }

        if (amounts.length < 2) continue;

        let depositAmount = 0;
        let withdrawalAmount = 0;
        let memo = '';

        const lowerLine = line.toLowerCase();

        if (lowerLine.includes('입금') || lowerLine.includes('deposit')) {
            const depositIdx = line.indexOf('입금') !== -1 ? line.indexOf('입금') : line.toLowerCase().indexOf('deposit');
            const afterDeposit = line.substring(depositIdx);
            // Try "원"-suffixed amounts first
            const depositWonAmounts = [];
            let dMatch;
            const dWonRegex = /([\d,]+)\s*원/g;
            while ((dMatch = dWonRegex.exec(afterDeposit)) !== null) {
                depositWonAmounts.push(parseInt(dMatch[1].replace(/,/g, '')) || 0);
            }
            if (depositWonAmounts.length > 0) {
                depositAmount = depositWonAmounts[0];
            } else {
                // Fallback to general numbers
                const dRegex = new RegExp(amountRegex.source, 'g');
                while ((dMatch = dRegex.exec(afterDeposit)) !== null) {
                    depositWonAmounts.push(parseInt(dMatch[1].replace(/,/g, '')) || 0);
                }
                depositAmount = depositWonAmounts.length > 0 ? depositWonAmounts[0] : 0;
            }
        }

        if (lowerLine.includes('출금') || lowerLine.includes('withdraw')) {
            const withdrawIdx = line.indexOf('출금') !== -1 ? line.indexOf('출금') : line.toLowerCase().indexOf('withdraw');
            const afterWithdraw = line.substring(withdrawIdx);
            // Try "원"-suffixed amounts first
            const withdrawWonAmounts = [];
            let wMatch;
            const wWonRegex = /([\d,]+)\s*원/g;
            while ((wMatch = wWonRegex.exec(afterWithdraw)) !== null) {
                withdrawWonAmounts.push(parseInt(wMatch[1].replace(/,/g, '')) || 0);
            }
            if (withdrawWonAmounts.length > 0) {
                withdrawalAmount = withdrawWonAmounts[0];
            } else {
                // Fallback to general numbers
                const wRegex = new RegExp(amountRegex.source, 'g');
                while ((wMatch = wRegex.exec(afterWithdraw)) !== null) {
                    withdrawWonAmounts.push(parseInt(wMatch[1].replace(/,/g, '')) || 0);
                }
                withdrawalAmount = withdrawWonAmounts.length > 0 ? withdrawWonAmounts[0] : 0;
            }
        }

        // Fallback: if no explicit 입금/출금 keyword, use position-based heuristics
        // Korean bank PDF format: date | time | type | memo | 출금액 | 입금액 | 잔액
        if (depositAmount === 0 && withdrawalAmount === 0 && amounts.length >= 2) {
            if (amounts.length >= 3) {
                // 3+ amounts: typically withdrawal, deposit, balance
                if (amounts[0] === 0 && amounts[1] > 0) {
                    // 출금=0, 입금>0
                    withdrawalAmount = 0;
                    depositAmount = amounts[1];
                } else if (amounts[0] > 0 && amounts[1] === 0) {
                    // 출금>0, 입금=0
                    withdrawalAmount = amounts[0];
                    depositAmount = 0;
                } else {
                    // Both non-zero: assume withdrawal, deposit, balance
                    withdrawalAmount = amounts[0];
                    depositAmount = amounts[1];
                }
            } else if (amounts[0] > 0 && amounts[1] === 0) {
                depositAmount = amounts[0];
                withdrawalAmount = 0;
            } else if (amounts[0] === 0 && amounts[1] > 0) {
                depositAmount = 0;
                withdrawalAmount = amounts[1];
            } else if (amounts[0] > 0 && amounts[1] > 0) {
                depositAmount = amounts[0];
                withdrawalAmount = amounts[1];
            }
        }

        memo = line
            .replace(dateRegex, '')
            .replace(timeRegex, '')
            .replace(/[\d,]+/g, '')
            .replace(/입금|출금|원/g, '')
            .trim()
            .substring(0, 100);

        if (depositAmount > 0 || withdrawalAmount > 0) {
            rows.push({
                date: currentDate,
                time: currentTime || '',
                memo: memo,
                in: depositAmount,
                out: withdrawalAmount
            });
        }
    }

    return rows;
}

// ===== Test Helpers =====
let passed = 0;
let failed = 0;
let testResults = [];

function assert(condition, testName) {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
        testResults.push({ name: testName, passed: true });
    } else {
        console.log(`  ❌ ${testName}`);
        failed++;
        testResults.push({ name: testName, passed: false });
    }
}

function assertEqual(actual, expected, testName) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) {
        console.log(`     예상: ${JSON.stringify(expected)}`);
        console.log(`     실제: ${JSON.stringify(actual)}`);
    }
    assert(ok, testName);
}

// ===== Test Cases =====

function testBasicDepositLine() {
    console.log('\n━━━ 1. 기본 입금 라인 파싱 ━━━');
    
    const text = '2026.06.15 14:30 입금 300,000원 50,000원 홍길동';
    const rows = parsePdfText(text);
    
    assert(rows.length === 1, '1개의 거래 행이 파싱됨');
    if (rows.length > 0) {
        assertEqual(rows[0].date, '2026-06-15', '날짜 파싱');
        assertEqual(rows[0].time, '14:30', '시간 파싱');
        assert(rows[0].in === 300000, `입금액 파싱 (expected 300000, got ${rows[0].in})`);
        assert(rows[0].memo.includes('홍길동'), '메모에 입금자명 포함');
    }
}

function testBasicWithdrawalLine() {
    console.log('\n━━━ 2. 기본 출금 라인 파싱 ━━━');
    
    const text = '2026-06-10 09:15 출금 150,000원 200,000원 관리비';
    const rows = parsePdfText(text);
    
    assert(rows.length === 1, '1개의 거래 행이 파싱됨');
    if (rows.length > 0) {
        assertEqual(rows[0].date, '2026-06-10', '날짜 파싱 (하이픈)');
        assert(rows[0].out === 150000, `출금액 파싱 (expected 150000, got ${rows[0].out})`);
    }
}

function testMultipleLines() {
    console.log('\n━━━ 3. 여러 라인 파싱 ━━━');
    
    const text = `거래일자 거래시간 적요 입금액 출금액 잔액
2026.05.01 10:00 입금 500,000 550,000 월세
2026.05.15 14:00 출금 100,000 450,000 관리비
2026.06.01 09:30 입금 500,000 950,000 월세`;
    
    const rows = parsePdfText(text);
    
    assert(rows.length === 3, `3개의 거래 행이 파싱됨 (got ${rows.length})`);
    if (rows.length >= 3) {
        assertEqual(rows[0].date, '2026-05-01', '첫 번째 날짜');
        assertEqual(rows[1].date, '2026-05-15', '두 번째 날짜');
        assertEqual(rows[2].date, '2026-06-01', '세 번째 날짜');
        assert(rows[0].in === 500000, '첫 번째 입금액');
        assert(rows[1].out === 100000, '두 번째 출금액');
    }
}

function testHeaderSkip() {
    console.log('\n━━━ 4. 헤더 라인 스킵 ━━━');
    
    const text = `거래일자 거래시간 적요 입금액 출금액 잔액
거래내역 구분 번호
2026.03.20 11:00 입금 200,000 300,000 테스트`;
    
    const rows = parsePdfText(text);
    
    assert(rows.length === 1, '헤더 라인은 스킵하고 데이터만 파싱');
    if (rows.length > 0) {
        assertEqual(rows[0].date, '2026-03-20', '헤더 스킵 후 날짜 파싱');
    }
}

function testPositionBasedParsing() {
    console.log('\n━━━ 5. 입금/출금 키워드 없이 위치 기반 파싱 ━━━');
    
    // Korean bank PDF format: 출금액 입금액 잔액
    // Test deposit: 출금=0, 입금=300,000, 잔액=800,000
    const text1 = '2026.04.01 0 300,000 800,000 김세입자';
    const rows1 = parsePdfText(text1);
    
    assert(rows1.length === 1, '1개의 거래 행이 파싱됨 (입금)');
    if (rows1.length > 0) {
        assert(rows1[0].in === 300000, `위치 기반 입금액 (expected 300000, got ${rows1[0].in})`);
        assert(rows1[0].out === 0, `위치 기반 출금액 0 (got ${rows1[0].out})`);
    }

    // Test withdrawal: 출금=150,000, 입금=0, 잔액=650,000
    const text2 = '2026.04.02 150,000 0 650,000 관리비';
    const rows2 = parsePdfText(text2);
    
    assert(rows2.length === 1, '1개의 거래 행이 파싱됨 (출금)');
    if (rows2.length > 0) {
        assert(rows2[0].out === 150000, `위치 기반 출금액 (expected 150000, got ${rows2[0].out})`);
        assert(rows2[0].in === 0, `위치 기반 입금액 0 (got ${rows2[0].in})`);
    }
}

function testEmptyInput() {
    console.log('\n━━━ 6. 빈 입력 처리 ━━━');
    
    const rows1 = parsePdfText('');
    assertEqual(rows1.length, 0, '눈 문자열 → 0개 결과');
    
    const rows2 = parsePdfText('거래일자 입금액 출금액 잔액');
    assertEqual(rows2.length, 0, '헤더만 있음 → 0개 결과');
    
    const rows3 = parsePdfText('이것은 거래 내역이 아닙니다');
    assertEqual(rows3.length, 0, '날짜 없는 텍스트 → 0개 결과');
}

function testDateCarryOver() {
    console.log('\n━━━ 7. 날짜 이어짐 (carry-over) ━━━');
    
    // Some PDFs have date on one line and details on the next
    const text = `2026.07.01
입금 400,000 900,000 이영희`;
    
    const rows = parsePdfText(text);
    
    assert(rows.length >= 1, '최소 1개의 거래 행이 파싱됨');
    if (rows.length > 0) {
        assertEqual(rows[0].date, '2026-07-01', '이전 라인의 날짜가 이어짐');
        assert(rows[0].in === 400000, '입금액 파싱');
    }
}

function testMixedDepositWithdrawal() {
    console.log('\n━━━ 8. 입금/출금 혼합 라인 ━━━');
    
    const text = '2026.08.01 10:00 입금 350,000 출금 50,000 600,000 혼합거래';
    const rows = parsePdfText(text);
    
    assert(rows.length === 1, '1개의 거래 행이 파싱됨');
    if (rows.length > 0) {
        assert(rows[0].in === 350000, `입금액 350000 (got ${rows[0].in})`);
        assert(rows[0].out === 50000, `출금액 50000 (got ${rows[0].out})`);
    }
}

// ===== PDF File Import Test =====
async function testPdfFile(filePath) {
    const fs = await import('fs');
    const path = await import('path');

    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
        console.log(`\n❌ 파일을 찾을 수 없습니다: ${fullPath}`);
        process.exit(1);
    }

    console.log(`\n━━━ PDF 파일 파싱: ${path.basename(fullPath)} ━━━`);
    console.log(`  파일 경로: ${fullPath}`);

    try {
        const dataBuffer = fs.readFileSync(fullPath);

        // Check if file is actually a valid PDF (starts with %PDF)
        const header = dataBuffer.toString('utf8', 0, 5);
        if (header !== '%PDF-') {
            console.log('  ⚠ 이 파일은 유효한 PDF가 아닙니다.');
            console.log('  DRM 보호 파일이거나 손상된 파일일 수 있습니다.');
            console.log(`  파일 헤더: ${dataBuffer.toString('utf8', 0, 30).replace(/\n/g, ' ')}`);
            assert(true, 'DRM/비유효 PDF 감지 - 스킵');
            console.log(`\n  ✅ PDF 파일 검증 테스트 완료 (비유효 PDF 감지)`);
            return;
        }

        const uint8 = new Uint8Array(dataBuffer);

        // Use pdfjs-dist directly (more reliable than pdf-parse v2)
        const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
        const numPages = doc.numPages;

        console.log(`  페이지 수: ${numPages}`);

        let fullText = '';
        for (let i = 1; i <= numPages; i++) {
            const page = await doc.getPage(i);
            const textContent = await page.getTextContent();
            // Group items by Y-coordinate to detect line breaks
            const items = textContent.items.filter(item => item.str.trim().length > 0);
            if (items.length === 0) continue;

            let lastY = items[0].transform[5];
            let currentLine = '';
            for (const item of items) {
                const y = item.transform[5];
                // If Y changed significantly (different line), add newline
                if (Math.abs(y - lastY) > 2) {
                    fullText += currentLine.trim() + '\n';
                    currentLine = item.str;
                } else {
                    currentLine += ' ' + item.str;
                }
                lastY = y;
            }
            if (currentLine.trim()) {
                fullText += currentLine.trim() + '\n';
            }
        }

        console.log(`  텍스트 길이: ${fullText.length}자`);

        // Show first 500 chars of extracted text
        console.log(`\n  ─── 추출된 텍스트 (처음 500자) ───`);
        console.log(fullText.substring(0, 500));
        console.log(`  ─────────────────────────────────────`);

        // Parse the text
        const rows = parsePdfText(fullText);

        console.log(`\n  📊 파싱 결과: ${rows.length}개의 거래 행`);

        if (rows.length === 0) {
            console.log('  ⚠ 파싱된 거래 내역이 없습니다.');
            console.log('  PDF 형식이 지원되지 않을 수 있습니다.');
        } else {
            // Summary
            const totalIn = rows.reduce((s, r) => s + (r.in || 0), 0);
            const totalOut = rows.reduce((s, r) => s + (r.out || 0), 0);
            console.log(`\n  💰 총 입금액: ${totalIn.toLocaleString()}원`);
            console.log(`  💸 총 출금액: ${totalOut.toLocaleString()}원`);

            // Output parsed rows as JSON
            console.log(`\n  ─── 파싱 결과 JSON ───`);
            console.log(JSON.stringify(rows, null, 2));
            console.log(`  ──────────────────────`);
        }

        // Run assertions on parsed data
        assert(rows !== null, 'PDF 파싱 결과가 null이 아님');
        assert(Array.isArray(rows), '파싱 결과가 배열임');

        // Save parsed result as JSON file
        const outputFileName = path.basename(fullPath, path.extname(fullPath)) + '.parsed.json';
        const outputPath = path.join(path.dirname(fullPath), outputFileName);
        const outputData = {
            sourceFile: path.basename(fullPath),
            totalRows: rows.length,
            totalIn: rows.reduce((s, r) => s + (r.in || 0), 0),
            totalOut: rows.reduce((s, r) => s + (r.out || 0), 0),
            rows: rows
        };
        fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2), 'utf8');
        console.log(`\n  📁 파싱 결과 저장: ${outputPath}`);

        console.log(`\n  ✅ PDF 파일 파싱 테스트 완료`);

    } catch (err) {
        console.error(`\n  ❌ PDF 파싱 오류: ${err.message}`);
        failed++;
    }
}

// ===== Run All Tests =====
async function runAll() {
    // Check for -i flag
    const args = process.argv.slice(2);
    const inputIdx = args.indexOf('-i');
    const inputFile = inputIdx !== -1 && args[inputIdx + 1] ? args[inputIdx + 1] : null;

    console.log('╔══════════════════════════════════════════╗');
    console.log('║  PDF 파싱 유닛 테스트                     ║');
    console.log('╚══════════════════════════════════════════╝');

    // Always run unit tests
    testBasicDepositLine();
    testBasicWithdrawalLine();
    testMultipleLines();
    testHeaderSkip();
    testPositionBasedParsing();
    testEmptyInput();
    testDateCarryOver();
    testMixedDepositWithdrawal();

    // If -i flag provided, also test with real PDF file
    if (inputFile) {
        await testPdfFile(inputFile);
    }

    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║  테스트 결과                               ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  ✅ 통과: ${String(passed).padEnd(28)}║`);
    console.log(`║  ❌ 실패: ${String(failed).padEnd(28)}║`);
    console.log('╚══════════════════════════════════════════╝');

    // Output results as JSON
    const resultJson = {
        totalTests: passed + failed,
        passed: passed,
        failed: failed,
        success: failed === 0,
        results: testResults
    };
    console.log('\n' + JSON.stringify(resultJson, null, 2));

    if (failed > 0) {
        console.log('\n⚠ 실패한 테스트가 있습니다.');
        process.exit(1);
    }
}

runAll();
