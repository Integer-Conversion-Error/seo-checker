// Global state
let chart = null;
let allTerms = [];
let checkPollingInterval = null;
let lastOutputIndex = 0;
let keywords = [];
let captchaNotificationShown = false;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize icons
    lucide.createIcons();

    await loadKeywords();
    await loadTerms();
    await loadLatestResults();
    await loadRunHistory();

    // Check current status on load
    await checkCurrentStatus();

    // Set up event listeners
    document.getElementById('applyFilters').addEventListener('click', applyFilters);
    document.getElementById('termSelect').addEventListener('change', updateChart);
    document.getElementById('startCheck').addEventListener('click', startCheck);
    document.getElementById('stopCheck').addEventListener('click', stopCheck);

    // Keyword management listeners
    document.getElementById('addKeyword').addEventListener('click', addKeyword);
    document.getElementById('newKeyword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addKeyword();
    });
    document.getElementById('selectAll').addEventListener('click', () => bulkAction('select-all'));
    document.getElementById('selectNone').addEventListener('click', () => bulkAction('select-none'));
    document.getElementById('selectFavorites').addEventListener('click', () => bulkAction('select-favorites'));

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});

// Check current status on page load
async function checkCurrentStatus() {
    try {
        const response = await fetch('/api/check/status');
        const data = await response.json();

        if (data.status === 'running') {
            // Resume polling if check is already running
            updateCheckUI('running');
            startPolling();
        }
    } catch (error) {
        console.error('Error checking status:', error);
    }
}

// Start SEO check
async function startCheck() {
    try {
        const response = await fetch('/api/check/start', { method: 'POST' });
        const data = await response.json();

        if (response.ok) {
            lastOutputIndex = 0;
            document.getElementById('checkOutput').innerHTML = '';
            updateCheckUI('running');
            startPolling();
        } else {
            alert(data.error || 'Failed to start check');
        }
    } catch (error) {
        console.error('Error starting check:', error);
        alert('Failed to start check');
    }
}

// Stop SEO check
async function stopCheck() {
    try {
        await fetch('/api/check/stop', { method: 'POST' });
        stopPolling();
        updateCheckUI('stopped');
    } catch (error) {
        console.error('Error stopping check:', error);
    }
}

// Start polling for check status
function startPolling() {
    if (checkPollingInterval) return;

    checkPollingInterval = setInterval(pollCheckStatus, 1000);
}

// Stop polling
function stopPolling() {
    if (checkPollingInterval) {
        clearInterval(checkPollingInterval);
        checkPollingInterval = null;
    }
}

// Poll check status
async function pollCheckStatus() {
    try {
        const response = await fetch(`/api/check/status?since=${lastOutputIndex}`);
        const data = await response.json();

        // Update output
        if (data.newOutput && data.newOutput.length > 0) {
            appendOutput(data.newOutput);
            lastOutputIndex = data.outputCount;
        }

        // Show/hide CAPTCHA alert
        const captchaAlert = document.getElementById('captchaAlert');
        if (data.captchaRequired) {
            captchaAlert.style.display = 'block';
            if (!captchaNotificationShown) {
                showNotification('CAPTCHA Required', 'Please solve the CAPTCHA in the browser window');
                captchaNotificationShown = true;
            }
        } else {
            captchaAlert.style.display = 'none';
            captchaNotificationShown = false;
        }

        // Update status
        updateCheckUI(data.status);

        // Stop polling if completed
        if (data.status === 'completed' || data.status === 'error') {
            stopPolling();

            // Reload dashboard data
            setTimeout(async () => {
                await loadTerms();
                await loadLatestResults();
                await loadRunHistory();
            }, 1000);

            if (data.status === 'completed') {
                showNotification('SEO Check Complete', 'Results have been saved to the database');
            }
        }
    } catch (error) {
        console.error('Error polling status:', error);
    }
}

