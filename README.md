# squared

Hold to grow the square, release to drop it. It has to slip through the top
gap and land on the bottom platform. Matching the top gap almost exactly is a
perfect.

Plain HTML/CSS/JS, no build step. Open `index.html` in a browser to play.

## Rules

- Land: 10 points. Perfect: 50 points.
- Miss (too big or too small): -5s, chain resets.
- Start pressing within `comboWindow` seconds of a new square appearing to keep
  the chain. Each chained landing raises the multiplier (x2, x3, ...), which
  multiplies points, adds `multiplier / 2` seconds and makes the square grow a
  bit faster.
- Daily mode uses the UTC date as the seed, so everyone gets the same platform
  sequence that day (best score kept per day). Random mode reseeds every game.
- New platforms are rolled after every landing. The gap between the top and
  bottom holes narrows as you land more squares.

## Tuning

All numbers live in the `CONFIG` object at the top of `game.js`. The game is laid
out on a fixed 360x640 board scaled to fit the screen, so sizes and speeds are
the same on every device.

## Deploying to GitHub Pages

1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: "Deploy from a branch", branch `main`, folder `/`.
3. The game is served at `https://<user>.github.io/<repo>/`.
