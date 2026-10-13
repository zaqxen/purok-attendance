# Connect the private administrator dashboard

The website now shows imported attendance for 2024–2026. Complete this setup once to activate private administration using your chosen Google account. Do not paste passwords or tokens into GitHub, this guide, or chat.

## 1. Create your Google application

1. Sign into your chosen administrator Google account and open [Google Apps Script](https://script.google.com/home/start). Create a new project called **Purok attendance**.
2. Open [Purok.gs](google/Purok.gs), choose **Raw**, and copy the whole file. Replace all text in the new project's default **Code.gs** with it. This single file includes the private dashboard, calendar, importer and publisher. Do not also paste the separate source files.
3. In Project Settings, enable **Show appsscript.json manifest file**. Replace that file with [appsscript.json](google/appsscript.json).
4. Under Project Settings → Script properties, add **ADMIN_EMAIL**, with your administrator Gmail address as its value. This account must also own/deploy the script. Keep other properties managed by the app.
5. Save. Choose **Deploy → New deployment → Web app**. Set **Execute as: User accessing the web app** and **Who has access: Only myself**. Do not select anonymous or anyone access. Authorize the requested Google permissions under your account. The manifest also specifies owner-only access.
6. Open the deployed `/exec` link and click **Create private data workbook**. Google creates a separate private workbook; the original is not overwritten. Confirm the new workbook's sharing is **Restricted**.

If Google does not offer the stated access setting for your account, stop before deploying and resolve the account restriction. Do not make the dashboard public as a workaround. The app additionally refuses every request whose signed-in account differs from ADMIN_EMAIL.

## 2. Connect publication to GitHub

1. In GitHub, create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) owned by your account. Select **Only select repositories → purok-attendance**. Grant repository **Contents: Read and write**; Metadata read access is automatic. No account-wide or workflow permission is needed. Choose an expiry and renew it before it expires.
2. In the private Google dashboard → **Setup & import**, paste that token and the deployed Google `/exec` URL. Click **Save publishing connection**. The token is kept in Google script properties; it is not returned to the browser or published to GitHub.
3. The repository's Pages source should be **Deploy from a branch → main → /docs** in [Pages settings](https://github.com/zaqxen/purok-attendance/settings/pages). The public URL is `https://zaqxen.github.io/purok-attendance/`.

## 3. Review the old Sheet import

1. Set the original workbook's sharing to **Restricted**. The script owner can still read it.
2. In Setup & import, paste the original spreadsheet URL and choose **Review import**. Import requires an empty application workbook.
3. Review every attendance name match across 2024–2026, especially abbreviated or historical-only names. Match spelling variants to one member. Review unknown attendance markers and every Doktrina inviter.
4. Pre-arrival/post-transfer `1` placeholders and `X` become excluded weeks. Intermediate `1` markers between actual attendances count as present. Choose **Outside monitoring** for `.` and **Saturday** for `S - Link`. Missing date headers are not guessed. The importer preserves the member IDs already published on this website. Source cell notes remain private. After importing, use Restore private comments to upload the separately provided private-comments-backup.json. Never commit that backup to GitHub.
5. Click **Import reviewed records privately**. Review the monitoring periods and correct their dates where needed. The original workbook remains unchanged.
6. Add your own member row with Kap K or B and the correct first monitored week. Record only the historical attendance you can confirm; the old formula's `+1` is not invented as history. Members with no legacy attendance row also need a confirmed first monitoring week.
7. Review what will be public: names, attendance, monitoring dates and totals. Contact details, birthdays, gender, Kap, Doktrina and all comments stay in Google. Anyone can see the published attendance, and GitHub retains earlier published versions in its history.
8. Click **Publish saved records**. Wait for GitHub Pages deployment, refresh the public website, and check a transfer week, an attendance status, an older year, and your own row.

## Updates and recovery

For routine updates, use **Save & publish** after marking attendance. Use **Save attendance** to keep a draft private. Saving profiles/transfers privately does not publish them until you click Publish.

If publication fails, your saved private records remain in Google and the last successful public report stays available. Fix the connection and retry Publish. If you see a concurrent-edit message, reload before editing again; the app never silently overwrites another session.

When changing the Google application source later, run preparation locally, replace Code.gs with the regenerated Purok.gs, and use **Manage deployments → Edit → New version** to update the existing deployment while preserving its URL. Keep owner-only access.

Back up the private application workbook periodically using Google Drive's Make a copy. To restore, set the private script property **DATA_SPREADSHEET_ID** to the verified backup workbook's ID. Do not edit the Records table by hand; it stores dated records and a revision used to prevent conflicting saves.
