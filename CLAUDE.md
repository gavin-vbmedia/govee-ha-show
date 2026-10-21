# Govee HA Show

A Home Assistant add-on for making and playing music-synchronised Govee light shows. One Python
service (aiohttp) in `govee_show/app/goveeshow/` serves a browser editor (plain ES modules in
`static/`, no build step) and streams baked frames to the lights over Govee's LAN "razer" protocol.
README.md has the architecture and a map of every file.

The owner (Gavin) uses this at home and wants Claude to run the project with as little input from
them as possible. How much to decide alone is in `.claude/skills/steward/SKILL.md`.

## Commands

```sh
python -m pytest -q                 # Python tests (tests/)
node --test tests/js/*.mjs          # editor logic tests (tests/js/)

# Run the editor locally; requests from this machine are allowed without HA ingress
cd govee_show/app
GOVEE_SHOW_CONFIG=/tmp/gs/config GOVEE_SHOW_MEDIA=/tmp/gs/media python -m goveeshow
# then http://localhost:8099/
```

There is no linter. CI (`.github/workflows/ci.yml`) runs both test suites, checks the three
version numbers match, builds the Docker image and checks it serves `/api/info`.

No real lights are reachable from a cloud session. To see a UI change working, run the service
locally, add **planned lights** (devices with no IP, `PUT /api/devices`) and drive the editor with
Playwright (Chromium is at `/opt/pw-browsers`; `pip install playwright`, never `playwright install`).

## Every user-facing change is a release

Home Assistant only offers an update when the version goes up, so each PR that changes what the
user gets (code or docs) carries its own release:

1. Bump the patch version in all three, identically: `pyproject.toml`, `govee_show/config.yaml`,
   `govee_show/app/goveeshow/__init__.py`.
2. Add a section at the top of `govee_show/CHANGELOG.md`: `## 0.2.N`, then bullets written for the
   user (what they'll notice and where), not for developers.
3. Update `govee_show/DOCS.md` (the user guide, shown on the add-on's Documentation tab) for any
   behaviour, button or setting that changed. Update README.md's feature list for new features.
4. Title the PR and commit `What changed (0.2.N)`, e.g. `Collapse editor panels to their title (0.2.65)`.

If `main` moved on while you worked, take the next free version number when you merge it in.
Changes that only touch tests, CI or `.claude/` don't need a release.

## Conventions

- Effects are written once, in `static/js/effects.js`, and used both for previews and for baking.
  The Python player never computes effects; it only plays baked frames. Keep it that way.
- Saved data lives in the add-on's config folder (shows, devices, palettes, presets, settings,
  house photo) and is part of users' backups. Old saved shows and settings must keep loading:
  read missing fields with defaults rather than changing the format in place.
- Server input is validated in `server.py` (`_clean_*` helpers); follow that pattern for new
  endpoints, and add a test in `tests/test_server.py`.
- New editor logic that can be tested without a DOM goes in its own module with a node test,
  like `autogen.js` and `tests/js/autogen.test.mjs`.
- Comments are sparse and explain why. Match the surrounding code.
- Writing for users (DOCS.md, CHANGELOG.md, UI text): plain British English ("colour"), second
  person, bold for on-screen names (**Save**, **Setup → Devices**), no jargon.
