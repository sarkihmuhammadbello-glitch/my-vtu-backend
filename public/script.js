
"use strict";

// HMB VTU TEST MODE
// Real purchases and payments are disabled.
const LIVE_PURCHASES_ENABLED = false;
const API_BASE_URL = "http://localhost:3000";
const TOKEN_KEY = "hmbVtuToken";

const $ = (id) => document.getElementById(id);

const menuToggle = $("menuToggle");
const navigation = $("navigation");
const rechargeForm = $("rechargeForm");

const airtimeTab = $("airtimeTab");
const dataTab = $("dataTab");
const serviceId = $("serviceId");
const phoneInput = $("phone");
const amountInput = $("amount");
const amountGroup = $("amountGroup");
const planGroup = $("planGroup");
const variationSelect = $("variationId");
const loadPlansButton = $("loadPlans");
const planMessage = $("planMessage");
const formMessage = $("formMessage");

const registerTab = $("registerTab");
const loginTab = $("loginTab");
const registerForm = $("registerForm");
const loginForm = $("loginForm");
const authForms = $("authForms");
const authStatus = $("authStatus");
const authMessage = $("authMessage");
const customerPanel = $("customerPanel");
const customerName = $("customerName");
const customerEmail = $("customerEmail");
const historyButton = $("historyButton");
const historyOutput = $("historyOutput");
const logoutButton = $("logoutButton");

let currentService = "airtime";
let loadedPlans = [];
let currentUser = null;

// Footer year.
$("year").textContent = new Date().getFullYear();

// --------------------------------
// GENERAL MESSAGE HELPERS
// --------------------------------

function showMessage(message, type = "success") {
  formMessage.textContent = message;
  formMessage.className = `message visible ${type}`;
}

function clearMessage() {
  formMessage.textContent = "";
  formMessage.className = "message";
}

function showAuthMessage(message, type = "success") {
  authMessage.textContent = message;
  authMessage.className = `message visible ${type}`;
}

function clearAuthMessage() {
  authMessage.textContent = "";
  authMessage.className = "message";
}

// --------------------------------
// MOBILE NAVIGATION
// --------------------------------

menuToggle.addEventListener("click", () => {
  const isOpen = navigation.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
});

navigation.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navigation.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

// --------------------------------
// ACCOUNT FORM TABS
// --------------------------------

function showAccountForm(type) {
  const showRegister = type === "register";

  registerForm.hidden = !showRegister;
  loginForm.hidden = showRegister;

  registerTab.classList.toggle("active", showRegister);
  loginTab.classList.toggle("active", !showRegister);

  registerTab.setAttribute("aria-selected", String(showRegister));
  loginTab.setAttribute("aria-selected", String(!showRegister));

  clearAuthMessage();
}

registerTab.addEventListener("click", () => {
  showAccountForm("register");
});

loginTab.addEventListener("click", () => {
  showAccountForm("login");
});

// --------------------------------
// BACKEND REQUEST HELPER
// --------------------------------

async function apiRequest(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const token = sessionStorage.getItem(TOKEN_KEY);

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers
    });
  } catch {
    throw new Error(
      "Cannot connect to the backend. Make sure your server is running at http://localhost:3000."
    );
  }

  let result = {};

  try {
    result = await response.json();
  } catch {
    // Handle an empty or non-JSON response.
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      sessionStorage.removeItem(TOKEN_KEY);
    }

    throw new Error(
      result.error ||
      result.message ||
      `Request failed (HTTP ${response.status}).`
    );
  }

  return result;
}


async function checkProviderBalance() {
  const button = document.getElementById("providerBalanceButton");

  try {
    if (button) button.disabled = true;

    const result = await apiRequest("/api/balance");

    alert("VTU.ng Provider Balance:\n" + JSON.stringify(result, null, 2));
  } catch (error) {
    alert("Could not check provider balance:\n" + error.message);
  } finally {
    if (button) button.disabled = false;
  }
}


document
  .getElementById("providerBalanceButton")
  ?.addEventListener("click", checkProviderBalance);


