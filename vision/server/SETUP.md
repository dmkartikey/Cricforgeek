# Turning on the cloud nets analyser

Until this is done, the nets analyser on cricforgeek.site runs on each visitor's own device. Once it's done, every clip
is analysed on Google Cloud Run: the same results on every phone, in seconds, and the clip is deleted straight after.

Cost: Cloud Run's free allowance (180,000 vCPU-seconds a month) covers roughly 1,500 clips a month. Beyond that it is a
few paise per clip. Storage of clips is negligible (they live for seconds). A budget alert is set up in step 6.

## 1. Create a Google Cloud project
1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Top bar → project picker → **New project**. Name it `cricforgeek`. Note the **Project ID** shown (e.g. `cricforgeek-123456`).
3. Billing: the console will ask you to link a billing account (a card). This is required even for the free allowance.

## 2. Create a service account for GitHub
1. Menu → **IAM & Admin → Service accounts → Create service account**. Name: `github-deploy`.
2. Give it these roles:
   - Cloud Run Admin
   - Cloud Build Editor
   - Artifact Registry Administrator
   - Storage Admin
   - Service Account User
   - Service Usage Admin
   - Service Account Admin (lets the deploy allow the analyser to sign upload links)
   - Viewer
3. Open the new account → **Keys → Add key → Create new key → JSON**. A file downloads. Keep it private.

## 3. Add two secrets to GitHub
On https://github.com/dmkartikey/Cricforgeek → **Settings → Secrets and variables → Actions → New repository secret**:
- `GCP_PROJECT_ID`: the Project ID from step 1.
- `GCP_SA_KEY`: open the JSON file from step 2 in a text editor and paste its whole contents.

Never paste the key into chat or anywhere else. Delete the downloaded file once the secret is saved.

## 4. Deploy
GitHub → **Actions → Nets analyser API → Run workflow**. It turns on the needed Google services, creates the private
upload storage (auto-deletes anything after a day), builds and deploys the analyser. About 10–15 minutes the first
time. The run summary ends with "Nets analyser live at https://…".

## 5. Switch the website over
The next nightly site build finds the analyser automatically (or run **Actions → nightly → Run workflow**). The nets
page then says "The clip is analysed on our server and deleted as soon as the analysis is done."

## 6. Budget alert (recommended)
Menu → **Billing → Budgets & alerts → Create budget**: amount ₹500 a month, alerts at 50%, 90%, 100%.
The analyser is also capped at 3 machines at once and 30 clips per hour per visitor.
