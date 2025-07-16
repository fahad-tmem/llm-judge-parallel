// Constants
const JUDGE_PROMPT = `Act as an impartial adjudicator evaluating Target Content (TC) against an explicit Evaluation Objective (EO).
Apply the rubric below, compute scores, and issue a single-sentence verdict.
Maintain brevity, neutrality, and determinism.
Rubric (0–10 whole integers)
Criterion 0 5 10
Factual Accuracy factually wrong mixed fully correct
Relevance to EO off-topic partly on-topic laser-focused
Depth/Reasoning superficial adequate rigorous
Clarity confusing understandable crystal-clear
Conciseness verbose/terse tolerable optimally brief
Scoring Rules
Score each criterion independently.
Average is Overall Score (round half up).
If any single criterion ≤ 2, cap Overall Score at 4.
Verdict Logic
• Accept if Overall Score ≥ 8.
• Needs Revision if 5 – 7.
• Reject if ≤ 4.
Output Format (exactly)
{
"scores": {
"accuracy": <0-10>,
"relevance": <0-10>,
"depth": <0-10>,
"clarity": <0-10>,
"conciseness": <0-10>
},
"overall_score": <0-10>,
"verdict": "<Accept|Needs Revision|Reject>",
"brief_rationale": "<≤25 words>"
}
Procedural Constraints
• Think step-by-step internally; reveal only the JSON code block.
• If TC or EO is missing/illegible, assume EO is "Evaluate the factual correctness of the content." and the content given is the TC.
• Emphasize factual correctness and relevance above other dimensions.
• No honorifics, apologies, or meta-discussion.`;

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES = 200;

// Application state
let appState = {
    apiKey: '',
    promptPairs: [],
    results: [],
    filters: {
        verdict: '',
        minScore: 0,
        searchText: ''
    },
    isEvaluating: false
};

let summaryChart = null;

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    initializeChart();
    updateUI();
});

function initializeEventListeners() {
    // API Key input
    document.getElementById('apiKey').addEventListener('input', function(e) {
        appState.apiKey = e.target.value;
        updateRunButton();
    });

    // File upload
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    
    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('drop', handleDrop);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    fileInput.addEventListener('change', handleFileSelect);

    // Ad-hoc pair input
    document.getElementById('addPairBtn').addEventListener('click', addSinglePair);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllPairs);

    // Run evaluation
    document.getElementById('runEvaluationBtn').addEventListener('click', runEvaluation);

    // Filters
    document.getElementById('verdictFilter').addEventListener('change', updateFilters);
    document.getElementById('minScoreFilter').addEventListener('input', updateFilters);
    document.getElementById('searchFilter').addEventListener('input', updateFilters);
    document.getElementById('clearFiltersBtn').addEventListener('click', clearFilters);

    // Export buttons
    document.getElementById('exportJsonBtn').addEventListener('click', exportJson);
    document.getElementById('exportCsvBtn').addEventListener('click', exportCsv);
}

function initializeChart() {
    const ctx = document.getElementById('summaryChart').getContext('2d');
    summaryChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Accept', 'Needs Revision', 'Reject'],
            datasets: [{
                label: 'Count',
                data: [0, 0, 0],
                backgroundColor: ['#1FB8CD', '#FFC185', '#B4413C']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

// File handling
function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        processFile(file);
    }
}

function processFile(file) {
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.textContent = `Processing ${file.name}...`;
    fileInfo.classList.remove('hidden');

    const extension = file.name.split('.').pop().toLowerCase();
    
    if (extension === 'csv') {
        Papa.parse(file, {
            header: true,
            complete: function(results) {
                processParsedData(results.data, file.name);
            },
            error: function(error) {
                showError('Error parsing CSV: ' + error.message);
            }
        });
    } else if (extension === 'json') {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = JSON.parse(e.target.result);
                processParsedData(Array.isArray(data) ? data : [data], file.name);
            } catch (error) {
                showError('Error parsing JSON: ' + error.message);
            }
        };
        reader.readAsText(file);
    } else {
        showError('Unsupported file format. Please upload CSV or JSON files.');
    }
}

function processParsedData(data, filename) {
    const validPairs = [];
    
    data.forEach((row, index) => {
        if (row.prompt && row.response) {
            const pair = {
                id: generateId(),
                prompt: row.prompt.toString(),
                response: row.response.toString()
            };
            if (row.context) {
                pair.context = row.context.toString();
            }
            validPairs.push(pair);
        }
    });

    if (validPairs.length === 0) {
        showError('No valid prompt-response pairs found. Ensure your file has "prompt" and "response" columns.');
        return;
    }

    appState.promptPairs = validPairs;
    
    const fileInfo = document.getElementById('fileInfo');
    fileInfo.textContent = `Loaded ${validPairs.length} pairs from ${filename}`;
    
    updateCurrentPairsDisplay();
    updateRunButton();
}

