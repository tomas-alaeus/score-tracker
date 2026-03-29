# ScoreTracker

## After each change

1. **Verify** — run `npm run verify` from the project root. This checks JS syntax on all modules and runs unit tests for pure logic functions. Fix any failures before proceeding.
2. **Deploy** — use the MCP deployer tool: `mcp__deployer__deploy` with `project_path: /home/vinden/projects/scoretracker`
3. **Bump cache version** — increment `?v=YYYYMMDD` on the `style.css` and `js/main.js` references in `web/index.html`
4. **Commit** — `git add` changed files, `git commit`
5. **Push** — `git push`

## Test coverage

Pure logic functions live in `web/js/math.js` and are tested in `tests/logic.js` (run via `npm run verify`).
When adding new pure functions (no DOM, no browser APIs), add them to `math.js` and add corresponding tests.
Visual/interaction behaviour still requires manual browser verification.
