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

## Monthly routine

1. **Statements as PDFs:** under Import → Bank or card statement, choose the monthly PDF. The app recognizes the JMCU member statement (Savings and Checking), the Discover it card statement and the Discover savings statement, and puts each row in the right account. Ending balances become net-worth snapshots. CSV and OFX exports also work; for those, pick the account first.
2. **Savings buckets:** if interest or a transfer changed them, use Goals → Match bank balances.
3. **Vanguard:** Transaction history → Download → spreadsheet-compatible CSV. Download **one account at a time** (Brokerage, Roth IRA, Cash Plus, 401k plan) and import each with its account selected. The app never reads account numbers, so it can't split a file that covers several accounts. A combined file can still update prices.
4. **Inbox:** confirm the imported rows. Matches with your Quick add entries merge automatically. Choosing a category teaches the app that merchant.
5. **Savings and CD:** type the ending balances under Net worth → Add snapshot.
6. **Backup:** Settings → Export backup, then save the file to iCloud Drive.

## Every quarter: 401(k) statement (Ekon Benefits)

The PDF's own text is scrambled, so read it from a picture instead. On the iPhone, screenshot pages 1 and 2, then use Live Text to copy the text. On the Mac, screenshot the pages and copy the text in Preview. Then go to Paystubs & 401k → Add quarterly statement and paste. The app checks that beginning value + contributions + gain = ending value, and that the fund balances add up.

## Savings buckets (Capital One)

Each Capital One savings bucket is a goal on the Goals screen, kept in Discover Savings. When the bank's numbers drift from the app's (interest, a transfer you didn't log), use **Match bank balances** and type in what the bank shows. The app records the difference as an adjustment.

## Paystubs

Take a screenshot in Ajera. On iPhone, open it in Photos, long-press the text and choose Copy. On the Mac, open it in Preview, select all and copy. Then go to Paystubs & 401k → Add paystub and paste. Check the figures; the app tests that gross minus taxes and deductions equals net pay before saving. If Ajera uses labels the app doesn't recognize, the label list is at the top of `js/import/paystub.js`.

## Privacy

- Account, card, routing and plan-number columns are dropped the moment a file is read (see `SENSITIVE_HEADER` in `js/util.js`).
- Original statements stay wherever you saved them. The app keeps only the numbers it pulls out.

## Files

- `vendor/pdfjs/`: Mozilla's pdf.js, version 4.4.168, downloaded from cdnjs.cloudflare.com on Nov 25, 2026. It reads text out of PDF statements in the browser.
- `js/import/pdf.js`: readers for the JMCU member statement, the Discover it card statement and the Discover savings statement.
- `vendor/firebase/`: Google's Firebase web library, version 10.12.2, downloaded from gstatic.com on Nov 25, 2026. Its import links were changed to point at the local copies, so the app loads nothing from outside sites.
- `js/sync.js`: sign-in and syncing with your Firebase project.
- `js/store.js`: local database (IndexedDB). Every save goes through it.
- `js/calc.js`: all totals (budget, holdings, net worth, goals).
- `js/views/`: one file per screen.
- `js/import/`: the Vanguard, bank CSV/OFX, spreadsheet (.xlsx) and paystub readers.
