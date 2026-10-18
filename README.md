# RocketWire

A browser-based tool for designing and documenting rocket electrical harnesses. Draw your systems, give each one connectors, wire them together, and export the pinout. No build step, no framework: plain HTML, CSS and JavaScript.

## Features

- **Canvas editor** for systems, connectors and wires, with pan, zoom, nested subsystems and automatic wire routing around obstacles
- **Connector library** with pin diagrams: Amphenol 9-35 / 9-98 / 13-pin, D-SUB 9 / 15 / 25 / 37, XT60, XT30, Molex, JST and custom layouts
- **Channel names and wire colors** per pin, with same-named nets bundled into one line labeled with a count (for example "X2")
- **Splices** to join several wires at one point
- **Copy / paste connectors** between systems (right-click a connector, then right-click a system)
- **Projects and folders** on the home page, with nested folders
- **Undo / redo** (Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z)
- **CSV and PDF export** of the wiring table
- **Cloud sync** (optional) through Supabase: push and pull projects across devices, with automatic merging of changes

## Quick start

Open `index.html` in a browser. Your work is saved in the browser's local storage.

Cloud sync is optional and needs a Supabase project (see below). Without it you can still use the app locally with the offline login.

## Setup

### Set up your own copy with cloud sync

**Follow the step-by-step guide: [RocketWire-Setup-Guide.pdf](RocketWire-Setup-Guide.pdf)**

It walks through everything a new team needs, and keeps your accounts and data completely separate from anyone else's copy of RocketWire:

1. Get your own copy of the code
2. Create a Supabase project
3. Create the `projects` table and row-level security policies
4. Point the code at your project (`js/supabase.js`)
5. Create the shared team account and log in
6. Host the site (GitHub Pages or similar)
7. Test the sync

The two code changes involved:

| File | What to change |
|---|---|
| `js/supabase.js` | `SUPABASE_URL` and `SUPABASE_KEY` (your project's URL and publishable key) |
| `js/constants.js` | `CREDS.pass`, the offline fallback password. Set it to a long random value |

### Accounts and collaboration

Projects belong to the account that is signed in, and an account can only see its own projects. For a team to work on the same projects, everyone logs in to **one shared account**. Create it in the Supabase dashboard, then everyone logs in with that email and password. The guide covers this in Step 5.

### Hosting on GitHub Pages

1. Push the folder to a GitHub repo
2. Settings, then Pages, then Source: main branch, root folder
3. The site is live at `https://yourname.github.io/repo-name`
4. Add that address as the Site URL in Supabase (Authentication, then URL Configuration)

### Security notes

- Everything in `js/` is visible to anyone who opens the site, even if the repo is private. Never put a Supabase `secret` or `service_role` key, or your database password, in these files.
- The `sb_publishable_` key in `js/supabase.js` is meant to be public. Row-level security in Supabase is what protects the data, so do not skip that step in the guide.
- The username and password in `js/constants.js` only give offline access with no syncing. They are not a secure login.

## Project structure

```
rocketwire/
├── index.html              # Entry point: loads CSS and JS, holds all page markup
├── RocketWire-Setup-Guide.pdf
├── css/
│   ├── styles.css          # Main styles
│   └── folders.css         # Home page folder styles
├── js/
│   ├── constants.js        # Pinouts, wire colors, connector types, offline login
│   ├── state.js            # Global state (ST, camera, drag state, navigation stack)
│   ├── supabase.js         # Supabase URL, key and client
│   ├── storage.js          # save/load, cloud push/pull, login and sign-up
│   ├── project-sync.js     # Merges a local project with its cloud copy
│   ├── folders.js          # Nested folders on the home page
│   ├── undo.js             # Undo / redo history
│   ├── panels.js           # Left and right panel toggles
│   ├── splice.js           # Splice creation and editing
│   ├── export.js           # CSV / PDF export and boot sequence
│   ├── canvas/
│   │   ├── routing.js      # Edge detection, bezier curves, obstacle avoidance
│   │   ├── draw.js         # Main redraw loop: wires, systems, connectors
│   │   └── events.js       # Mouse events, drag, zoom, hit testing, right-click menus
│   └── pages/
│       ├── home.js         # Projects home page
│       ├── connector.js    # Connector editor (pin diagrams, channel list)
│       └── add-system.js   # Add a system or connect an existing one
└── tests/
    └── project-sync.test.js
```

## Tests

The sync merge logic has unit tests that use Node's built-in test runner (Node 18 or newer):

```
node --test tests/
```

## Adding a connector type

1. Add its pin positions to the pinout table in `js/constants.js`, and add it to `AUTO_PINS` and `FIXED_PINS` if its pin count is fixed
2. Add an `<option>` for it in the connector type dropdowns in `index.html` and `js/pages/add-system.js`
