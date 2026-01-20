const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;

// Check runner state
let checkProcess = null;
let checkOutput = [];
let checkStatus = 'idle'; // idle, running, completed, error
let captchaRequired = false;

// Database connection
const DB_PATH = path.join(__dirname, 'seo-results.db');

// Check if database exists, if not create it with schema
let db;
if (!fs.existsSync(DB_PATH)) {
    console.log('📦 Database not found. Creating new database...');
    db = new Database(DB_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            domain TEXT NOT NULL
        );
        
        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id INTEGER NOT NULL,
            term TEXT NOT NULL,
            organic_rank INTEGER,
            page_found INTEGER,
            ai_summary INTEGER DEFAULT 0,
            places INTEGER DEFAULT 0,
            sponsored INTEGER DEFAULT 0,
            FOREIGN KEY (run_id) REFERENCES runs(id)
        );
        
        CREATE INDEX IF NOT EXISTS idx_results_run_id ON results(run_id);
        CREATE INDEX IF NOT EXISTS idx_results_term ON results(term);
    `);
    console.log('✅ Database created successfully');
} else {
    db = new Database(DB_PATH, { readonly: true });
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Keywords config file path
const KEYWORDS_FILE = path.join(__dirname, 'keywords-config.json');
const SEARCH_TERMS_FILE = path.join(__dirname, 'search-terms.json');

// Load keywords config (with favorites and selection state)
function loadKeywordsConfig() {
    // If config file exists, use it
    if (fs.existsSync(KEYWORDS_FILE)) {
        return JSON.parse(fs.readFileSync(KEYWORDS_FILE, 'utf8'));
    }

    // Otherwise, initialize from search-terms.json
    let terms = [];
    if (fs.existsSync(SEARCH_TERMS_FILE)) {
        terms = JSON.parse(fs.readFileSync(SEARCH_TERMS_FILE, 'utf8'));
    }

    const config = {
        keywords: terms.map(term => ({
            term: term,
            selected: true,
            favorite: false
        }))
    };

    saveKeywordsConfig(config);
    return config;
}

// Save keywords config
function saveKeywordsConfig(config) {
    fs.writeFileSync(KEYWORDS_FILE, JSON.stringify(config, null, 2));

    // Also update search-terms.json with selected terms for the checker
    const selectedTerms = config.keywords.filter(k => k.selected).map(k => k.term);
    fs.writeFileSync(SEARCH_TERMS_FILE, JSON.stringify(selectedTerms, null, 2));
}

// API: Start a new SEO check
app.post('/api/check/start', (req, res) => {
    if (checkStatus === 'running') {
        return res.status(400).json({ error: 'Check already running' });
    }

    // Reset state
    checkOutput = [];
    checkStatus = 'running';
    captchaRequired = false;

    // Spawn the check process
    checkProcess = spawn('node', ['index.js'], {
        cwd: __dirname,
        env: { ...process.env, HEADLESS: 'false' }
    });

    checkProcess.stdout.on('data', (data) => {
        const text = data.toString();
        checkOutput.push({ type: 'stdout', text, timestamp: new Date().toISOString() });

        // Detect CAPTCHA
        if (text.includes('BLOCKED') || text.includes('CAPTCHA') || text.includes('solve')) {
            captchaRequired = true;
        }

        console.log('[CHECK]', text.trim());
    });

    checkProcess.stderr.on('data', (data) => {
        const text = data.toString();
        checkOutput.push({ type: 'stderr', text, timestamp: new Date().toISOString() });
        console.error('[CHECK ERROR]', text.trim());
    });

    checkProcess.on('close', (code) => {
        checkStatus = code === 0 ? 'completed' : 'error';
        captchaRequired = false;
        checkProcess = null;
        console.log(`[CHECK] Process exited with code ${code}`);
    });

    res.json({ message: 'Check started', status: 'running' });
});

// API: Get check status and output
app.get('/api/check/status', (req, res) => {
    const since = parseInt(req.query.since) || 0;
    const newOutput = checkOutput.slice(since);

    res.json({
        status: checkStatus,
        captchaRequired: captchaRequired,
        outputCount: checkOutput.length,
        newOutput: newOutput
    });
});

// API: Stop running check
app.post('/api/check/stop', (req, res) => {
    if (checkProcess) {
        checkProcess.kill();
        checkStatus = 'stopped';
        res.json({ message: 'Check stopped' });
    } else {
        res.json({ message: 'No check running' });
    }
});

// API: Get all keywords with their config
app.get('/api/keywords', (req, res) => {
    const config = loadKeywordsConfig();
    res.json(config.keywords);
});

// API: Add a new keyword
app.post('/api/keywords', (req, res) => {
    const { term } = req.body;
    if (!term || !term.trim()) {
        return res.status(400).json({ error: 'Term is required' });
    }

    const config = loadKeywordsConfig();

    // Check if already exists
    if (config.keywords.some(k => k.term.toLowerCase() === term.trim().toLowerCase())) {
        return res.status(400).json({ error: 'Keyword already exists' });
    }

    config.keywords.push({
        term: term.trim(),
        selected: true,
        favorite: false
    });

    saveKeywordsConfig(config);
    res.json({ message: 'Keyword added', keywords: config.keywords });
});

// API: Update a keyword (toggle selected/favorite)
app.put('/api/keywords/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const { selected, favorite, term } = req.body;

    const config = loadKeywordsConfig();

    if (index < 0 || index >= config.keywords.length) {
        return res.status(404).json({ error: 'Keyword not found' });
    }

    if (selected !== undefined) config.keywords[index].selected = selected;
    if (favorite !== undefined) config.keywords[index].favorite = favorite;
    if (term !== undefined) config.keywords[index].term = term.trim();

    saveKeywordsConfig(config);
    res.json({ message: 'Keyword updated', keyword: config.keywords[index] });
});

// API: Delete a keyword
app.delete('/api/keywords/:index', (req, res) => {
    const index = parseInt(req.params.index);
    const config = loadKeywordsConfig();

    if (index < 0 || index >= config.keywords.length) {
        return res.status(404).json({ error: 'Keyword not found' });
    }

    config.keywords.splice(index, 1);
    saveKeywordsConfig(config);
    res.json({ message: 'Keyword deleted', keywords: config.keywords });
});

// API: Bulk update keywords (select all, select none, select favorites)
app.post('/api/keywords/bulk', (req, res) => {
    const { action } = req.body;
    const config = loadKeywordsConfig();

    switch (action) {
        case 'select-all':
            config.keywords.forEach(k => k.selected = true);
            break;
        case 'select-none':
            config.keywords.forEach(k => k.selected = false);
            break;
        case 'select-favorites':
            config.keywords.forEach(k => k.selected = k.favorite);
            break;
        case 'toggle-favorites':
            // Select only favorites, deselect non-favorites
            const hasFavorites = config.keywords.some(k => k.favorite);
            if (hasFavorites) {
                config.keywords.forEach(k => k.selected = k.favorite);
            }
            break;
        default:
            return res.status(400).json({ error: 'Unknown action' });
    }

    saveKeywordsConfig(config);
    res.json({ message: `Action ${action} completed`, keywords: config.keywords });
});

// API: Get all runs
app.get('/api/runs', (req, res) => {
    const runs = db.prepare(`
        SELECT id, timestamp, domain,
               (SELECT COUNT(*) FROM results WHERE run_id = runs.id) as result_count
        FROM runs 
        ORDER BY timestamp DESC
    `).all();
    res.json(runs);
});

// API: Get results with optional date filtering
app.get('/api/results', (req, res) => {
    const { from, to } = req.query;

    let query = `
        SELECT r.*, runs.timestamp 
        FROM results r
        JOIN runs ON r.run_id = runs.id
    `;
    const params = [];

    if (from || to) {
        query += ' WHERE 1=1';
        if (from) {
            query += ' AND runs.timestamp >= ?';
            params.push(from);
        }
        if (to) {
            query += ' AND runs.timestamp <= ?';
            params.push(to);
        }
    }

    query += ' ORDER BY runs.timestamp DESC, r.term';

    const results = db.prepare(query).all(...params);
    res.json(results);
});

// API: Get ranking history for a specific term
app.get('/api/term/:term/history', (req, res) => {
    const { term } = req.params;
    const { from, to } = req.query;

    let query = `
        SELECT r.organic_rank, r.ai_summary, r.places, r.sponsored, 
               runs.timestamp, runs.id as run_id
        FROM results r
        JOIN runs ON r.run_id = runs.id
        WHERE r.term = ?
    `;
    const params = [term];

    if (from) {
        query += ' AND runs.timestamp >= ?';
        params.push(from);
    }
    if (to) {
        query += ' AND runs.timestamp <= ?';
        params.push(to);
    }

    query += ' ORDER BY runs.timestamp ASC';

    const history = db.prepare(query).all(...params);
    res.json(history);
});

// API: Get latest results with ranking changes
app.get('/api/latest', (req, res) => {
    // Get the two most recent runs
    const recentRuns = db.prepare(`
        SELECT id, timestamp FROM runs ORDER BY timestamp DESC LIMIT 2
    `).all();

    if (recentRuns.length === 0) {
        return res.json({ runs: [], results: [], changes: [] });
    }

    const latestRunId = recentRuns[0].id;
    const previousRunId = recentRuns.length > 1 ? recentRuns[1].id : null;

    // Get latest results
    const latestResults = db.prepare(`
        SELECT * FROM results WHERE run_id = ? ORDER BY term
    `).all(latestRunId);

    // Get previous results for comparison
    let changes = [];
    if (previousRunId) {
        const previousResults = db.prepare(`
            SELECT term, organic_rank FROM results WHERE run_id = ?
        `).all(previousRunId);

        const previousMap = new Map(previousResults.map(r => [r.term, r.organic_rank]));

        changes = latestResults.map(r => {
            const prevRank = previousMap.get(r.term);
            let change = null;
            if (prevRank !== undefined && prevRank !== null && r.organic_rank !== null) {
                change = prevRank - r.organic_rank; // Positive = improved (lower rank number is better)
            } else if (prevRank === null && r.organic_rank !== null) {
                change = 'NEW'; // Newly ranked
            } else if (prevRank !== null && r.organic_rank === null) {
                change = 'LOST'; // Lost ranking
            }
            return {
                term: r.term,
                currentRank: r.organic_rank,
                previousRank: prevRank,
                change: change
            };
        });
    }

    // Calculate top movers
    const numericChanges = changes.filter(c => typeof c.change === 'number');
    const topGainers = [...numericChanges].sort((a, b) => b.change - a.change).slice(0, 3);
    const topLosers = [...numericChanges].sort((a, b) => a.change - b.change).slice(0, 3);

    res.json({
        latestRun: recentRuns[0],
        previousRun: recentRuns[1] || null,
        results: latestResults,
        changes: changes,
        topGainers: topGainers,
        topLosers: topLosers
    });
});

// API: Get all unique terms
app.get('/api/terms', (req, res) => {
    const terms = db.prepare('SELECT DISTINCT term FROM results ORDER BY term').all();
    res.json(terms.map(t => t.term));
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SEO Dashboard running at http://localhost:${PORT}`);
    console.log(`📊 Database: ${DB_PATH}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit();
});
