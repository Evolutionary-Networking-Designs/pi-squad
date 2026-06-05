# @pi-squad/pi-web-plugin

PI WEB plugin for pi-squad workspaces.

## What it adds

- **Squad** workspace panel with:
  - current focus from `.squad/identity/now.md`
  - team roster from `.squad/team.md`
  - latest orchestration activity from `.squad/orchestration-log/`
  - decision count from `.squad/decisions.md`
  - manual refresh button for re-reading `.squad/` state
- **Run /squad** action-palette command that starts or focuses the selected session and sends `/squad`
- **Squad** workspace status label that prefers recent orchestration activity, then falls back to the latest decision summary

## Install

PI WEB discovers this plugin from `package.json#piWeb.plugins`.

For local development, add the package directory to PI WEB's local plugin list by symlinking it into the plugin directory:

```bash
npm install
mkdir -p ~/.pi-web/plugins
ln -s /home/kiera/projects/pi-squad/community/packages/pi-web-plugin ~/.pi-web/plugins/pi-squad
```

Then reload the PI WEB browser tab.

## Development

```bash
npm run build -w packages/pi-web-plugin
npm run dev -w packages/pi-web-plugin
npm run test -w packages/pi-web-plugin
```

`npm run test` is currently a placeholder. Proto's browser smoke gate is planned under:

```bash
PISQUAD_WEB_SMOKE=1
```

## Troubleshooting

If the plugin does not appear, check:

```bash
curl http://127.0.0.1:8504/pi-web-plugins/manifest.json
```

## OSS note

`src/` is part of the published OSS package. Keep the plugin independent from `@pi-squad/coordinator` internals and treat `.squad/` parsing as a file-format integration boundary.
