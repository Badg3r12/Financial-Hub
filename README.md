# Finance Hub

Your budget, investments, savings goals and net worth in one app. It's plain HTML, CSS and JavaScript with no build step and no outside libraries, so it runs anywhere and doesn't depend on Claude.

## Run it on this Mac

```bash
/usr/bin/python3 -m http.server 8765 --bind 127.0.0.1 --directory "$HOME/Claude/Finance Hub/app"
```

Then open http://localhost:8765 in Safari. Data stays in that browser until you connect sync (below).

## One-time setup: sync and phone access (free, no card)

**A. Create your Firebase project (holds the synced data).**
1. Go to console.firebase.google.com, sign in with your Google account and choose **Create a project** (name it, say, `finance-hub`). Turn off Google Analytics. You stay on the free Spark plan, so no billing is set up.
2. **Build → Firestore Database → Create database**. Pick a US location and choose **production mode**.
3. On the **Rules** tab, replace everything with this, then click **Publish**:
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /users/{uid}/{document=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
     }
   }
   ```
4. **Build → Authentication → Get started → Email/Password → Enable → Save.**
5. **Project settings (gear icon) → Your apps → Web (</>)**. Register an app (no hosting needed) and copy the `firebaseConfig` block it shows. This config is not a password; it only identifies your project. The rules above are what keep your data private.

**B. Put the app online (GitHub Pages, free).**
1. Create a free account at github.com, then a **new public repository** named `finance-hub`. It holds only the app's code. Your data never goes there.
2. In the repository: **Add file → Upload files**, then drag in everything *inside* the `app` folder (index.html, css, js, vendor, icons and so on), and Commit.
3. **Settings → Pages → Branch: main / (root) → Save.** After a minute the app is at `https://<your-username>.github.io/finance-hub/`.
4. In Firebase: **Authentication → Settings → Authorized domains → Add domain** `<your-username>.github.io`.

**C. Connect each device.**
1. Open the GitHub Pages address in Safari on the Mac. Go to Settings → Sync between devices, paste the `firebaseConfig` block and choose **Connect**.
2. Enter your email and a password, then choose **Create account** (first device only).
3. On the iPhone, open the same address in Safari, then **Share → Add to Home Screen**. Open it from the home screen, go to Settings, paste the same config, and **Sign in**. The phone downloads everything from the Mac.

From then on, changes on either device show up on the other within seconds when online. Changes made offline upload the next time the app is open with a connection.

To update the app later, upload the changed files to the same GitHub repository again.

## Automatic market data (free)

A GitHub Action in the repository fetches closing prices every weekday evening and fund holdings once a month, and saves them in `data/`. The app reads them to update prices, draw a price chart and returns in each holding's detail, and to fill **Invest → Overlap & exposure** (how much your funds overlap, and how much of each company you own through all your funds and stocks). Nothing to pay and no keys. It runs on GitHub's computers, not on the Mac, and doesn't involve Claude.

It only ever fetches a fixed, broad list of about 290 popular stocks and funds (`tools/universe.json`), so the public repository doesn't show what you own. To follow a new ticker, add it to that list.

**One-time setup**
1. In the repository: **Add file → Upload files** and drag in the `.github`, `tools` and `data` folders from `app` together with the changed files (`js/market.js`, `js/calc.js`, `js/views/invest.js`, `sw.js`, `README.md`). Commit. Finder hides `.github`: press **Cmd-Shift-.** in the Finder window to show it.
2. Check the repository now lists `.github/workflows/market-data.yml`, `tools/market_data.py` and `tools/universe.json`. (If `.github` didn't upload, use **Add file → Create new file**, type `.github/workflows/market-data.yml` as the name and paste the file's contents.)
3. **Settings → Actions → General**: allow actions, and under **Workflow permissions** choose **Read and write permissions**. Save.
4. **Actions** tab → **Market data** → **Run workflow** → Run. It takes 15–25 minutes the first time (about 290 price histories); afterwards `data/` shows a new commit by `market-data-bot`, and the site updates a minute later.

After that it runs by itself. If a run fails (a data site changed), GitHub emails you; the app keeps showing the last good data. Sources: Nasdaq's quote pages for prices (Yahoo as a backup), Vanguard's fund-holdings pages, the Nasdaq-100 list for QQQ (weights estimated from company size) and stockanalysis.com for the top 25 holdings of other ETFs such as SCHD.