// Append output to console
function appendOutput(outputs) {
    const container = document.getElementById('checkOutput');

    // Clear empty state message
    if (container.querySelector('.empty-state')) {
        container.innerHTML = '';
    }

    outputs.forEach(output => {
        const line = document.createElement('p');
        line.className = 'output-line ' + output.type;

        // Colorize based on content
        if (output.text.includes('✅') || output.text.includes('complete')) {
            line.className += ' success';
        } else if (output.text.includes('⚠️') || output.text.includes('BLOCKED') || output.text.includes('CAPTCHA')) {
            line.className += ' warning';
        }

        line.textContent = output.text;
        container.appendChild(line);
    });

    // Auto-scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Update check UI state
function updateCheckUI(status) {
    const startBtn = document.getElementById('startCheck');
    const stopBtn = document.getElementById('stopCheck');
    const statusBadge = document.getElementById('checkStatus');

    statusBadge.className = 'status-badge ' + status;
    statusBadge.textContent = status.charAt(0).toUpperCase() + status.slice(1);

    if (status === 'running') {
        startBtn.disabled = true;
        stopBtn.disabled = false;
    } else {
        startBtn.disabled = false;
        stopBtn.disabled = true;
    }
}

// Show browser notification
function showNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '📊' });
    }
}

// Load available terms for dropdown
async function loadTerms() {
    try {
        const response = await fetch('/api/terms');
        allTerms = await response.json();

        const select = document.getElementById('termSelect');
        allTerms.forEach(term => {
            const option = document.createElement('option');
            option.value = term;
            option.textContent = term;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading terms:', error);
    }
}

// Load latest results and top movers
async function loadLatestResults() {
    try {
        const response = await fetch('/api/latest');
        const data = await response.json();

        renderTopMovers(data.topGainers, data.topLosers);
        renderResultsTable(data.results, data.changes);

        // Initial chart with all terms
        if (allTerms.length > 0) {
            await updateChart();
        }
    } catch (error) {
        console.error('Error loading results:', error);
        document.getElementById('resultsBody').innerHTML =
            '<tr><td colspan="6" class="empty-state">No data available. Run the SEO checker first.</td></tr>';
    }
}

// Render top movers
function renderTopMovers(gainers, losers) {
    const gainersContainer = document.getElementById('topGainers');
    const losersContainer = document.getElementById('topLosers');

    if (!gainers || gainers.length === 0) {
        gainersContainer.innerHTML = '<p class="empty-state">No data yet</p>';
    } else {
        gainersContainer.innerHTML = gainers.map(item => `
            <div class="mover-item">
                <span class="term" title="${item.term}">${item.term}</span>
                <span class="change positive">
                    <i data-lucide="arrow-up" class="icon-xs"></i> 
                    ${item.change}
                </span>
            </div>
        `).join('');
    }

    if (!losers || losers.length === 0 || losers.every(l => l.change >= 0)) {
        losersContainer.innerHTML = '<p class="empty-state">No losses</p>';
    } else {
        const actualLosers = losers.filter(l => l.change < 0);
        losersContainer.innerHTML = actualLosers.map(item => `
            <div class="mover-item">
                <span class="term" title="${item.term}">${item.term}</span>
                <span class="change negative">
                    <i data-lucide="arrow-down" class="icon-xs"></i>
                    ${Math.abs(item.change)}
                </span>
            </div>
        `).join('') || '<p class="empty-state">No losses</p>';
    }

    lucide.createIcons();
}

// Render results table
function renderResultsTable(results, changes) {
    const tbody = document.getElementById('resultsBody');

    if (!results || results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No results yet. Run the SEO checker first.</td></tr>';
        return;
    }

    const changesMap = new Map(changes?.map(c => [c.term, c]) || []);

    tbody.innerHTML = results.map(result => {
        const change = changesMap.get(result.term);
        const rankBadge = getRankBadge(result.organic_rank);
        const changeIndicator = getChangeIndicator(change);

        // Helper for check/x icons
        const getIcon = (val) => val ?
            '<i data-lucide="check-circle" class="text-green icon-sm"></i>' :
            '<i data-lucide="minus" class="text-muted icon-sm"></i>';

        return `
            <tr>
                <td>${result.term}</td>
                <td>${rankBadge}</td>
                <td>${changeIndicator}</td>
                <td class="text-center">${getIcon(result.ai_summary)}</td>
                <td class="text-center">${getIcon(result.places)}</td>
                <td class="text-center">${getIcon(result.sponsored)}</td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

// Get rank badge HTML
function getRankBadge(rank) {
    if (rank === null || rank === undefined) {
        return '<span class="rank-badge notfound">Not Found</span>';
    }

    let className = 'below';
    if (rank <= 10) className = 'top10';
    else if (rank <= 20) className = 'top20';

    return `<span class="rank-badge ${className}">#${rank}</span>`;
}

// Get change indicator HTML
function getChangeIndicator(change) {
    if (!change) return '<span class="change-indicator same"><i data-lucide="minus" class="icon-xs"></i></span>';

    if (change.change === 'NEW') {
        return '<span class="change-indicator new"><i data-lucide="sparkles" class="icon-xs"></i> New</span>';
    }
    if (change.change === 'LOST') {
        return '<span class="change-indicator down"><i data-lucide="x-circle" class="icon-xs"></i> Lost</span>';
    }
    if (typeof change.change === 'number') {
        if (change.change > 0) {
            return `<span class="change-indicator up"><i data-lucide="arrow-up" class="icon-xs"></i> ${change.change}</span>`;
        } else if (change.change < 0) {
            return `<span class="change-indicator down"><i data-lucide="arrow-down" class="icon-xs"></i> ${Math.abs(change.change)}</span>`;
        }
    }
    return '<span class="change-indicator same"><i data-lucide="minus" class="icon-xs"></i></span>';
}

// Load run history
async function loadRunHistory() {
    try {
        const response = await fetch('/api/runs');
        const runs = await response.json();

        const container = document.getElementById('runHistory');

        if (runs.length === 0) {
            container.innerHTML = '<p class="empty-state">No runs yet</p>';
            return;
        }

        container.innerHTML = runs.slice(0, 20).map(run => {
            const date = new Date(run.timestamp);
            const formatted = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            return `
                <div class="run-item">
                    <span class="run-id">Run #${run.id}</span>
                    <span class="run-date">${formatted}</span>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading run history:', error);
    }
}

// Update chart based on selected term and date range
async function updateChart() {
    const termSelect = document.getElementById('termSelect');
    const selectedTerm = termSelect.value;
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    // If no term selected, show top 5 terms
    const termsToShow = selectedTerm ? [selectedTerm] : allTerms.slice(0, 5);

    if (termsToShow.length === 0) {
        return;
    }

    try {
        const datasets = [];
        const colors = ['#4f8cff', '#10b981', '#f59e0b', '#ef4444', '#a855f7'];

        for (let i = 0; i < termsToShow.length; i++) {
            const term = termsToShow[i];
            let url = `/api/term/${encodeURIComponent(term)}/history`;
            const params = new URLSearchParams();
            if (dateFrom) params.append('from', dateFrom);
            if (dateTo) params.append('to', dateTo);
            if (params.toString()) url += '?' + params.toString();

            const response = await fetch(url);
            const history = await response.json();

            if (history.length > 0) {
                datasets.push({
                    label: term.length > 30 ? term.substring(0, 30) + '...' : term,
                    data: history.map(h => ({
                        x: new Date(h.timestamp),
                        y: h.organic_rank
                    })),
                    borderColor: colors[i % colors.length],
                    backgroundColor: colors[i % colors.length] + '20',
                    tension: 0.3,
                    fill: false,
                    pointRadius: 4,
                    pointHoverRadius: 6
                });
            }
        }

        renderChart(datasets);
    } catch (error) {
        console.error('Error updating chart:', error);
    }
}

// Render Chart.js chart
function renderChart(datasets) {
    const ctx = document.getElementById('rankingChart').getContext('2d');

    if (chart) {
        chart.destroy();
    }

    chart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: '#a0a0b0',
                        usePointStyle: true,
                        padding: 20
                    }
                },
                tooltip: {
                    backgroundColor: '#252540',
                    titleColor: '#ffffff',
                    bodyColor: '#a0a0b0',
                    borderColor: '#3a3a5c',
                    borderWidth: 1,
                    padding: 12,
                    callbacks: {
                        title: function (context) {
                            const date = new Date(context[0].parsed.x);
                            return date.toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                            });
                        },
                        label: function (context) {
                            const rank = context.parsed.y;
                            return `${context.dataset.label}: #${rank || 'Not found'}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        displayFormats: {
                            day: 'MMM d'
                        }
                    },
                    grid: {
                        color: '#3a3a5c'
                    },
                    ticks: {
                        color: '#a0a0b0'
                    }
                },
                y: {
                    reverse: true, // Lower rank number is better
                    beginAtZero: false,
                    min: 1,
                    grid: {
                        color: '#3a3a5c'
                    },
                    ticks: {
                        color: '#a0a0b0',
                        stepSize: 5,
                        callback: function (value) {
                            return '#' + value;
                        }
                    },
                    title: {
                        display: true,
                        text: 'Ranking Position',
                        color: '#a0a0b0'
                    }
                }
            }
        }
    });
}

