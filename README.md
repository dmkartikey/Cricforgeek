# cricforgeek

Cricket stats for geeks. Ball-by-ball analytics for every format: impact, win probability, matchups, phase splits and inferred pitch-zone weaknesses, rebuilt every night from [Cricsheet](https://cricsheet.org) and published as a free static site.

The sidebar sets the context for every page: **format** (Test, ODI, T20, first-class, List A, The Hundred), **men or women**, and **level** (full members + major leagues, internationals only, or everything). Light and dark themes.

- **Overview**: the pulse of the format (run rate, runs per wicket, dot %, pace share, each against the previous year), batting and bowling leaders with a tab per metric, breakouts (dumbbell), clutch performers, scoring mix, year and phase trends, chasing advantage. Choosing Test adds the Test match lab (chases by target, follow-ons, toss, home advantage, the ageing ball, conditions by country).
- **Players** and **Player**: directory, then a profile with a stat band where any number opens a breakdown by phase, bowling type or hand, innings, leverage, year, opposition and venue. Percentiles, year trends, splits, pitch maps (inferred), matchups, recent form.
- **Compare**: up to four players overlaid: head-to-head table, yearly lines, phase bars, pace v spin scatter, side-by-side pitch maps, common opponents, and a same-years mode.
- **Teams** and **Team**: record band and form, win % and run rates by season, phase butterfly, batting order, pace v spin, attack mix, how they get out, leaders and appearances, highest and lowest totals, biggest wins, venues, head to head, recent results.
- **Competitions**, **Matches** and **Match**: full scorecards for every innings (dismissals with fielders, extras, total, did not bat, fall of wickets, maidens, wides and no-balls, partnerships), over-by-over Manhattan, worm, win probability and turning points.
- **Explorer**: Statsguru-style query builder with CSV export.
- **My pinboard**: pin any leaderboard or breakdown; boards are saved in your browser.
- **Methodology**: every model explained, with live calibration charts.

## How it works

```
Cricsheet all_json.zip ──► pipeline/ (Python + DuckDB) ──► web/public/data/*.json ──► web/ (React + D3) ──► GitHub Pages
                         ingest → models → derived tables → export
```

No server or database to run. A GitHub Action (`.github/workflows/nightly.yml`) downloads the full Cricsheet archive every night, rebuilds every model from scratch (about 5 minutes) and deploys the static site to GitHub Pages. Generated data is never committed.

| Step | File | What it does |
|---|---|---|
| Ingest | `pipeline/cricforgeek/ingest.py` | 23k+ match files → `balls`, `matches`, `appearances`, `players` Parquet tables |
| Competitions | `pipeline/cricforgeek/competitions.py` | Merges sponsor names (e.g. every County Championship) and sets format, tier and country |
| Models | `pipeline/cricforgeek/models.py` | Expected runs/wickets per ball (format, innings, over, wickets, era), run expectancy, win probability, leverage |
| Derived | `pipeline/cricforgeek/prep.py` | Bowler types, wicketkeeper detection, dismissal categories, batting/bowling innings |
| Export | `pipeline/cricforgeek/export.py` | Player, team, league, match, home, explorer and search JSON |
| Seeds | `pipeline/cricforgeek/seeds/` | `player_styles.csv` (batting/bowling styles) and `zones.json` (dismissal → pitch-zone weights). Edit and rebuild. |

### Key metrics

- **SR+ / Average+ / Economy+ / Wickets+**: actual vs expected for the same situations and era. 100 = average, higher is better.
- **Impact**: runs added above an average player, counting the run value of wickets (from a run-expectancy table in limited overs, runs per wicket in multi-day).
- **WPA**: win probability added. Each ball's change in win chance, credited to batter and bowler.
- **Clutch**: impact on high-leverage balls only (where win chance typically swings ≥1.5× normal).
- **Inferred pitch zones**: free data has no ball-tracking, so zones are inferred from how a batter gets out (bowled, LBW, caught behind, stumped…) and how they score (dots, ones to threes, fours, sixes) against the format's baseline, with a confidence score. Bowlers get the same maps for wickets, runs leaked and dot balls. The pipeline exports raw counts; the site builds the maps, so they can be filtered by phase, bowler type and batter hand. Weights live in `seeds/zones.json`.

## Run it locally

```bash
# 1. data (needs ~8 GB RAM, about 5 minutes)
curl -LO https://cricsheet.org/downloads/all_json.zip
curl -LO https://cricsheet.org/register/people.csv
cd pipeline
pip install -r requirements.txt
python -m cricforgeek.build --zip ../all_json.zip --people ../people.csv --work ../work --out ../web/public/data

# 2. site
cd ../web
npm install
npm run dev        # http://localhost:5173
```

Quick tests (no download needed): `cd pipeline && python -m pytest tests`.

## One-time GitHub setup

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Run the workflow once from the **Actions** tab (**Nightly data build & deploy → Run workflow**), or push to `main`.
3. The site appears at `https://<user>.github.io/cricforgeek/`. For a custom domain, add it under Settings → Pages.

## Coverage and limits

- All Cricsheet competitions: men's and women's Tests, ODIs and T20Is, IPL, WPL, Syed Mushtaq Ali, BBL/WBBL, PSL, CPL, SA20, T20 Blast, The Hundred, ILT20, MLC, BPL, LPL, Super Smash and more. First-class: County Championship, Sheffield Shield, Plunket Shield, Sri Lanka Major League. New competitions are picked up automatically.
- No Ranji Trophy (not in Cricsheet yet). No ball-tracking. Win probability is limited-overs only.
- Batting/bowling styles cover about 82% of deliveries; unknown styles are left out of pace/spin splits.

Data © Cricsheet, [ODC Attribution License](https://opendatacommons.org/licenses/by/1-0/).
