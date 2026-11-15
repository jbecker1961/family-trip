// v2 TEST version: this must point at a separate Firebase project (for example "family-trip-test"),
// never the live "family-disney-trip" project. Until it's filled in, the app shows a setup notice.
// Firebase console > Project settings > Your apps > Web app > Config, then paste it in place of null.
export const firebaseConfig = null;

// Shown on the sign-up and "waiting for approval" screens.
export const appConfig = {
  adminName: 'Jason',
  adminPhone: '',          // optional: a number here adds a "Let Jason know" text-message button for pending accounts
  appCheckKey: '',         // optional: reCAPTCHA v3 site key once App Check is set up (README)
  testBanner: true         // shows "Test version" at the top
};