// Apply filters
async function applyFilters() {
    await updateChart();

    // Could also filter the table here if needed
    const dateFrom = document.getElementById('dateFrom').value;
    const dateTo = document.getElementById('dateTo').value;

    if (dateFrom || dateTo) {
        // Reload results with date filter
        let url = '/api/results';
        const params = new URLSearchParams();
        if (dateFrom) params.append('from', dateFrom);
        if (dateTo) params.append('to', dateTo);
        if (params.toString()) url += '?' + params.toString();

        try {
            const response = await fetch(url);
            const results = await response.json();
            // Group by most recent run
            if (results.length > 0) {
                const latestTimestamp = results[0].timestamp;
                const latestResults = results.filter(r => r.timestamp === latestTimestamp);
                renderResultsTable(latestResults, []);
            }
        } catch (error) {
            console.error('Error applying filters:', error);
        }
    }
}

// === Keyword Management ===

// Load keywords
async function loadKeywords() {
    try {
        const response = await fetch('/api/keywords');
        keywords = await response.json();
        renderKeywords();
    } catch (error) {
        console.error('Error loading keywords:', error);
    }
}

// Render keywords list
function renderKeywords() {
    const container = document.getElementById('keywordsList');
    const stats = document.getElementById('keywordStats');

    // Update stats
    const selectedCount = keywords.filter(k => k.selected).length;
    stats.textContent = `${selectedCount} selected of ${keywords.length} keywords`;

    if (keywords.length === 0) {
        container.innerHTML = '<p class="empty-state">No keywords configured</p>';
        return;
    }

    container.innerHTML = keywords.map((k, index) => `
        <div class="keyword-item ${k.selected ? 'selected' : ''}">
            <input type="checkbox" 
                   ${k.selected ? 'checked' : ''} 
                   onchange="updateKeyword(${index}, 'selected', this.checked)">
            <span class="keyword-text">${k.term}</span>
            <button class="favorite-btn ${k.favorite ? 'active' : ''}" 
                    onclick="updateKeyword(${index}, 'favorite', ${!k.favorite})"
                    title="${k.favorite ? 'Remove from favorites' : 'Add to favorites'}">
                <i data-lucide="star" class="${k.favorite ? 'fill-current' : ''}"></i>
            </button>
            <button class="delete-btn" onclick="deleteKeyword(${index})" title="Delete keyword">
                <i data-lucide="trash-2"></i>
            </button>
        </div>
    `).join('');

    lucide.createIcons();
}

