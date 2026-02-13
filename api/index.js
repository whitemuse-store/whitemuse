import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

// Replicate: create prediction -> poll until done
async function replicatePredict({ version, input }) {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN is not set");
  }

  const createRes = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
      "Prefer": "wait" // if supported, can return faster; if not, polling still works
    },
    body: JSON.stringify({ version, input })
  });

  const created = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`Replicate create failed: ${JSON.stringify(created)}`);
  }

  // Poll if async
  let pred = created;
  const getUrl = pred?.urls?.get;
  if (!getUrl) return pred;

  const start = Date.now();
  const timeoutMs = 120000; // 2 minutes

  while (true) {
    if (pred.status === "succeeded" || pred.status === "failed" || pred.status === "canceled") {
      return pred;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error("Replicate timed out");
    }
    await new Promise(r => setTimeout(r, 1200));
    const r2 = await fetch(getUrl, {
      headers: { "Authorization": `Bearer ${REPLICATE_API_TOKEN}` }
    });
    pred = await r2.json();
  }
}

app.get("/health", (req, res) => res.json({ ok: true }));

// 高精度背景除去（PNGの透過画像URLを返す）
app.post("/remove-bg", async (req, res) => {
  try {
    const { imageDataUrl, quality = "high" } = req.body || {};
    if (!imageDataUrl) return res.status(400).json({ ok: false, error: "imageDataUrl is required" });

    // まずは高精度寄り（BRIA系）: cjwbw/rmgb version: e89200fb (Replicate page)
    // もし重い/遅いなら後で rembg（軽い）に切替できます。
    const version = "e89200fb"; // cjwbw/rmgb (latest shown on Replicate)
    const input = { image: imageDataUrl };

    const pred = await replicatePredict({ version, input });
    if (pred.status !== "succeeded") {
      return res.status(500).json({ ok: false, error: `remove-bg failed: ${pred.status}`, pred });
    }

    // output could be a URL (string) or array; normalize
    const out = pred.output;
    const url = Array.isArray(out) ? out[0] : out;

    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 背景だけ生成（商品は生成しない。背景画像URLを返す）
app.post("/generate-bg", async (req, res) => {
  try {
    const { prompt, width = 1024, height = 1024 } = req.body || {};
    if (!prompt) return res.status(400).json({ ok: false, error: "prompt is required" });

    // SDXL version: 7762fd07 (Replicate versions list)
    const version = "7762fd07";
    const input = {
      prompt: `Background only, no product, no logo, no text. ${prompt}`,
      width,
      height
    };

    const pred = await replicatePredict({ version, input });
    if (pred.status !== "succeeded") {
      return res.status(500).json({ ok: false, error: `generate-bg failed: ${pred.status}`, pred });
    }

    const out = pred.output;
    const url = Array.isArray(out) ? out[0] : out;

    res.json({ ok: true, url });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// 文章生成（まずは安全に“非テンプレっぽく”揺らす）
// ※本物のLLM接続は次ステップ（キー管理が必要）
app.post("/generate-text", async (req, res) => {
  try {
    const { channel = "mercari", title = "", condition = "", accessories = "", intent = "auto" } = req.body || {};

    const openings = [
      "ご覧いただきありがとうございます。",
      "お忙しい中、ページをご覧いただきありがとうございます。",
      "数ある中からお目に留めていただきありがとうございます。"
    ];
    const mercariHooks = [
      "人気モデルのため、気になる方はお早めにどうぞ。",
      "この機会にぜひご検討ください。",
      "即購入OKです。"
    ];
    const yahooHooks = [
      "落ち着いた雰囲気で、長くご愛用いただける一品です。",
      "丁寧に保管しておりました。",
      "状態重視の方にもおすすめです。"
    ];
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

    const head = pick(openings);
    const hook = channel === "yahoo" ? pick(yahooHooks) : pick(mercariHooks);

    const lines = [];
    if (title) lines.push(`【商品】${title}`);
    if (condition) lines.push(`【状態】${condition}`);
    if (accessories) lines.push(`【付属品】${accessories}`);
    lines.push("※写真は実物です（商品をAIで描きません）");
    lines.push("※気になる点はご購入前にコメントください");
    lines.push(channel === "yahoo" ? "丁寧に梱包のうえ発送いたします。" : "丁寧梱包で発送します。");

    const body = `${head}\n${hook}\n\n${lines.join("\n")}`;
    const outTitle =
      channel === "yahoo"
        ? `【正規品】${title || "ブランド品"}｜状態良好｜丁寧梱包`
        : `${title || "ブランド品"}｜人気モデル｜即購入OK`;

    res.json({ ok: true, title: outTitle, body });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("WhiteMuse API running on", port));
