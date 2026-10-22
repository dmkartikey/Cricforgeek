"""Map Cricsheet event names to stable competition keys.

International cricket is grouped by gender and format (e.g. men's Tests).
Domestic events are grouped across sponsor renames (e.g. every County
Championship sponsor name becomes `county-championship`).
"""
from __future__ import annotations

import re

# family: T20 (20 overs), HUN (The Hundred, 100 balls), ODI (50 overs), MD (multi-day)
FAMILY_LABEL = {"T20": "T20", "HUN": "The Hundred", "ODI": "One-day", "MD": "Multi-day"}

# Domestic competitions: alias -> (key, label, country, tier)
# tier: "first-class", "list-a", "t20", "hundred"
_DOMESTIC = [
    # First-class
    (["County Championship", "LV= County Championship", "Specsavers County Championship"],
     "county-championship", "County Championship", "England", "first-class"),
    (["Bob Willis Trophy"], "bob-willis-trophy", "Bob Willis Trophy", "England", "first-class"),
    (["Sheffield Shield", "Marsh Sheffield Shield"], "sheffield-shield", "Sheffield Shield", "Australia", "first-class"),
    (["Plunket Shield"], "plunket-shield", "Plunket Shield", "New Zealand", "first-class"),
    (["Major League Tournament"], "sl-major-league", "Major League Tournament", "Sri Lanka", "first-class"),
    # List A
    (["Royal London One-Day Cup", "One-Day Cup"], "eng-one-day-cup", "One-Day Cup (England)", "England", "list-a"),
    (["The Marsh Cup", "One-Day Cup (Australia)"], "marsh-cup", "Marsh One-Day Cup", "Australia", "list-a"),
    (["Major Clubs Limited Over Tournament"], "sl-major-clubs-lo", "Major Clubs Limited Over", "Sri Lanka", "list-a"),
    (["Cricket Ireland Inter-Provincial Limited Over Cup"], "ire-ip-cup", "Inter-Provincial Cup", "Ireland", "list-a"),
    (["Rachael Heyhoe Flint Trophy"], "rhf-trophy", "Rachael Heyhoe Flint Trophy", "England", "list-a"),
    (["ECB Women's One-Day Cup"], "eng-w-one-day-cup", "Women's One-Day Cup (England)", "England", "list-a"),
    (["CG United Women's Super50"], "wi-w-super50", "Women's Super50", "West Indies", "list-a"),
    # T20
    (["Indian Premier League"], "ipl", "Indian Premier League", "India", "t20"),
    (["Syed Mushtaq Ali Trophy"], "smat", "Syed Mushtaq Ali Trophy", "India", "t20"),
    (["Women's Premier League"], "wpl", "Women's Premier League", "India", "t20"),
    (["Women's T20 Challenge", "Women's T20 Challenge Match"], "w-t20-challenge", "Women's T20 Challenge", "India", "t20"),
    (["Big Bash League"], "bbl", "Big Bash League", "Australia", "t20"),
    (["Women's Big Bash League"], "wbbl", "Women's Big Bash League", "Australia", "t20"),
    (["Vitality Blast", "NatWest T20 Blast", "Vitality Blast Men"], "t20-blast", "T20 Blast", "England", "t20"),
    (["Vitality Blast Women"], "w-t20-blast", "Women's T20 Blast", "England", "t20"),
    (["Charlotte Edwards Cup"], "charlotte-edwards-cup", "Charlotte Edwards Cup", "England", "t20"),
    (["Women's Cricket Super League"], "wcsl", "Women's Cricket Super League", "England", "t20"),
    (["Pakistan Super League"], "psl", "Pakistan Super League", "Pakistan", "t20"),
    (["Caribbean Premier League"], "cpl", "Caribbean Premier League", "West Indies", "t20"),
    (["Women's Caribbean Premier League"], "wcpl", "Women's Caribbean Premier League", "West Indies", "t20"),
    (["Bangladesh Premier League"], "bpl", "Bangladesh Premier League", "Bangladesh", "t20"),
    (["Lanka Premier League"], "lpl", "Lanka Premier League", "Sri Lanka", "t20"),
    (["Major Clubs T20 Tournament"], "sl-major-clubs-t20", "Major Clubs T20", "Sri Lanka", "t20"),
    (["SA20"], "sa20", "SA20", "South Africa", "t20"),
    (["CSA T20 Challenge", "Ram Slam T20 Challenge", "MiWAY T20 Challenge", "CSA Pro20"],
     "csa-t20", "CSA T20 Challenge", "South Africa", "t20"),
    (["Mzansi Super League"], "msl", "Mzansi Super League", "South Africa", "t20"),
    (["Super Smash", "HRV Cup", "HRV Twenty20"], "super-smash", "Super Smash", "New Zealand", "t20"),
    (["Women's Super Smash", "New Zealand Cricket Women's Twenty20"], "w-super-smash", "Women's Super Smash", "New Zealand", "t20"),
    (["International League T20"], "ilt20", "ILT20", "UAE", "t20"),
    (["Major League Cricket"], "mlc", "Major League Cricket", "USA", "t20"),
    (["Nepal Premier League"], "npl", "Nepal Premier League", "Nepal", "t20"),
    (["Cricket Ireland Inter-Provincial Twenty20 Trophy"], "ire-ip-t20", "Inter-Provincial T20", "Ireland", "t20"),
    (["European T20 Premier League"], "etpl", "European T20 Premier League", "Europe", "t20"),
    (["FairBreak Invitational Tournament"], "fairbreak", "FairBreak Invitational", "Global", "t20"),
    (["T20 Blaze", "Women's T20 Blaze"], "wi-w-t20-blaze", "Women's T20 Blaze", "West Indies", "t20"),
    # The Hundred
    (["The Hundred Men's Competition"], "hundred-men", "The Hundred (Men)", "England", "hundred"),
    (["The Hundred Women's Competition"], "hundred-women", "The Hundred (Women)", "England", "hundred"),
]

