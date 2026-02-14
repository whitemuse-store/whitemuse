/**
 * index.js (Node + Express)
 * - Replicate API を叩くサーバー
 * - 環境変数は REPLICATE_API_TOKEN のみ参照（これでズレが起きません）
 *
 * 必須:
 *   REPLICATE_API_TOKEN = r8_.... (実トークン全文)
 *
 * 任意:
 *   REPLICATE_TEXT_VERSION  = ReplicateのモデルID/バージョン（例: "meta/llama-3.1-8b-instruct" 等）
 *   REPLICATE_IMAGE_VERSION = 画像モデルID（例: "black-forest-labs/flux-2-pro"）
 *   PORT = 10000 (Renderは自動で入ることが多い)
 */

import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));

const REPLICATE_API_TOKEN = (process.env.REPLICATE_API_TOKEN || "").trim();
if (!REPLICATE_API_TOKEN) {
  console.error("❌ REPLICATE_API_TOKEN が未設定です（RenderのEnvironmentに入れてください）");
}

const TEXT_VERSION =
  (process.env.REPLICATE_TEXT_VERSION || "").trim() || "meta/llama-3.1-8b-instruct";
const IMAGE_VERSION =
  (process.env.REPLICATE_IMAGE_VERSION || "").trim() || "black-forest-labs/flux-2-pro";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function replicateCreatePrediction({ version, input }) {
  const res = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ version, input }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Replicate側エラーはそのまま返す（原因特定しやすい）
    const err = new Error(json?.detail || json?.title || "Replicate error");
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

async function replicateWaitPrediction(prediction, { timeoutMs = 120000 } = {}) {
  const started = Date.now();
  let p = prediction;

  while (true) {
    if (p.status === "succeeded") return p;
    if (p.status === "failed" || p.status === "canceled") return p;

    if (Date.now() - started > timeoutMs) {
      const err = new Error("Timeout waiting for prediction");
      err.status = 504;
      err.payload = p;
      throw err;
    }

    await sleep(900);

    const res = await fetch(p.urls.get, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    });
    p = await res.json();
  }
}

async function withRetry(fn, { tries = 4 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = e?.status;

      // 429や一時系はリトライ（指数バックオフ）
      if (status === 429 || status === 502 || status === 503 || status === 504) {
        const wait = 1200 * Math.pow(2, i); // 1.2s, 2.4s, 4.8s, 9.6s
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

/**
 * POST /generate
 * body例:
 * {
 *   "mode": "text",
 *   "input": { "text": "シャネルのマトラッセの出品文を作ってください" }
 * }
 *
 * or 画像:
 * {
 *   "mode": "image",
 *   "input": { "prompt": "..." }
 * }
 */
app.post("/generate", async (req, res) => {
  try {
    if (!REPLICATE_API_TOKEN) {
      return res.status(500).json({
        ok: false,
        error: "REPLICATE_API_TOKEN is missing",
      });
    }

    const mode = req.body?.mode || "text";
    const input = req.body?.input || {};

    // --- TEXT ---
    if (mode === "text") {
      const text = String(input.text || "").trim();
      if (!text) {
        return res.status(400).json({ ok: false, error: "input.text is required" });
      }

      // Replicateに投げる形（モデルにより input のキーは変わるので、最小に寄せます）
      const version = input.version || TEXT_VERSION;

      const prediction = await withRetry(() =>
        replicateCreatePrediction({
          version,
          input: {
            prompt: text, // 多くのLLM系は prompt を受ける
          },
        })
      );

      const done = await replicateWaitPrediction(prediction);

      // 出力整形（モデルによって output の型が違うので柔軟に）
      let result = done.output;
      if (Array.isArray(result)) result = result.join("");
      if (result && typeof result === "object") result = JSON.stringify(result);

      return res.json({
        ok: true,
        mode: "text",
        result: String(result ?? ""),
        raw: done,
      });
    }

    // --- IMAGE ---
    if (mode === "image") {
      const prompt = String(input.prompt || "").trim();
      if (!prompt) {
        return res.status(400).json({ ok: false, error: "input.prompt is required" });
      }

      const version = input.version || IMAGE_VERSION;

      const prediction = await withRetry(() =>
        replicateCreatePrediction({
          version,
          input: {
            prompt,
          },
        })
      );

      const done = await replicateWaitPrediction(prediction, { timeoutMs: 180000 });

      // 画像は output がURL配列になることが多い
      return res.json({
        ok: true,
        mode: "image",
        output: done.output,
        raw: done,
      });
    }

    return res.status(400).json({ ok: false, error: "mode must be 'text' or 'image'" });
  } catch (e) {
    const status = e?.status || 500;
    return res.status(status).json({
      ok: false,
      error: e?.message || "Server error",
      detail: e?.payload || null,
      status,
    });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const port = process.env.PORT || 10000;
app.listen(port, () => console.log(`✅ API listening on :${port}`));