// --------------------------------
// ACCOUNT DISPLAY
// --------------------------------

function displayLoggedOut() {
  currentUser = null;

  authForms.hidden = false;
  customerPanel.hidden = true;

  authStatus.textContent = "You are not logged in.";
  authStatus.className = "message";
  historyOutput.replaceChildren();

  showAccountForm("login");
}

function displayLoggedIn(user) {
  currentUser = user;

  authForms.hidden = true;
  customerPanel.hidden = false;

  customerName.textContent = user.name || "Customer";
  customerEmail.textContent = user.email || "";

  authStatus.textContent = "You are logged in.";
  authStatus.className = "message visible success";

  clearAuthMessage();
}

// --------------------------------
// REGISTER
// --------------------------------

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessage();

  const name = $("registerName").value.trim();
  const email = $("registerEmail").value.trim().toLowerCase();
  const phone = $("registerPhone").value.trim();
  const password = $("registerPassword").value;

  if (name.length < 2) {
    showAuthMessage("Please enter your full name.", "error");
    return;
  }

  if (password.length < 8 || password.length > 72) {
    showAuthMessage(
      "Your password must be between 8 and 72 characters.",
      "error"
    );
    return;
  }

  const submitButton = registerForm.querySelector(
    'button[type="submit"]'
  );

  submitButton.disabled = true;
  submitButton.textContent = "Creating account...";

  try {
    const result = await apiRequest("/api/register", {
      method: "POST",
      body: JSON.stringify({
        name,
        email,
        phone,
        password
      })
    });

    if (!result.token || !result.user) {
      throw new Error(
        "The server did not return the expected account details."
      );
    }

    sessionStorage.setItem(TOKEN_KEY, result.token);
    displayLoggedIn(result.user);

    registerForm.reset();

    showAuthMessage(
      "Your account has been created successfully."
    );
  } catch (error) {
    showAuthMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Create Account";
  }
});

// --------------------------------
// LOGIN
// --------------------------------

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearAuthMessage();

  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;

  const submitButton = loginForm.querySelector(
    'button[type="submit"]'
  );

  submitButton.disabled = true;
  submitButton.textContent = "Logging in...";

  try {
    const result = await apiRequest("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password
      })
    });

    if (!result.token || !result.user) {
      throw new Error(
        "The server did not return the expected login details."
      );
    }

    sessionStorage.setItem(TOKEN_KEY, result.token);
    displayLoggedIn(result.user);

    loginForm.reset();

    showAuthMessage("Login successful.");
  } catch (error) {
    showAuthMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Log In";
  }
});

// --------------------------------
// RESTORE EXISTING LOGIN
// --------------------------------

async function restoreSession() {
  const token = sessionStorage.getItem(TOKEN_KEY);

  if (!token) {
    displayLoggedOut();
    return;
  }

  authStatus.textContent = "Checking your account...";

  try {
    const result = await apiRequest("/api/me");

    if (!result.user) {
      throw new Error("Account details were not returned.");
    }

    displayLoggedIn(result.user);
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    displayLoggedOut();

    showAuthMessage(
      "Your session could not be verified. Please log in again.",
      "error"
    );
  }
}

// --------------------------------
// LOGOUT
// --------------------------------

logoutButton.addEventListener("click", () => {
  sessionStorage.removeItem(TOKEN_KEY);
  displayLoggedOut();

  showAuthMessage("You have logged out successfully.");
});

// --------------------------------
// TRANSACTION HISTORY
// --------------------------------

