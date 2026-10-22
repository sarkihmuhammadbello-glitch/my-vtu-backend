
require("dotenv").config();

const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require("express");
const crypto = require("node:crypto");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://vtu.ng/wp-json";

// SAFETY: real purchases are disabled.
const LIVE_PURCHASES_ENABLED = false;

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

const AIRTIME_NETWORKS = ["mtn", "airtel", "glo", "9mobile"];
const DATA_NETWORKS = ["mtn", "airtel", "glo", "9mobile", "smile"];

const mongoClient = new MongoClient(
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017"
);

let db;
let users;
let transactions;
let wallets;
let walletLedger;

// -------------------- HELPERS --------------------

function cleanPhone(phone) {
  if (typeof phone !== "string") return null;

  const value = phone.trim().replace(/[\s()-]/g, "");

  return /^\+?\d{11,16}$/.test(value) ? value : null;
}

function validObjectId(value) {
  return (
    typeof value === "string" &&
    /^[a-fA-F0-9]{24}$/.test(value)
  );
}

function safeUser(user) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    created_at: user.created_at
  };
}

function createToken(user) {
  return jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "2h", issuer: "hmb-vtu" }
  );
}

function getRequestId(value) {
  if (value === undefined || value === null || value === "") {
    return { id: "req_" + crypto.randomUUID() };
  }

  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9_-]{1,50}$/.test(value)
  ) {
    return {
      error: "request_id must contain 1-50 letters, numbers, underscores or hyphens."
    };
  }

  return { id: value };
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization;

  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Please log in first." });
  }

  try {
    const decoded = jwt.verify(
      header.slice(7).trim(),
      process.env.JWT_SECRET,
      { issuer: "hmb-vtu" }
    );

    if (!validObjectId(decoded.userId)) {
      return res.status(401).json({ error: "Invalid login token." });
    }

    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({
      error: "Your session has expired. Please log in again."
    });
  }
}

async function requireAdmin(req, res, next) {
  try {
    const user = await users.findOne({
      _id: new ObjectId(req.userId)
    });

    if (!user || user.role !== "admin") {
      return res.status(403).json({
        error: "Administrator access required."
      });
    }

    req.admin = user;
    next();
  } catch (error) {
    console.error("Admin check:", error.message);
    res.status(500).json({ error: "Could not verify admin access." });
  }
}

// -------------------- VTU.NG --------------------

async function getVtuToken() {
  if (!process.env.VTU_USERNAME || !process.env.VTU_PASSWORD) {
    throw new Error("VTU_USERNAME or VTU_PASSWORD is missing from .env");
  }

  const response = await fetch(
    BASE_URL + "/jwt-auth/v1/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: process.env.VTU_USERNAME,
        password: process.env.VTU_PASSWORD
      }),
      signal: AbortSignal.timeout(20000)
    }
  );

  const text = await response.text();
  let result = {};

  try {
    result = JSON.parse(text);
  } catch {
    // Do not print credentials or raw login responses.
  }

  if (!response.ok || !result.token) {
    console.error(
      "VTU login failed. HTTP status:",
      response.status,
      "Reason:",
      result.message || result.code || "No token returned"
    );

    throw new Error("VTU.ng authentication failed.");
  }

  return result.token;
}

async function fetchDataPlans(serviceId) {
  const url = new URL(BASE_URL + "/api/v2/variations/data");

  if (serviceId) {
    url.searchParams.set("service_id", serviceId);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(20000)
  });

  const result = await response.json();

  if (
    !response.ok ||
    result.code !== "success" ||
    !Array.isArray(result.data)
  ) {
    throw new Error("Could not retrieve data plans.");
  }

  return result.data;
}

// -------------------- HOME / HEALTH --------------------

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.json({
    message: "HMB VTU backend is running.",
    test_mode: true,
    live_purchases_enabled: LIVE_PURCHASES_ENABLED,
    database_connected: Boolean(users && transactions && wallets)
  });
});

