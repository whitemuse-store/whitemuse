import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Renderがくれるポート番号を使う（これ必須）
const PORT = process.env.PORT || 3000;

// RenderのEnvironmentに入れておくもの
// REPLICATE_API_TOKEN = r8_から始まるやつ
// REPLICATE_TEXT_VERSION = meta/meta-llama-3-8b-instruct （おすすめ）
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ヘルスチェック（動いてるか確認用）
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "v1" });
});

// あなたが叩いてるAPI（/generate）
app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error:
          "REPLICATE_API_TOKEN が未設定です。RenderのEnvironmentに入れてください。"
      });
    }

    // 受け取り（いままで通り）
    const mode = req.body?.mode || "text";
    const inputText = req.body?.input?.text || "";

    if (mode !== "text") {
      return res.status(400).json({
        ok: false,
        error: "いまは mode:'text' のみ対応です"
      });
    }

    if (!inputText.trim()) {
      return res.status(400).json({
        ok: false,
        error: "input.text が空です（文章を入れてください）"
      });
    }

    // Replicateに投げるプロンプト（余計なことをさせず、出品文に集中させる）
    const prompt = [
      "あなたは日本のフリマアプリ（メルカリ・ヤフオク）向けの出品文作成のプロです。",
      "目的：売れやすく、信頼感があり、読みやすい出品文を日本語で作る。",
      "",
      "【絶対ルール】",
      "・嘘は書かない。分からない所は「写真をご確認ください」「不明（写真参照）」と書く。",
      "・専門用語は使わない（誰でも分かる言葉）。",
      "・返品/注意点をトラブルにならないように短く入れる。",
      "",
      "【出力形式】",
      "1) タイトル（1行）",
      "2) 商品説明（見出し＋本文）",
      "",
      "【素材（あなたが受け取った情報）】",
      inputText
    ].join("\n");

    // 1) まずprediction作成
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // ここは RenderのEnvironmentで自由に差し替え可能
        version: REPLICATE_TEXT_VERSION,
        input: {
          prompt
        }
      })
    });

    // 429などのエラーをそのまま返す
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

    // 2) 完了まで待つ（最大60秒）
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

    // モデルによって output の型が違うので吸収する
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
      error: "サーバー側エラー",
      detail: String(e?.message || e)
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
