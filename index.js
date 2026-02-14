import express from "express";
import cors from "cors";
import Replicate from "replicate";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// ここがReplicateの鍵（RenderのEnvironmentに入れてあるやつ）
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

// 使う文章モデル（RenderのEnvironmentで変えられる）
const TEXT_MODEL =
  process.env.REPLICATE_TEXT_MODEL || "meta/meta-llama-3-8b-instruct";

// 余計なものを落として「タイトル＋本文」だけにする関数
function extractListing(text) {
  if (!text) return "";

  // ありがちな余計なJSONっぽい部分を切り落とす（raw/logs/metrics等）
  // 途中に {"raw": ...} みたいなのが混ざっても、そこから後ろを捨てる
  const cutKeys = ['"raw"', '"logs"', '"metrics"', '"id"', '"model"', '"version"', '"status"'];
  for (const k of cutKeys) {
    const idx = text.indexOf(k);
    if (idx !== -1) {
      text = text.slice(0, idx);
    }
  }

  // TITLE: / DESCRIPTION: 形式を優先して抜く
  const m = text.match(/TITLE\s*:\s*(.+?)\n+DESCRIPTION\s*:\s*([\s\S]+)$/i);
  if (m) {
    const title = m[1].trim();
    const body = m[2].trim();
    return `${title}\n\n${body}`.trim();
  }

  // もしマーカーが崩れてても、とにかく「最初のタイトルっぽい1行 + 残り本文」に整える
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return "";
  const title = lines[0];
  const body = lines.slice(1).join("\n");
  return `${title}\n\n${body}`.trim();
}

app.get("/", (_, res) => {
  res.send("whitemuse-api ok");
});

app.post("/generate", async (req, res) => {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return res.status(500).json({ ok: false, error: "REPLICATE_API_TOKEN が未設定です" });
    }

    const mode = req.body?.mode || "text";
    const inputText = req.body?.input?.text || "";

    if (mode !== "text") {
      return res.status(400).json({ ok: false, error: "mode は text のみ対応です" });
    }
    if (!inputText.trim()) {
      return res.status(400).json({ ok: false, error: "input.text が空です" });
    }

    // ✅ ゴール固定ルール（AIへの指示）
    const systemRules = `
あなたは出品文作成の専門家です。出力は必ず日本語で、次の形式だけにしてください。

TITLE: （タイトルを1行）
DESCRIPTION:
（商品説明本文）

【絶対禁止】
- JSON、ログ、raw、metrics、id、model、version、status、英語、前置き、注釈、理由説明
- 「Here’s」などの導入文

【本文に必ず含める】
- 「写真に写っているものが全てです」
- 状態は断定しない（不明は「写真をご確認ください」）
- 返品：すり替え防止のため、原則返品不可（ただし説明と大きく違う場合は相談可）
`.trim();

    // ユーザーから来た本文（あなたが入力した文章）
    const userPrompt = `
以下の情報を元に、売れやすく丁寧な「タイトル＋商品説明」を作成してください。

【入力情報】
${inputText}
`.trim();

    // Replicateへ送る（文章生成）
    const output = await replicate.run(TEXT_MODEL, {
      input: {
        prompt: `${systemRules}\n\n${userPrompt}`,
        max_new_tokens: 650,
        temperature: 0.6,
      },
    });

    // Replicateの返り値が配列のこともあるので吸収
    const rawText = Array.isArray(output) ? output.join("") : String(output);

    // ✅ 最終的に「タイトル＋本文」だけに整形
    const listing = extractListing(rawText);

    if (!listing) {
      return res.status(500).json({ ok: false, error: "出力の整形に失敗しました" });
    }

    // ✅ 返すのはこれだけ（余計なもの返さない）
    return res.json({ ok: true, mode: "text", result: listing });
  } catch (e) {
    const msg = e?.message || String(e);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// Renderが使うPORT
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log("server listening on", port);
});
