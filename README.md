# Trip Planner (v2 test: personal logins)

> This is the **v2-accounts** test branch. The live Disney planner is on `main`. This version needs its own Firebase project; see "One-time setup for the TEST project".


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

## How access works (v2: personal logins)

Everyone has their own login: their own email and a password they choose. A trip lists the emails that can open it, so one person can have a solo trip, a family trip and a trip shared with another family, and each person only ever sees the trips they're on.

- **Sign up:** anyone can create an account on the site (name, email, password), then must tap the confirmation link Firebase emails them.
- **Approval:** a new account starts as **pending** and can read or write nothing until the admin approves it on the **Approvals** page (on the dashboard, admin only). The admin can also deny an account, or remove access later. Pending people see a "Waiting for approval" screen, with an optional button to text the admin.
- **Admin:** the email listed in `adminEmails()` in `firestore.rules`. That account is approved automatically.
- **Dashboard ("My trips"):** the trips you're on, and **My families**: saved groups of people (name, and an email if they have a login) for adding people to a trip in one tap. Kids and anyone without a login are just names.
- **New trip:** pick a name, type (Walt Disney World, Disneyland or another trip with no parks), optional dates, and tick who's going. Only ticked people with an email can open it. You're always included, and you're the trip's **planner**.
- **Inside a trip:** the same Home, Trip, Day, Must-dos and Lists tabs as before. Trips that aren't Disney hide parks, booking windows, ride heights and Lightning Lane. **Who can open this trip** on Home lists everyone with access. Anyone on the trip can add people by email (and add a saved family); only the planner can remove people or delete the trip.
- **Just me** in the people filter shows your own itinerary, including plans with others.
- Signing out also clears the offline copy on that device.

### Copy a trip from the old planner

On the dashboard, **Copy a trip from the old planner** takes an old trip link and that trip's password, reads the trip read-only from the live project (`appConfig.legacyConfig`), and saves a copy that only you can open. The old trip is never changed. Afterwards, link people to their emails under **Who can open this trip** ("On the plan as").

### What the rules enforce (on Google's servers, not just in the app)

- Only accounts with a confirmed email get anywhere. Unconfirmed sign-ups write nothing to the database.
- A pending or denied account can't read or write anything. Nobody can approve themselves.
- A trip can be read only by the emails in its `members` list. Non-planners can only add to that list, never remove; the planner can't be removed.
- Only the admin can list accounts.

### Costs and bots

This stays on the free **Spark** plan, which has no billing account, so nothing can ever be charged. The worst a flood of fake sign-ups could do is hit a daily free limit and pause the app until the next day. Never click **Upgrade** / **Blaze** in Firebase and never link a billing account in Google Cloud.

Optional extra shield: **App Check** with reCAPTCHA v3 (free) makes the database accept requests only from this website. Register a reCAPTCHA v3 key for the site, add it under **App Check** in the Firebase console, enforce it for Firestore and Authentication, and put the site key in `appConfig.appCheckKey` in `firebase-config.js`.

## One-time setup for the TEST project

Use a **separate** Firebase project so the test version can never touch the live trip.

1. https://console.firebase.google.com > **Create a project**, for example `family-trip-test`. Google Analytics isn't needed. It starts on the free Spark plan.
2. **Build > Authentication > Get started > Sign-in method**: enable **Email/Password** (leave "Email link" off). Under **Settings > User actions**, keep **Enable create (sign-up)** checked: the approval step keeps strangers out.
3. **Build > Firestore Database > Create database**: **production mode**, a location near you.
4. **Firestore Database > Rules**: paste [`firestore.rules`](firestore.rules), replace `you@example.com` with your own email (lowercase), and **Publish**.
5. **Authentication > Settings > Authorized domains**: add `jbecker1961.github.io` so the hosted test site can sign in.
6. **Project settings > General > Your apps**: add a **Web** app and copy its `firebaseConfig` into [`firebase-config.js`](firebase-config.js) in place of `null`. Optionally set `adminPhone` there.
7. Open the test site (or run it locally, below), **Create an account** with the admin email, confirm it from your inbox, and you're in.

The values in `firebase-config.js` identify the project and are safe to publish; the rules are what protect the data.

### Not done yet

- "Sign in with Google".
- Testing the rules in Firebase's emulator (the app's screens and logic are tested headlessly).

## Run it locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. (`localhost` is allowed for sign-in by default.)

## Test site

The test version is its own repository, `jbecker1961/family-trip-test`, published at https://jbecker1961.github.io/family-trip-test/. It shares that web address with the live planner, so it keeps its own saved settings (prefixed `v2test-`), its own offline cache and its own home-screen name ("Trip Test"). Push this branch there to update it: `git push test v2-accounts:main`.

## Host it on GitHub Pages

Push this folder to a GitHub repository, then turn on **Settings > Pages > Deploy from a branch**, branch `main`, folder `/ (root)`. GitHub Pages needs a public repository on a free GitHub plan; that's fine here because the repository holds only code, and trip data stays in Firebase behind the password.

## Files

- `index.html`, `styles.css`, `app.js`: the app.
- `firebase-config.js`: the TEST Firebase project's web config, plus `appConfig` (admin name, optional phone, App Check key, test banner).
- `firestore.rules`: the database access rules (paste into the Firebase console).
- `sw.js`, `manifest.webmanifest`, `icon-*.png`, `apple-touch-icon.png`: home-screen install and offline support.
