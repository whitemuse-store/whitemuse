const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// トップ確認用（←これが無かった）
app.get("/", (req, res) => {
  res.send("WhiteMuse API is running");
});

// generate（POST専用）
app.post("/generate", (req, res) => {
  res.json({
    ok: true,
    message: "generate endpoint is working",
    input: req.body || null,
  });
});

app.listen(PORT, () => {
  console.log(`WhiteMuse API running on ${PORT}`);
});
app.get("/", (req, res) => {
  res.send("WhiteMuse 起動中（ここが見えたら成功）");
});
