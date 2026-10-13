# Purok attendance

A read-only attendance website hosted on GitHub Pages, with a private Google administrator dashboard and Google Sheets storage. No database subscription, Node/PHP hosting, or other hosting provider is required.

**[Open the website](https://zaqxen.github.io/purok-attendance/)** · **[Connect the private dashboard](SETUP.md)**

The website now contains attendance imported from the existing Google Sheet for 2024–2026. Names, monitoring dates and attendance are intentionally public. Contact details, birthdays, private profiles, credentials and the source spreadsheet ID are not included in this repository.

## Daily use

Open the website to view the current reporting year, search names, and compare saved years. The Administrator button opens your Google dashboard after setup. Only your configured Google account can access it.

In the dashboard, edit attendance, profiles, monitoring periods, transfers and Doktrina records. Save changes privately, then publish when ready. Publishing writes a sanitized report to GitHub. GitHub Pages normally needs a few minutes to deploy it. Visitors read only GitHub files and make zero Google requests. An open visitor page shows its loaded version until refreshed.

## Attendance rules

- A reporting week runs Tuesday–Sunday, matching the source workbook. A week is completed the following Monday. The reporting year can start in late December.
- Arrival week counts; departure week is excluded. Returning members get another monitoring period. Historical periods remain.
- Kap K/B starts monitoring; other classifications remain in the private roster. Historical eligibility comes from dated periods, not today's classification.
- A blank completed monitored week is absent. Outside-monitoring and open/future weeks are excluded from percentages.
- Weekly absence is absent members divided by eligible members that week. Individual annual attendance is attended weeks divided by completed eligible weeks. Group annual attendance uses total attended member-weeks divided by total eligible member-weeks.
- The administrator's attendance must have an explicit member row. No automatic `+1` is added.
- Leading/trailing legacy `1` placeholders and `X` mean outside monitoring. A `1` between actual attendances counts as present, including temporary transfers across a year boundary. In the imported data, `.` means outside monitoring and `S - Link` means Saturday attendance.
- The administrator's own attendance was left out at their request, until entered explicitly. The 2024 source's week 13 has no date label, so monitoring starts no earlier than week 14.

Current-year totals advance when you publish after a week closes. This deliberate publication cutoff keeps all viewers on the same saved report. The new year appears automatically; no sheet duplication is needed.

## Data boundaries

Google holds birthdates, mobiles, addresses, gender, classification, all attendance comments, Doktrina, and publishing credentials. GitHub receives member IDs/names, monitoring dates, attendance, computed totals. Public reports and Git history are accessible to everyone, even if search engines are asked not to index the site. Removing a record from the current website does not erase Git history.

Keep the application workbook and original workbook Restricted in Google Drive. Copy the private workbook periodically for a backup; GitHub is only a backup of the public reports. History is retained by the application until you explicitly remove the underlying Google/GitHub records; free provider availability is not a permanent service guarantee.

## Development

Use Node.js 22 or later; there are no package dependencies.

```text
npm run prepare:google
npm run demo
npm test
npm run preview
```

`docs/` is the published site. `google/` is the private Apps Script application. `lib/attendance.js` is the shared calendar and report calculation. Run preparation after changing the Google source, calendar or `google/Admin.template.html`. For account setup, paste the generated `google/Purok.gs` as the project's only source file, plus appsscript.json. The separate source files are for development.

`npm run demo` refuses to overwrite real published reports. Generate fictional reports only in a separate development copy. Developing code must preserve `docs/data/` and the latest remote commits from the administrator.

Tests cover calculations, authorization, concurrent-edit protection, transfer history, public export privacy, reviewed import, and publishing failure. Google authorization and live Sheet writes must also be verified after account setup.
