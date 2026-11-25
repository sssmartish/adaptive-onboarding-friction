# Adaptive Onboarding Friction

A five-step onboarding prototype that uses recent interaction evidence to adjust guidance in real time. The aim is to detect difficulty across steps, beyond what a single inline validation message can show.

The browser records categorical events such as a failed email-format check, a valid field, or a navigation move. The state engine maintains a recent-event window and a separate ledger for unresolved evidence, then classifies the interaction as Stable, Friction, or Critical. The response controller chooses guidance appropriate to the current screen. The decision trace explains the score and any override.

## Run the demo

Use Node.js 22 or later. No dependencies are required just to run the prototype:

```sh
npm start
```

Open the localhost URL printed in the terminal (default: `http://127.0.0.1:4173`). Node serves static files; scoring, guidance, and local analysis run in the browser. There is no backend, database, or automatic collection.

Try the same invalid email three times and open **View decision trace**. Then correct the input and continue. To try post-hoc analysis without creating a session, run `npm run example:reports` and import both generated JSON files from `evidence/examples/` at `/analysis.html`. The counts represent events, not distinct people.

## Run the tests

```sh
npm ci
npm test
npm run test:scenarios
npx playwright install chromium
npm run test:browser
```

| Command | What it checks |
| --- | --- |
| `npm test` | Node unit and integration tests for scoring, transitions, guidance selection, and report handling. |
| `npm run test:scenarios` | Replays controlled sequences and checks actual scores and states against expected outcomes. |
| `npm run test:browser` | Playwright walkthrough of the real UI, including keyboard, responsive, reporting, and regression checks. |
| `npm run test:compatibility` | Chrome and Edge workflow checks (installed browser channels), followed by the original Windows Firefox initial-render check. Firefox workflow coverage is not claimed. |
| `npm run test:performance` | Measures state-engine processing on the current machine. |

The Playwright suite uses its bundled Chromium by default. On Linux, use `npx playwright install --with-deps chromium` if browser system dependencies are missing. Set `BROWSER_PATH` only if you intentionally want to run the main suite with another compatible executable. `PORT` can override the port if another process is using it. `HOST` applies to the manual server and defaults to loopback; tests bind to loopback explicitly.

GitHub Actions is configured to install dependencies from the lockfile and run the unit/integration, scenario, and Chromium suites. Generated results and screenshots are written to `evidence/`. A browser failure also attempts to collect a screenshot and a Playwright trace. Use only synthetic inputs in test artifacts.

### Browser regression example

**B25:** Complete Account, go back, submit an invalid email five times, fix it, and return to Profile. The correction brings the evidence score to 0.8, and the return raises it to 1.0 under the existing loop rule. Guidance must not refer to a highlighted field or display an error summary when no field error exists. The browser test verifies the screen as well as the decision trace. See [the browser suite](tests/browser/run-browser-tests.mjs) and [the corresponding response integration test](tests/integration/response-and-data.test.mjs).

## Research scope and citation

The scenario definitions are executable in [the scenario matrix](tests/scenarios/run-scenario-matrix.mjs). This repository tests the rules in a controlled onboarding flow; it does not establish improved outcomes, disability detection, or accessibility conformance. This repository contains a maintained version of the research prototype. Test results apply to the version or commit tested. Cite the exact version or commit you used with [CITATION.cff](CITATION.cff).

## Licence

The prototype source and tests are available under the [MIT licence](LICENSE).
