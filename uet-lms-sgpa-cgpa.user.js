// ==UserScript==
// @name         UET LMS - SGPA & CGPA Auto Calculator
// @namespace    https://lms.uet.edu.pk/
// @version      1.0
// @description  Student DMC page se data parh kar har semester ka SGPA aur running CGPA calculate karta hai, aur ek summary card show karta hai.
// @author       You
// @match        https://lms.uet.edu.pk/*
// @match        https://lms.uet.pk/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const CONFIG = {
        maxWaitMs: 20000,     // kitni der tak table dhoondhna hai (ms)
        pollInterval: 500,    // poll interval fallback (ms)
        cardId: 'uet-sgpa-cgpa-summary-card'
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

    // Page par se DMC results table dhoondo (header match kar ke)
    function findResultsTable() {
        const tables = Array.from(document.querySelectorAll('table'));
        for (const table of tables) {
            const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
            if (!headerRow) continue;
            const headerCells = Array.from(headerRow.querySelectorAll('th, td')).map(td => normalizeHeader(td.textContent));

            const hasSemester = headerCells.some(h => h.includes('semester'));
            const hasCH = headerCells.some(h => h === 'ch' || h.includes('credit'));
            const hasGP = headerCells.some(h => h === 'gp' || h.includes('grade point'));

            if (hasSemester && hasCH && hasGP) {
                return table;
            }
        }
        return null;
    }

    // Header text se relevant columns ke index nikalo (dynamic - order kuch bhi ho chal jayega)
    function getColumnIndices(table) {
        const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
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

    // Table ki har row parh kar semester-wise CH/GP jama karo
    function extractData(table, cols) {
        const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
        const rows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(1);

        const semesters = [];       // order jis tarah semester pehli baar mila
        const semesterData = {};    // name -> { ch, gp, count }

        rows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td'));
            if (!cells.length) return;

            const semesterName = normalizeText(cells[cols.semesterIdx]?.textContent);
            const ch = parseNumber(cells[cols.chIdx]?.textContent);
            const gp = parseNumber(cells[cols.gpIdx]?.textContent);

            // Agar semester name, CH ya GP na mile to row skip (junk/merged rows)
            if (!semesterName || ch === null || gp === null) return;

            if (!semesterData[semesterName]) {
                semesterData[semesterName] = { ch: 0, gp: 0, count: 0 };
                semesters.push(semesterName);
            }

            semesterData[semesterName].ch += ch;
            semesterData[semesterName].gp += gp;
            semesterData[semesterName].count += 1;
        });

        return { semesters, semesterData };
    }

    // Har semester ka SGPA + us tak running CGPA nikalo
    function computeResults(semesters, semesterData) {
        let cumCH = 0;
        let cumGP = 0;
        const results = [];

        semesters.forEach(sem => {
            const { ch, gp } = semesterData[sem];
            const sgpa = ch > 0 ? (gp / ch) : 0;

            cumCH += ch;
            cumGP += gp;
            const cgpa = cumCH > 0 ? (cumGP / cumCH) : 0;

            results.push({
                semester: sem,
                sgpa: sgpa.toFixed(2),
                cgpa: cgpa.toFixed(2),
                ch,
                gp: gp.toFixed(2)
            });
        });

        return {
            results,
            overallCGPA: cumCH > 0 ? (cumGP / cumCH).toFixed(2) : '0.00',
            totalCH: cumCH
        };
    }

    function buildCard(data) {
        const existing = document.getElementById(CONFIG.cardId);
        if (existing) existing.remove();

        const card = document.createElement('div');
        card.id = CONFIG.cardId;
        card.style.cssText = `
            font-family: 'Segoe UI', Roboto, Arial, sans-serif;
            background: linear-gradient(135deg, #1f2937, #111827);
            color: #f3f4f6;
            border: 1px solid #374151;
            border-radius: 12px;
            padding: 18px 20px;
            margin: 16px 0;
            box-shadow: 0 4px 14px rgba(0,0,0,0.35);
            max-width: 700px;
        `;

        let html = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <h2 style="margin:0; font-size:18px; color:#facc15;">📊 SGPA / CGPA Summary</h2>
                <span style="font-size:12px; color:#9ca3af;">Auto-calculated</span>
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:14px;">
                <thead>
                    <tr style="text-align:left; border-bottom:1px solid #374151;">
                        <th style="padding:6px 4px;">Semester</th>
                        <th style="padding:6px 4px;">CH</th>
                        <th style="padding:6px 4px;">SGPA</th>
                        <th style="padding:6px 4px;">CGPA</th>
                    </tr>
                </thead>
                <tbody>
        `;

        data.results.forEach(r => {
            html += `
                <tr style="border-bottom:1px solid #27303f;">
                    <td style="padding:6px 4px; font-weight:600; color:#93c5fd;">${r.semester}</td>
                    <td style="padding:6px 4px;">${r.ch}</td>
                    <td style="padding:6px 4px; color:#34d399; font-weight:600;">${r.sgpa}</td>
                    <td style="padding:6px 4px; color:#fbbf24; font-weight:600;">${r.cgpa}</td>
                </tr>
            `;
        });

        html += `
                </tbody>
            </table>
            <div style="margin-top:14px; padding-top:12px; border-top:1px solid #374151; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                <span style="font-size:14px; color:#d1d5db;">Total Credit Hours: <b>${data.totalCH}</b></span>
                <span style="font-size:16px; color:#facc15; font-weight:bold;">Overall CGPA: ${data.overallCGPA}</span>
            </div>
        `;

        card.innerHTML = html;
        return card;
    }

    function insertCard(table, card) {
        table.parentNode.insertBefore(card, table);
    }

    function run() {
        const table = findResultsTable();
        if (!table) {
            log('Results table abhi nahi mila.');
            return false;
        }

        const cols = getColumnIndices(table);
        if (cols.semesterIdx === -1 || cols.chIdx === -1 || cols.gpIdx === -1) {
            log('Zaroori columns (Semester/CH/GP) table mein nahi milay.');
            return false;
        }

        const { semesters, semesterData } = extractData(table, cols);
        if (!semesters.length) {
            log('Abhi koi valid row parse nahi hui.');
            return false;
        }

        const data = computeResults(semesters, semesterData);
        const card = buildCard(data);
        insertCard(table, card);
        log('Summary card inject ho gaya.', data);
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
