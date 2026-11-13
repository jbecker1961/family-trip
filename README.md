# Family Disney Trip

A shared, password-protected trip planner for the family. It's plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages, with trip data stored in Firebase (Firestore).

- **Overview:** countdown, booking windows (dining, Lightning Lane, check-in) worked out from your dates, who's going with heights, trip at a glance, and sharing.
- **Day by day:** a park for each day and a timed plan (rides, Lightning Lane, dining, breaks), with confirmation numbers and who's going.
- **Must-dos:** everyone votes; known rides fill in park and height minimum, and anyone too short is flagged.
- **To-dos & packing**, and a **Budget** with paid/unpaid totals by category.

It installs to a phone's home screen and keeps working with a weak signal: changes made offline sync when the phone reconnects.

## How access works

Each trip has a link (`?t=<random key>`) and a **trip password**. Both are needed, and only the organizer can create a trip or set its password.

- The trip's data lives at `trips/<key>` in Firestore.
- Each trip has one Firebase sign-in account, `<key>@trips.example.com`, whose password is the trip password. No email is ever sent to that address; it only names the account.
- `firestore.rules` lets a device read or write a trip only while it's signed in to that trip's account. Someone with the link but not the password gets nothing from the database.
- Public sign-up and self-deletion are turned off in **Authentication > Settings > User actions**, so nobody can create an account from the site. Trip accounts are created only in the Firebase console.
- Firebase blocks repeated wrong passwords for a while (`auth/too-many-requests`).
- Each device enters the password once and stays signed in. **Sign out of this trip** on the Overview tab signs a device out.

Send the link and the password separately (for example, the link by text and the password out loud).

### Create a trip

1. Make a random key of 28 lowercase letters and digits, for example: `python3 -c "import secrets;print(''.join(secrets.choice('abcdefghijkmnpqrstuvwxyz23456789') for _ in range(28)))"`
2. In **Authentication > Users > Add user**, enter `<key>@trips.example.com` and the trip password.
3. Open `https://<your site>/?t=<key>`, enter the password, and fill in the trip details.

### Change the trip password

There's no reset email, because the account address isn't real. Instead:

1. In **Authentication > Users**, delete the trip's user (the data stays; it's stored by key, not by account).
2. **Add user** again with the same `<key>@trips.example.com` email and the new password.
3. Devices signed in with the old password get signed out within about an hour and are asked for the new one.

## One-time Firebase setup

1. Go to https://console.firebase.google.com and **Create a project**. Google Analytics isn't needed.
2. **Build > Authentication > Get started > Sign-in method**: enable **Email/Password**. Leave "Email link" off.
3. **Build > Firestore Database > Create database**: choose **production mode** and a location near you (for example `us-east1`).
4. **Firestore Database > Rules**: replace the rules with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.
5. **Project settings (gear) > General > Your apps**: add a **Web** app (the `</>` icon). Skip Firebase Hosting. Copy the `firebaseConfig` object it shows into [`firebase-config.js`](firebase-config.js) in place of `null`.
6. **Authentication > Settings > User actions**: uncheck **Enable create (sign-up)** and **Enable delete**, then **Save**.

The values in `firebase-config.js` identify the project and are safe to publish; the rules and the trip password are what protect the data. Firebase's free Spark plan is far more than a family trip needs.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/?t=<key>.

## Host it on GitHub Pages

Push this folder to a GitHub repository, then turn on **Settings > Pages > Deploy from a branch**, branch `main`, folder `/ (root)`. GitHub Pages needs a public repository on a free GitHub plan; that's fine here because the repository holds only code, and trip data stays in Firebase behind the password.

## Files

- `index.html`, `styles.css`, `app.js`: the app.
- `firebase-config.js`: your Firebase project's web config.
- `firestore.rules`: the database access rules (paste into the Firebase console).
- `sw.js`, `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`: home-screen install and offline support.
