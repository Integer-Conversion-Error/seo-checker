
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');

// Configure stealth plugin with all evasions
puppeteer.use(StealthPlugin());

const fs = require('fs');

// Database setup
const DB_PATH = path.join(__dirname, 'seo-results.db');
const db = new Database(DB_PATH);

// Initialize database tables
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

// Configuration
const DOMAIN_TO_TRACK = 'raindropjanitorial.com';
const TERMS_FILE = './search-terms.json';
// Headless: false by default to allow manual CAPTCHA solving. 
// Set HEADLESS=true environment variable to run headlessly.
const HEADLESS = process.env.HEADLESS === 'true';
const MAX_PAGES = 3;

// Anti-detection settings
const USER_DATA_DIR = path.join(os.homedir(), '.seo-checker-profile');
const MIN_DELAY_BETWEEN_SEARCHES = 8000;  // 8 seconds minimum
const MAX_DELAY_BETWEEN_SEARCHES = 15000; // 15 seconds maximum
const MIN_DELAY_BETWEEN_PAGES = 3000;     // 3 seconds minimum  
const MAX_DELAY_BETWEEN_PAGES = 7000;     // 7 seconds maximum

// Realistic user agents (rotate randomly)
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0'
];

// Realistic viewport sizes
const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1536, height: 864 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 }
];

// Helper functions
function randomDelay(min, max) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Simulate human-like mouse movement
async function humanMove(page) {
    const viewport = page.viewport();
    const x = Math.floor(Math.random() * viewport.width * 0.8) + viewport.width * 0.1;
    const y = Math.floor(Math.random() * viewport.height * 0.8) + viewport.height * 0.1;
    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
}

// Simulate human-like scrolling
async function humanScroll(page) {
    await page.evaluate(async () => {
        const scrollAmount = Math.floor(Math.random() * 300) + 100;
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    });
}