// -------------------- REGISTRATION --------------------

app.post("/api/register", async (req, res) => {
  try {
    const name =
      typeof req.body.name === "string" ? req.body.name.trim() : "";

    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const phone = cleanPhone(req.body.phone);
    const password = req.body.password;

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({ error: "Name must be 2-80 characters." });
    }

    if (
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    if (!phone) {
      return res.status(400).json({ error: "Enter a valid phone number." });
    }

    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 72
    ) {
      return res.status(400).json({
        error: "Password must be between 8 and 72 characters."
      });
    }

    const existing = await users.findOne({ email });

    if (existing) {
      return res.status(409).json({ error: "Email already registered." });
    }

    const user = {
      name,
      email,
      phone,
      password_hash: await bcrypt.hash(password, 12),
      role: "customer",
      created_at: new Date().toISOString()
    };

    const saved = await users.insertOne(user);
    user._id = saved.insertedId;

    // Create an empty test wallet for this customer.
    await wallets.updateOne(
      { user_id: user._id.toString() },
      {
        $setOnInsert: {
          user_id: user._id.toString(),
          balance_kobo: 0,
          created_at: new Date()
        }
      },
      { upsert: true }
    );

    res.status(201).json({
      message: "Account created successfully.",
      token: createToken(user),
      user: safeUser(user)
    });
  } catch (error) {
    console.error("Registration:", error.message);

    res.status(error.code === 11000 ? 409 : 500).json({
      error: error.code === 11000
        ? "Email already registered."
        : "Could not create account."
    });
  }
});

// -------------------- LOGIN --------------------

app.post("/api/login", async (req, res) => {
  try {
    const email =
      typeof req.body.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = req.body.password;

    if (
      !email ||
      typeof password !== "string" ||
      password.length === 0 ||
      password.length > 72
    ) {
      return res.status(400).json({
        error: "Enter your email and password."
      });
    }

    const user = await users.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Ensure older accounts also have a wallet.
    await wallets.updateOne(
      { user_id: user._id.toString() },
      {
        $setOnInsert: {
          user_id: user._id.toString(),
          balance_kobo: 0,
          created_at: new Date()
        }
      },
      { upsert: true }
    );

    res.json({
      message: "Login successful.",
      token: createToken(user),
      user: safeUser(user)
    });
  } catch (error) {
    console.error("Login:", error.message);
    res.status(500).json({ error: "Could not log in." });
  }
});

// -------------------- CURRENT USER --------------------

app.get("/api/me", requireAuth, async (req, res) => {
  try {
    const user = await users.findOne({
      _id: new ObjectId(req.userId)
    });

    if (!user) {
      return res.status(404).json({ error: "Account not found." });
    }

    res.json({ user: safeUser(user) });
  } catch (error) {
    console.error("Account:", error.message);
    res.status(500).json({ error: "Could not retrieve account." });
  }
});

// -------------------- PROVIDER BALANCE --------------------

app.get("/api/balance", requireAuth, async (req, res) => {
  try {
    const token = await getVtuToken();

    const response = await fetch(BASE_URL + "/api/v2/balance", {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(20000)
    });

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "VTU.ng returned an unexpected balance response."
      });
    }

    if (!response.ok) {
      console.error("VTU balance request failed. HTTP:", response.status);
      return res.status(502).json({
        error: "VTU.ng rejected the balance request."
      });
    }

    res.json(result);
  } catch (error) {
    console.error("Provider balance:", error.message);
    res.status(502).json({
      error: "Could not retrieve provider balance. Check server logs."
    });
  }
});

// -------------------- DATA PLANS --------------------

