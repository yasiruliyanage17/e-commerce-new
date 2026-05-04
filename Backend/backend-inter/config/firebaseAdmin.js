import admin from "firebase-admin";
import fs from "fs";

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (err) {
    console.error("❌ Failed to parse FIREBASE_SERVICE_ACCOUNT env var:", err.message);
  }
}

if (!serviceAccount) {
  try {
    const keyPath = new URL("../serviceAccountKey.json", import.meta.url);
    if (fs.existsSync(keyPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(keyPath));
    }
  } catch (err) {
    console.warn("⚠️ serviceAccountKey.json not found or invalid. Ensure FIREBASE_SERVICE_ACCOUNT env var is set.");
  }
}

if (serviceAccount) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
} else {
  console.error("❌ Firebase Admin could not be initialized: Missing service account credentials.");
}

export default admin;

