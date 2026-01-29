require("dotenv").config();

const express = require("express");
const path = require("path");

const syncEngine = require("./syncEngine");
const db = require("./mysql");

const app = express();
const PORT = 4000;

/* ------------------ Middleware ------------------ */
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

/* ------------------ Routes ------------------ */

// Root → Frontend UI
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "index.html"));
});

// Manual Sync Trigger
app.get("/sync", async (req, res) => {
  try {
    await syncEngine.sync();
    res.send("Sync triggered successfully");
  } catch (err) {
    console.error("Manual sync error:", err);
    res.status(500).send("Sync failed");
  }
});

// Fetch MySQL Data
app.get("/data", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM users");
    res.json(rows);
  } catch (err) {
    console.error("DB Fetch Error:", err);
    res.status(500).json({ error: "Database error" });
  }
});

/* ------------------ Auto Sync Loop ------------------ */

setInterval(async () => {
  try {
    await syncEngine.sync();
    console.log("synced");
  } catch (err) {
    console.error("Auto sync error:", err.message);
  }
}, 5000);

/* ------------------ Start Server ------------------ */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