app.get("/api/data-plans", async (req, res) => {
  try {
    let serviceId = req.query.service_id;

    if (serviceId !== undefined) {
      if (typeof serviceId !== "string") {
        return res.status(400).json({ error: "Invalid service_id." });
      }

      serviceId = serviceId.toLowerCase();

      if (!DATA_NETWORKS.includes(serviceId)) {
        return res.status(400).json({
          error: "Choose mtn, airtel, glo, 9mobile or smile."
        });
      }
    }

    const data = await fetchDataPlans(serviceId);

    res.json({
      message: "Data plans retrieved successfully.",
      data
    });
  } catch (error) {
    console.error("Data plans:", error.message);
    res.status(502).json({ error: "Data plans are unavailable." });
  }
});

// -------------------- SAVE TEST ORDER --------------------

async function saveTestOrder(order, type, userId) {
  const transaction = {
    ...order,
    user_id: userId,
    type,
    status: "validated",
    test_mode: true,
    created_at: new Date().toISOString()
  };

  await transactions.insertOne(transaction);
  return transaction;
}

// -------------------- AIRTIME TEST ORDER --------------------

app.post("/api/airtime", requireAuth, async (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const serviceId =
    typeof req.body.service_id === "string"
      ? req.body.service_id.toLowerCase()
      : "";

  const amount = Number(req.body.amount);

  if (!phone) {
    return res.status(400).json({ error: "Enter a valid phone number." });
  }

  if (!AIRTIME_NETWORKS.includes(serviceId)) {
    return res.status(400).json({
      error: "Choose mtn, airtel, glo or 9mobile."
    });
  }

  const minimum = serviceId === "mtn" ? 10 : 50;

  if (
    req.body.amount === "" ||
    req.body.amount === undefined ||
    !Number.isInteger(amount) ||
    amount < minimum ||
    amount > 50000
  ) {
    return res.status(400).json({
      error: `Amount must be a whole number from ${minimum} to 50000 naira.`
    });
  }

  const id = getRequestId(req.body.request_id);

  if (id.error) {
    return res.status(400).json({ error: id.error });
  }

  try {
    const order = {
      request_id: id.id,
      phone,
      service_id: serviceId,
      amount
    };

    const transaction = await saveTestOrder(
      order,
      "airtime",
      req.userId
    );

    res.status(201).json({
      message: "Airtime order validated. No purchase was made.",
      test_mode: true,
      order: transaction
    });
  } catch (error) {
    console.error("Airtime order:", error.message);

    res.status(error.code === 11000 ? 409 : 500).json({
      error: error.code === 11000
        ? "This request_id has already been used."
        : "Could not save airtime order."
    });
  }
});

// -------------------- DATA TEST ORDER --------------------

app.post("/api/data", requireAuth, async (req, res) => {
  try {
    const phone = cleanPhone(req.body.phone);
    const serviceId =
      typeof req.body.service_id === "string"
        ? req.body.service_id.toLowerCase()
        : "";

    const variationId = req.body.variation_id;

    if (!phone) {
      return res.status(400).json({ error: "Enter a valid phone number." });
    }

    if (!DATA_NETWORKS.includes(serviceId)) {
      return res.status(400).json({
        error: "Choose mtn, airtel, glo, 9mobile or smile."
      });
    }

    if (
      variationId === undefined ||
      variationId === null ||
      !/^\d+$/.test(String(variationId))
    ) {
      return res.status(400).json({
        error: "A numeric variation_id is required."
      });
    }

    const plans = await fetchDataPlans(serviceId);
    const plan = plans.find(
      item => String(item.variation_id) === String(variationId)
    );

    if (!plan) {
      return res.status(400).json({
        error: "Selected plan does not match this network."
      });
    }

    if (plan.availability !== "Available") {
      return res.status(400).json({
        error: "This plan is currently unavailable."
      });
    }

    const amount = Number(plan.price);

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(502).json({ error: "Invalid data plan price." });
    }

    const id = getRequestId(req.body.request_id);

    if (id.error) {
      return res.status(400).json({ error: id.error });
    }

    const order = {
      request_id: id.id,
      phone,
      service_id: serviceId,
      variation_id: plan.variation_id,
      data_plan: plan.data_plan,
      amount
    };

    const transaction = await saveTestOrder(
      order,
      "data",
      req.userId
    );

    res.status(201).json({
      message: "Data order validated. No purchase was made.",
      test_mode: true,
      order: transaction
    });
  } catch (error) {
    console.error("Data order:", error.message);

    res.status(error.code === 11000 ? 409 : 502).json({
      error: error.code === 11000
        ? "This request_id has already been used."
        : "Could not validate or save data order."
    });
  }
});

