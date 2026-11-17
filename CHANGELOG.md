# Changelog

## 0.1.7

- Apply DSH Host/Origin and authentication admission to every HTTP route before owner authorization, body parsing or profile service access. Refuse missing, throwing and invalid synchronous checks.
- Refuse asynchronous host verdicts and consume rejected promises so an incompatible host check cannot leave an unhandled rejection.
- Apply the same synchronous contract to owner admission: consume rejected promises/thenables, refuse invalid rejection statuses and catch unreadable service or principal fields before any route work.
- Keep owner authorization, HTTP method checks, explicit write confirmation and route disposal. Add regressions for rejected asynchronous checks and unavailable connection services across all 16 routes.
- Retain the 0.1.6 client presentation and existing Node.js/DSH version ranges. See the [bilingual release notes](docs/release-notes-0.1.7.md).

## 0.1.6

- Keep long names and source paths from squeezing version and action columns; contain table scrolling on narrow windows. See the [bilingual release notes](docs/release-notes-0.1.6.md).
