# Gombe State High Court Website

The official website of the High Court of Justice, Gombe State, with its own content management dashboard.

The public site keeps the original design. Everything on it (judges, directorates, news, judgments, cause lists, rules, notices, gallery, pages, menu, home page and contact details) is now edited from the dashboard at `/admin`, with no coding.

## What you can do in the dashboard

* **Add, edit and publish content** in every section. Items can be saved as drafts and previewed before they go live.
* **Create new sections** whenever you need them (for example Registries, Practice Directions or Staff), choose their fields, and decide where they appear:
  * in the main menu, at the top level or under an existing heading such as The Court or Directorates;
  * on the home page, as a block you can move up or down;
  * inside the pages of another section, for example listing registries on the page of the directorate they belong to.
* **Manage the menu and home page**: reorder, hide, rename and add blocks or links.
* **Reset forgotten passwords**: an administrator opens the user, clicks **Generate a strong password**, saves, and gives the temporary password to the person privately.
* **Manage users**: the super admin creates accounts and decides, section by section, who can edit drafts and who can publish. Staff without publishing rights can still edit published pages; their changes wait for approval and the live page stays unchanged until approved.
* **History**: every save keeps a copy, and earlier versions can be restored.
* **Messages** sent through the contact form, an **activity log** of all changes, and a **backup** download.

## Deploying on Render

You need three accounts: GitHub (already set up), MongoDB Atlas and Cloudinary (already in use for another app).

### 1. MongoDB Atlas

1. Sign in at https://cloud.mongodb.com and create a cluster. For an official website choose a paid tier (M10 or above) so that automatic backups are included.
2. Under **Database Access**, add a database user with a strong password.
3. Under **Network Access**, allow access from Render. The simplest option is `0.0.0.0/0` together with the strong password above.
4. Click **Connect**, then **Drivers**, and copy the connection string. Put the password into it. This is your `MONGODB_URI`.

### 2. Cloudinary

On the Cloudinary dashboard, copy the **API Environment variable** (it starts with `cloudinary://`). This is your `CLOUDINARY_URL`. Photos and documents are stored in a folder called `gombe-high-court`, separate from your other app.

Cloudinary blocks delivery of PDF and ZIP files on new accounts by default. Turn on **Allow delivery of PDF and ZIP files** under Settings, Security, otherwise documents will not open.

Documents are shown inside the website by a built in viewer (public/vendor/pdfjs, Mozilla PDF.js, Apache 2.0 licence), and the site sends them to visitors itself, so links always open the court's own pages rather than Cloudinary addresses.

### 3. GitHub

Replace the contents of your repository with this project (keep your copy of the old files somewhere safe), then push:

```
git add .
git commit -m "Website with content management"
git push
```

The `public/assets` folder already contains the original logos, photos and PDFs. The large gallery folder is not needed in GitHub; see "Importing the gallery" below.

### 4. Render

1. In Render choose **New**, then **Blueprint**, and select the repository. Render reads `render.yaml` and creates a web service on the Starter plan.
2. Fill in the environment variables it asks for: `MONGODB_URI`, `CLOUDINARY_URL` and `SITE_URL` (the final address of the site, for example `https://judiciary.gm.gov.ng`). `SETUP_TOKEN` is generated automatically.
3. Deploy. On the first start the site imports all the content of the original website.
4. Open the **Environment** tab of the service, copy the value of `SETUP_TOKEN`, then visit `https://YOUR-SITE/admin/setup` and create the super admin account using that code.
5. When the domain is ready, add it under **Settings, Custom Domains** in Render and ask whoever manages the domain to point it to Render as instructed there.

If you prefer not to use the blueprint, create a **Web Service** manually with build command `npm install --omit=dev`, start command `npm start`, health check path `/health`, and the same environment variables, plus `NODE_ENV=production`.

## Importing the gallery

The original gallery (about 680 MB) is imported from your computer straight to Cloudinary, so it never has to pass through GitHub.

