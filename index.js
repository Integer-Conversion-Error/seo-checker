
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const fs = require('fs');

// Configuration
const DOMAIN_TO_TRACK = 'raindropjanitorial.com';
const TERMS_FILE = './search-terms.json';
// Headless: false allows you to see the browser and solve CAPTCHAs manually if needed
const HEADLESS = false;
const MAX_PAGES = 3;

async function checkRank(browser, term) {
    const page = await browser.newPage();

    // Pipe browser console to node console
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });

    // Note: stealth plugin handles user agent often, but setting a recent one is good backup
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36');

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

        // Loop through pages
        for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
            const startParam = (pageNum - 1) * 10;
            const url = `https://www.google.com/search?q=${encodeURIComponent(term)}&start=${startParam}`;

            // console.log(`   Checking page ${pageNum}...`); // Verbose off
            await page.goto(url, { waitUntil: 'domcontentloaded' });

            // Check for cookie consent (only needed on first load usually, but good to have)
            try {
                const acceptButton = await page.waitForSelector('button[id="L2AGLb"], button:has-text("Accept all")', { timeout: 1000 });
                if (acceptButton) await acceptButton.click();
            } catch (e) { }

            try {
                // Wait for either results or a captcha/blocking indicator
                // .g is organic result, .recaptcha is captcha
                await page.waitForSelector('#search, #main, div.g, #captcha-form', { timeout: 5000 });
            } catch (e) {
                // If we time out, likely captcha or empty result, but we continue to inspect
            }

            // Analyze page
            const pageResults = await page.evaluate((domain, pageNum) => {
                const res = {
                    aiSummary: false,
                    sponsored: false,
                    places: false,
                    organicRank: null
                };
                const textContent = document.body.innerText;
                console.log(`Debug Page Title: ${document.title}`);
                // console.log(`Debug Body Start: ${textContent.substring(0, 50).replace(/\n/g, ' ')}`);

                // Check for captcha/block
                if (document.title.includes("Before you continue") || document.querySelector('#captcha-form') || textContent.includes("unusual traffic")) {
                    console.log("   ⚠️  BLOCKED: Google is showing a CAPTCHA or blocking page. Please solve it in the browser window.");
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

                // 4. Organic - Classic Check
                const organicResults = Array.from(document.querySelectorAll('div.g'));
                let rankCounter = 1;
                for (const result of organicResults) {
                    const link = result.querySelector('a');
                    if (link && link.href.includes(domain) && !link.href.includes('google.com')) {
                        res.organicRank = rankCounter + ((pageNum - 1) * 10);
                        break;
                    }
                    rankCounter++;
                }

                // Fallback Organic Check
                if (!res.organicRank) {
                    const simpleFound = res.debugLinks.findIndex(l => l.includes(domain) && !l.includes('google.com'));
                    if (simpleFound !== -1) {
                        res.foundInOtherLink = simpleFound;
                    }
                }

                return res;
            }, DOMAIN_TO_TRACK, pageNum);

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

            if (pageResults.foundInOtherLink !== undefined && !report.organicRank) {
                report.foundNonStandard = true;
                report.foundOnPage = pageNum;
                break;
            }

            // Random pause between pages
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
        }

        // Print Report
        console.log(`   - AI Summary:   ${report.aiSummary ? '✅ Yes' : '⬜ No'}`);
        console.log(`   - Map/Places:   ${report.places ? '✅ Yes' : '⬜ No'}`);
        console.log(`   - Sponsored:    ${report.sponsored ? '✅ Yes' : '⬜ No'}`);
        if (report.organicRank) {
            console.log(`   - Organic:      ✅ Found at #${report.organicRank} (Page ${report.foundOnPage})`);
        } else if (report.foundNonStandard) {
            console.log(`   - Organic:      ⚠️  Found on Page ${report.foundOnPage} (but selector structure differed). Check debug output.`);
        } else {
            console.log(`   - Organic:      ❌ Not found in first ${MAX_PAGES} pages`);

            // Print debug info
            if (report.debugLinks && report.debugLinks.length > 0) {
                const nonGoogle = report.debugLinks.filter(l => !l.includes('google.com'));
                // console.log(`   --- Debug: Found ${report.debugLinks.length} total links on Page 1 ---`);

                // Specific check
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

    const browser = await puppeteer.launch({
        headless: HEADLESS,
        executablePath: process.env.CHROME_BIN || null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1920,1080'
        ]
    });

    try {
        for (const term of searchTerms) {
            await checkRank(browser, term);
        }
    } finally {
        await browser.close();
    }
})();
