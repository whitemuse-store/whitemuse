// index.js (repo root)
// WhiteMuse API - minimal working server with /generate
// - GET /          -> "WhiteMuse API is running"
// - GET /generate  -> "Use POST /generate"
// - POST /generate -> returns mock JSON (or calls OpenAI if OPENAI_API_KEY is set)

const express = require("express");
const cors = require("cors");

const app = express();

// ---- basics
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json({ limit: "2mb" }));

// ---- health
app.get("/", (_req, res) => res.status(200).send("WhiteMuse API is running"));

// ブラウザで開いた時に「存在する」ことが分かるように GET も作る
app.get("/generate", (_req, res) => {
  res.status(200).send("OK. Use POST /generate with JSON body.");
});

// ---- main endpoint
app.post("/generate", async (req, res) => {
  try {
    const payload = req.body || {};

    // 1) まずは 404 を潰すための「必ず返す」レスポンス
    //    （OPENAI_API_KEY が無い/設定してない場合でもアプリが落ちない）
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        note: "OPENAI_API_KEY is not set. Returning mock response.",
        input: payload,
        // フロントが表示できるように最低限の形
        text: "（モック）文章生成：ここに生成文が入ります",
        image: null,
      });
    }

    // 2) OPENAI_API_KEY がある場合（任意）
    //    ここは「最低限動く」構成にしてます。
    //    あなたのフロントが求める返却形式が別なら、そこに合わせて調整します。
    const apiKey = process.env.OPENAI_API_KEY;

    // 文章だけ簡易生成（必要なければ消してOK）
    const promptText =
      payload?.prompt ||
      `ブランド:${payload?.brand || ""} 色:${payload?.color || ""} 素材:${
        payload?.material || ""
      } 状態:${payload?.condition || ""} 追加:${payload?.extra || ""}`;

    // OpenAI Responses API（テキスト）
    const textResp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: `メルカリ用の丁寧で売れる商品説明を日本語で作って。\n${promptText}`,
      }),
    });

    if (!textResp.ok) {
      const err = await textResp.text();
      return res.status(500).json({ ok: false, where: "responses", err });
    }

    const textJson = await textResp.json();
    const generatedText =
      (textJson.output_text && String(textJson.output_text)) ||
      "（テキスト生成に失敗）";

    // 画像生成が必要ならここに追加（いまは /generate の存在が最優先なので省略可）
    return res.status(200).json({
      ok: true,
      text: generatedText,
      image: null,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      message: e?.message || String(e),
    });
  }
});

// ---- port (Render uses process.env.PORT)
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`WhiteMuse API listening on ${PORT}`);
});
