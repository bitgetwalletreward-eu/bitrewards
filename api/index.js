require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const path = require("path");
const fs = require("fs");
const MongoStore = require("connect-mongo");

const app = express();

// =============================
// 🔐 ENVIRONMENT VARIABLES
// =============================
const {
  MONGODB_URI,
  SESSION_SECRET,
  TELEGRAM_USERNAME,
  ADMIN_USER,
  ADMIN_PASS,
  NODE_ENV,
} = process.env;

if (!MONGODB_URI || !SESSION_SECRET) {
  console.error("❌ Missing required environment variables.");
}

// =============================
// 🌍 LOAD LANGUAGES
// =============================
const languages = {
  en: JSON.parse(
    fs.readFileSync(path.join(__dirname, "../locales/en.json"), "utf8"),
  ),
  cs: JSON.parse(
    fs.readFileSync(path.join(__dirname, "../locales/cs.json"), "utf8"),
  ),
  hr: JSON.parse(
    fs.readFileSync(path.join(__dirname, "../locales/hr.json"), "utf8"),
  ),
  hu: JSON.parse(
    fs.readFileSync(path.join(__dirname, "../locales/hu.json"), "utf8"),
  ),
};

// =============================
// 🧩 MIDDLEWARE
// =============================
app.use(express.static(path.join(__dirname, "../public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "../views"));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new MongoStore({
      mongoUrl: MONGODB_URI,
      touchAfter: 24 * 3600,
    }),
    cookie: {
      secure: NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
    },
  }),
);

// Language Middleware
app.use((req, res, next) => {
  const langCode = req.cookies.lang || "en";
  res.locals.lang = langCode;
  res.locals.t = languages[langCode] || languages["en"];
  next();
});

// Telegram username available in all views
app.use((req, res, next) => {
  res.locals.telegramUser = TELEGRAM_USERNAME;
  next();
});

// =============================
// 🗄 DATABASE CONNECTION
// =============================
let mongoConnection = null;

async function connectDatabase() {
  if (mongoConnection) {
    return mongoConnection;
  }

  try {
    mongoConnection = await mongoose.connect(MONGODB_URI);
    console.log("✅ MongoDB Connected");
    return mongoConnection;
  } catch (err) {
    console.error("❌ Database Connection Error:", err);
    throw err;
  }
}

// =============================
// 📦 MODELS
// =============================
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  balance: { type: Number, default: 0 },
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

// =============================
// 🔑 SAFE ADMIN SEED (ONLY IF PROVIDED)
// =============================
async function seedAdmin() {
  if (!ADMIN_USER || !ADMIN_PASS) return;

  const adminExists = await User.findOne({ username: ADMIN_USER });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash(ADMIN_PASS, 12);
    await User.create({
      username: ADMIN_USER,
      password: hashedPassword,
      isAdmin: true,
      balance: 0,
    });
    console.log("✅ Admin account created from ENV");
  }
}

// =============================
// 🔐 AUTH MIDDLEWARE
// =============================
const requireLogin = (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  next();
};

const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect("/login");
  const user = await User.findById(req.session.userId);
  if (!user || !user.isAdmin) return res.redirect("/dashboard");
  next();
};

// =============================
// 🌐 ROUTES
// =============================
app.get("/", (req, res) => res.redirect("/login"));

app.get("/set-lang/:code", (req, res) => {
  const code = req.params.code;
  if (["en", "cs", "hr", "hu"].includes(code)) {
    res.cookie("lang", code, { maxAge: 900000000, path: "/" });
  }
  res.redirect(req.get("referer") || "/dashboard");
});

// Auth
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

app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = await User.create({ username, password: hashedPassword });
    req.session.userId = newUser._id;
    res.redirect("/dashboard");
  } catch {
    res.render("register", { error: "Username taken" });
  }
});

app.get("/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/login");
});

// Dashboard
app.get("/dashboard", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const transactions = await Transaction.find({ userId: user._id }).sort({
    date: -1,
  });
  res.render("dashboard", { user, transactions });
});

// Withdraw
app.get("/withdraw", requireLogin, (req, res) => res.render("withdraw"));

app.post("/withdraw/confirm", requireLogin, async (req, res) => {
  try {
    const { amount, method, details } = req.body;
    const user = await User.findById(req.session.userId);

    if (!amount || isNaN(amount)) return res.send("Invalid Amount");

    const parsedAmount = parseFloat(amount);

    if (parsedAmount > user.balance) {
      return res.send(
        `Insufficient funds. Balance: €${user.balance.toFixed(2)}`,
      );
    }

    const vat = parseFloat((parsedAmount * 0.075).toFixed(2));

    const tx = await Transaction.create({
      userId: user._id,
      amount: parsedAmount,
      vatFee: vat,
      method,
      details,
    });

    res.redirect(`/invoice/${tx._id}`);
  } catch (error) {
    console.error(error);
    res.send("Withdrawal error. Try again.");
  }
});

app.get("/invoice/:id", requireLogin, async (req, res) => {
  const tx = await Transaction.findById(req.params.id).populate("userId");
  if (!tx) return res.redirect("/dashboard");
  res.render("invoice", { tx });
});

// Admin
app.get("/admin", requireAdmin, async (req, res) => {
  const users = await User.find({ isAdmin: false });
  const transactions = await Transaction.find()
    .populate("userId")
    .sort({ date: -1 });
  res.render("admin", { users, transactions });
});

// Reinvest (if you have this route, add it based on your original code)
app.get("/rewards", requireLogin, (req, res) => res.render("rewards"));

app.get("/invest", requireLogin, (req, res) => res.render("invest"));

app.get("/about-us", (req, res) => res.render("about-us"));

// =============================
// 🔌 INITIALIZE AND EXPORT
// =============================
let isConnected = false;

// Middleware to ensure DB connection before handling requests
app.use(async (req, res, next) => {
  if (!isConnected) {
    try {
      await connectDatabase();
      await seedAdmin();
      isConnected = true;
    } catch (err) {
      console.error("Failed to connect to database:", err);
      return res.status(500).send("Database connection failed");
    }
  }
  next();
});

module.exports = app;
