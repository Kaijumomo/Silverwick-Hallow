import type { FirebaseAppConfig } from "./config";

// Public client identifiers from the registered development web app. An API
// key identifies the Auth project too, so checking only projectId is unsafe.
export const DEVELOPMENT_FIREBASE_CONFIG = Object.freeze({
  apiKey: "AIzaSyCCNAhF548RjgmKS5vKDpCL72EAA0s4wNU",
  authDomain: "silverwick-hollow.firebaseapp.com",
  databaseURL: "https://silverwick-hollow-default-rtdb.firebaseio.com",
  projectId: "silverwick-hollow",
  storageBucket: "silverwick-hollow.firebasestorage.app",
  messagingSenderId: "863800899154",
  appId: "1:863800899154:web:c9dc003334dfc4d547118b",
} satisfies FirebaseAppConfig);

// Separate SDK/Auth persistence from any default app initialized in this page.
export const DEVELOPMENT_FIREBASE_APP_NAME = "silverwick-hollow-development";

export function isApprovedDevelopmentConfig(config: FirebaseAppConfig): boolean {
  const expected = DEVELOPMENT_FIREBASE_CONFIG;
  return Object.entries(expected).every(([key, value]) =>
    config[key as keyof FirebaseAppConfig] === value
  ) && Object.keys(config).every((key) => Object.prototype.hasOwnProperty.call(expected, key));
}
