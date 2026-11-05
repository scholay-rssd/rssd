# Private data overlay

The calendar corpus in `desktop/src/calendar/*.json` and the site seeds in
`sites/seeds/*.json` are synthetic samples. Application builds always use these
public files; an installed desktop app reads its real calendar from the runtime
archive under its data directory (`legacy-calendar/`, captured with
`desktop/scripts/legacy-calendar.mjs`).

Manual exports and corpus tests can read private data from an overlay instead:

- `RSSD_DATA_DIR` names an absolute directory, or
- `deploy/data/` exists in the checkout (git-ignored; normally a separate
  private repository).

The overlay mirrors repository paths, for example
`<overlay>/desktop/src/calendar/historyEvents.json` and
`<overlay>/sites/seeds/<siteId>.json`. A present overlay directory replaces the
public directory as a whole and must contain every public JSON file name, so a
partial copy fails loudly instead of mixing private and synthetic records.

Readers:

- `scripts/sync-data.mjs` (default calendar source),
- `scripts/seed-site.mjs` and `scripts/preview-site-organization.mjs`
  (default seed file),
- `scripts/deploy-site.sh` (seeds shipped in a site package),
- desktop Vitest: `desktop/scripts/calendar-corpus-plugin.mjs` redirects
  calendar JSON imports and enables tests that need the real corpus
  (`__RSSD_CALENDAR_CORPUS__`); without it they are skipped.

Never commit overlay contents to this repository.