// -------------------- CUSTOMER TRANSACTIONS --------------------

app.get("/api/transactions", requireAuth, async (req, res) => {
  try {
    const records = await transactions
      .find({ user_id: req.userId })
      .sort({ _id: -1 })
      .limit(100)
      .toArray();

    res.json({
      count: records.length,
      transactions: records
    });
  } catch (error) {
    console.error("Transactions:", error.message);
    res.status(500).json({ error: "Could not retrieve transactions." });
  }
});

// -------------------- CUSTOMER WALLET --------------------

app.get("/api/wallet", requireAuth, async (req, res) => {
  try {
    const wallet = await wallets.findOne({ user_id: req.userId });
    const kobo = wallet ? wallet.balance_kobo : 0;

    res.json({
      test_mode: true,
      currency: "NGN",
      balance: kobo / 100,
      balance_kobo: kobo
    });
  } catch (error) {
    console.error("Wallet:", error.message);
    res.status(500).json({ error: "Could not retrieve wallet." });
  }
});

app.get("/api/wallet/transactions", requireAuth, async (req, res) => {
  try {
    const records = await walletLedger
      .find({ user_id: req.userId })
      .sort({ created_at: -1 })
      .limit(100)
      .toArray();

    res.json({
      test_mode: true,
      count: records.length,
      transactions: records
    });
  } catch (error) {
    console.error("Wallet ledger:", error.message);
    res.status(500).json({ error: "Could not retrieve wallet transactions." });
  }
});

// -------------------- ADMIN SUMMARY --------------------

app.get(
  "/api/admin/summary",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const [customers, orders, ledgerEntries, totals] = await Promise.all([
        users.countDocuments({ role: "customer" }),
        transactions.countDocuments({}),
        walletLedger.countDocuments({}),
        transactions.aggregate([
          {
            $group: {
              _id: null,
              total_test_order_value: { $sum: "$amount" }
            }
          }
        ]).toArray()
      ]);

      res.json({
        test_mode: true,
        customers,
        orders,
        wallet_ledger_entries: ledgerEntries,
        total_test_order_value:
          totals.length ? totals[0].total_test_order_value : 0,
        note: "Test-order values are not real sales or revenue."
      });
    } catch (error) {
      console.error("Admin summary:", error.message);
      res.status(500).json({ error: "Could not load admin summary." });
    }
  }
);

// -------------------- ADMIN CUSTOMERS --------------------

app.get(
  "/api/admin/customers",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const records = await users
        .find({}, { projection: { password_hash: 0 } })
        .sort({ created_at: -1 })
        .limit(500)
        .toArray();

      res.json({
        count: records.length,
        customers: records.map(safeUser)
      });
    } catch (error) {
      console.error("Admin customers:", error.message);
      res.status(500).json({ error: "Could not retrieve customers." });
    }
  }
);

// -------------------- ADMIN TEST ORDERS --------------------

app.get(
  "/api/admin/transactions",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const records = await transactions
        .find({})
        .sort({ _id: -1 })
        .limit(500)
        .toArray();

      res.json({ count: records.length, transactions: records });
    } catch (error) {
      console.error("Admin transactions:", error.message);
      res.status(500).json({ error: "Could not retrieve transactions." });
    }
  }
);

// -------------------- ADMIN WALLET LEDGER --------------------

