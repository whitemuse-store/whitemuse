import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanJapaneseOnly(text) {
  let t = String(text || "")
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n");

  // 英語の前置きを強制削除
  t = t.replace(/^Here is.*?\n+/is, "");
  t = t.replace(/^Here are.*?\n+/is, "");
  t = t.replace(/^Below is.*?\n+/is, "");
  t = t.replace(/^Sure[,\s].*?\n+/is, "");

  // 最初の日本語文字より前を全削除
  const jp = t.match(/[ぁ-んァ-ン一-龥]/);
  if (jp && jp.index > 0) t = t.slice(jp.index);

  // Markdown・英語ラベル除去
  t = t.replace(/\*\*/g, "");
  t = t.replace(/^Title:\s*/gim, "");
  t = t.replace(/^Product Description:\s*/gim, "");

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

// ヘルスチェック
app.get("/", (_req, res) => {
  res.json({ ok: true });
});

app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN が未設定です"
      });
    }

    const inputText = req.body?.input?.text || "";
    if (!inputText.trim()) {
      return res.status(400).json({
        ok: false,
        error: "input.text が空です"
      });
    }

    const systemPrompt = [
      "あなたは日本のフリマ（メルカリ・ヤフオク）向け出品文の専門家です。",
      "必ず日本語のみで出力してください。",
      "英語・前置き・説明文・挨拶は禁止。",
      "憶測で書かない。不明点は必ず「写真参照」と書く。",
      "出力形式は以下のみ：",
      "1) タイトル（1行）",
      "2) 商品説明（短い見出し＋本文）"
    ].join("\n");

    const createResp = await fetch(
      "https://api.replicate.com/v1/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version: REPLICATE_TEXT_VERSION,
          input: {
            system_prompt: systemPrompt,
            prompt: inputText,
            max_tokens: 512
          }
        })
      }
    );

    if (!createResp.ok) {
      return res.status(createResp.status).json({
        ok: false,
        error: "Replicate API error"
      });
    }

    let prediction = await createResp.json();
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
      await sleep(1200);
      const r = await fetch(prediction.urls.get, {
        headers: {
          Authorization: `Token ${REPLICATE_API_TOKEN}`
        }
      });
      prediction = await r.json();
    }

    if (prediction.status !== "succeeded") {
      return res.status(500).json({
        ok: false,
        error: "生成失敗"
      });
    }

    const out = prediction.output;
    const raw =
      typeof out === "string"
        ? out
        : Array.isArray(out)
        ? out.join("\n")
        : JSON.stringify(out);

    const result = cleanJapaneseOnly(raw);

    return res.json({
      ok: true,
      mode: "text",
      result
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "サーバーエラー",
      detail: String(e?.message || e)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
