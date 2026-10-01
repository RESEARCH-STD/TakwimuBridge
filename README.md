# TakwimuBridge — Qualitative Data Analysis Tool

**Live:** https://takwimubridge-qda.vercel.app — auto-deployed from this repo's `main` branch via Vercel (see "Deploying" below for how the build installs Quarto in Vercel's cloud build).

A **Quarto + Bootstrap 5** web app implementing SST's ("Sustainable Solutions
Tanzania") qualitative data analysis (QDA) tool, laid out as a dashboard
(sidebar navigation, project overview home page): import KIIs, FGDs,
interviews and open-ended responses, highlight and code passages — one
passage can be coded to several theme groups (e.g. a cause, a challenge and
an impact) in a single reading — with an optional 1–10 importance weight,
then get live frequency/coverage/weighted-score analytics at theme,
sub-theme or code level, a respondent×theme matrix, theme clouds (themes
sized by coded frequency) and word clouds, group comparisons, and
CSV/Excel/Word/PNG/JSON exports — entirely in the browser, no server.

Built from two source documents (already incorporated into the app and
pages): `TakwimuBridge_Qualitative_Data_Analysis_Tool_Functional_Description.docx`
and `TakwimuBridge_Simple_User_Guide.docx` (kept in the parent
`DATABRIDGE/` folder).

