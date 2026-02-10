const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const app = express();

// --- CONFIGURATION ---
const TELEGRAM_USERNAME = "YOUR_TELEGRAM_ID";

// Environment variables for Render deployment
const MONGO_URI =
  process.env.MONGO_URI || "mongodb://127.0.0.1:27017/bitrewards";
const PORT = process.env.PORT || 3000;

// --- LOAD LANGUAGES ---
const languages = {
  en: JSON.parse(fs.readFileSync("./locales/en.json", "utf8")),
  cs: JSON.parse(fs.readFileSync("./locales/cs.json", "utf8")),
  hr: JSON.parse(fs.readFileSync("./locales/hr.json", "utf8")),
  hu: JSON.parse(fs.readFileSync("./locales/hu.json", "utf8")),
};

// --- MIDDLEWARE ---
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.set("view engine", "ejs");
app.use(
  session({
    secret: "secret-key-123",
    resave: false,
    saveUninitialized: false,
  }),
);

// --- LANGUAGE MIDDLEWARE ---
app.use((req, res, next) => {
  const langCode = req.cookies.lang || "en";
  res.locals.lang = langCode;
  res.locals.t = languages[langCode] || languages["en"];
  next();
});

// --- DATABASE CONNECTION ---
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.log("❌ DB Error:", err));

// --- MODELS ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0.0 },
  isAdmin: { type: Boolean, default: false },
});

const transactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, default: "withdrawal" },
  amount: Number,
  vatFee: Number,
  method: String,
  details: String,
  status: { type: String, default: "Pending" },
  date: { type: Date, default: Date.now },
});

const User = mongoose.model("User", userSchema);
const Transaction = mongoose.model("Transaction", transactionSchema);

// --- SEED ADMIN ---
async function seedAdmin() {
  const adminExists = await User.findOne({ username: "admin" });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash("admin123", 10);
    await User.create({
      username: "admin",
      password: hashedPassword,
      isAdmin: true,
      balance: 0,
    });
    console.log("Admin Account Created: admin / admin123");
  }
}
seedAdmin();

// --- ROUTES ---

// Language Switcher
app.get("/set-lang/:code", (req, res) => {
  const code = req.params.code;
  if (["en", "cs", "hr", "hu"].includes(code)) {
    res.cookie("lang", code, { maxAge: 90000000 });
  }
  res.redirect("back");
});

// Auth Routes
app.get("/", (req, res) => res.redirect("/login"));

app.get("/login", (req, res) => res.render("login"));

app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (user && (await bcrypt.compare(password, user.password))) {
    req.session.userId = user._id;
    return user.isAdmin ? res.redirect("/admin") : res.redirect("/dashboard");
  }
  res.render("login", { error: "Invalid credentials" });
});

app.get("/register", (req, res) => res.render("register"));

// Auto-Login after Sign Up
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ username, password: hashedPassword });
    req.session.userId = newUser._id;
    res.redirect("/dashboard");
  } catch (e) {
    res.render("register", { error: "Username taken" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Middleware: Require Login
const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  next();
};

// Wallet Dashboard
app.get("/dashboard", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const transactions = await Transaction.find({ userId: user._id }).sort({
    date: -1,
  });
  res.render("dashboard", { user, transactions });
});

// Withdrawal Process
app.get("/withdraw", requireLogin, (req, res) => res.render("withdraw"));

// --- UPDATED WITHDRAWAL ROUTE (7.5% VAT) ---
app.post("/withdraw/confirm", requireLogin, async (req, res) => {
  try {
    const { amount, method, details } = req.body;
    const user = await User.findById(req.session.userId);

    if (!user) return res.redirect("/login");
    if (!amount || isNaN(amount)) return res.send("Invalid Amount");

    // Check Balance
    if (parseFloat(amount) > user.balance) {
      return res.send(
        `Insufficient funds. Your Balance: €${user.balance.toFixed(2)}`,
      );
    }

    // --- CALCULATE 7.5% VAT ---
    const vat = (parseFloat(amount) * 0.075).toFixed(2);

    const newTx = await Transaction.create({
      userId: user._id,
      amount: parseFloat(amount),
      vatFee: vat,
      method: method,
      details: details,
      status: "Pending",
    });

    console.log(`Withdrawal Success: ${newTx._id}`);
    res.redirect(`/invoice/${newTx._id}`);
  } catch (error) {
    console.error("Withdrawal Error:", error);
    res.send("An error occurred during withdrawal. Please try again.");
  }
});

app.get("/invoice/:id", requireLogin, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id).populate("userId");
    if (!tx) return res.redirect("/dashboard");
    res.render("invoice", { tx, telegramUser: TELEGRAM_USERNAME });
  } catch (err) {
    res.redirect("/dashboard");
  }
});

// Admin Routes
const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  const user = await User.findById(req.session.userId);
  if (!user || !user.isAdmin) return res.redirect("/dashboard");
  next();
};

app.get("/admin", requireAdmin, async (req, res) => {
  const users = await User.find({ isAdmin: false });
  const transactions = await Transaction.find()
    .populate("userId")
    .sort({ date: -1 });
  res.render("admin", { users, transactions });
});

app.post("/admin/balance", requireAdmin, async (req, res) => {
  await User.findByIdAndUpdate(req.body.userId, {
    balance: req.body.newBalance,
  });
  res.redirect("/admin");
});

app.post("/admin/approve", requireAdmin, async (req, res) => {
  const { txId, action } = req.body;
  const tx = await Transaction.findById(txId);

  if (action === "approve") {
    const user = await User.findById(tx.userId);
    if (user.balance >= tx.amount) {
      user.balance -= tx.amount;
      await user.save();
      tx.status = "Approved";
    } else {
      tx.status = "Failed (Insufficient Funds)";
    }
  } else {
    tx.status = "Rejected";
  }

  await tx.save();
  res.redirect("/admin");
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`),
);