The 401(k) has no tickers, so its funds are matched by name in `K401_MAP` at the bottom of `js/calc.js` (Total Stock Market → VTI, Small Cap → VB). The target-date fund holds other funds and is left out of the company breakdown; the screen says so.

## Insights and tools

- **Home** warns when a category is near or over budget and reminds you to back up once a week. Its Insights card links to everything below.
- **Monthly review** (`#review`): income, spending, savings rate, investments split into money added vs. market change, net-worth change, and over-budget categories.
- **Plan** (`#plan`): savings rate, net-worth projection with milestones and an "extra a month" slider, Roth IRA contributions against the yearly limit (`ROTH_LIMITS` in `js/insights.js`; add each new year's limit there), and a Roth 401(k) projection. Set your birth year and expected return under **Assumptions**.
- **Invest tabs**: Performance (your portfolio vs. the same deposits in VTI, VOO, VT, QQQ or SCHD), Dividends, Allocation (target mix, where to put the next deposit, sectors and US vs. international), and Taxes (lots in the brokerage, short vs. long term, loss-harvest candidates with a wash-sale check).
- **Budget links**: Trends (category-by-month heatmap and year-over-year), Subscriptions (repeating charges, yearly cost, price increases), and Cash flow (calendar of expected paydays and bills, with the projected checking balance).
- **Transactions**: search by merchant, note, category or amount, plus min/max amount and account filters. Open a transaction and choose **Split…** to divide it across categories.
- **Goals** show what each goal needs per month to hit its date and what you've actually been putting in.
- **Data health** (More): missing or stale prices, balances that don't match holdings, old snapshots, uncategorized rows, backup status, and suggested merchant rules.
- **At a glance** (More): just the big numbers.
- **Privacy**: the eye button at the top right hides every dollar amount until you tap it again.
- **Face ID lock** (Settings): asks for Face ID or Touch ID when the app opens and after 5 minutes away. It's a privacy screen for this device and doesn't encrypt anything. If you ever get stuck, clearing this site's data removes the lock, and sync brings your data back.
- **Look**: accent color under Settings, chart range buttons (1M–All) and tap/hover readouts on charts, pull down to refresh, and swipe a sheet down to close it.
- **Backups**: **Back up now** (Home) or **Back up…** (Settings) lets you pick iCloud Drive, Google Drive, OneDrive or this device, on any device.
  - iPhone/iPad: the share sheet opens; choose **Save to Files** and pick the drive. Google Drive and OneDrive show up there once their apps are installed.
  - Computer: the file is saved to Downloads and the drive's website opens so you can drag it in. On a Mac you can also save straight into the iCloud Drive folder. Apple has no way for websites to upload to iCloud directly.
  - Optional, for one-click uploads from a computer: add free sign-in IDs under **Settings → Backup → Upload straight to Google Drive or OneDrive** (steps below).

Sector data (`data/sectors.json`) comes from the same Market data action, refreshed with fund holdings each month.

## Optional: direct upload to Google Drive and OneDrive (free, one-time)

These IDs only identify the app to Google and Microsoft; they aren't passwords. You sign in with your own account each time you back up, and the app can only touch files it created. Add both redirect addresses each time: `https://badg3r12.github.io/Financial-Hub/oauth.html` and, for testing on the Mac, `http://localhost:8765/oauth.html`.

**Google Drive**
1. Go to console.cloud.google.com, sign in, and create a project (e.g. `finance-hub`). No billing needed.
2. **APIs & Services → Library**: search **Google Drive API** and choose **Enable**.
3. **APIs & Services → OAuth consent screen**: choose **External**, enter the app name and your email, save. Under **Test users**, add your own Google account. It can stay in testing mode.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**: type **Web application**. Under **Authorized JavaScript origins** add `https://badg3r12.github.io` (and `http://localhost:8765`). Under **Authorized redirect URIs** add the two `oauth.html` addresses above. Create.
5. Copy the client ID (it ends in `.apps.googleusercontent.com`) into Settings → Backup. Backups go into a **Finance Hub backups** folder.

**OneDrive**
1. Go to portal.azure.com (sign in with your Microsoft account; free) → **App registrations → New registration**.
2. Name it `Finance Hub`. Supported account types: **Personal Microsoft accounts only** (or "any organizational directory and personal accounts"). Redirect URI: platform **Single-page application**, address `https://badg3r12.github.io/Financial-Hub/oauth.html`. Register.
3. **Authentication**: add the localhost `oauth.html` address too, and under **Implicit grant and hybrid flows** tick **Access tokens**. Save.
4. **API permissions**: make sure **Microsoft Graph → Files.ReadWrite.AppFolder** (delegated) is listed; add it if not.
5. Copy the **Application (client) ID** from Overview into Settings → Backup. Backups go into **Apps → Finance Hub** in your OneDrive.

The setting syncs, so you only enter the IDs once. If your browser blocks the sign-in window, allow pop-ups for the site.

## Monthly routine

1. **Statements as PDFs:** under Import → Bank or card statement, choose the monthly PDF. The app recognizes the JMCU member statement (Savings and Checking), the Discover it card statement and the Discover savings statement, and puts each row in the right account. Ending balances become net-worth snapshots. CSV and OFX exports also work; for those, pick the account first.
2. **Savings buckets:** if interest or a transfer changed them, use Goals → Match bank balances.
3. **Vanguard:** Transaction history → Download → spreadsheet-compatible CSV. Download **one account at a time** (Brokerage, Roth IRA, Cash Plus) and import each with its account selected. The app never reads account numbers, so it can't split a file that covers several accounts. A combined file can still update prices.
4. **Inbox:** confirm the imported rows. Matches with your Quick add entries merge automatically. Choosing a category teaches the app that merchant.
5. **Savings and CD:** type the ending balances under Net worth → Add snapshot.
6. **Backup:** Settings → Export backup, then save the file to iCloud Drive.

## Every quarter: 401(k) statement (Ekon Benefits)

Download the quarterly PDF from Ekon Benefits (the Roth 401(k) is there, not at Vanguard). In the app, go to **Import → Paystubs and 401(k) statements** (or Paystubs & 401k → Add statements) and choose it. The PDF's own text is scrambled, so the app reads the page image on the device. It checks that beginning value + contributions + gain = ending value, and saves the statement and a net-worth snapshot. Anything that doesn't add up opens for you to check.

## Savings buckets (Capital One)

Each Capital One savings bucket is a goal on the Goals screen, kept in Discover Savings. When the bank's numbers drift from the app's (interest, a transfer you didn't log), use **Match bank balances** and type in what the bank shows. The app records the difference as an adjustment.

## Paystubs

Download the paystub PDFs from Ajera and choose them under **Import → Paystubs and 401(k) statements** (several at once is fine). They're read on the device; stubs that pass the math check (gross − taxes − deductions + reimbursements = net) save automatically.

## Privacy

- Account, card, routing and plan-number columns are dropped the moment a file is read (see `SENSITIVE_HEADER` in `js/util.js`).
- Original statements stay wherever you saved them. The app keeps only the numbers it pulls out.

## Files

- `vendor/pdfjs/`: Mozilla's pdf.js, version 4.4.168, downloaded from cdnjs.cloudflare.com on Nov 25, 2026. It reads text out of PDF statements in the browser.
- `js/import/pdf.js`: readers for the JMCU member statement, the Discover it card statement and the Discover savings statement.
- `vendor/firebase/`: Google's Firebase web library, version 10.12.2, downloaded from gstatic.com on Nov 25, 2026. Its import links were changed to point at the local copies, so the app loads nothing from outside sites.
- `js/sync.js`: sign-in and syncing with your Firebase project.
- `js/store.js`: local database (IndexedDB). Every save goes through it.
- `js/calc.js`: all totals (budget, holdings, net worth, goals, fund overlap and look-through).
- `js/insights.js`: monthly review, projections, benchmark, recurring charges, alerts, dividends, allocation, taxes, cash flow, data health.
- `js/views/plan.js`, `js/views/portfolio.js`: the insight screens and the extra Invest tabs.
- `js/backup.js`, `oauth.html`: the backup chooser and Google Drive / OneDrive uploads (`oauth.html` receives the sign-in and closes).
- `js/lock.js`, `js/gestures.js`: Face ID lock, touch gestures.
- `js/market.js`: loads `data/prices.json` and `data/holdings.json` and updates stored prices when they're newer.
- `tools/market_data.py`, `.github/workflows/market-data.yml`: the free market-data job (Python standard library only).
- `js/views/`: one file per screen.
- `js/import/`: the Vanguard, bank CSV/OFX, spreadsheet (.xlsx) and paystub readers.