> **Naming note:** unlike the sibling `../SITE-1` project (whose "Takwimu
> Bridge" name is an explicitly-labelled placeholder), **"TakwimuBridge" is
> the real product name** given in SST's own functional description. See
> [about.qmd](about.qmd) for the naming collision this creates with SITE-1,
> which is left for the project owner to resolve.

## What this is (and isn't)

This is a **static site**. Unlike a typical "proof of concept" that mocks
its core workflow, the qualitative coding and analysis here is **genuinely
functional**: it runs entirely as client-side JavaScript against the
browser's `localStorage`. Optionally (see "Cloud sync" below), researchers
can sign in and their projects sync to a Supabase database so they can
continue on another computer; the browser copy remains the working copy.

| Feature | Status |
|---|---|
| Coding workspace (highlight → theme → colour → weight) | ✅ Real |
| Coding one passage to several theme groups in one reading, adding sub-themes inline | ✅ Real |
| Frequency / coverage / total weight / average weight analysis, at theme, sub-theme or code level | ✅ Real, computed live |
| Respondent × Theme matrix, heat map, group comparison | ✅ Real |
| Theme cloud (themes sized by coded frequency), word frequency & word cloud | ✅ Real |
| CSV, Excel (.xlsx), Word-compatible report, PNG, JSON export | ✅ Real |
| DOCX / TXT / CSV import | ✅ Real (mammoth.js / SheetJS, client-side) |
| Accounts + cloud sync across computers (Supabase), conflict-safe | ✅ Real, once `assets/config.js` is filled in |
| Multi-user / team projects | ❌ Not implemented — each account holds one researcher's own projects |
| Inter-coder reliability, advanced compound queries | ❌ Not implemented — data model anticipates them |

See [about.qmd](about.qmd) for the full scope table.

## Requirements

- [Quarto](https://quarto.org/docs/get-started/) ≥ 1.4 (tested with 1.10)
- A browser with internet access on first load (for Google Fonts + the CDN
  libraries: Chart.js, wordcloud2.js, SheetJS, mammoth.js). No other
  dependencies — this renders to plain static HTML/CSS/JS.

## Install & Run

```bash
quarto preview      # live-reloading local preview
quarto render        # builds the static site into ./_site
```

## Deploying

This repo auto-deploys to Vercel on every push to `main` (project `takwimubridge-qda`, team `geomap-onboarding-portal`), via Vercel's GitHub integration — no CI file in this repo controls it.

Vercel's build image doesn't include Quarto, so `vercel.json`'s `buildCommand` downloads the pinned Quarto CLI release tarball (currently v1.10.18, matching local dev — bump both together) into `.quarto-bin/` and runs `quarto render` before Vercel serves `outputDirectory: "_site"`. No R/Python/Jupyter engine is needed since none of the `.qmd` files use code chunks — just Quarto + its bundled Pandoc.

To deploy manually instead (e.g. to test before pushing): `quarto render` locally, then `npx vercel deploy ./_site --prod --yes --project takwimubridge-qda`.

## Cloud sync (optional)

With `assets/config.js` empty the app is browser-only. To switch accounts on:

1. Create a Supabase project and run [`supabase/setup.sql`](supabase/setup.sql) once in its SQL Editor — a `projects` table (one JSON document per project, keyed by owner + project id), database-set `updated_at` version stamps, and row-level security so each user can only read or change their own rows.
2. In Authentication → URL Configuration, set the Site URL to the live site and allow `https://<site>/**` as a redirect URL (email confirmation and password-reset links return there).
3. Put the Project URL and the **public** (anon / publishable) key in `assets/config.js`. Never the secret / service_role key.

How it behaves (`assets/cloud.js`):

- The browser copy is always the working copy; every page still reads and writes it synchronously. Each save is uploaded about a second later; each page load first pulls the account's version list (ids + stamps only) and downloads full data just for projects that changed.
- Transcripts live in their own `sources` column and are only re-uploaded when they change, so coding a passage sends a few kilobytes rather than every transcript — this matters on mobile data.
- Browsers cap local storage at roughly 5 MB per site, and signing in brings the whole account into the browser. Very large accounts would need a move to IndexedDB.
- An upload only applies if the account still holds the version this browser last saw. If a project changed on two computers, the account's version keeps the original and this browser's edits become a separate "(conflicted copy)" project — nothing is silently overwritten.
- Deletions are stored as tombstones so they reach the user's other computers; a project edited elsewhere after this browser last saw it is restored rather than deleted.
- Offline edits stay marked and upload when the connection returns (or on the next page load).
- Signing in on a browser that already has projects asks whether to add them to the account; signing out removes the account's projects from that browser (important on shared computers).
- The Supabase client (`@supabase/supabase-js`, pinned, with an SRI hash) is only downloaded when sync is configured.

## Project Structure

```
_quarto.yml                Site config: footer, theme, page-layout: custom, html-table-processing: none
custom.scss                 Bootstrap variable overrides + dashboard/component styles (blue/teal palette)
_includes/head-extra.html   Fonts + CDN libraries (Chart.js, wordcloud2.js, SheetJS, mammoth.js) + app scripts
_includes/app-shell.html    Dashboard sidebar navigation + mobile top bar (included before every page body)
assets/config.js             Cloud sync settings (Supabase URL + public key); empty = browser-only
assets/app.js                Core data model, localStorage persistence, all analysis computations
assets/demo-data.js          Seeded demo project (5 KIIs + 1 FGD, Challenges/Causes/Impacts), versioned upgrades
assets/cloud.js              Optional sign-in + sync to Supabase (pull on page load, push on save, conflict copies)
supabase/setup.sql           One-time database setup: projects table, version stamps, row-level security
assets/ui.js                 Sidebar behaviour, evidence modal, theme chips, Themes/Sub-themes level switch
assets/coding-ui.js          Coding Workspace: sources, transcript highlighting, coding panel, codebook, import
assets/charts.js             Chart.js / theme cloud / word cloud / heat-colour rendering helpers
assets/export.js             CSV / XLSX / Word-report / PNG / JSON export + JSON import
index.qmd                    Dashboard (home): active project KPIs, theme charts, coding progress, latest quotes
guide.qmd                    Simple User Guide (adapted from the source .docx)
projects.qmd                 Create / open / delete / import projects, reset the demo
workspace.qmd                 The coding tool (sources · transcript · coding panel)
analysis.qmd                  Theme analysis at any level, matrix, group comparison, hierarchy, evidence drill-down
wordfrequency.qmd             Theme cloud (default) and word cloud, with tables
export.qmd                    Export center
about.qmd                     Scope, credits, and the SITE-1 naming-collision note
```

Two Quarto settings matter here: every page uses `page-layout: custom` so
the sidebar shell controls the layout, and `html-table-processing: none` is
required — the tables are empty shells filled by JavaScript, and with
processing on, Quarto fails to convert them and drops the raw HTML that
precedes them in the same block.

## Data model

One JSON object per project, stored under `localStorage['tb_project_<id>']`:

```
Project { id, title, description, topic, researcher, org, date, weightingEnabled, memo }
Source  { id, type, name, text, speakers?: [{id,label}] (FGD only), attributes: {...}, memo }
Theme   { id, parentId (null|themeId), name, color, memo }   // self-referential → Theme→Sub-theme→Code
Coding  { id, sourceId, speakerId?, themeIds: [...], start, end, quote, weight?: 1-10, memo }
```

`Coding.themeIds` is an array so one passage can carry multiple codes —
including codes from different top-level themes, which is how a single
reading codes causes, challenges and impacts together. Analysis rolls a
coding up to every ancestor of its theme(s), so a parent theme's stats
include all its descendants automatically, counting each coded reference
once per theme. The analysis "level" (`TB.themesAtLevel`) is a cut through
the tree at one depth, plus any leaf that stops short of it, so no coded
reference drops out of a level.

## Where placeholders / seed content live

| Item | Where | Notes |
|---|---|---|
| Demo project | `assets/demo-data.js` | Safe to delete or reset from the Projects page; its Challenges sub-themes match the functional doc's illustrative respondent×theme matrix exactly. Bump `DEMO_VERSION` when changing it: untouched older demos upgrade in place, edited ones are left alone, deleted ones stay deleted |
| Logo | `images/logo.svg` | Simple placeholder monogram |
| Brand colors | `custom.scss` | Deliberately distinct from `../SITE-1`'s palette |
| Site URL | `_quarto.yml` (`website.site-url`) | The Vercel production URL — update it if the site moves to a custom domain (used for social-card links) |
