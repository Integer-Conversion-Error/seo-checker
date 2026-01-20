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
   node index.js
   ```

3. **Headless Mode**:
   By default, the browser opens visibly (`headless: false`) to let you solve CAPTCHAs manually if they appear.
   To run headlessly (e.g., on a server):
   ```bash
   HEADLESS=true node index.js
   ```

## Logic
The script launches a browser, navigates to Google, and performs a search for each term in your list. It scrapes the results and prints a report to the console.

**Note on VPS Usage**: Google aggressively blocks cloud server IPs (AWS, DigitalOcean, etc.). This tool works best on a local residential connection.
