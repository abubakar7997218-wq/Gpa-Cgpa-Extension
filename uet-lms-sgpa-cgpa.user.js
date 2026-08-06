// ==UserScript==
// @name         UET LMS - SGPA & CGPA Auto Calculator
// @namespace    https://lms.uet.edu.pk/
// @version      2.0
// @description  Student DMC page ke Course Result table ke andar, har semester khatam hone ke baad, ek line mein us semester ka SGPA aur us tak ka running CGPA dikhata hai.
// @author       You
// @match        https://lms.uet.edu.pk/*
// @match        https://lms.uet.pk/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/abubakar7997218-wq/Gpa-Cgpa-Extension/main/uet-lms-sgpa-cgpa.user.js
// @downloadURL  https://raw.githubusercontent.com/abubakar7997218-wq/Gpa-Cgpa-Extension/main/uet-lms-sgpa-cgpa.user.js
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        maxWaitMs: 20000,     // kitni der tak table dhoondhna hai (ms)
        pollInterval: 500,    // poll interval fallback (ms)
        injectedMarker: 'sgpaCgpaInjected',
        colorConfirmed: '#dc2626',  // red - jab semester ke saare subjects "Confirmed" hon
        colorPending: '#111827'     // black - jab semester abhi "Provisional"/ongoing ho
    };

    function log(...args) {
        console.log('[UET SGPA/CGPA]', ...args);
    }

    // Header text ko compare karne ke liye normalize
    function normalizeHeader(str) {
        return (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    // Cell text ke liye normalize (case preserve)
    function normalizeText(str) {
        return (str || '').replace(/\s+/g, ' ').trim();
    }

    // Table ke andar asal column-header wali row dhoondo. Kabhi kabhi pehli
    // row sirf ek title/caption hoti hai (jese "Course Result"), asal
    // headers (Semester/CH/GP) neeche wali kisi row mein hote hain — is liye
    // saari rows scan karte hain, sirf pehli nahi.
    function findHeaderRow(table) {
        const rows = Array.from(table.querySelectorAll('tr')).slice(0, 10); // shuru ki 10 rows kaafi hain
        for (const row of rows) {
            const cells = Array.from(row.querySelectorAll('th, td')).map(td => normalizeHeader(td.textContent));
            const hasSemester = cells.some(h => h.includes('semester') && !h.includes('summary'));
            const hasCH = cells.some(h => h === 'ch' || h.includes('credit'));
            const hasGP = cells.some(h => h === 'gp' || h.includes('grade point'));
            if (hasSemester && hasCH && hasGP) {
                return row;
            }
        }
        return null;
    }

    // Ek table ka header check karo ke wo results table hai ya nahi
    function tableMatches(table) {
        return findHeaderRow(table) !== null;
    }

    // Page par se DMC results table dhoondo (nested/wrapper tables ki wajah se
    // sabse "andar wala" matching table choose karta hai, kyunke Odoo LMS
    // page mein bade layout tables ke andar asal data table nested hoti hai)
    function findResultsTable() {
        const tables = Array.from(document.querySelectorAll('table'));
        const candidates = tables.filter(tableMatches);
        if (!candidates.length) return null;

        // Outer wrapper tables ko hata do (jo kisi doosre candidate table ko
        // apne andar contain karte hain) — sirf innermost table rakho
        const innermost = candidates.filter(
            t => !candidates.some(other => other !== t && t.contains(other))
        );

        const pool = innermost.length ? innermost : candidates;

        // Agar phir bhi ek se zyada bachein, sabse zyada rows wali table lo
        pool.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length);

        return pool[0];
    }

    // Header text se relevant columns ke index nikalo (dynamic - order kuch bhi ho chal jayega)
    function getColumnIndices(table) {
        const headerRow = findHeaderRow(table);
        if (!headerRow) return null;
        const headerCells = Array.from(headerRow.querySelectorAll('th, td')).map(td => normalizeHeader(td.textContent));

        const findIndex = (predicates) => {
            for (let i = 0; i < headerCells.length; i++) {
                for (const p of predicates) {
                    if (p(headerCells[i])) return i;
                }
            }
            return -1;
        };

        return {
            headerRow,
            columnCount: headerCells.length,
            semesterIdx: findIndex([h => h.includes('semester')]),
            chIdx: findIndex([h => h === 'ch', h => h.includes('credit')]),
            gpIdx: findIndex([h => h === 'gp', h => h.includes('grade point')]),
            subjectIdx: findIndex([h => h.includes('subject'), h => h.includes('course')]),
            gradeIdx: findIndex([h => h === 'grade']),
            statusIdx: findIndex([h => h.includes('status')])
        };
    }

    function parseNumber(text) {
        const n = parseFloat((text || '').replace(/[^\d.\-]/g, ''));
        return isNaN(n) ? null : n;
    }

    // Ek semester-summary row banao aur di gayi row ke turant baad insert karo
    function insertSummaryRow(afterRow, columnCount, semesterName, sgpa, cgpa, allConfirmed) {
        const tr = document.createElement('tr');
        tr.className = 'uet-sgpa-cgpa-summary-row';

        const td = document.createElement('td');
        td.colSpan = columnCount;
        td.style.cssText = `
            padding: 8px 10px;
            background: #f1f5f9;
            border-top: 1px solid #cbd5e1;
            border-bottom: 1px solid #cbd5e1;
            font-weight: 700;
            font-size: 13px;
        `;

        const color = allConfirmed ? CONFIG.colorConfirmed : CONFIG.colorPending;
        td.innerHTML = `<span style="color:${color};">${semesterName} &nbsp;—&nbsp; SGPA: ${sgpa} &nbsp;|&nbsp; CGPA: ${cgpa}</span>`;

        tr.appendChild(td);
        afterRow.parentNode.insertBefore(tr, afterRow.nextSibling);
    }

    // Table ki data rows ko semester-wise process karke, har semester ke
    // aakhri subject row ke turant baad ek summary row insert karta hai
    function injectInlineSummaries(table, cols) {
        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        const allRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(1);
        const dataRows = allRows.filter(row => row !== cols.headerRow);

        let blockCH = 0, blockGP = 0;
        let cumCH = 0, cumGP = 0;
        let currentSemester = null;
        let blockStatuses = [];
        let lastRowOfBlock = null;
        let semestersProcessed = 0;

        dataRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (!cells.length) return;

            const semesterName = normalizeText(cells[cols.semesterIdx]?.textContent);
            const ch = parseNumber(cells[cols.chIdx]?.textContent);
            const gp = parseNumber(cells[cols.gpIdx]?.textContent);
            const status = cols.statusIdx !== -1 ? normalizeText(cells[cols.statusIdx]?.textContent) : '';

            // Invalid/junk row (jese blank spacer row) - skip karo
            if (!semesterName || ch === null || gp === null) return;

            if (currentSemester === null) {
                currentSemester = semesterName;
            } else if (semesterName !== currentSemester) {
                // Pichla semester khatam ho gaya - uski summary row insert karo
                const sgpa = blockCH > 0 ? (blockGP / blockCH).toFixed(2) : '0.00';
                const cgpa = cumCH > 0 ? (cumGP / cumCH).toFixed(2) : '0.00';
                const allConfirmed = blockStatuses.length > 0 && blockStatuses.every(s => s.toLowerCase() === 'confirmed');
                insertSummaryRow(lastRowOfBlock, cols.columnCount, currentSemester, sgpa, cgpa, allConfirmed);
                semestersProcessed++;

                // Naye semester ke liye reset
                blockCH = 0;
                blockGP = 0;
                blockStatuses = [];
                currentSemester = semesterName;
            }

            blockCH += ch;
            blockGP += gp;
            cumCH += ch;
            cumGP += gp;
            blockStatuses.push(status);
            lastRowOfBlock = row;
        });

        // Aakhri semester ki summary bhi insert karo
        if (currentSemester !== null && lastRowOfBlock) {
            const sgpa = blockCH > 0 ? (blockGP / blockCH).toFixed(2) : '0.00';
            const cgpa = cumCH > 0 ? (cumGP / cumCH).toFixed(2) : '0.00';
            const allConfirmed = blockStatuses.length > 0 && blockStatuses.every(s => s.toLowerCase() === 'confirmed');
            insertSummaryRow(lastRowOfBlock, cols.columnCount, currentSemester, sgpa, cgpa, allConfirmed);
            semestersProcessed++;
        }

        return semestersProcessed;
    }

    function run() {
        const table = findResultsTable();
        if (!table) {
            log('Results table abhi nahi mila.');
            return false;
        }

        // Agar is table mein pehle hi summary rows daal chuke hain, dobara mat daalo
        if (table.dataset[CONFIG.injectedMarker] === 'true') {
            return true;
        }

        const cols = getColumnIndices(table);
        if (!cols || cols.semesterIdx === -1 || cols.chIdx === -1 || cols.gpIdx === -1) {
            log('Zaroori columns (Semester/CH/GP) table mein nahi milay.');
            return false;
        }

        const count = injectInlineSummaries(table, cols);
        if (count === 0) {
            log('Abhi koi valid row parse nahi hui.');
            return false;
        }

        table.dataset[CONFIG.injectedMarker] = 'true';
        log(`${count} semester summary row(s) inject ho gayin.`);
        return true;
    }

    // Pehle turant try karo, phir DOM changes observe karo, aur timeout tak poll bhi karo
    let done = run();

    if (!done) {
        const observer = new MutationObserver(() => {
            if (done) return;
            done = run();
            if (done) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const startTime = Date.now();
        const poll = setInterval(() => {
            if (done || Date.now() - startTime > CONFIG.maxWaitMs) {
                clearInterval(poll);
                observer.disconnect();
                return;
            }
            done = run();
        }, CONFIG.pollInterval);
    }
})();
