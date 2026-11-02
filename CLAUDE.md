# Isobar

Dylan's weather web app, served by GitHub Pages at https://dabossadler10-creator.github.io/isobar/ (main branch, root).
Plain HTML/CSS/JS, no build step. Files: index.html (markup + styles), app.js (core, Today tab, maps), coast.js (marine layer, tides),
history.js (NOAA ACIS station history), ride.js (ride planner), outlook.js (day/week summary), sw.js (offline cache).

## Shipping a change
- Bump the `?v=N` query on every script tag in index.html and the `VERSION` constant in sw.js together, or phones keep old files.
- Pages takes 1 to 3 minutes to publish. Verify on the live site, not just locally.
- Dylan doesn't use Terminal; never hand him command-line steps.
