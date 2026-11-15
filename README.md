# Family Disney Trip

A shared, password-protected trip planner for the family. It's plain HTML, CSS and JavaScript with no build step, hosted on GitHub Pages, with trip data stored in Firebase (Firestore).

- **Home:** each family's tile first (dates, hotel, an Outbound and a Return flight slot with flight number, airports, times, confirmation and a FlightAware tracking link, then parks, activities and dining), then the countdown, trip at a glance, next to-dos, booking windows (dining, Lightning Lane, check-in) worked out from your dates, who's going, and sharing.
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
- Under it is **Everyone** and that view's people. Tap a name to see just that person's itinerary, including plans they share with anyone from either family; tap more names to add them. **Everyone** or **Show everyone** clears it.
- A family's view shows only plans with at least one of its people on them, including plans shared with another family (labeled "With …"). Everything else is in Group.
- **Home > Families** shows each family's dates, hotel, people, travel and dining (your own family in a family view, every family in Group), and is where a family edits its details or adds people. **Add another family** is at the bottom of that panel.

The family views reduce clutter; they are not private. Everyone with the link and password can switch to Group.

## Flights

Each family has an **Outbound flight** and a **Return flight** on its Home tile (date, flight number, from, to, departs, arrives, confirmation). Saved flights appear on the Day and Trip tabs and in calendar export on their own, for everyone in that family. If an old travel plan like "EWR to MCO" is on the arrival or leave day, the flight form pre-fills from it, and saving moves it into the flight so it isn't listed twice.

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

## Run it on your iPhone (free)

`ios/DisneyTrip` is a small iPhone app that loads the live GitHub Pages site. Push a change to the website and it shows up in the app the next time the page loads. The trip password is saved with the website data on the phone, the same way it is in Safari.

Install **Xcode** from the Mac App Store and sign the app with the Apple ID you already have. That is the whole setup. The app needs iOS 17 or later. TestFlight and the App Store, which put the app on other people's phones, need the paid Apple Developer Program ($99 a year).

1. Install **Xcode** from the Mac App Store. Open it once and wait until it finishes installing the extra components.
2. Plug the iPhone into the Mac with a cable, unlock it, and tap **Trust**.
3. On the Mac, open `ios/DisneyTrip/DisneyTrip.xcodeproj` (double-click it). If Xcode asks to update the project settings, either choice is fine.
4. In the left sidebar, click the blue **DisneyTrip** project, then the **DisneyTrip** target under Targets. Open **Signing & Capabilities**.
5. Turn on **Automatically manage signing**. Next to **Team**, choose **Add an Account…**, sign in with your Apple ID, and pick the **Personal Team** (your name).
6. Leave the bundle identifier as `com.jbecker.familytrip`, or change it if Xcode says that one is taken. Something like `com.jbecker.familytrip.yourname` is fine. There is nothing to add under Capabilities.
7. At the top of the window, set the run destination to your iPhone, then press **Run** (the play button). The first build takes a few minutes, and Xcode creates a free provisioning profile. If a signing error appears, check that Team is your Personal Team and press Run again.
8. If the iPhone asks you to enable **Developer Mode**, turn it on, restart the phone, and press Run again. The switch is under **Settings > Privacy & Security > Developer Mode**. It sometimes appears only after the first Run.
9. If the app installs but won't open, and the phone says the developer isn't trusted: open **Settings > General > VPN & Device Management**, tap the Apple Development profile for your Apple ID, and tap **Trust**. On some iOS versions that menu is named **Device Management**.
10. Open **Disney Trip**. Paste the trip link (or just the key) and then the trip password. The password is remembered on this phone.

A free Apple ID signature lasts **7 days**. After that, plug the phone in and press Run again. Leave the app installed: Run refreshes the signature and keeps the saved sign-in.

To open a different trip later, tap **Open a different trip** on the Home tab (under Sign out). You can also long-press the Disney Trip icon on the Home Screen and tap **Change trip**.

Links that leave the planner, such as FlightAware and Google Calendar, open in Safari. **iPhone / Apple Calendar** asks to add the plans to Calendar, or to share the `.ics` file. Pull down on the plan to reload it.

The address the app loads is `Site.home` at the top of `ios/DisneyTrip/DisneyTrip/TripLink.swift`. Change that line if the website moves.

The `ios` folder is the app only. The website and the GitHub Pages setup are unchanged.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000/?t=<key>.

## Host it on GitHub Pages

Push this folder to a GitHub repository, then turn on **Settings > Pages > Deploy from a branch**, branch `main`, folder `/ (root)`. GitHub Pages needs a public repository on a free GitHub plan; that's fine here because the repository holds only code, and trip data stays in Firebase behind the password.

### Custom domain: allsetaway.com

The live site is served at **https://allsetaway.com** (the `CNAME` file). Old `jbecker1961.github.io/family-trip/` links redirect there automatically, trip key included.

- **DNS (Cloudflare, "DNS only", not proxied):** four `A` records for `@` (185.199.108.153, .109, .110, .111), four `AAAA` records (2606:50c0:8000::153, 8001, 8002, 8003), and `www` as a `CNAME` to `jbecker1961.github.io`.
- **HTTPS:** GitHub's free certificate, with **Enforce HTTPS** on. `http://` and `www.` both redirect to `https://allsetaway.com`.
- **Takeover protection:** the domain is verified for the jbecker1961 GitHub account (`_github-pages-challenge-jbecker1961` TXT record), so no other account can publish a Pages site on it.
- **DNSSEC** is on in Cloudflare.
- **No email:** `v=spf1 -all` and a DMARC `p=reject` record, so nobody can send mail pretending to be @allsetaway.com.
- **Firebase:** `allsetaway.com` is in Authentication > Settings > Authorized domains.

## Files

- `index.html`, `styles.css`, `app.js`: the app.
- `firebase-config.js`: your Firebase project's web config.
- `firestore.rules`: the database access rules (paste into the Firebase console).
- `sw.js`, `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`: home-screen install and offline support.
- `ios/DisneyTrip`: the iPhone app. See **Run it on your iPhone (free)**.
