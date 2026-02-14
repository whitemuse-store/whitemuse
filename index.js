import express from "express";

const app = express();
app.use(express.json({ limit: "5mb" }));

// Renderが指定するPORTを必ず使う
const PORT = process.env.PORT || 3000;

// 必須環境変数
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const MODEL_VERSION =
  process.env.REPLICATE_TEXT_VERSION ||
  "meta/meta-llama-3-8b-instruct";

// 動作確認用
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "1.0" });
});

// メインAPI
app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN が設定されていません"
      });
    }

    const inputText = req.body?.input?.text;
    if (!inputText || !inputText.trim()) {
      return res.status(400).json({
        ok: false,
        error: "input.text が空です"
      });
    }

    // 出品文専用プロンプト（日本語のみ・説明禁止）
    const prompt = `
あなたは高級ブランド品EC出品のプロです。
以下の条件を必ず守って、日本語の出品文だけを書いてください。

【絶対ルール】
・英語禁止
・前置き、説明、謝罪、補足禁止
・写真に書いていない情報を追加しない
・「写真参照」は許可
・1行目：商品名
・2行目以降：自然な商品説明文

【入力情報】
${inputText}
`.trim();

    // Replicate に生成リクエスト
    const createResp = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version: MODEL_VERSION,
          input: { prompt }
        })
      }
    );

    if (!createResp.ok) {
      const t = await createResp.text();
      return res.status(500).json({
        ok: false,
        error: "Replicate create error",
        detail: t
      });
    }

    let prediction = await createResp.json();

    // 完了まで待つ（最大60秒）
    const start = Date.now();
    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed"
    ) {
      if (Date.now() - start > 60000) {
        return res.status(504).json({
          ok: false,
          error: "タイムアウト"
        });
      }

      await new Promise(r => setTimeout(r, 1200));

      const getResp = await fetch(prediction.urls.get, {
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`
        }
      });

      prediction = await getResp.json();
    }

    if (prediction.status !== "succeeded") {
      return res.status(500).json({
        ok: false,
        error: "生成失敗",
        detail: prediction.error || null
      });
    }

    const out = prediction.output;
    const result =
      typeof out === "string"
        ? out.trim()
        : Array.isArray(out)
        ? out.join("").trim()
        : JSON.stringify(out);

    return res.json({
      ok: true,
      mode: "text",
      result
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "server error",
      detail: String(e)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
