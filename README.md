# SEO Checker Tool

A robust Puppeteer-based tool to check Google Search rankings for your domain.

## Features
- **Multi-Page**: Scans the first 3 pages of Google results.
- **Stealth Mode**: Uses `puppeteer-extra-plugin-stealth` to bypass basic bot detection.
- **Comprehensive Detection**:
    - Organic Rankings
    - AI Overviews (SGE)
    - Sponsored Ads
    - Google Places / Map Pack
- **Debug Mode**: Logs found links if your site isn't ranked, helping you verify blocking/visibility.

## Prerequisites
- Node.js (v18+)
- Local machine (Residential IP recommended to avoid Google blocks)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/Integer-Conversion-Error/seo-checker.git
   cd seo-checker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

1. **Configure Search Terms**:
   Edit `search-terms.json` to add your keywords:
   ```json
   [
       "brand name",
       "service keyword city"
   ]
   ```

2. **Run the Checker**:
   ```bash
   npm run check
   # or
   node index.js
   ```

3. **Web Dashboard** (Recommended):
   ```bash
   npm run dashboard
   ```
   Open http://localhost:3001 to:
   - **Run checks from the browser** with live output
   - **Get CAPTCHA notifications** when manual solving is needed
   - **View ranking trends** with interactive charts
   - **Filter by date range** and search term
   - **See top gainers/losers** at a glance

4. **Headless Mode**:
   By default, the browser opens visibly (`headless: false`) to let you solve CAPTCHAs manually if they appear.
   To run headlessly (e.g., on a server):
   ```bash
   HEADLESS=true node index.js
   ```

## Logic
The script launches a browser, navigates to Google, and performs a search for each term in your list. It scrapes the results and saves them to an SQLite database (`seo-results.db`).

## Chrome Profile & Avoiding Rate Limits

The script uses a persistent Chrome profile at `~/.seo-checker-profile` to help avoid Google's rate limiting. This stores cookies, session data, and browser fingerprint consistency between runs.

### Setting Up on a New Machine

**Option 1: Fresh Profile (Recommended)**
1. Run `npm install` to install dependencies
2. Run `npm start` the first time
3. When the browser opens, **manually solve any CAPTCHA** that appears
4. The solved CAPTCHA "trusts" this browser profile for future runs
5. *(Optional)* Sign into a Google account in the automated browser for extra trust

**Option 2: Copy Existing Profile**
If you have a working profile, copy the folder:
```bash
# On the working machine
cp -r ~/.seo-checker-profile /path/to/backup

# On the new machine
cp -r /path/to/backup ~/.seo-checker-profile
```

### Tips for Avoiding Rate Limits

| Tip | Why It Helps |
|-----|--------------|
| Sign into Google | Google trusts logged-in users more |
| Use the same IP | Changing IPs looks suspicious |
| Keep delays long | Script uses 8-15s between searches by default |
| Don't run too often | 1-2 checks per day is reasonable |
| Use a residential network | VPNs/datacenters are flagged more often |

> **Note**: The first run on a new machine will likely hit a CAPTCHA — solve it once, and subsequent runs should work smoothly.

**Note on VPS Usage**: Google aggressively blocks cloud server IPs (AWS, DigitalOcean, etc.). This tool works best on a local residential connection.
