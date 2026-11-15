# Family Disney Trip

A shared, password-protected trip planner for the family. It's plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages, with trip data stored in Firebase (Firestore).

- **Home:** countdown, trip at a glance, next to-dos, booking windows (dining, Lightning Lane, check-in) worked out from your dates, who's going, and sharing.
- **Trip:** every day at once, with its park, hotel and plans, plus **Add all to calendar**.
- **Day:** a park and hotel for each day and a timed plan. Each plan lists only the people going (tap × to remove someone), can spawn a to-do with a due date and owner, and can be added to Apple or Google Calendar.
- **Must-dos:** everyone votes; known rides fill in park and height minimum, and anyone too short is flagged. Heights are set here.
- **Lists:** to-dos and packing.
- A **person filter** (Everyone, or any mix of people) on Home, Trip and Day shows only the plans that include them.

It's built for phones first (bottom tab bar, large tap targets, two-tap delete), installs to the home screen, and keeps working with a weak signal: changes made offline sync when the phone reconnects.

## Calendar

Calendar export is a one-time copy, not a live link: GitHub Pages can't serve a private, always-updating calendar feed, and doing that with Firebase would need its paid plan.

- **iPhone / Apple Calendar** downloads an `.ics` file; open it and tap **Add All**.
- **Google Calendar** opens a pre-filled event in Google Calendar.
- **Add all to calendar** on the Trip tab makes one `.ics` file with every plan shown (it follows the person filter).
- Events use the park's time zone. Each event keeps the plan's ID, so adding a changed plan again updates the event instead of duplicating it in Apple Calendar and in Google Calendar imports.

## Families

A trip can have several families (for example, two families travelling together). Each family has its own people, hotel, arrival and leave dates, park for each day, booking windows, to-dos and packing. Must-dos are shared.

- The switch at the top of each tab picks **Group** or one family. Each phone remembers its choice.
- Under it, that view's people are all on; tap someone to hide plans that only include them.
- In a family's view, other families' **key** plans appear in a compact, read-only form. Travel and dining plans are key by default; any plan can be starred or un-starred.
- **Home > Families** shows every family's dates, hotel, people, travel and key plans, and is where a family edits its details or adds people. **Add another family** is at the bottom of that panel.

The family views reduce clutter; they are not private. Everyone with the link and password can switch to Group.

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
