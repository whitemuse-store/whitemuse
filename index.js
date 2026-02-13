const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

// ★これが無かった
app.get("/", (req, res) => {
  res.send("WhiteMuse API is running");
});

app.listen(PORT, () => {
  console.log("WhiteMuse API listening on", PORT);
});
