// index.js  (WhiteMuse API / Render)
// 必要: RenderのEnvironmentに REPLICATE_API_TOKEN を設定しておく

import express from "express";
import cors from "cors";

const app = express();
// ===== WhiteMuse v1.0 固定指示文（ここがAIの憲法） =====
const WHITEMUSE_SYSTEM = `
あなたは WhiteMuse v1.0。
高級ブランドバッグ・高級腕時計・ジュエリー/アクセサリーをECで売るためのAIオペレーター。

【最終ゴール】
ユーザー操作は「写真を送る → 出品 → 売れたら終わり」だけ。
判断・編集方針・文章・価格調整・記録はすべてあなたが行う。

【絶対禁止（違反＝失格）】
- 被写体を作る/足す/消す/直す（生成・補完・修復表現禁止）
- 形/サイズ/縦横比を変える（細くする、横長にする等）
- パーツを増やす/欠けを補う/新品化しすぎる
- トリミングはOFF（例外：背景分離のための切り抜きのみOK。サイズ比率は完全一致）
- 変形/遠近補正は常にOFF
- 回転は0.0°固定（水平確認のみ）

【必ず最初に自動判定】
1) カテゴリ：バッグ / 腕時計 / アクセサリー
2) 色：黒 / 白・明色 / はっきり色 / メタル
3) 素材：レザー / 布 / エナメル / 金属 / 宝石 など
※黒バッグ用の考えを白・赤・メタルに流用しない。時計・アクセは別ロジック。

【写真の仕上げ（出力は“編集の指示書”）】
- 基本はEC向け白背景
- 影は接地影のみ、極薄、浮き禁止、二重影禁止
- くっきりは主役だけ。やりすぎ禁止
- 数値は固定しない。写真を見て毎回判断する。

【品質チェック（5段階）】
形状再現性 / 素材表現 / 色の正確性 / EC適性 / 不自然さ
不自然さが出たら理由を言い、やり直し案を出す。

【出品文（テンプレ禁止）】
写真と違うことは書かない。煽らない。
- バッグ：使用感/角/スレは事実ベースで自然に
- 時計：型番/サイズ/付属品を正確に。分からないことは断言しない
- アクセ：素材と特徴を短く。盛らない
`;

const WHITEMUSE_OUTPUT_RULE = `
必ずJSONだけを返す（文章で説明しない）。
JSONの形はこの通り：

{
  "category": "bag|watch|accessory",
  "color_group": "black|light|vivid|metal",
  "material": ["..."],
  "photo_edit_plan": {
    "fixed_rules": {
      "crop": "OFF (except cutout)",
      "perspective": "OFF",
      "rotate": "0.0"
    },
    "cutout": { "do": true, "note": "輪郭分離のみ。比率維持。拡大縮小なし。" },
    "background": { "type": "white", "note": "EC向け白背景。必要なら理由を書く" },
    "shadow": { "type": "soft_contact", "strength": "very_thin", "note": "浮き/二重影は禁止" },
    "adjustments": [
      { "name": "明るさ", "direction": "上げる/下げる/そのまま", "reason": "一言" },
      { "name": "コントラスト", "direction": "上げる/下げる/そのまま", "reason": "一言" },
      { "name": "ハイライト", "direction": "上げる/下げる/そのまま", "reason": "一言" },
      { "name": "シャドウ", "direction": "上げる/下げる/そのまま", "reason": "一言" },
      { "name": "色味", "direction": "暖かく/冷たく/そのまま", "reason": "一言" },
      { "name": "色の濃さ", "direction": "上げる/下げる/そのまま", "reason": "一言" }
    ],
    "sharpness": { "apply": true, "area": "被写体のみ", "strength": "弱め", "note": "やりすぎ禁止" }
  },
  "qc_score": {
    "shape": 1, "material": 1, "color": 1, "ec": 1, "unnatural": 1
  },
  "qc_reason": ["短い理由を最大3つ"],
  "listing": {
    "title": "販路に合わせたタイトル",
    "description": "テンプレ禁止。写真と矛盾禁止。",
    "bullets": ["要点1","要点2","要点3"],
    "tone": "mercari|yahoo|dealer"
  },
  "price_plan": {
    "suggested": "数値が不明なら 'need_market_price' と返す",
    "auto_discount": [
      { "trigger": "days", "value": 7, "action": "price_down", "amount": "小さめ", "note": "安全運用" }
    ]
  },
  "next_action": "次にユーザーがやる1つだけ"
}
`;


