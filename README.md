# TakwimuBridge — Qualitative Data Analysis Tool

A **Quarto + Bootstrap 5** website implementing SST's ("Sustainable Solutions
Tanzania") qualitative data analysis (QDA) tool: import KIIs, FGDs,
interviews and open-ended responses, highlight and code passages, assign
themes/sub-themes and an optional 1–10 importance weight, then get live
frequency/coverage/weighted-score analytics, a respondent×theme matrix, word
frequency & word clouds, group comparisons, and CSV/Excel/Word/PNG/JSON
exports — entirely in the browser, no server.

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

This is a **static site** — no backend, no database, no accounts. Unlike a
typical "proof of concept" that mocks its core workflow, the qualitative
coding and analysis here is **genuinely functional**: it runs entirely as
client-side JavaScript against the browser's `localStorage`, which is the
only way to deliver the tool's actual workflow without standing up a server.

| Feature | Status |
|---|---|
| Coding workspace (highlight → theme → colour → weight) | ✅ Real |
| Frequency / coverage / total weight / average weight analysis | ✅ Real, computed live |
| Respondent × Theme matrix, heat map, group comparison | ✅ Real |
| Word frequency & word cloud (all text or coded-passages-only) | ✅ Real |
| CSV, Excel (.xlsx), Word-compatible report, PNG, JSON export | ✅ Real |
| DOCX / TXT / CSV import | ✅ Real (mammoth.js / SheetJS, client-side) |
| Multi-user / team projects, cloud sync | ❌ Not implemented — single-browser storage only |
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

## Project Structure

```
_quarto.yml                Site config: navbar, footer, search, theme
custom.scss                 Bootstrap variable overrides + component styles (violet/teal palette)
_includes/head-extra.html   Fonts + CDN libraries (Chart.js, wordcloud2.js, SheetJS, mammoth.js) + app scripts
assets/app.js                Core data model, localStorage persistence, all analysis computations
assets/demo-data.js          Seeded demo project (5 KIIs + 1 FGD) matching the functional doc's illustrative matrix
assets/coding-ui.js          Coding Workspace behaviour: sources, transcript highlighting, codebook, import
assets/charts.js             Chart.js / word-cloud / heat-colour rendering helpers
assets/export.js             CSV / XLSX / Word-report / PNG / JSON export + JSON import
index.qmd                    Home (marketing/explainer)
guide.qmd                    Simple User Guide (adapted from the source .docx)
projects.qmd                 Create / open / delete / import projects
workspace.qmd                 The coding tool (3-panel layout)
analysis.qmd                  Analysis dashboard, matrix, group comparison, evidence drill-down
wordfrequency.qmd             Word frequency table + word cloud
export.qmd                    Export center
about.qmd                     Scope, credits, and the SITE-1 naming-collision note
```

## Data model

One JSON object per project, stored under `localStorage['tb_project_<id>']`:

```
Project { id, title, description, topic, researcher, org, date, weightingEnabled, memo }
Source  { id, type, name, text, speakers?: [{id,label}] (FGD only), attributes: {...}, memo }
Theme   { id, parentId (null|themeId), name, color, memo }   // self-referential → Theme→Sub-theme→Code
Coding  { id, sourceId, speakerId?, themeIds: [...], start, end, quote, weight?: 1-10, memo }
```

`Coding.themeIds` is an array so one passage can carry multiple codes.
Analysis rolls a coding up to every ancestor of its theme(s), so a parent
theme's stats include all its descendants automatically.

## Where placeholders / seed content live

| Item | Where | Notes |
|---|---|---|
| Demo project | `assets/demo-data.js` | Safe to delete from the Projects page; matches the functional doc's illustrative respondent×theme matrix exactly |
| Logo | `images/logo.svg` | Simple placeholder monogram |
| Brand colors | `custom.scss` | Deliberately distinct from `../SITE-1`'s palette |
| Site URL | `_quarto.yml` (`website.site-url`) | Placeholder — no deployment/CI is configured yet |