historyButton.addEventListener("click", async () => {
  if (!currentUser) {
    showAuthMessage("Please log in to view your transactions.", "error");
    return;
  }

  historyButton.disabled = true;
  historyButton.textContent = "Loading...";
  historyOutput.replaceChildren();

  try {
    const result = await apiRequest("/api/transactions");

    const transactions = Array.isArray(result)
      ? result
      : Array.isArray(result.transactions)
        ? result.transactions
        : Array.isArray(result.data)
          ? result.data
          : [];

    const heading = document.createElement("h4");
    heading.textContent = "My transactions";
    historyOutput.appendChild(heading);

    if (transactions.length === 0) {
      const emptyMessage = document.createElement("p");
      emptyMessage.textContent =
        "No transactions are linked to your account yet.";
      historyOutput.appendChild(emptyMessage);
      return;
    }

    const list = document.createElement("ul");

    transactions.forEach((transaction) => {
      const item = document.createElement("li");

      const reference =
        transaction.request_id ||
        transaction.reference ||
        transaction.transaction_id ||
        "No reference";

      const type =
        transaction.type ||
        transaction.service ||
        transaction.transaction_type ||
        "Transaction";

      const status = transaction.status || "Status unavailable";

      const amount = Number(transaction.amount);

      const amountText = Number.isFinite(amount)
        ? ` · ₦${amount.toLocaleString("en-NG")}`
        : "";

      const phoneText = transaction.phone
        ? ` · ${transaction.phone}`
        : "";

      item.textContent =
        `${type} · ${reference} · ${status}${amountText}${phoneText}`;

      list.appendChild(item);
    });

    historyOutput.appendChild(list);
  } catch (error) {
    const errorMessage = document.createElement("p");
    errorMessage.textContent = error.message;
    historyOutput.appendChild(errorMessage);
  } finally {
    historyButton.disabled = false;
    historyButton.textContent = "View My Transactions";
  }
});

// --------------------------------
// AIRTIME / DATA TABS
// --------------------------------

function setService(type) {
  currentService = type;
  clearMessage();

  const isAirtime = type === "airtime";

  airtimeTab.classList.toggle("active", isAirtime);
  dataTab.classList.toggle("active", !isAirtime);

  airtimeTab.setAttribute("aria-selected", String(isAirtime));
  dataTab.setAttribute("aria-selected", String(!isAirtime));

  amountGroup.hidden = !isAirtime;
  planGroup.hidden = isAirtime;

  amountInput.required = isAirtime;
  variationSelect.required = !isAirtime;

  if (!isAirtime && loadedPlans.length === 0) {
    planMessage.textContent =
      "Select your network, then load the available plans.";
  }
}

airtimeTab.addEventListener("click", () => setService("airtime"));
dataTab.addEventListener("click", () => setService("data"));

document.querySelectorAll("[data-service]").forEach((card) => {
  card.addEventListener("click", () => {
    setService(card.dataset.service);
    $("recharge").scrollIntoView({ behavior: "smooth" });
  });
});

// Quick airtime amounts.
document.querySelectorAll("[data-amount]").forEach((button) => {
  button.addEventListener("click", () => {
    amountInput.value = button.dataset.amount;
    clearMessage();
  });
});

// --------------------------------
// PHONE NUMBER VALIDATION
// --------------------------------

function normalizePhone(value) {
  let phone = value.replace(/[\s()-]/g, "");

  if (phone.startsWith("+234")) {
    phone = "0" + phone.slice(4);
  } else if (phone.startsWith("234")) {
    phone = "0" + phone.slice(3);
  }

  return phone;
}

function isValidNigerianPhone(value) {
  return /^0[789][01]\d{8}$/.test(value);
}

// --------------------------------
// LOAD DATA PLANS
// --------------------------------

