import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDjQbGWua0kdo2EWRrQKCCdbteKYG8C-MU",
  authDomain: "didascere-quest-c4f38.firebaseapp.com",
  projectId: "didascere-quest-c4f38",
  storageBucket: "didascere-quest-c4f38.firebasestorage.app",
  messagingSenderId: "179704025376",
  appId: "1:179704025376:web:4602eeb90c4e5b1ad04745",
  measurementId: "G-DK66LNFGTD"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const loginForm = document.getElementById("login-form");
const recoveryForm = document.getElementById("recovery-form");
const loginEmailInput = document.getElementById("login-email");
const loginPasswordInput = document.getElementById("login-password");
const loginSubmitBtn = document.getElementById("login-submit-btn");
const recoveryEmailInput = document.getElementById("recovery-email");
const recoverySubmitBtn = document.getElementById("recovery-submit-btn");
const togglePasswordBtn = document.getElementById("toggle-password-btn");
const goToRecoveryBtn = document.getElementById("go-to-recovery-btn");
const goToLoginBtn = document.getElementById("go-to-login-btn");
const notificationBox = document.getElementById("notification-box");
const notificationText = document.getElementById("notification-text");

let isRedirecting = false;
let isManualLogin = false;

function showNotification(message, type) {
  notificationBox.className = `notification-box ${type}`;
  notificationText.textContent = message;
}

function clearNotification() {
  notificationBox.className = "notification-box hidden";
  notificationText.textContent = "";
}

function switchView(showForm, hideForm) {
  clearNotification();
  hideForm.classList.remove("active");
  showForm.classList.add("active");
}

function getSelectedRole() {
  return loginForm.querySelector('input[name="login-role"]:checked')?.value ?? "";
}

goToRecoveryBtn.addEventListener("click", () => {
  switchView(recoveryForm, loginForm);
});

goToLoginBtn.addEventListener("click", () => {
  switchView(loginForm, recoveryForm);
});

togglePasswordBtn.addEventListener("click", () => {
  const showPassword = loginPasswordInput.type === "password";
  loginPasswordInput.type = showPassword ? "text" : "password";
  togglePasswordBtn.textContent = showPassword ? "HIDE" : "SHOW";
  togglePasswordBtn.setAttribute("aria-label", showPassword ? "Hide password" : "Show password");
  togglePasswordBtn.setAttribute("aria-pressed", String(showPassword));
});

onAuthStateChanged(auth, async (user) => {
  if (!user || isRedirecting || isManualLogin) return;

  try {
    const userDoc = await getDoc(doc(db, "users", user.uid));
    const role = userDoc.exists() ? userDoc.data().role : null;

    if (role === "teacher" || role === "admin") {
      isRedirecting = true;
      window.location.href = "dashboard.html";
    }
  } catch (error) {
    console.error("Auth routing check failed:", error);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotification();

  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;
  const selectedRole = getSelectedRole();

  if (!selectedRole) {
    showNotification("Choose Admin or Teacher before logging in.", "error");
    return;
  }

  loginSubmitBtn.disabled = true;
  loginSubmitBtn.textContent = "CHECKING CREDENTIALS...";
  isManualLogin = true;

  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const userDoc = await getDoc(doc(db, "users", credential.user.uid));
    const actualRole = userDoc.exists() ? userDoc.data().role : null;

    if (actualRole !== "teacher" && actualRole !== "admin") {
      await signOut(auth);
      showNotification(
        userDoc.exists()
          ? "Access denied. This portal is for faculty and staff."
          : "Access denied. Faculty record not found.",
        "error"
      );
      return;
    }

    if (actualRole !== selectedRole) {
      await signOut(auth);
      showNotification(`This account is registered as ${actualRole}. Choose the matching role and try again.`, "error");
      return;
    }

    isRedirecting = true;
    showNotification("Login successful. Entering the village...", "success");
    window.location.href = "dashboard.html";
  } catch (error) {
    let message = "Something went wrong. Please try again.";

    if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(error.code)) {
      message = "Invalid email or password.";
    } else if (error.code === "auth/too-many-requests") {
      message = "Too many attempts. Please try again later.";
    } else if (error.code === "auth/network-request-failed") {
      message = "Network error. Check your connection.";
    }

    showNotification(message, "error");
  } finally {
    isManualLogin = false;
    if (!isRedirecting) {
      loginSubmitBtn.disabled = false;
      loginSubmitBtn.textContent = "ENTER THE VILLAGE";
    }
  }
});

recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearNotification();

  recoverySubmitBtn.disabled = true;
  recoverySubmitBtn.textContent = "SENDING RESET LINK...";

  try {
    await sendPasswordResetEmail(auth, recoveryEmailInput.value.trim());
    showNotification("If an account exists for that email, a reset link will be sent.", "success");
    recoveryEmailInput.value = "";
  } catch (error) {
    let message = "Could not send the reset link. Please try again.";

    if (error.code === "auth/invalid-email") {
      message = "Please enter a valid email address.";
    } else if (error.code === "auth/too-many-requests") {
      message = "Too many attempts. Please try again later.";
    } else if (error.code === "auth/network-request-failed") {
      message = "Network error. Check your connection.";
    }

    showNotification(message, "error");
  } finally {
    recoverySubmitBtn.disabled = false;
    recoverySubmitBtn.textContent = "SEND RESET LINK";
  }
});