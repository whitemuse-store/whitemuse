import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

/**
 * 動作確認用（ルート）
 */
app.get("/", (req, res) => {
  res.send("WhiteMuse API is running");
});

/**
 * /generate（フロントから呼ばれる本命）
 */
app.post("/generate", (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({
      error: "text is required"
    });
  }

  // 仮の生成結果（あとでAIに差し替え可）
  res.json({
    success: true,
    original: text,
    result: `【生成結果】${text}`
  });
});

/**
 * Render 用 listen
 */
app.listen(PORT, () => {
  console.log(`WhiteMuse API listening on ${PORT}`);
});