async function loadDataPlans() {
  const network = serviceId.value;

  loadPlansButton.disabled = true;
  loadPlansButton.textContent = "Loading...";
  planMessage.textContent = "Checking available data plans...";

  variationSelect.replaceChildren();

  const loadingOption = document.createElement("option");
  loadingOption.value = "";
  loadingOption.textContent = "Loading plans...";
  variationSelect.appendChild(loadingOption);

  loadedPlans = [];
  clearMessage();

  try {
    const result = await apiRequest(
      `/api/data-plans?service_id=${encodeURIComponent(network)}`
    );

    const plans = Array.isArray(result)
      ? result
      : Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.data?.plans)
          ? result.data.plans
          : [];

    loadedPlans = plans.filter((plan) =>
      plan.variation_id !== undefined &&
      plan.variation_id !== null &&
      plan.price !== undefined
    );

    variationSelect.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a data plan";
    variationSelect.appendChild(placeholder);

    loadedPlans.forEach((plan) => {
      const option = document.createElement("option");
      option.value = String(plan.variation_id);

      const name = plan.data_plan || "Data bundle";
      const price = Number(plan.price);

      const formattedPrice = Number.isFinite(price)
        ? price.toLocaleString("en-NG")
        : String(plan.price);

      option.textContent = `${name} — ₦${formattedPrice}`;
      variationSelect.appendChild(option);
    });

    if (loadedPlans.length === 0) {
      planMessage.textContent =
        "No plans were returned. Try another network or check the backend.";
      placeholder.textContent = "No plans available";
      return;
    }

    planMessage.textContent =
      `${loadedPlans.length} plan(s) loaded. Test orders only.`;
  } catch (error) {
    console.error("Could not load data plans:", error);

    variationSelect.replaceChildren();

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Unable to load plans";
    variationSelect.appendChild(option);

    planMessage.textContent = error.message;
  } finally {
    loadPlansButton.disabled = false;
    loadPlansButton.textContent = "Load Data Plans";
  }
}

loadPlansButton.addEventListener("click", loadDataPlans);

serviceId.addEventListener("change", () => {
  clearMessage();

  if (currentService === "data") {
    loadDataPlans();
  }
});

// --------------------------------
// SUBMIT AIRTIME OR DATA ORDER
// --------------------------------

rechargeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  // Real purchases must remain disabled.
  if (LIVE_PURCHASES_ENABLED) {
    showMessage(
      "Live purchases are disabled in this version.",
      "error"
    );
    return;
  }

  // Orders must belong to a logged-in account.
  if (!currentUser || !sessionStorage.getItem(TOKEN_KEY)) {
    showMessage("Please register or log in before submitting an order.", "error");
    return;
  }

  const phone = normalizePhone(phoneInput.value);

  if (!isValidNigerianPhone(phone)) {
    showMessage(
      "Enter a valid 11-digit Nigerian mobile number, for example 08012345678.",
      "error"
    );
    phoneInput.focus();
    return;
  }

  const network = serviceId.value;
  const submitButton = rechargeForm.querySelector(
    'button[type="submit"]'
  );

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = "Submitting test order...";
  }

  try {
    let result;

    if (currentService === "airtime") {
      const amount = Number(amountInput.value);
      const minimum = network === "mtn" ? 10 : 50;

      if (
        !Number.isFinite(amount) ||
        !Number.isInteger(amount) ||
        amount < minimum ||
        amount > 50000
      ) {
        showMessage(
          `Enter a whole-number amount from ₦${minimum} to ₦50,000.`,
          "error"
        );
        amountInput.focus();
        return;
      }

      result = await apiRequest("/api/airtime", {
        method: "POST",
        body: JSON.stringify({
          phone,
          service_id: network,
          amount
        })
      });
    } else {
      const variation_id = variationSelect.value;

      if (!variation_id) {
        showMessage("Please load and select a data plan.", "error");
        variationSelect.focus();
        return;
      }

      const plan = loadedPlans.find(
        (item) => String(item.variation_id) === variation_id
      );

      if (!plan) {
        showMessage(
          "Reload the plans and select a valid data plan.",
          "error"
        );
        return;
      }

      result = await apiRequest("/api/data", {
        method: "POST",
        body: JSON.stringify({
          phone,
          service_id: network,
          variation_id
        })
      });
    }

    showMessage(
      `${result.message || "Order validated successfully."} ` +
      "TEST MODE: No airtime or data was purchased, and no money was deducted."
    );

    // Clear the previous history display so it can be reloaded.
    historyOutput.replaceChildren();
  } catch (error) {
    showMessage(
      error.message || "Order validation failed. Please try again.",
      "error"
    );
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = "Submit Order";
    }
  }
});

// --------------------------------
// STARTUP
// --------------------------------

setService("airtime");
restoreSession();
