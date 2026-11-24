# MAHAJYOTISH — Firebase Cloud Sync & Monetization Guide
Developed by Mahaindustries (Pro. Ankit Sharma • Contact: 7500343487)

## 1. Enable Firebase Auth & Firestore Cloud Sync
1. Create a Firebase project at https://console.firebase.google.com/
2. Enable **Authentication** (Email/Password or Google Sign-In) and **Cloud Firestore**.
3. Copy your `firebaseConfig` object and paste it inside the **Account & Cloud Sync** modal in the app (or configure it in your deployed frontend).
4. Recommended Firestore Security Rules:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## 2. Enable UPI / Razorpay Premium Plans
- Configure your Razorpay Checkout key on `server.js` (keep `RAZORPAY_KEY_SECRET` in `.env`, never in frontend JS).
- Verify payment signatures server-side before unlocking premium subscription flags in Firestore.
