// v2 TEST version: this must point at a separate Firebase project (for example "family-trip-test"),
// never the live "family-disney-trip" project. Until it's filled in, the app shows a setup notice.
// Firebase console > Project settings > Your apps > Web app > Config. These values identify the
// project; they are not passwords. Access is controlled by firestore.rules and admin approval.
export const firebaseConfig = {
  apiKey: "AIzaSyAYUeyupDP2kKlonr6zkYFWJCYWX6iK05M",
  authDomain: "family-trip-test.firebaseapp.com",
  projectId: "family-trip-test",
  storageBucket: "family-trip-test.firebasestorage.app",
  messagingSenderId: "453147199637",
  appId: "1:453147199637:web:fc15cf852859d14915f39c"
};

// Shown on the sign-up and "waiting for approval" screens.
export const appConfig = {
  adminName: 'Jason',
  adminPhone: '',          // optional: a number here adds a "Let Jason know" text-message button for pending accounts
  appCheckKey: '',         // optional: reCAPTCHA v3 site key once App Check is set up (README)
  testBanner: true,        // shows "Test version" at the top
  // The live planner's project, used ONLY to read (never write) a trip for "Copy a trip from the old planner".
  // Public web config, same as in the live site's firebase-config.js. Remove it to hide that option.
  legacyConfig: {
    apiKey: "AIzaSyBpevzuQWYsRfcRYmfSOw9GK_mQDsEYFm4",
    authDomain: "family-disney-trip.firebaseapp.com",
    projectId: "family-disney-trip",
    storageBucket: "family-disney-trip.firebasestorage.app",
    messagingSenderId: "549733207304",
    appId: "1:549733207304:web:a6db7e6f42dc97f121f0bd"
  }
};