function addSinglePair() {
    const prompt = document.getElementById('promptInput').value.trim();
    const response = document.getElementById('responseInput').value.trim();
    const context = document.getElementById('contextInput').value.trim();
    
    if (!prompt || !response) {
        showError('Both prompt and response are required.');
        return;
    }
    
    const pair = {
        id: generateId(),
        prompt,
        response
    };
    
    if (context) {
        pair.context = context;
    }
    
    appState.promptPairs.push(pair);
    
    // Clear inputs
    document.getElementById('promptInput').value = '';
    document.getElementById('responseInput').value = '';
    document.getElementById('contextInput').value = '';
    
    updateCurrentPairsDisplay();
    updateRunButton();
    showSuccess(`Added pair. Total: ${appState.promptPairs.length}`);
}

function removePair(id) {
    appState.promptPairs = appState.promptPairs.filter(pair => pair.id !== id);
    updateCurrentPairsDisplay();
    updateRunButton();
}

function clearAllPairs() {
    appState.promptPairs = [];
    updateCurrentPairsDisplay();
    updateRunButton();
    document.getElementById('fileInfo').classList.add('hidden');
}

function updateCurrentPairsDisplay() {
    const container = document.getElementById('currentPairsContainer');
    const pairCount = document.getElementById('pairCount');
    const clearAllBtn = document.getElementById('clearAllBtn');
    
    pairCount.textContent = appState.promptPairs.length;
    
    if (appState.promptPairs.length === 0) {
        container.innerHTML = '<div class="empty-pairs-message">No pairs added yet</div>';
        clearAllBtn.style.display = 'none';
        return;
    }
    
    clearAllBtn.style.display = 'block';
    
    container.innerHTML = appState.promptPairs.map(pair => `
        <div class="pair-item">
            <div class="pair-content">
                <div class="pair-prompt">${escapeHtml(truncateText(pair.prompt, 60))}</div>
                <div class="pair-response">${escapeHtml(truncateText(pair.response, 80))}</div>
                ${pair.context ? `<div class="pair-context">Context: ${escapeHtml(truncateText(pair.context, 60))}</div>` : ''}
            </div>
            <button class="pair-remove" onclick="removePair('${pair.id}')" title="Remove pair">×</button>
        </div>
    `).join('');
}

function updateRunButton() {
    const runBtn = document.getElementById('runEvaluationBtn');
    const canRun = appState.apiKey && appState.promptPairs.length > 0 && !appState.isEvaluating;
    runBtn.disabled = !canRun;
}

// Parallel evaluation logic
async function runEvaluation() {
    if (appState.isEvaluating) return;
    
    appState.isEvaluating = true;
    appState.results = [];
    
    updateRunButton();
    showProgress(0, appState.promptPairs.length);
    
    try {
        const totalPairs = appState.promptPairs.length;
        const batches = [];
        
        // Create batches
        for (let i = 0; i < totalPairs; i += BATCH_SIZE) {
            batches.push(appState.promptPairs.slice(i, i + BATCH_SIZE));
        }
        
        let completedCount = 0;
        
        // Process batches sequentially to respect rate limits
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];
            
            // Process all pairs in the current batch in parallel
            const batchPromises = batch.map(pair => evaluatePairWithFallback(appState.apiKey, pair));
            const batchResults = await Promise.all(batchPromises);
            
            // Add results to state
            batchResults.forEach((result, index) => {
                appState.results.push({
                    ...batch[index],
                    ...result,
                    index: completedCount + index
                });
            });
            
            completedCount += batch.length;
            showProgress(completedCount, totalPairs);
            updateResultsTable();
            updateChart();
            
            // Add delay between batches (except for the last batch)
            if (batchIndex < batches.length - 1) {
                await delay(DELAY_BETWEEN_BATCHES);
            }
        }
        
        showSuccess('Evaluation completed successfully!');
    } catch (error) {
        showError('Evaluation failed: ' + error.message);
    } finally {
        appState.isEvaluating = false;
        updateRunButton();
        hideProgress();
    }
}

async function evaluatePairWithFallback(apiKey, pair) {
    try {
        return await evaluatePair(apiKey, pair);
    } catch (error) {
        // Fallback evaluation on error
        console.warn(`Evaluation failed for pair ${pair.id}, using fallback:`, error);
        return {
            scores: {
                accuracy: 0,
                relevance: 0,
                depth: 0,
                clarity: 0,
                conciseness: 0
            },
            overall_score: 0,
            verdict: 'Reject',
            brief_rationale: 'Evaluation failed - API error'
        };
    }
}

async function evaluatePair(apiKey, pair) {
    const objective = pair.context || "Evaluate the factual correctness of the content.";
    const userContent = `EO: ${objective}\nTC: ${pair.response}`;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: 'o3-mini-2025-01-31',
            messages: [
                { role: 'system', content: JUDGE_PROMPT },
                { role: 'user', content: userContent }
            ],
            reasoning_effort: 'medium',
            max_completion_tokens: 5000
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'API request failed');
    }
    
    const data = await response.json();
    const content = data.choices[0].message.content;
    
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('Invalid response format from judge');
    }
    
    try {
        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        throw new Error('Failed to parse judge response');
    }
}