async function checkRank(browser, term, isFirstSearch) {
    const page = await browser.newPage();

    // Pipe browser console to node console
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    // Randomize viewport
    const viewport = randomChoice(VIEWPORTS);
    await page.setViewport(viewport);

    // Randomize user agent
    await page.setUserAgent(randomChoice(USER_AGENTS));

    // Set realistic headers (avoid headers that cause CORS issues)
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'en-US,en;q=0.9'
    });

    let report = {
        term: term,
        aiSummary: false,
        sponsored: false,
        places: false,
        organicRank: null,
        foundOnPage: null
    };

    try {
        console.log(`\n🔍 Searching for: "${term}"`);

        // For first search, go to Google homepage first (more natural)
        if (isFirstSearch) {
            console.log('   ⏳ Warming up browser...');
            await page.goto('https://www.google.com', { waitUntil: 'networkidle2' });
            await randomDelay(2000, 4000);
            await humanMove(page);

            // Handle cookie consent
            try {
                const acceptButton = await page.waitForSelector('button[id="L2AGLb"], button:has-text("Accept all")', { timeout: 3000 });
                if (acceptButton) {
                    await randomDelay(500, 1500);
                    await acceptButton.click();
                    await randomDelay(1000, 2000);
                }
            } catch (e) { }
        }

        // Loop through pages
        for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
            const startParam = (pageNum - 1) * 10;
            const url = `https://www.google.com/search?q=${encodeURIComponent(term)}&start=${startParam}`;

            await page.goto(url, { waitUntil: 'networkidle2' });

            // Simulate human behavior
            await randomDelay(1000, 2000);
            await humanMove(page);
            await humanScroll(page);

            try {
                // Wait for either results or a captcha/blocking indicator
                await page.waitForSelector('#search, #main, div.g, #captcha-form', { timeout: 10000 });
            } catch (e) {
                // If we time out, likely captcha or empty result, but we continue to inspect
            }

            // Analyze page
            const pageResults = await page.evaluate((domain, pageNum) => {
                const res = {
                    aiSummary: false,
                    sponsored: false,
                    places: false,
                    organicRank: null,
                    isBlocked: false
                };
                const textContent = document.body.innerText;
                console.log(`Debug Page Title: ${document.title}`);

                // Check for captcha/block
                if (document.title.includes("Before you continue") ||
                    document.querySelector('#captcha-form') ||
                    textContent.includes("unusual traffic") ||
                    textContent.includes("automated queries") ||
                    document.querySelector('iframe[src*="recaptcha"]')) {
                    res.isBlocked = true;
                }

                // 1. AI Summary (Only check on page 1)
                if (pageNum === 1) {
                    if (textContent.includes("AI Overview") || document.querySelector('.M8OgIe') || document.querySelector('.ab-gp')) {
                        res.aiSummary = true;
                    }
                }

                // 2. Sponsored
                const ads = Array.from(document.querySelectorAll('.uEierd, [data-text-ad], div[aria-label="Ads"]'));
                if (ads.some(ad => ad.innerText.toLowerCase().includes(domain))) {
                    res.sponsored = true;
                }

                // 3. Places (Only check on page 1 usually)
                if (pageNum === 1) {
                    if (document.querySelector('.G0G57e') || textContent.includes("Places") || document.querySelector('div[data-attrid="Url"]')) {
                        const mapHeaders = Array.from(document.querySelectorAll('div[role="heading"], .rllt__details'));
                        if (mapHeaders.some(h => h.innerText.toLowerCase().includes('raindrop'))) res.places = true;
                    }
                }

                // Debug: Capture all found URLs
                const allLinks = Array.from(document.querySelectorAll('a'));
                res.debugLinks = allLinks.map(a => a.href).filter(href => href && !href.startsWith('javascript:'));

                // 4. Organic - Count all actual search result entries in order
                const searchArea = document.querySelector('#search, #rso') || document.body;

                // Build a list of unique result URLs in order of appearance
                const seenUrls = new Set();
                const orderedResults = [];

                // Walk through all links in the search area
                const allResultLinks = searchArea.querySelectorAll('a[href]');
                for (const link of allResultLinks) {
                    const href = link.href;
                    // Skip Google internal links, javascript, and duplicates
                    if (!href ||
                        href.includes('google.com') ||
                        href.startsWith('javascript:') ||
                        href.startsWith('#') ||
                        seenUrls.has(href)) {
                        continue;
                    }

                    // Check if this looks like a main result link (has visible text, reasonable size)
                    const rect = link.getBoundingClientRect();
                    const hasVisibleText = link.innerText && link.innerText.trim().length > 0;
                    const isReasonableSize = rect.width > 100 && rect.height > 10;

                    // Only count links that appear to be main result links
                    if (hasVisibleText && isReasonableSize) {
                        seenUrls.add(href);
                        orderedResults.push(href);
                    }
                }

                // Find our domain's position (exact count, not estimated)
                for (let i = 0; i < orderedResults.length; i++) {
                    if (orderedResults[i].includes(domain)) {
                        res.organicRank = (i + 1) + ((pageNum - 1) * 10);
                        break;
                    }
                }

                res.totalResultsOnPage = orderedResults.length;

                return res;
            }, DOMAIN_TO_TRACK, pageNum);

            // Handle CAPTCHA/blocking - poll until user solves it
            if (pageResults.isBlocked) {
                console.log(`   ⚠️  BLOCKED: Google is showing a CAPTCHA or blocking page.`);
                console.log(`   ⏸️  Waiting for you to solve the CAPTCHA in the browser window...`);

                // Poll every 3 seconds for up to 2 minutes
                const maxWaitTime = 120000; // 2 minutes
                const pollInterval = 3000;  // 3 seconds
                let waited = 0;
                let stillBlocked = true;

                while (waited < maxWaitTime && stillBlocked) {
                    await new Promise(r => setTimeout(r, pollInterval));
                    waited += pollInterval;

                    // Check if still blocked
                    stillBlocked = await page.evaluate(() => {
                        const textContent = document.body.innerText;
                        return document.title.includes("Before you continue") ||
                            document.querySelector('#captcha-form') ||
                            textContent.includes("unusual traffic") ||
                            textContent.includes("automated queries") ||
                            document.querySelector('iframe[src*="recaptcha"]') ||
                            !document.querySelector('#search, div.g');
                    });

                    if (stillBlocked) {
                        process.stdout.write(`\r   ⏳ Waiting... ${Math.floor(waited / 1000)}s`);
                    }
                }
                console.log(''); // New line after progress

                if (!stillBlocked) {
                    console.log(`   ✅ CAPTCHA solved! Continuing...`);
                    // Re-navigate to ensure clean state
                    await page.goto(url, { waitUntil: 'networkidle2' });
                    await randomDelay(1000, 2000);
                } else {
                    console.log(`   ❌ Timeout waiting for CAPTCHA. Skipping this term.`);
                    break;
                }

                // Re-evaluate the page
                const retryResults = await page.evaluate((domain, pageNum) => {
                    const res = {
                        aiSummary: false,
                        sponsored: false,
                        places: false,
                        organicRank: null,
                        isBlocked: false
                    };
                    const textContent = document.body.innerText;

                    // Check if still blocked
                    if (document.title.includes("Before you continue") ||
                        document.querySelector('#captcha-form') ||
                        textContent.includes("unusual traffic") ||
                        textContent.includes("automated queries") ||
                        document.querySelector('iframe[src*="recaptcha"]')) {
                        res.isBlocked = true;
                        return res;
                    }

                    // 1. AI Summary
                    if (pageNum === 1) {
                        if (textContent.includes("AI Overview") || document.querySelector('.M8OgIe') || document.querySelector('.ab-gp')) {
                            res.aiSummary = true;
                        }
                    }

                    // 2. Sponsored
                    const ads = Array.from(document.querySelectorAll('.uEierd, [data-text-ad], div[aria-label="Ads"]'));
                    if (ads.some(ad => ad.innerText.toLowerCase().includes(domain))) {
                        res.sponsored = true;
                    }

                    // 3. Places
                    if (pageNum === 1) {
                        if (document.querySelector('.G0G57e') || textContent.includes("Places") || document.querySelector('div[data-attrid="Url"]')) {
                            const mapHeaders = Array.from(document.querySelectorAll('div[role="heading"], .rllt__details'));
                            if (mapHeaders.some(h => h.innerText.toLowerCase().includes('raindrop'))) res.places = true;
                        }
                    }

                    // 4. Organic - Count all actual search result entries in order
                    const searchArea = document.querySelector('#search, #rso') || document.body;
                    const seenUrls = new Set();
                    const orderedResults = [];

                    const allResultLinks = searchArea.querySelectorAll('a[href]');
                    for (const link of allResultLinks) {
                        const href = link.href;
                        if (!href ||
                            href.includes('google.com') ||
                            href.startsWith('javascript:') ||
                            href.startsWith('#') ||
                            seenUrls.has(href)) {
                            continue;
                        }

                        const rect = link.getBoundingClientRect();
                        const hasVisibleText = link.innerText && link.innerText.trim().length > 0;
                        const isReasonableSize = rect.width > 100 && rect.height > 10;

                        if (hasVisibleText && isReasonableSize) {
                            seenUrls.add(href);
                            orderedResults.push(href);
                        }
                    }

                    for (let i = 0; i < orderedResults.length; i++) {
                        if (orderedResults[i].includes(domain)) {
                            res.organicRank = (i + 1) + ((pageNum - 1) * 10);
                            break;
                        }
                    }

                    return res;
                }, DOMAIN_TO_TRACK, pageNum);

                if (retryResults.isBlocked) {
                    console.log(`   ❌ Still blocked. Skipping this term.`);
                    break;
                }

                // Use retry results
                if (retryResults.aiSummary) report.aiSummary = true;
                if (retryResults.sponsored) report.sponsored = true;
                if (retryResults.places) report.places = true;
                if (pageNum === 1 && retryResults.debugLinks) report.debugLinks = retryResults.debugLinks;

                if (retryResults.organicRank) {
                    report.organicRank = retryResults.organicRank;
                    report.foundOnPage = pageNum;
                    break;
                }
                continue;
            }

            // Update report if found
            if (pageResults.aiSummary) report.aiSummary = true;
            if (pageResults.sponsored) report.sponsored = true;
            if (pageResults.places) report.places = true;

            // Debug capture for Page 1
            if (pageNum === 1 && pageResults.debugLinks) {
                report.debugLinks = pageResults.debugLinks;
            }

            if (pageResults.organicRank) {
                report.organicRank = pageResults.organicRank;
                report.foundOnPage = pageNum;
                break; // Found it, stop looking
            }

            // Random pause between pages (longer delays)
            if (pageNum < MAX_PAGES) {
                const delay = MIN_DELAY_BETWEEN_PAGES + Math.random() * (MAX_DELAY_BETWEEN_PAGES - MIN_DELAY_BETWEEN_PAGES);
                console.log(`   ⏳ Waiting ${(delay / 1000).toFixed(1)}s before next page...`);
                await randomDelay(MIN_DELAY_BETWEEN_PAGES, MAX_DELAY_BETWEEN_PAGES);
            }
        }

        // Print Report
        console.log(`   - AI Summary:   ${report.aiSummary ? '✅ Yes' : '⬜ No'}`);
        console.log(`   - Map/Places:   ${report.places ? '✅ Yes' : '⬜ No'}`);
        console.log(`   - Sponsored:    ${report.sponsored ? '✅ Yes' : '⬜ No'}`);
        if (report.organicRank) {
            console.log(`   - Organic:      ✅ #${report.organicRank} (Page ${report.foundOnPage})`);
        } else {
            console.log(`   - Organic:      ❌ Not found in first ${MAX_PAGES} pages`);

            // Print debug info
            if (report.debugLinks && report.debugLinks.length > 0) {
                const domainFound = report.debugLinks.find(l => l.includes("raindropjanitorial.com"));
                if (domainFound) {
                    console.log(`   🚨 DEBUG: Domain found in raw link list: ${domainFound}`);
                }
            }
        }

    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
    } finally {
        await page.close();
    }

    return report;
}

