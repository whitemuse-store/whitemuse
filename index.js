import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Render 用ポート
const PORT = process.env.PORT || 3000;

// Render Environment に設定してある想定
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

// スリープ
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 出力クリーニング（英語前置き完全排除）
function cleanText(s) {
  if (!s) return "";
  return String(s)
    .replace(/^Here is the output:\s*/i, "")
    .replace(/^I hope.*$/gim, "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ヘルスチェック
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "v1" });
});

// メイン API
app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN が未設定です（Render Environment）"
      });
    }

    const mode = req.body?.mode || "text";
    const inputText = req.body?.input?.text || "";

    if (mode !== "text") {
      return res.status(400).json({
        ok: false,
        error: "現在 mode:'text' のみ対応しています"
      });
    }

    if (!inputText.trim()) {
      return res.status(400).json({
        ok: false,
        error: "input.text が空です"
      });
    }

    // 出品文専用プロンプト（固定）
    const prompt = [
      "あなたは日本のフリマアプリ（メルカリ・ヤフオク）向けの出品文作成のプロです。",
      "目的：売れやすく、信頼感があり、読みやすい出品文を日本語のみで作る。",
      "",
      "【絶対ルール】",
      "- 憶測で書かない",
      "- 不明点は「写真をご確認ください」「写真参照」と明記する",
      "- 専門用語は使わず、誰でも分かる日本語にする",
      "- 返品トラブルにならないよう注意点を簡潔に書く",
      "",
      "【出力形式】",
      "1. タイトル（1行）",
      "2. 商品説明（見出し＋本文）",
      "",
      "【素材情報】",
      inputText
    ].join("\n");

    // prediction 作成
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: REPLICATE_TEXT_VERSION,
        input: { prompt }
      })
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      return res.status(createResp.status).json({
        ok: false,
        error: "Replicate API error",
        status: createResp.status,
        detail: errText
      });
    }

    let prediction = await createResp.json();

    // 最大60秒待機
    const start = Date.now();
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      if (Date.now() - start > 60000) {
        return res.status(504).json({
          ok: false,
          error: "タイムアウトしました（もう一度お試しください）"
        });
      }

      await sleep(1200);

      const getResp = await fetch(prediction.urls.get, {
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`
        }
      });

      if (!getResp.ok) {
        const errText = await getResp.text();
        return res.status(getResp.status).json({
          ok: false,
          error: "Replicate GET error",
          status: getResp.status,
          detail: errText
        });
      }

      prediction = await getResp.json();
    }

    if (prediction.status !== "succeeded") {
      return res.status(500).json({
        ok: false,
        error: "生成に失敗しました",
        status: prediction.status,
        detail: prediction.error || null
      });
    }

    const out = prediction.output;
    const raw =
      typeof out === "string"
        ? out
        : Array.isArray(out)
        ? out.join("\n")
        : JSON.stringify(out);

    const result = cleanText(raw);

    return res.json({
      ok: true,
      mode: "text",
      result
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "サーバー側エラー",
      detail: String(e?.message || e)
    });
  }
});

// 起動
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