// Render(Free)で落ちないようにタイムアウト気味のリクエストにも耐える想定
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const PORT = process.env.PORT || 10000;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// ---- util ----
function mustHaveToken() {
  if (!REPLICATE_API_TOKEN || String(REPLICATE_API_TOKEN).trim() === "") {
    const err = new Error("Missing REPLICATE_API_TOKEN in environment variables");
    err.status = 500;
    throw err;
  }
}

async function replicateRequest(path, body) {
  mustHaveToken();

  const res = await fetch(`https://api.replicate.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.detail || json?.error || JSON.stringify(json);
    const err = new Error(`Replicate API error: ${res.status} ${msg}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function replicateGetPrediction(predictionId) {
  mustHaveToken();

  const res = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.detail || json?.error || JSON.stringify(json);
    const err = new Error(`Replicate GET error: ${res.status} ${msg}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function waitForPrediction(predictionId, { timeoutMs = 120000, intervalMs = 1500 } = {}) {
  const start = Date.now();
  while (true) {
    const p = await replicateGetPrediction(predictionId);

    if (p.status === "succeeded") return p;
    if (p.status === "failed" || p.status === "canceled") {
      const err = new Error(`Prediction ${p.status}`);
      err.status = 500;
      err.payload = p;
      throw err;
    }

    if (Date.now() - start > timeoutMs) {
      const err = new Error("Prediction timeout");
      err.status = 504;
      err.payload = p;
      throw err;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ---- routes ----

// ルートにアクセスされたときの表示（あなたの確認用）
app.get("/", (_req, res) => {
  res.status(200).send("WhiteMuse API is running");
});

// Render側の生存確認
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// ✅ WhiteMuse(フロント)が叩く想定のエンドポイント
// POST /generate
// body:
// {
//   "mode": "text" | "image",
//   "prompt": "...",
//   "input": { ... }  // 任意: Replicateに渡したい追加input
// }
app.post("/generate", async (req, res) => {
  try {
    const { mode, prompt, input } = req.body || {};

// WhiteMuse v1.0 は prompt をユーザーに作らせない。
// 受け取った情報（input）から、API側で必ず固定指示文を付ける。
const userPayload = (input && typeof input === "object") ? input : {};
const finalPrompt = `${WHITEMUSE_SYSTEM}\n\n${WHITEMUSE_OUTPUT_RULE}\n\n【入力】\n${JSON.stringify(userPayload)}`;


    // ---- ここがモデル指定 ----
    // まず動かすこと優先で「汎用・軽め」なモデルを使う構成にしています
    // ※あとであなたのWhiteMuse仕様に合わせてモデルを差し替え可能
    let model;
    let modelInput;

    if (mode === "text") {
      // LLM（文章生成）
      // 例: meta/llama-3-8b-instruct など
      model = "meta/llama-3-8b-instruct";
      modelInput = {
        finalPrompt,
        max_new_tokens: 450,
        temperature: 0.6,
        ...((input && typeof input === "object") ? input : {}),
      };
    } else if (mode === "image") {
      // 画像生成
      // 例: black-forest-labs/flux-schnell など
      model = "black-forest-labs/flux-schnell";
      modelInput = {
        finalPrompt,
        // 追加で渡したい場合は input に入れてOK
        ...((input && typeof input === "object") ? input : {}),
      };
    } else {
      return res.status(400).json({ error: "mode must be 'text' or 'image'" });
    }

    // Replicate Prediction作成
    const created = await replicateRequest("predictions", {
      version: model, // Replicateは「model:version」形式 or deployment指定もあるが、ここでは簡易指定
      // ↑ この指定が通らない場合があるので、下の fallback を使います（安定化）
      input: modelInput,
    }).catch(async (e) => {
      // ✅ 安定化: "version" にモデル文字列が通らない場合があるので
      // その時は "model" フィールド方式で再トライ（ReplicateのAPI仕様差異吸収）
      // （これで動く確率が上がります）
      return await replicateRequest("predictions", {
        model,
        input: modelInput,
      });
    });

    const predictionId = created.id;
    const done = await waitForPrediction(predictionId);

    // 返す形をフロントが扱いやすいように整形
    // done.output はモデルによって配列/文字列/URLなど色々
    res.json({
      ok: true,
      id: predictionId,
      status: done.status,
      output: done.output ?? null,
      raw: done, // 困ったとき用（あとで消してOK）
    });
  } catch (err) {
    const status = err?.status || 500;
    res.status(status).json({
      ok: false,
      error: err?.message || "Unknown error",
      detail: err?.payload || null,
    });
  }
});

app.listen(PORT, () => {
  console.log(`WhiteMuse API listening on ${PORT}`);
});
