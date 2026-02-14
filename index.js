import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

// Render は PORT を渡してくる（これ必須）
const PORT = process.env.PORT || 3000;

// Render の Environment に入れておく
// 例: r8_0ap... みたいなやつ
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// 使うモデル（デフォルトは meta-llama-3-8b-instruct）
const REPLICATE_TEXT_VERSION =
  process.env.REPLICATE_TEXT_VERSION || "meta/meta-llama-3-8b-instruct";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 文字の掃除（英語混入・余計な章・1文字ずつ改行 を止める）
function cleanToListingOnly(raw) {
  let text = String(raw ?? "");

  // 改行コード整理
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // **太字** を除去
  text = text.replace(/\*\*/g, "");

  // もし "1文字ずつ改行" っぽかったら強制で直す
  // 例: "シ\nャ\nネ\nル" → "シャネル"
  // 条件：改行の密度が異常に高い時だけ発動
  const newlineCount = (text.match(/\n/g) || []).length;
  if (text.length > 0 && newlineCount > text.length * 0.25) {
    text = text.replace(/\n+/g, "");
  }

  // 先頭の英語挨拶をカット（日本語が出てきたらそこからにする）
  // ※ブランド名（Chanel等）の英字は残る可能性があるが、英語の文章は消す
  const jpIndex = text.search(/[ぁ-んァ-ン一-龥]/);
  if (jpIndex > 0) text = text.slice(jpIndex);

  // よくある英語の前置き/締めを削除（残ってたら）
  text = text.replace(/^\s*(I['’]m|Here['’]s|Here is|Please note|Based on)[\s\S]*?\n/gi, "");
  text = text.replace(/\n\s*(Please note|I hope|Let me know)[\s\S]*$/gi, "");

  // 「出品文」セクションがあるなら、そこだけ抜き出す
  // 例: 「出品文」以降を採用し、次の大見出し（価格など）が来たら切る
  const idxListing = text.indexOf("出品文");
  if (idxListing !== -1) {
    text = text.slice(idxListing + "出品文".length);
  }

  // 余計な章が混ざってたら切り落とす（WhiteMuseの返却は出品文だけに固定）
  const cutWords = ["写真編集", "品質チェック", "価格", "運用", "編集指示書", "品質", "価格・運用"];
  for (const w of cutWords) {
    const p = text.indexOf(w);
    if (p !== -1) {
      text = text.slice(0, p);
    }
  }

  // 引用符で囲まれてる時の対処
  text = text.trim();
  text = text.replace(/^「/, "").replace(/」$/, "").trim();

  // 連続空行を整える（読みやすく）
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

// ヘルスチェック
app.get("/", (_req, res) => {
  res.json({ ok: true, service: "whitemuse-api", version: "v1" });
});

// メイン：/generate
app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN が未設定です。Render の Environment に入れてください。"
      });
    }

    // 受け取り（固定）
    const mode = req.body?.mode || "text";
    const inputText = req.body?.input?.text || "";

    if (mode !== "text") {
      return res.status(400).json({ ok: false, error: "いまは mode:'text' のみ対応です" });
    }
    if (!String(inputText).trim()) {
      return res.status(400).json({ ok: false, error: "input.text が空です（文章を入れてください）" });
    }

    // ✅ WhiteMuse v1.0：出品文だけ返す（前置き・英語・テンプレ感を禁止）
    const system_prompt = [
      "あなたは高級ブランド（バッグ・腕時計・ジュエリー/アクセサリー）のEC販売プロ向けAIオペレーターです。",
      "【絶対条件】",
      "・出力は日本語のみ（英語の挨拶、注意書き、解説、前置き、締めの言葉は禁止）",
      "・テンプレの丸出しは禁止（毎回文章を自然に作る）",
      "・写真が無いので、断定表現は避ける（不明な点は『写真参照』で止める）",
      "・あなたの役割は『出品文の文章』を作ることだけ（写真編集指示/品質チェック/価格/運用の話は書かない）",
      "",
      "【出力フォーマット固定】",
      "1行目：タイトル（1行だけ）",
      "2行目：空行",
      "3行目以降：本文（読みやすい段落。箇条書き多用しない）",
      "",
      "【本文に入れて良い情報】",
      "・入力にある情報のみ（サイズ/色/付属品/状態など）",
      "・不明は必ず『写真参照』で止める",
      "",
      "【禁止】",
      "・英語（単語も原則禁止。ブランド名など必要最低限は可）",
      "・『I’m happy』『Please note』『Here is』などの前置き/締め",
      "・『写真編集指示書』『品質チェック』『価格・運用』などの章立て",
      ""
    ].join("\n");

    // ユーザー入力を、そのまま材料として渡す
    const prompt = [
      "次の入力情報を元に、出品文を作ってください。",
      "入力情報：",
      inputText
    ].join("\n");

    // 1) 予測作成
    const createResp = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: REPLICATE_TEXT_VERSION,
        input: {
          prompt,
          system_prompt,
          max_tokens: 700,
          temperature: 0.4
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

    // 3) 出力を文字列にする（ここが「1文字ずつ改行」の最大原因）
    // Replicateの output は「配列」になることが多いので join("") が正解
    const out = prediction.output;
    const rawText =
      typeof out === "string"
        ? out
        : Array.isArray(out)
          ? out.join("") // ← "\n" で繋ぐと地獄になるので絶対に "" で繋ぐ
          : JSON.stringify(out);

    // 4) WhiteMuse仕様：出品文だけに整形
    const result = cleanToListingOnly(rawText);

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
