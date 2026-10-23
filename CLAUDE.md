# HA-liday Show

A Home Assistant app (formerly an add-on) for making and playing music-synchronised light shows on
Govee lights, WLED strips, pixel controllers (DDP and E1.31), Home Assistant lights and switches, and
Twinkly (experimental). One Python service (aiohttp) in `haliday_show/app/halidayshow/` serves a browser editor
(plain ES modules in `static/`, no build step) and streams baked frames to each light in its own
protocol: Govee's LAN "razer" protocol, DDP, E1.31, Home Assistant actions or Twinkly's realtime mode.
It also runs without Home Assistant, as a Docker container or a `pipx` install (see "Running
without Home Assistant" below). README.md has the architecture and a map of every file.
**Before changing how lights are driven (`output.py`, `protocol.py`, `wled.py`, `e131.py`,
`twinkly.py`), read that kind's notes, listed in `docs/README.md`**. For Govee that's
`docs/govee-protocols.md`: what's known about each protocol, measurements from the owner's real
lights, what was tried and didn't work, and open questions. Add to the notes when you learn something
new about the lights. A new kind of light gets its own `docs/<kind>.md` and a row in `docs/README.md`.
Saved lights have a `kind`; each kind's saved fields are a saved-data change to agree with Gavin.

The owner (Gavin) uses this at home and wants Claude to run the project with as little input from
them as possible. How much to decide alone is in `.claude/skills/steward/SKILL.md`.

## Commands

```sh
python -m pytest -q                 # Python tests (tests/)
node --test tests/js/*.mjs          # editor logic tests (tests/js/)

# Run the editor locally; requests from this machine are allowed without HA ingress
cd haliday_show/app
HALIDAY_SHOW_CONFIG=/tmp/gs/config HALIDAY_SHOW_MEDIA=/tmp/gs/media python -m halidayshow
# then http://localhost:8099/

# The way people run it without Home Assistant
pipx install . && HALIDAY_SHOW_PASSWORD=pw haliday-show   # data in ~/haliday-show/
```

There is no linter. CI (`.github/workflows/ci.yml`) runs both test suites, checks the three
version numbers match, builds the Docker image and checks it serves `/api/info`, runs that image
standalone on the host network with a password, and installs with `pipx`. `publish.yml` pushes the
image to `ghcr.io/gdeboos/ha-liday-show` on every merge that touches `haliday_show/`.

No real lights are reachable from a cloud session. To see a UI change working, run the service
locally, add **planned lights** (devices with no IP, `PUT /api/devices`) and drive the editor with
Playwright (Chromium is at `/opt/pw-browsers`; `pip install playwright`, never `playwright install`).
To check what goes on the wire, give a light the IP `127.0.0.1` and listen on its port: UDP 4003
(Govee), 4048 (WLED and DDP), 5568 (E1.31) or 7777 (Twinkly); for Home Assistant lights run a fake
Home Assistant and point `HA_URL` and `HA_TOKEN` at it.

Questions only the real lights can answer go to the owner one simple step at a time (for Govee lights,
ideally through the packet lab, Setup → Labs; it appears once **Show the Labs tab** is ticked under Setup → Settings): give the exact thing to paste or press and what to
look for. Check which lights the owner actually has before asking.

## Every user-facing change is a release

Home Assistant only offers an update when the version goes up, so each PR that changes what the
user gets (code or docs) carries its own release:

1. Bump the patch version in all three, identically: `pyproject.toml`, `haliday_show/config.yaml`,
   `haliday_show/app/halidayshow/__init__.py`.
2. Add a section at the top of `haliday_show/CHANGELOG.md`: `## 0.2.N`, then bullets written for the
   user (what they'll notice and where), not for developers.
3. Update `haliday_show/DOCS.md` (the user guide, shown on the app's Documentation tab and linked
   for Docker and pipx installs) for any behaviour, button or setting that changed. Update README.md's feature list for new features.
4. Title the PR and commit `What changed (0.2.N)`, e.g. `Collapse editor panels to their title (0.2.65)`.

If `main` moved on while you worked, take the next free version number when you merge it in.
Changes that only touch tests, CI or `.claude/` don't need a release.

## Running without Home Assistant

Three ways to run it, one codebase: the **app** (the main one), **Docker** (the app's own image
from ghcr.io, with `standalone/docker-compose.yml`) and **pipx** (`pyproject.toml` builds the package;
its dependencies are read from `haliday_show/requirements.txt`; the `haliday-show` command defaults its
data to `~/haliday-show/`). User guide: "Running without Home Assistant" in DOCS.md.

- **The app must behave exactly as before.** Anything only for standalone installs is switched on
  by an environment setting and/or only when `SUPERVISOR_TOKEN` is absent (as `HALIDAY_SHOW_PASSWORD`
  is). Don't change the Dockerfile, `config.yaml` or the app's `/config` and `/media` defaults for
  standalone reasons.
- Who may connect is decided in `server.py`'s `ingress_only`: the ingress proxy and this machine always,
  everyone with `HALIDAY_SHOW_ALLOW_ALL=1`, otherwise other devices only with the password (HTTP Basic,
  any user name). New routes are covered automatically; don't add ways round it.
- Settings for standalone installs are environment variables (`HALIDAY_SHOW_*`, `HA_URL`/`HA_TOKEN`,
  `ANTHROPIC_API_KEY`). A new app option needs an environment fallback too, listed in DOCS.md's
  settings table.
- Outside Home Assistant there's no `hassio.app_stdin`, and speakers only play songs if Home
  Assistant can see the same songs folder. Features that need Home Assistant should say so rather
  than break when `ha.available` is false.
- Saved files are the same in every install, so shows copy across. The data-format rule below covers
  all three.
- No new accounts or paid services (Gavin's call): no PyPI, Docker Hub or similar. GitHub only.

## Conventions

- Effects are written once, in `static/js/effects.js`, and used both for previews and for baking.
  The Python player never computes effects; it only plays baked frames. Keep it that way.
- Saved data lives in the app's config folder (`HALIDAY_SHOW_CONFIG` elsewhere) (shows, devices, palettes, presets, settings,
  house photo) and is part of users' backups. Old saved shows and settings must keep loading:
  read missing fields with defaults rather than changing the format in place.
- Server input is validated in `server.py` (`_clean_*` helpers); follow that pattern for new
  endpoints, and add a test in `tests/test_server.py`.
- New editor logic that can be tested without a DOM goes in its own module with a node test,
  like `autogen.js` and `tests/js/autogen.test.mjs`.
- Comments are sparse and explain why. Match the surrounding code.
- Home Assistant renamed add-ons to **apps** in 2026.2 (**Settings → Apps**, **App store**). Say "app"
  in anything users read, or "HA-liday Show" where Docker and pipx installs are meant too. Names in
  code and config (`addon_config`, `/addons`, the `addon` in Supervisor API paths) stay as they are.
- Writing for users (DOCS.md, CHANGELOG.md, UI text): plain British English ("colour"), second
  person, bold for on-screen names (**Save**, **Setup → Devices**), no jargon.
