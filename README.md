# RocketWire

Rocket electrical harness wiring management tool.

## Project Structure

```
rocketwire/
├── index.html              # Entry point — loads CSS + JS
├── css/
│   └── styles.css          # All styles
└── js/
    ├── constants.js        # PINOUTS, wire colors, fixed config
    ├── state.js            # Global state variables (ST, cam, drag, etc.)
    ├── storage.js          # save(), load(), scope() — localStorage persistence
    ├── panels.js           # Right/left panel collapse toggles
    ├── splice.js           # Splice system — create, edit, commit splices
    ├── export.js           # CSV/PDF export + boot sequence
    ├── canvas/
    │   ├── routing.js      # Edge detection, bezier control points, obstacle avoidance
    │   ├── draw.js         # Main redraw() loop — wires, systems, connectors
    │   └── events.js       # Mouse events, drag, pan, zoom, hit testing
    └── pages/
        ├── home.js         # Projects home page
        ├── connector.js    # Connector editor page (SVG diagrams, channel list)
        └── add-system.js   # Add system / connect existing page
```

## Setup

### Local development
Just open `index.html` in a browser — no build step needed.

### GitHub Pages
1. Push this folder to a GitHub repo
2. Go to Settings → Pages → Source: main branch / root
3. Your site will be live at `https://yourname.github.io/rocketwire`

### Supabase (cloud storage — coming soon)
Replace the `save()` / `load()` functions in `js/storage.js` with Supabase API calls.
