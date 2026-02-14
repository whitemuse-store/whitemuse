import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanText(s) {
  if (!s) return "";

  // 1) まず文字列化＋ \n を実改行に
  let t = String(s).replace(/\r/g, "").replace(/\\n/g, "\n");

  // 2) よくある英語の前置きを消す（何パターンでも消す）
  t = t.replace(/^Here is.*?\n+/is, "");
  t = t.replace(/^Here are.*?\n+/is, "");
  t = t.replace(/^Below is.*?\n+/is, "");
  t = t.replace(/^Sure[,\s].*?\n+/is, "");

  // 3) 先頭が英語でダラダラ続く場合、「最初の日本語文字」より前を全部捨てる
  //    （ひらがな/カタカナ/漢字）
  const m = t.match(/[ぁ-んァ-ン一-龥]/);
  if (m && m.index > 0) t = t.slice(m.index);

  // 4) 余計なMarkdownラベルを消す（Title: とか）
  t = t.replace(/^Title:\s*/gim, "");
  t = t.replace(/^Product Description:\s*/gim, "");
  t = t.replace(/\*\*/g, ""); // 太字記号を除去

  // 5) 連続改行を整理
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  return t;
}

// ヘルスチェック
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "v1" });
});

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
      return res.status(400).json({ ok: false, error: "mode:'text' のみ対応" });
    }
    if (!inputText.trim()) {
      return res.status(400).json({ ok: false, error: "input.text が空です" });
    }

    // ✅ システムプロンプトで「日本語のみ・英語禁止」を強制
    const systemPrompt = [
      "あなたは日本のフリマ（メルカリ/ヤフオク）向け出品文のプロです。",
      "必ず日本語のみで出力してください。英語は一切書かないでください。",
      "見出しの英語（Title: など）も禁止。Markdown記号（** など）も禁止。",
      "憶測で書かない。不明点は「写真参照」「写真をご確認ください」と書く。",
      "出力形式は必ず次の2部構成のみ：",
      "1) タイトル（1行）",
      "2) 商品説明（短い見出し＋本文）"
    ].join("\n");

    // Replicate prediction 作成
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
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
        return res.status(504).json({ ok: false, error: "タイムアウトしました" });
      }
      await sleep(1200);

      const getResp = await fetch(prediction.urls.get, {
        headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` }
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

    return res.json({ ok: true, mode: "text", result });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "サーバー側エラー",
      detail: String(e?.message || e)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
