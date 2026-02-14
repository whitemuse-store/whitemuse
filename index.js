import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = process.env.PORT || 3000;

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "v1.0" });
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

    const prompt = `
あなたは WhiteMuse v1.0（個人専用）のAIオペレーター。
高級ブランドバッグ・高級腕時計・ジュエリー/アクセサリーをECで最短で売れる状態にする。

【絶対禁止】
・被写体生成、改変、修復、新品化
・形状、サイズ、縦横比変更
・トリミング（輪郭抽出による背景分離のみ可）
・変形、遠近補正
・回転（0.0°固定）
・英語の出力
・前置き、挨拶、感想、まとめ

【必須処理順】
1. カテゴリ判別（バッグ／腕時計／アクセサリー）
2. 色系統判別（黒／白・明色／有彩色／メタル）
3. 素材判別（写真で分かる範囲のみ。不明は不明）

【写真編集指示】
・背景は白
・影は極薄の接地影のみ
・不自然なら影なし
・被写体サイズと比率は完全維持

【品質チェック】
形状再現性／素材表現／色正確性／EC適性／不自然さ
各5段階。低評価は理由と再処理指示を書く。

【出品文】
日本語のみ。
写真と矛盾しない。
不明点は不明と書く。

【出力形式】
以下4ブロックのみ、順番固定。

1) 写真編集 指示書
2) 品質チェック
3) 出品文（タイトル1行＋本文）
4) 価格・運用

【ユーザー入力】
${inputText}
`.trim();

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
      const t = await createResp.text();
      return res.status(500).json({ ok: false, error: t });
    }

    let prediction = await createResp.json();
    const start = Date.now();

    while (
      prediction.status !== "succeeded" &&
      prediction.status !== "failed" &&
      prediction.status !== "canceled"
    ) {
      if (Date.now() - start > 60000) {
        return res.status(504).json({ ok: false, error: "タイムアウト" });
      }
      await sleep(1200);
      const getResp = await fetch(prediction.urls.get, {
        headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` }
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
        ? out
        : Array.isArray(out)
        ? out.join("\n")
        : JSON.stringify(out);

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
