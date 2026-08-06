// ==UserScript==
// @name         UET LMS - SGPA & CGPA Auto Calculator
// @namespace    https://lms.uet.edu.pk/
// @version      3.0
// @description  Student DMC page ke Course Result table ko semester-wise group karke, har semester ke baad SGPA/CGPA ki line dikhata hai. "Show Semester Summary" jaisi buttons se table shuffle ho jaye to bhi khud theek kar deta hai.
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
        debounceMs: 350,           // DOM change ke baad kitna wait kar ke reprocess karein
        maxInitialWaitMs: 20000,   // shuru mein table dhoondhne ki max koshish (ms)
        summaryRowClass: 'uet-sgpa-cgpa-summary-row',
        colorConfirmed: '#dc2626', // red - jab semester ke saare subjects "Confirmed" hon
        colorPending: '#111827'    // black - jab semester abhi "Provisional"/ongoing ho
    };

    let lastSignature = null;
    let debounceTimer = null;
    let isProcessing = false;

    function log(...args) {
        console.log('[UET SGPA/CGPA]', ...args);
    }

    function normalizeHeader(str) {
        return (str || '').replace(/\s+/g, ' ').trim().toLowerCase();
    }

    function normalizeText(str) {
        return (str || '').replace(/\s+/g, ' ').trim();
    }

    function parseNumber(text) {
        const n = parseFloat((text || '').replace(/[^\d.\-]/g, ''));
        return isNaN(n) ? null : n;
    }

    // Table ke andar asal column-header wali row dhoondo (humari khud ki
    // summary rows ko ignore karte hue, warna wo bhi galti se header ban sakti hain)
    function findHeaderRow(table) {
        const rows = Array.from(table.querySelectorAll('tr')).slice(0, 10);
        for (const row of rows) {
            if (row.classList.contains(CONFIG.summaryRowClass)) continue;
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

    function tableMatches(table) {
        return findHeaderRow(table) !== null;
    }

    // Nested/wrapper tables ki wajah se sabse "andar wala" matching table dhoondo
    function findResultsTable() {
        const tables = Array.from(document.querySelectorAll('table'));
        const candidates = tables.filter(tableMatches);
        if (!candidates.length) return null;

        const innermost = candidates.filter(
            t => !candidates.some(other => other !== t && t.contains(other))
        );

        const pool = innermost.length ? innermost : candidates;
        pool.sort((a, b) => b.querySelectorAll('tr').length - a.querySelectorAll('tr').length);

        return pool[0];
    }

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
            statusIdx: findIndex([h => h.includes('status')])
        };
    }

    // Table ki saari (valid) data rows nikalo, apni khud ki summary rows aur
    // header row ko chhod kar
    function getDataRows(table, cols) {
        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        const allRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(1);
        return allRows.filter(row => row !== cols.headerRow && !row.classList.contains(CONFIG.summaryRowClass));
    }

    // Har row se semester/ch/gp/status parh kar { row, semesterName, ch, gp, status } return karo
    // Invalid/junk rows (jese blank spacer row) ke liye null
    function parseRow(row, cols) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (!cells.length) return null;

        const semesterName = normalizeText(cells[cols.semesterIdx]?.textContent);
        const ch = parseNumber(cells[cols.chIdx]?.textContent);
        const gp = parseNumber(cells[cols.gpIdx]?.textContent);
        const status = cols.statusIdx !== -1 ? normalizeText(cells[cols.statusIdx]?.textContent) : '';

        if (!semesterName || ch === null || gp === null) return null;
        return { row, semesterName, ch, gp, status };
    }

    // Order-independent "signature" banata hai taake pata chal sake ke asal
    // mein data change hua hai ya sirf order shuffle hui hai
    function buildSignature(entries) {
        return entries
            .map(e => `${e.semesterName}|${e.ch}|${e.gp}|${e.status}`)
            .sort()
            .join(';');
    }

    function insertSummaryRow(afterRow, columnCount, semesterName, sgpa, cgpa, allConfirmed) {
        const tr = document.createElement('tr');
        tr.className = CONFIG.summaryRowClass;

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

    // Rows ko semester-wise group karke, table ke andar physically wapis
    // tarteeb (group) mein laga deta hai (chahe original order mixed ho),
    // phir har group ke baad summary row insert karta hai
    function regroupAndInject(table, cols, entries) {
        // Purani summary rows hata do (fresh insert karenge)
        table.querySelectorAll('.' + CONFIG.summaryRowClass).forEach(r => r.remove());

        const semesterOrder = [];
        const groups = new Map();

        entries.forEach(e => {
            if (!groups.has(e.semesterName)) {
                groups.set(e.semesterName, { rows: [], ch: 0, gp: 0, statuses: [] });
                semesterOrder.push(e.semesterName);
            }
            const g = groups.get(e.semesterName);
            g.rows.push(e.row);
            g.ch += e.ch;
            g.gp += e.gp;
            g.statuses.push(e.status);
        });

        if (!semesterOrder.length) return 0;

        // Ek marker (comment node) pehli data-row ki jagah pe rakho, phir har
        // group ki rows ko tarteeb se usi marker se pehle move kar do
        const firstRow = groups.get(semesterOrder[0]).rows[0];
        const parent = firstRow.parentNode;
        const marker = document.createComment('uet-sgpa-cgpa-anchor');
        parent.insertBefore(marker, firstRow);

        let cumCH = 0, cumGP = 0;

        semesterOrder.forEach(semName => {
            const g = groups.get(semName);
            g.rows.forEach(r => parent.insertBefore(r, marker));

            cumCH += g.ch;
            cumGP += g.gp;

            const sgpa = g.ch > 0 ? (g.gp / g.ch).toFixed(2) : '0.00';
            const cgpa = cumCH > 0 ? (cumGP / cumCH).toFixed(2) : '0.00';
            const allConfirmed = g.statuses.length > 0 && g.statuses.every(s => s.toLowerCase() === 'confirmed');

            const lastRow = g.rows[g.rows.length - 1];
            insertSummaryRow(lastRow, cols.columnCount, semName, sgpa, cgpa, allConfirmed);
        });

        parent.removeChild(marker);

        return semesterOrder.length;
    }

    function runOnce() {
        const table = findResultsTable();
        if (!table) {
            log('Results table abhi nahi mila.');
            return;
        }

        const cols = getColumnIndices(table);
        if (!cols || cols.semesterIdx === -1 || cols.chIdx === -1 || cols.gpIdx === -1) {
            log('Zaroori columns (Semester/CH/GP) table mein nahi milay.');
            return;
        }

        const dataRows = getDataRows(table, cols);
        const entries = dataRows.map(row => parseRow(row, cols)).filter(Boolean);
        if (!entries.length) {
            log('Abhi koi valid row parse nahi hui.');
            return;
        }

        const signature = buildSignature(entries);
        const summaryRowsPresent = table.querySelectorAll('.' + CONFIG.summaryRowClass).length > 0;

        // Agar data pehle jaisa hi hai AUR summary rows already lagi hui hain, kuch mat karo
        if (signature === lastSignature && summaryRowsPresent) {
            return;
        }

        const count = regroupAndInject(table, cols, entries);
        lastSignature = signature;
        log(`${count} semester summary row(s) inject/update ho gayin.`);
    }

    function scheduleRun() {
        if (isProcessing) return;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            isProcessing = true;
            try {
                runOnce();
            } finally {
                isProcessing = false;
            }
        }, CONFIG.debounceMs);
    }

    // Shuru mein turant try karo
    scheduleRun();

    // Har DOM change pe (jese "Show Semester Summary" click, tab switch,
    // AJAX refresh) dobara check karo aur zaroorat ho to theek kar do
    const observer = new MutationObserver(() => scheduleRun());
    observer.observe(document.body, { childList: true, subtree: true });

    // Safety net: shuru ke 20 second tak thora poll bhi karte raho, taake
    // agar koi mutation miss ho jaye to bhi table mil jaye
    const startTime = Date.now();
    const poll = setInterval(() => {
        if (Date.now() - startTime > CONFIG.maxInitialWaitMs) {
            clearInterval(poll);
            return;
        }
        scheduleRun();
    }, 1000);
})();