DOMESTIC = {}
for aliases, key, label, country, tier in _DOMESTIC:
    for a in aliases:
        DOMESTIC[a] = (key, label, country, tier)

_INTL_LABEL = {
    ("male", "Test"): ("men-test", "Men's Tests", "first-class"),
    ("female", "Test"): ("women-test", "Women's Tests", "first-class"),
    ("male", "MDM"): ("men-icc-fc", "ICC Intercontinental Cup", "first-class"),
    ("male", "ODI"): ("men-odi", "Men's ODIs", "list-a"),
    ("female", "ODI"): ("women-odi", "Women's ODIs", "list-a"),
    ("male", "ODM"): ("men-odm-intl", "Men's other one-day internationals", "list-a"),
    ("female", "ODM"): ("women-odm-intl", "Women's other one-day internationals", "list-a"),
    ("male", "T20"): ("men-t20i", "Men's T20Is", "t20"),
    ("female", "T20"): ("women-t20i", "Women's T20Is", "t20"),
    ("male", "IT20"): ("men-it20-other", "Men's other T20 internationals", "t20"),
    ("female", "IT20"): ("women-it20-other", "Women's other T20 internationals", "t20"),
}


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "unknown"


def family(match_type: str, balls_per_over: int) -> str:
    if match_type in ("Test", "MDM"):
        return "MD"
    if match_type in ("ODI", "ODM"):
        return "ODI"
    if balls_per_over == 5:
        return "HUN"
    return "T20"


def classify(info: dict) -> dict:
    """Return competition key, label, country, tier and group for a match info block."""
    mt = info["match_type"]
    gender = info.get("gender", "male")
    event = (info.get("event") or {}).get("name") or ""
    if info.get("team_type") == "international":
        key, label, tier = _INTL_LABEL.get((gender, mt), (slug(f"{gender}-{mt}"), f"{gender} {mt}", "other"))
        return {"comp": key, "comp_label": label, "country": "International", "tier": tier,
                "group": "International", "event": event}
    if event in DOMESTIC:
        key, label, country, tier = DOMESTIC[event]
    else:
        tier = {"MDM": "first-class", "ODM": "list-a"}.get(mt, "t20")
        key, label, country = "club-" + slug(event or "unnamed"), event or "Unnamed club cricket", "Other"
    return {"comp": key, "comp_label": label, "country": country, "tier": tier,
            "group": "Domestic", "event": event}
