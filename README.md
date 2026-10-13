# Purok attendance

A read-only attendance website hosted on GitHub Pages, with a private Google administrator dashboard and Google Sheets storage. No database subscription, Node/PHP hosting, or other hosting provider is required.

**[Open the website](https://zaqxen.github.io/purok-attendance/)** · **[Connect the private dashboard](SETUP.md)**

The initial release contains clearly labelled fictional records for 2024–2026. No real member records, credentials, or source spreadsheet IDs are included.

## Daily use

Open the website to view the current reporting year, search names, read attendance explanations, and compare saved years. The Administrator button opens your Google dashboard after setup. Only your configured Google account can access it.

In the dashboard, edit attendance, profiles, monitoring periods, transfers and Doktrina records. Save changes privately, then publish when ready. Publishing writes a sanitized report to GitHub. GitHub Pages normally needs a few minutes to deploy it. Visitors read only GitHub files and make zero Google requests. An open visitor page shows its loaded version until refreshed.

## Attendance rules

- A reporting week runs Tuesday–Sunday, matching the source workbook. A week is completed the following Monday. The reporting year can start in late December.
- Arrival week counts; departure week is excluded. Returning members get another monitoring period. Historical periods remain.
- Kap K/B starts monitoring; other classifications remain in the private roster. Historical eligibility comes from dated periods, not today's classification.
- A blank completed monitored week is absent. Outside-monitoring and open/future weeks are excluded from percentages.
- Weekly absence is absent members divided by eligible members that week. Individual annual attendance is attended weeks divided by completed eligible weeks. Group annual attendance uses total attended member-weeks divided by total eligible member-weeks.
- The administrator's attendance must have an explicit member row. No automatic `+1` is added.
- Legacy `1` and `X` mean outside monitoring. The reviewed import retains old cell notes privately and requires decisions for unknown markers.

Current-year totals advance when you publish after a week closes. This deliberate publication cutoff keeps all viewers on the same saved report. The new year appears automatically; no sheet duplication is needed.

## Data boundaries

Google holds birthdates, mobiles, addresses, gender, classification, private notes, Doktrina, and publishing credentials. GitHub receives member IDs/names, monitoring dates, attendance, explicitly public reasons and computed totals. Public reports and Git history are accessible to everyone, even if search engines are asked not to index the site. Removing a record from the current website does not erase Git history.

Keep the application workbook and original workbook Restricted in Google Drive. Copy the private workbook periodically for a backup; GitHub is only a backup of the public reports. History is retained by the application until you explicitly remove the underlying Google/GitHub records; free provider availability is not a permanent service guarantee.

## Development

Use Node.js 22 or later; there are no package dependencies.

```text
npm run prepare:google
npm run demo
npm test
npm run preview
```

`docs/` is the published site. `google/` is the private Apps Script application. `lib/attendance.js` is the shared calendar and report calculation. Run preparation after changing it or `google/Admin.template.html`. Upload only the generated `Admin.html`, not the template, to Google.

`npm run demo` overwrites published report files with fictional data. Run it only during initial development, never after publishing real reports. Developing code must preserve `docs/data/` and the latest remote commits from the administrator.

Tests cover calculations, authorization, concurrent-edit protection, transfer history, public export privacy, reviewed import, and publishing failure. Google authorization and live Sheet writes must also be verified after account setup.