// Add new keyword
async function addKeyword() {
    const input = document.getElementById('newKeyword');
    const term = input.value.trim();

    if (!term) return;

    try {
        const response = await fetch('/api/keywords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ term })
        });

        const data = await response.json();

        if (response.ok) {
            keywords = data.keywords;
            renderKeywords();
            input.value = '';
        } else {
            alert(data.error || 'Failed to add keyword');
        }
    } catch (error) {
        console.error('Error adding keyword:', error);
    }
}

// Update keyword (selected/favorite)
async function updateKeyword(index, field, value) {
    try {
        const update = {};
        update[field] = value;

        // Optimistic UI update
        keywords[index][field] = value;
        renderKeywords();

        await fetch(`/api/keywords/${index}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update)
        });
    } catch (error) {
        console.error('Error updating keyword:', error);
        // Revert on error
        await loadKeywords();
    }
}

// Delete keyword
async function deleteKeyword(index) {
    if (!confirm('Are you sure you want to delete this keyword?')) return;

    try {
        const response = await fetch(`/api/keywords/${index}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const data = await response.json();
            keywords = data.keywords;
            renderKeywords();
        }
    } catch (error) {
        console.error('Error deleting keyword:', error);
    }
}

// Bulk actions
async function bulkAction(action) {
    try {
        const response = await fetch('/api/keywords/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });

        if (response.ok) {
            const data = await response.json();
            keywords = data.keywords;
            renderKeywords();
        }
    } catch (error) {
        console.error('Error performing bulk action:', error);
    }
}

// Expose functions globally for onclick handlers
window.updateKeyword = updateKeyword;
window.deleteKeyword = deleteKeyword;