// UI Updates
function updateResultsTable() {
    const tbody = document.getElementById('resultsTableBody');
    const filteredResults = getFilteredResults();
    
    if (filteredResults.length === 0) {
        tbody.innerHTML = '<tr class="empty-state"><td colspan="4">No results match current filters.</td></tr>';
        return;
    }
    
    tbody.innerHTML = filteredResults.map(result => `
        <tr>
            <td class="prompt-cell" title="${escapeHtml(result.prompt)}">${escapeHtml(truncateText(result.prompt, 50))}</td>
            <td>${getVerdictBadge(result.verdict)}</td>
            <td><span class="score-display">${result.overall_score}/10</span></td>
            <td><button class="details-toggle" onclick="toggleDetails(${result.index})">View Details</button></td>
        </tr>
        <tr id="details-${result.index}" class="details-row hidden">
            <td colspan="4">
                <div class="details-content">
                    <div class="details-json">${JSON.stringify(result.scores, null, 2)}</div>
                    <div class="details-rationale">"${escapeHtml(result.brief_rationale)}"</div>
                    ${result.context ? `<div style="margin-top: 8px; font-size: 12px; color: var(--color-text-secondary);">Context: ${escapeHtml(result.context)}</div>` : ''}
                </div>
            </td>
        </tr>
    `).join('');
}

function getFilteredResults() {
    return appState.results.filter(result => {
        const { verdict, minScore, searchText } = appState.filters;
        
        if (verdict && result.verdict !== verdict) return false;
        if (result.overall_score < minScore) return false;
        if (searchText && !result.prompt.toLowerCase().includes(searchText.toLowerCase())) return false;
        
        return true;
    });
}

function updateChart() {
    const verdictCounts = { Accept: 0, 'Needs Revision': 0, Reject: 0 };
    
    appState.results.forEach(result => {
        verdictCounts[result.verdict]++;
    });
    
    summaryChart.data.datasets[0].data = [
        verdictCounts.Accept,
        verdictCounts['Needs Revision'],
        verdictCounts.Reject
    ];
    
    summaryChart.update();
}

function updateFilters() {
    appState.filters.verdict = document.getElementById('verdictFilter').value;
    appState.filters.minScore = parseInt(document.getElementById('minScoreFilter').value);
    appState.filters.searchText = document.getElementById('searchFilter').value;
    
    document.getElementById('minScoreValue').textContent = appState.filters.minScore;
    
    updateResultsTable();
}

function clearFilters() {
    document.getElementById('verdictFilter').value = '';
    document.getElementById('minScoreFilter').value = 0;
    document.getElementById('searchFilter').value = '';
    
    appState.filters = { verdict: '', minScore: 0, searchText: '' };
    document.getElementById('minScoreValue').textContent = '0';
    
    updateResultsTable();
}

function toggleDetails(index) {
    const detailsRow = document.getElementById(`details-${index}`);
    detailsRow.classList.toggle('hidden');
}

// Export functionality
function exportJson() {
    const data = JSON.stringify(appState.results, null, 2);
    downloadFile(data, 'evaluations.json', 'application/json');
}

function exportCsv() {
    const headers = ['prompt', 'response', 'context', 'verdict', 'overall_score', 'accuracy', 'relevance', 'depth', 'clarity', 'conciseness', 'brief_rationale'];
    const rows = appState.results.map(result => [
        result.prompt,
        result.response,
        result.context || '',
        result.verdict,
        result.overall_score,
        result.scores.accuracy,
        result.scores.relevance,
        result.scores.depth,
        result.scores.clarity,
        result.scores.conciseness,
        result.brief_rationale
    ]);
    
    const csv = Papa.unparse([headers, ...rows]);
    downloadFile(csv, 'evaluations.csv', 'text/csv');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Progress handling
function showProgress(current, total) {
    const container = document.getElementById('progressContainer');
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    
    container.classList.remove('hidden');
    
    const percentage = total > 0 ? (current / total) * 100 : 0;
    fill.style.width = percentage + '%';
    text.textContent = `${current} / ${total} completed`;
}

function hideProgress() {
    document.getElementById('progressContainer').classList.add('hidden');
}

// Utility functions
function getVerdictBadge(verdict) {
    const badgeClass = {
        'Accept': 'verdict-badge--accept',
        'Needs Revision': 'verdict-badge--needs-revision',
        'Reject': 'verdict-badge--reject'
    }[verdict] || 'verdict-badge--reject';
    
    return `<span class="verdict-badge ${badgeClass}">${verdict}</span>`;
}

function truncateText(text, maxLength) {
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function showError(message) {
    console.error(message);
    alert('Error: ' + message);
}

function showSuccess(message) {
    console.log(message);
}

function updateUI() {
    updateRunButton();
    updateCurrentPairsDisplay();
    updateResultsTable();
    updateChart();
}