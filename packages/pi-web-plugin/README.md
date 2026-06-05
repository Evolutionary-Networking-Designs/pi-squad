# @pi-squad/pi-web-plugin

Minimal PI WEB plugin for pi-squad workspaces.

## What it adds

- **Squad** workspace panel with roster + current focus
- **Run /squad** action-palette command
- **Squad** workspace status label based on the latest decision entry

## Install for local development

1. From the community repo root, install workspace dependencies:
   ```bash
   npm install
   ```
2. Symlink the package into PI WEB's local plugin directory:
   ```bash
   mkdir -p ~/.pi-web/plugins
   ln -s /home/kiera/projects/pi-squad/community/packages/pi-web-plugin ~/.pi-web/plugins/pi-squad
   ```
3. Reload the PI WEB browser tab.

PI WEB discovers plugin metadata from `package.json#piWeb.plugins`, then loads `pi-web-plugin.js` in the browser. The TypeScript source stays in `src/` for no-emit development and type-checking.

## Development

```bash
npm run build -w packages/pi-web-plugin
npm run dev -w packages/pi-web-plugin
```

If the plugin does not appear, check:

```bash
curl http://127.0.0.1:8504/pi-web-plugins/manifest.json
```