(async () => {
    let searchTerms = [];
    try {
        const data = fs.readFileSync(TERMS_FILE, 'utf8');
        searchTerms = JSON.parse(data);
    } catch (err) {
        console.error(`Error reading ${TERMS_FILE}:`, err);
        process.exit(1);
    }

    console.log(`Starting SEO Check for: ${DOMAIN_TO_TRACK}`);
    console.log(`Terms: ${searchTerms.length} | Max Pages: ${MAX_PAGES}`);
    console.log(`🛡️  Enhanced stealth mode enabled`);
    console.log(`📁 Using persistent profile: ${USER_DATA_DIR}\n`);

    // Ensure user data directory exists
    if (!fs.existsSync(USER_DATA_DIR)) {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    const browser = await puppeteer.launch({
        headless: HEADLESS,
        executablePath: process.env.CHROME_BIN || null,
        userDataDir: USER_DATA_DIR, // Persistent profile = more trustworthy
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1920,1080',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--lang=en-US,en'
        ],
        ignoreDefaultArgs: ['--enable-automation']
    });

    // Create a new run in the database
    const timestamp = new Date().toISOString();
    const insertRun = db.prepare('INSERT INTO runs (timestamp, domain) VALUES (?, ?)');
    const runResult = insertRun.run(timestamp, DOMAIN_TO_TRACK);
    const runId = runResult.lastInsertRowid;
    console.log(`📊 Database run ID: ${runId}\n`);

    // Prepare insert statement for results
    const insertResult = db.prepare(`
        INSERT INTO results (run_id, term, organic_rank, page_found, ai_summary, places, sponsored)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
        for (let i = 0; i < searchTerms.length; i++) {
            const term = searchTerms[i];
            const isFirstSearch = (i === 0);

            const report = await checkRank(browser, term, isFirstSearch);

            // Save result to database
            insertResult.run(
                runId,
                report.term,
                report.organicRank,
                report.foundOnPage,
                report.aiSummary ? 1 : 0,
                report.places ? 1 : 0,
                report.sponsored ? 1 : 0
            );

            // Longer delay between different search terms
            if (i < searchTerms.length - 1) {
                const delay = MIN_DELAY_BETWEEN_SEARCHES + Math.random() * (MAX_DELAY_BETWEEN_SEARCHES - MIN_DELAY_BETWEEN_SEARCHES);
                console.log(`\n⏳ Waiting ${(delay / 1000).toFixed(1)}s before next search term...`);
                await new Promise(r => setTimeout(r, delay));
            }
        }
    } finally {
        await browser.close();
    }

    console.log('\n✅ SEO check complete!');
    console.log(`📊 Results saved to database (Run #${runId})`);

    // Close database connection
    db.close();
})();
