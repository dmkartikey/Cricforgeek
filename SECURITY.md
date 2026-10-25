# Security

cricforgeek is a static website: there are no accounts, no logins, no server and no database.
Settings and pinboards stay in your own browser (localStorage) and are never sent anywhere.

## Reporting a problem

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/dmkartikey/Cricforgeek/security/advisories/new),
not as a public issue.

## What protects the site

- Served only over HTTPS from GitHub Pages.
- A Content Security Policy that lets only the site's own scripts run, and fetches data only from the site itself
  (fonts and their stylesheet come from Google Fonts).
- The app refuses to run inside another site's frame.
- All text from the data is escaped before it reaches a page.
- Dependencies are pinned to exact versions, checked by `npm audit` on every build, and updated weekly by Dependabot.
- The deploy workflow runs with the least permissions it needs, and its actions are pinned to exact commits.