app.get(
  "/api/admin/wallet-ledger",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const records = await walletLedger
        .find({})
        .sort({ created_at: -1 })
        .limit(500)
        .toArray();

      res.json({ count: records.length, ledger: records });
    } catch (error) {
      console.error("Admin wallet ledger:", error.message);
      res.status(500).json({ error: "Could not retrieve wallet ledger." });
    }
  }
);

// -------------------- ADMIN TEST CREDIT --------------------
// This adds test funds only. It does not confirm a real payment.

app.post(
  "/api/admin/wallet/test-credit",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    const amount = Number(req.body.amount);
    const customerId = req.body.customer_id;
    const reason =
      typeof req.body.reason === "string"
        ? req.body.reason.trim().slice(0, 150)
        : "";

    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      amount > 100000
    ) {
      return res.status(400).json({
        error: "Test credit must be between ₦1 and ₦100,000."
      });
    }

    if (!validObjectId(customerId)) {
      return res.status(400).json({
        error: "A valid customer_id is required."
      });
    }

    if (!reason) {
      return res.status(400).json({
        error: "Enter a reason for the test credit."
      });
    }

    const customer = await users.findOne({
      _id: new ObjectId(customerId)
    });

    if (!customer) {
      return res.status(404).json({ error: "Customer not found." });
    }

    const amountKobo = amount * 100;

    try {
      await wallets.updateOne(
        { user_id: customerId },
        {
          $setOnInsert: {
            user_id: customerId,
            balance_kobo: 0,
            created_at: new Date()
          }
        },
        { upsert: true }
      );

      const updated = await wallets.findOneAndUpdate(
        { user_id: customerId },
        {
          $inc: { balance_kobo: amountKobo },
          $set: { updated_at: new Date() }
        },
        { returnDocument: "after" }
      );

      if (!updated) {
        throw new Error("Wallet update failed.");
      }

      await walletLedger.insertOne({
        user_id: customerId,
        type: "test_credit",
        amount_kobo: amountKobo,
        reason,
        created_by: req.userId,
        test_mode: true,
        created_at: new Date()
      });

      res.json({
        message: "Test credit added. No real payment occurred.",
        test_mode: true,
        balance: updated.balance_kobo / 100
      });
    } catch (error) {
      console.error("Test credit:", error.message);
      res.status(500).json({
        error: "Could not complete test credit. Check wallet and ledger before retrying."
      });
    }
  }
);

// -------------------- START SERVER --------------------

async function startServer() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI is missing from .env");
    }

    if (
      typeof process.env.JWT_SECRET !== "string" ||
      process.env.JWT_SECRET.length < 32
    ) {
      throw new Error("JWT_SECRET is missing or must be at least 32 characters.");
    }

    await mongoClient.connect();

    db = mongoClient.db(process.env.MONGODB_DB || "hmb_vtu");

    users = db.collection("users");
    transactions = db.collection("transactions");
    wallets = db.collection("wallets");
    walletLedger = db.collection("wallet_ledger");

    await users.createIndex({ email: 1 }, { unique: true });
    await transactions.createIndex({ request_id: 1 }, { unique: true });
    await wallets.createIndex({ user_id: 1 }, { unique: true });
    await walletLedger.createIndex({ user_id: 1, created_at: -1 });

    const adminEmail =
      typeof process.env.ADMIN_EMAIL === "string"
        ? process.env.ADMIN_EMAIL.trim().toLowerCase()
        : "";

    if (adminEmail) {
      const result = await users.updateOne(
        { email: adminEmail },
        { $set: { role: "admin" } }
      );

      console.log(
        result.matchedCount
          ? "Administrator account configured."
          : "Register ADMIN_EMAIL first, then restart the server."
      );
    } else {
      console.log("ADMIN_EMAIL is not configured.");
    }

    app.listen(PORT, () => {
      console.log("MongoDB connected successfully.");
      console.log("HMB VTU running at http://localhost:" + PORT);
      console.log("TEST MODE: real purchases and payments are disabled.");
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
