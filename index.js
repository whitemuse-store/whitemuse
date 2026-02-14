import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Render が指定する PORT を必ず使う
const PORT = process.env.PORT || 3000;

// 環境変数（Render に設定済みの前提）
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

// 応答待ち用
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ヘルスチェック
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "v1.0" });
});

// 生成API
app.post("/generate", async (req, res) => {
  try {
    // ---- 入力チェック ----
    const inputText = req?.body?.input?.text;

    if (!inputText || !inputText.trim()) {
      return res.status(400).json({
        ok: false,
        error: "input.text が空です",
      });
    }

    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN が設定されていません",
      });
    }

    // ---- プロンプト（日本語固定・英語禁止）----
    const prompt = `
あなたは日本のEC販売専用AIです。
必ず日本語のみで出力してください。
英語・記号説明・前置き・補足文は禁止です。

【出力ルール】
・1行目：商品名
・2行目以降：商品説明（簡潔）
・写真に無い情報は書かない
・状態・サイズは「写真参照」で統一

【商品情報】
${inputText}
`.trim();

    // ---- Replicate に生成依頼 ----
    const createResp = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          version: REPLICATE_TEXT_VERSION,
          input: { prompt },
        }),
      }
    );

    if (!createResp.ok) {
      const t = await createResp.text();
      return res.status(500).json({
        ok: false,
        error: "Replicate create error",
        detail: t,
      });
    }

    let prediction = await createResp.json();

    // ---- 完了待ち（最大60秒）----
    const start = Date.now();
    while (prediction.status !== "succeeded") {
      if (prediction.status === "failed") {
        return res.status(500).json({
          ok: false,
          error: "生成に失敗しました",
        });
      }
      if (Date.now() - start > 60000) {
        return res.status(504).json({
          ok: false,
          error: "タイムアウトしました",
        });
      }

      await sleep(1200);

      const getResp = await fetch(prediction.urls.get, {
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`,
        },
      });

      prediction = await getResp.json();
    }

    // ---- 出力正規化（空・配列・改行崩れ対策）----
    let output = prediction.output;

    let result = "";
    if (typeof output === "string") {
      result = output;
    } else if (Array.isArray(output)) {
      result = output.join("");
    }

    result = result.replace(/\r/g, "").trim();

    if (!result) {
      return res.status(500).json({
        ok: false,
        error: "生成結果が空でした",
      });
    }

    // ---- 正常返却 ----
    return res.json({
      ok: true,
      mode: "text",
      result,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "サーバー内部エラー",
      detail: String(e),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
