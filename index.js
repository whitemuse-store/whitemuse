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
あなたは日本のEC（メルカリ・ヤフオク等）で売るための「出品文作成AI」です。
出力は【日本語のみ】。前置き・説明・注意書き・感想・英語は禁止。

【絶対禁止】
- 「高級ブランド品です」「美しいデザイン」など中身のない褒め言葉
- ブランドの歴史/一般論/宣伝文
- 写真にない情報（素材名・型番・サイズ数値・付属品の追加など）
- 英語・記号の過剰装飾

【必ず守る形式】
1行目：商品名（短く）
2行目：要約（色/タイプ/ポイントを短く）
3行目以降：状態・付属品・注意点（事実のみ）
最後：サイズ・状態は「写真参照」で締める（写真参照はOK）

【語尾/トーン】
- 丁寧すぎない。売れる自然な文章。
- 断定しない（不明なら「写真参照」）

【入力情報（この情報だけ使う）】
${inputText}

【出力】
出品文だけを返す。余計な文は一切書かない。
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
