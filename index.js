import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Renderが割り当てるポート（必須）
const PORT = process.env.PORT || 3000;

// RenderのEnvironmentに入れておくもの（必須）
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// なくてもOK（任意）: 変えたい時だけRenderのEnvironmentで差し替え
// 例) meta/meta-llama-3-8b-instruct
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

// 生存確認（ブラウザで開いてOKが出れば起動してる）
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api" });
});

// 余計な文字を消して、読みやすい文章だけ返すための整形
function cleanText(s) {
  if (!s) return "";
  return String(s)
    .replace(/\r/g, "")
    .replace(/\\n/g, "\n") // "\n" 文字として入ってきた場合は改行に戻す
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Replicateに投げる「固定の指示」
// ここで “日本語だけ / タイトル1行 + 商品説明だけ / 余計な文は書かない” を強制
function buildPrompt(inputText) {
  return [
    "あなたは日本のフリマアプリ（メルカリ・ヤフオク）向けの出品文作成のプロです。",
    "目的：売れやすく、信頼感があり、読みやすい出品文を日本語で作る。",
    "",
    "【絶対ルール】",
    "・日本語のみ。英語は一切出さない。",
    "・嘘は書かない。分からない所は必ず「写真参照」または「不明（写真参照）」と書く。",
    "・専門用語は避けて、誰でも分かる言い方にする。",
    "・返品/注意点はトラブルにならないように短く入れる。",
    "",
    "【出力形式（この順番で固定）】",
    "1) タイトル（1行だけ）",
    "2) 商品説明（見出し＋本文）",
    "",
    "【素材（あなたが受け取った情報）】",
    inputText,
  ].join("\n");
}

app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN が未設定です。RenderのEnvironmentに入れてください。",
      });
    }

    const mode = req.body?.mode || "text";
    const inputText = req.body?.input?.text || "";

    if (mode !== "text") {
      return res.status(400).json({ ok: false, error: "いまは mode: 'text' のみ対応です" });
    }
    if (!String(inputText).trim()) {
      return res.status(400).json({ ok: false, error: "input.text が空です（文章を入れてください）" });
    }

    const prompt = buildPrompt(inputText);

    // 1) predictions を作る
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: REPLICATE_TEXT_VERSION,
        input: { prompt },
      }),
    });

    if (!createResp.ok) {
      const errText = await createResp.text();
      return res.status(createResp.status).json({
        ok: false,
        error: "Replicate API error (create)",
        status: createResp.status,
        detail: errText,
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
          error: "タイムアウトしました（もう一度お試しください）",
        });
      }

      await new Promise((r) => setTimeout(r, 1200));

      const getResp = await fetch(prediction.urls.get, {
        headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
      });

      if (!getResp.ok) {
        const errText = await getResp.text();
        return res.status(getResp.status).json({
          ok: false,
          error: "Replicate API error (get)",
          status: getResp.status,
          detail: errText,
        });
      }

      prediction = await getResp.json();
    }

    if (prediction.status !== "succeeded") {
      return res.status(500).json({
        ok: false,
        error: "生成に失敗しました",
        status: prediction.status,
        detail: prediction.error || null,
      });
    }

    // 3) 出力を “人が読める文章” にする
    // prediction.output は「文字」か「配列」になることがあるので吸収する
    const out = prediction.output;
    let text = "";
    if (typeof out === "string") text = out;
    else if (Array.isArray(out)) text = out.join("");
    else text = JSON.stringify(out);

    const result = cleanText(text);

    return res.json({ ok: true, mode: "text", result });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "サーバー側エラー",
      detail: String(e?.message || e),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
