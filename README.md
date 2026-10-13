# ChitWise

A personal PWA for tracking chits (chit funds): what you pay each month, the thopudu (dividend) you get, when you take the pot, and what's left.

No build step and no server. It's plain HTML, CSS and JS, and your data stays in your browser's localStorage.

## Run it

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

Opening `index.html` directly also works, but offline mode and install only work over http(s).

To use it on your phone, host this folder anywhere static (GitHub Pages, Netlify, Vercel), open the URL, and choose **Add to Home Screen**.

## Data

- **Backup → Download backup** saves a `.json` file. **Import backup** restores it on any device (replace or merge).
- **Export spreadsheet** saves a `.csv` for Excel or Google Sheets.
- Clearing browser data erases everything, so keep a backup.

## Math

```
discount = pot − winning bid
thopudu  = (discount − organizer commission) ÷ members
you pay  = installment − thopudu
```

Future months are estimated from your average thopudu so far. In the last round, whoever is left takes the full pot.

## Files

`index.html` · `styles.css` · `app.js` (all logic) · `sw.js` (offline cache; bump `CACHE` after edits) · `manifest.webmanifest` · `icons/`