1. Install Node.js 20 or newer on the computer that has the photos.
2. In this project folder run `npm install`.
3. In PowerShell, set the same values as on Render, then run the import:

```
$env:MONGODB_URI="mongodb+srv://..."
$env:CLOUDINARY_URL="cloudinary://..."
npm run import-gallery -- "C:\Users\...\High_Court_Website\assets\img\gallery" --album "Judicial Gallery" --per-album 60
```

Photos in sub folders become one album per folder. Loose photos are split into albums of 60. If the connection drops, run the same command again: photos already uploaded are skipped. Cloudinary's free plan accepts images up to 10 MB each; larger ones are listed at the end so you can resize them.

Afterwards, rename albums, add captions and dates in the dashboard under **Gallery**.

## Backups

* **Dashboard**: super admins can download a backup from **Backup** at any time.
* **Command line**: `npm run backup` writes a file to the `backups` folder.
* **Restore**: `npm run restore -- backups/website-backup-2026-10-08.json --yes`, then restart the service.
* Uploaded files stay on Cloudinary; the backup records their addresses.

## Recovering access

If every super admin is locked out, run this from Render's **Shell** tab (or any computer with `MONGODB_URI` set):

```
npm run create-admin -- --email someone@example.com --name "Full Name"
```

It creates the account, or resets its password if the email already exists.

## Running on your own computer

```
npm install
npm run dev
```

Without `MONGODB_URI` the site uses a temporary in memory database, which is useful for trying things out. Set `DATA_FILE=dev-data.json` to keep that data between restarts. Uploads are saved in `public/uploads` unless `CLOUDINARY_URL` is set. Then open http://localhost:3000/admin/setup.

## Security measures

* Passwords are hashed with scrypt; accounts lock for 15 minutes after 5 wrong passwords, and sign in attempts are rate limited.
* Passwords given by an administrator (for new accounts and resets) are temporary: they expire after 72 hours, and the owner must choose their own password at first sign in before they can do anything else. The Users page shows who has not done so yet.
* Sessions expire after 8 hours, or 1 hour without activity. Changing a password signs out other devices.
* Every form in the dashboard is protected against cross site request forgery.
* Text from the editor is cleaned before it is saved, so scripts cannot be planted on public pages.
* Uploads are checked by content, not just by file name, and limited in size.
* A strict Content Security Policy and other security headers are sent with every page.
* All changes are recorded in the activity log.

## Old addresses

Links to the old pages keep working: for example `/ict.html` redirects to `/directorates/ict` and `/profiles/justice_halima.html` to `/judges/halima`.

## Content to complete

The original files referenced some photos and documents that were not in the folder. These now show a neat placeholder until they are uploaded in the dashboard:

* Photos of four past Chief Registrars and of Hon. Justice Joseph A. Awak
* Photos of the heads of Appeal, ICT, Library, Process and Research, Planning and Statistics
* Weekly cause list PDFs for High Courts 1 to 9, Magistrate Courts 1 to 16, and Dukku and Kaltungo appeals
* The Court Rules documents, and judgments GHC/CV/50/2023 and GHC/LND/10/2022

Some directorate pages still contain placeholder text from the original site (for example "Overview text goes here" on ICT, and the Appeal and Area Courts pages show the ICT email address). Two sample judgments ("ABC vs. XYZ" and a duplicate "SANI vs. IBRAHIM") were imported as drafts, so they are not public.

## Project structure

```
server.js              starts the website
src/                   application code
  routes/public.js     public pages
  routes/admin.js      dashboard
  views/               page templates
  layouts.js           display styles available for sections
  fields.js            field types available for sections
  seed.js              first run import of the original content
public/                styles, scripts and the original images and PDFs
seed/content.json      content extracted from the original website
scripts/               command line tools (import gallery, backup, restore, create admin)
render.yaml            Render deployment settings
```

The site needs only one third party package (the official MongoDB driver), which keeps it small and easy to keep secure.
