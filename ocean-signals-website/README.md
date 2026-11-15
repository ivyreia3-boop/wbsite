# Ocean Signals — NASA Space Apps website framework

This is a **static, single-file website** (HTML + CSS + vanilla JavaScript) for an ocean observation / ENSO / coastal sea-level project. No build process, npm, Python server, or third-party dependencies are needed.

## Publish in your existing GitHub repository

1. Open your existing repository your existing GitHub repository (the one shown in your screenshots).
2. Upload **index.html** to the root of the repository, replacing the earlier starter page. If the repository already has `styles.css` or `script.js`, the new page does not need those files; all styling and interactions are included in `index.html`.
3. Commit the change.
4. If your GitHub plan/repository visibility permits GitHub Pages, configure **Settings → Pages → Deploy from a branch → main → /(root)**.

## Add actual figures later

Upload these image files to an `assets` folder in your repository:

- `assets/ssh-map.png` — satellite-based ocean map
- `assets/coastal-levels.png` — tide-gauge time series
- `assets/model-comparison.png` — model validation chart

Once added, the corresponding gallery tabs display them automatically. Until then they show explicit placeholders. The hero graphic is **conceptual artwork**, not measured data.

## Edit content

Open `index.html` in GitHub and click the pencil icon. Edit the text sections for mission, methods, data sources, outputs, and team. To change gallery descriptions or filenames, find `const gallery = {` at the end of the file.

## Science and integrity notes

- This starter intentionally **does not claim new scientific findings** or invent numerical results.
- Cite the exact NASA and NOAA datasets, dates, units and versions when figures are inserted.
- Distinguish conditional hindcasts from true forward forecasts when ENSO input for the target month is observed.
- Avoid describing monthly sea-level analysis as a flood-risk prediction.
- Never commit Earthdata access tokens, passwords, or private data to a GitHub repository.

## Technical details

- Responsive on phones and desktop.
- Keyboard-accessible tabs and mobile navigation.
- Honors reduced motion preferences.
- No external fonts, libraries, scripts, analytics or cookies.
