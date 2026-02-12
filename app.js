// app.js
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    fileInput: $("fileInput"),
    strength: $("strength"),
    btnOneTap: $("btnOneTap"),
    btnEdge: $("btnEdge"),
    btnShadowWeak: $("btnShadowWeak"),
    btnWhiteStrong: $("btnWhiteStrong"),
    thumbs: $("thumbs"),
    before: $("beforeCanvas"),
    after: $("afterCanvas"),
    baSlider: $("baSlider"),
    selectedName: $("selectedName"),
    btnDownloadAll: $("btnDownloadAll"),
    exportPreset: $("exportPreset"),
    category: $("category"),
    btnOcr: $("btnOcr"),
    ocrOut: $("ocrOut"),
    ocrGuide: $("ocrGuide"),
    refMode: $("refMode"),
    refType: $("refType"),
    sizeOut: $("sizeOut"),
    copyMode: $("copyMode"),
    btnCopy: $("btnCopy"),
    copyLong: $("copyLong"),
    copyShort: $("copyShort"),
    btnUsed: $("btnUsed"),
    btnSold: $("btnSold"),
    btnClearLearning: $("btnClearLearning"),
    cloudToggle: $("cloudToggle"),
    cloudApiKey: $("cloudApiKey"),
    modelStatus: $("modelStatus"),
    progress: $("progress"),
    barFill: $("barFill"),
    barText: $("barText"),
    tips: $("tips"),
    btnInstallHelp: $("btnInstallHelp"),
    btnGenerateIcons: $("btnGenerateIcons")
  };

  // ✅ 重要：要素が1つでも無いと、iPhoneで「何も起きない」状態になるので最初に止める
  const REQUIRED_IDS = [
    "fileInput","strength","btnOneTap","btnEdge","btnShadowWeak","btnWhiteStrong",
    "thumbs","beforeCanvas","afterCanvas","baSlider","selectedName","btnDownloadAll",
    "exportPreset","category","btnOcr","ocrOut","ocrGuide","refMode","refType","sizeOut",
    "copyMode","btnCopy","copyLong","copyShort","btnUsed","btnSold","btnClearLearning",
    "cloudToggle","cloudApiKey","modelStatus","progress","barFill","barText","tips",
    "btnInstallHelp","btnGenerateIcons"
  ];
  for (const id of REQUIRED_IDS) {
    if (!$(id)) {
      alert(`画面の部品が見つかりません：${id}\n\nindex.html をそのまま貼れているか確認してください。`);
      return;
    }
  }

  const state = {
    items: [], // {name, file, img, objectUrl, thumbUrl, beforeCanvas, afterCanvas, mask, statusText, ocr, size}
    selectedIndex: -1,
    style: { edgePriority: false, shadowWeak: false, whiteStrong: false },
    calib: { active: false, p1: null, p2: null },
    learning: loadLearning(),
    model: { ort: null, session: null, ready: false }
  };

  // -------------------- PWA SW --------------------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
      try { await navigator.serviceWorker.register("./sw.js"); } catch (_) {}
    });
  }

  // -------------------- UI helpers --------------------
  function showProgress(on, pct = 0, text = "") {
    els.progress.hidden = !on;
    els.barFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    if (text) els.barText.textContent = text;
  }

  function nowYMD() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${da}`;
  }

  function rand(seedObj) {
    let x = (seedObj?.x ?? Date.now()) ^ (state.learning?.salt ?? 1234567);
    return () => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return ((x >>> 0) / 4294967296);
    };
  }

  function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v); }
  function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // -------------------- Load ONNX Runtime + U2NetP --------------------
  async function ensureBgModel() {
    if (state.model.ready) return true;

    const modelUrl = "./models/u2netp.onnx";

    const exists = await (async () => {
      // ✅ iPhone/Safari/Pagesで HEAD が通らないことがあるので、Range GET を先に試す
      try {
        const r = await fetch(modelUrl, {
          method: "GET",
          headers: { "Range": "bytes=0-0" },
          cache: "no-store"
        });
        if (r.ok) return true;
      } catch (_) {}
      try {
        const r2 = await fetch(modelUrl, { method: "HEAD", cache: "no-store" });
        return r2.ok;
      } catch (_) {
        return false;
      }
    })();

    if (!exists) {
      els.modelStatus.hidden = false;
      state.model.ready = false;
      return false;
    } else {
      els.modelStatus.hidden = true;
    }

    if (!state.model.ort) {
      await loadScript("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js");
      state.model.ort = window.ort;
      state.model.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/";
      state.model.ort.env.wasm.numThreads = 1; // iOS Safari 安全
    }

    showProgress(true, 5, "背景除去モデルを読み込み中…");

    state.model.session = await state.model.ort.InferenceSession.create(modelUrl, {
      executionProviders: ["wasm"]
    });

    state.model.ready = true;
    showProgress(false);
    return true;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // -------------------- Image IO --------------------
  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = reject;
      img.src = url;
    });
  }

  function fitWithin(w, h, maxSide) {
    if (Math.max(w, h) <= maxSide) return { w, h, scale: 1 };
    const s = maxSide / Math.max(w, h);
    return { w: Math.round(w * s), h: Math.round(h * s), scale: s };
  }

  function drawToCanvas(img, maxSide = 1024) {
    const { w, h } = fitWithin(img.naturalWidth, img.naturalHeight, maxSide);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return c;
  }

  // -------------------- Background removal (U2NetP) --------------------
  async function removeBackgroundU2Net(canvas) {
    const ok = await ensureBgModel();
    if (!ok) return null;

    const target = 320;

    const tmp = document.createElement("canvas");
    tmp.width = target; tmp.height = target;
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.drawImage(canvas, 0, 0, target, target);
    const id = tctx.getImageData(0, 0, target, target).data;

    const float = new Float32Array(1 * 3 * target * target);
    let p = 0;
    for (let y = 0; y < target; y++) {
      for (let x = 0; x < target; x++) {
        const i = (y * target + x) * 4;
        const r = id[i] / 255;
        const g = id[i + 1] / 255;
        const b = id[i + 2] / 255;
        float[p] = r;
        float[p + target * target] = g;
        float[p + 2 * target * target] = b;
        p++;
      }
    }

    const inputName = state.model.session.inputNames[0];
    const tensor = new state.model.ort.Tensor("float32", float, [1, 3, target, target]);

    const outputs = await state.model.session.run({ [inputName]: tensor });
    const outName = state.model.session.outputNames[0];
    const out = outputs[outName].data;

    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    const denom = (mx - mn) || 1;

    const w = canvas.width, h = canvas.height;
    const mask = new Float32Array(w * h);

    for (let y = 0; y < h; y++) {
      const sy = Math.min(target - 1, Math.max(0, Math.round((y / h) * (target - 1))));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(target - 1, Math.max(0, Math.round((x / w) * (target - 1))));
        const v = (out[sy * target + sx] - mn) / denom;
        mask[y * w + x] = v;
      }
    }

    return boxBlurMask(mask, w, h, 2);
  }

  function boxBlurMask(mask, w, h, r) {
    if (r <= 0) return mask;
    const out = new Float32Array(mask.length);
    const tmp = new Float32Array(mask.length);

    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) {
        const xx = Math.min(w - 1, Math.max(0, x));
        acc += mask[y * w + xx];
      }
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        const xOut = x - r;
        const xIn = x + r + 1;
        if (xOut >= 0) acc -= mask[y * w + xOut];
        if (xIn < w) acc += mask[y * w + xIn];
      }
    }

    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) {
        const yy = Math.min(h - 1, Math.max(0, y));
        acc += tmp[yy * w + x];
      }
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / (2 * r + 1);
        const yOut = y - r;
        const yIn = y + r + 1;
        if (yOut >= 0) acc -= tmp[yOut * w + x];
        if (yIn < h) acc += tmp[yIn * w + x];
      }
    }

    return out;
  }

  // -------------------- Optional cloud (stub, safe default OFF) --------------------
  async function removeBackgroundCloud(canvas, apiKey) {
    void canvas;
    void apiKey;
    return null;
  }

  // -------------------- Photo enhancement pipeline --------------------
  function enhance(canvas, mask, opts) {
    const strength = opts.strength;
    const edgePriority = opts.edgePriority;
    const shadowWeak = opts.shadowWeak;
    const whiteStrong = opts.whiteStrong;

    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const id = ctx.getImageData(0, 0, w, h);
    const d = id.data;

    // 1) WB (gray-world)
    let rSum = 0, gSum = 0, bSum = 0, count = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = mask ? mask[(i / 4)] : 1;
      if (a < 0.25) continue;
      rSum += d[i]; gSum += d[i + 1]; bSum += d[i + 2];
      count++;
    }
    if (count < 50) count = (d.length / 4);
    const rAvg = rSum / count, gAvg = gSum / count, bAvg = bSum / count;
    const gray = (rAvg + gAvg + bAvg) / 3;
    const rGain = gray / (rAvg || 1);
    const gGain = gray / (gAvg || 1);
    const bGain = gray / (bAvg || 1);

    // 2) Exposure + contrast (percentile-based)
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const a = mask ? mask[(i / 4)] : 1;
      if (a < 0.25) continue;
      const rr = clamp255(d[i] * rGain);
      const gg = clamp255(d[i + 1] * gGain);
      const bb = clamp255(d[i + 2] * bGain);
      const y = Math.round(0.2126 * rr + 0.7152 * gg + 0.0722 * bb);
      hist[y]++;
    }
    const total = hist.reduce((a, b) => a + b, 0) || 1;
    const lo = percentileFromHist(hist, total, 0.02);
    const hi = percentileFromHist(hist, total, 0.98);
    const inv = 1 / Math.max(1, (hi - lo));

    // 3) Apply transforms
    const satBoost = lerp(0, 0.20, strength);
    const conBoost = lerp(1.0, 1.18 + (whiteStrong ? 0.06 : 0), strength);
    const expBoost = lerp(1.0, 1.10 + (whiteStrong ? 0.08 : 0), strength);

    for (let i = 0; i < d.length; i += 4) {
      const idx = i / 4;
      let rr = d[i] * rGain;
      let gg = d[i + 1] * gGain;
      let bb = d[i + 2] * bGain;

      rr = (rr - lo) * inv * 255;
      gg = (gg - lo) * inv * 255;
      bb = (bb - lo) * inv * 255;

      rr *= expBoost; gg *= expBoost; bb *= expBoost;

      rr = (rr - 128) * conBoost + 128;
      gg = (gg - 128) * conBoost + 128;
      bb = (bb - 128) * conBoost + 128;

      const y = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
      rr = y + (rr - y) * (1 + satBoost);
      gg = y + (gg - y) * (1 + satBoost);
      bb = y + (bb - y) * (1 + satBoost);

      const dn = lerp(0, 0.10, strength);
      rr = y + (rr - y) * (1 - dn);
      gg = y + (gg - y) * (1 - dn);
      bb = y + (bb - y) * (1 - dn);

      if (mask) {
        const a = mask[idx];
        const bgMix = (1 - a);
        if (bgMix > 0.7) {
          rr = lerp(rr, 255, 0.65);
          gg = lerp(gg, 255, 0.65);
          bb = lerp(bb, 255, 0.65);
        }
      }

      d[i] = clamp255(rr);
      d[i + 1] = clamp255(gg);
      d[i + 2] = clamp255(bb);
    }

    const sharpenAmount = lerp(0, edgePriority ? 0.85 : 0.55, strength);
    const out = unsharp(id, w, h, sharpenAmount);

    return compositeWhiteWithShadow(out, mask, w, h, { strength, shadowWeak });
  }

  function percentileFromHist(hist, total, p) {
    const target = total * p;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  }

  function unsharp(imageData, w, h, amount) {
    if (amount <= 0.001) return imageData;

    const src = imageData.data;
    const blur = new Uint8ClampedArray(src.length);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let rs = 0, gs = 0, bs = 0, as = 0, n = 0;
        for (let yy = -1; yy <= 1; yy++) {
          const y2 = Math.min(h - 1, Math.max(0, y + yy));
          for (let xx = -1; xx <= 1; xx++) {
            const x2 = Math.min(w - 1, Math.max(0, x + xx));
            const i = (y2 * w + x2) * 4;
            rs += src[i]; gs += src[i + 1]; bs += src[i + 2]; as += src[i + 3];
            n++;
          }
        }
        const o = (y * w + x) * 4;
        blur[o] = rs / n;
        blur[o + 1] = gs / n;
        blur[o + 2] = bs / n;
        blur[o + 3] = as / n;
      }
    }

    const out = new ImageData(w, h);
    const dst = out.data;
    for (let i = 0; i < src.length; i += 4) {
      dst[i] = clamp255(src[i] + (src[i] - blur[i]) * amount);
      dst[i + 1] = clamp255(src[i + 1] + (src[i + 1] - blur[i + 1]) * amount);
      dst[i + 2] = clamp255(src[i + 2] + (src[i + 2] - blur[i + 2]) * amount);
      dst[i + 3] = src[i + 3];
    }
    return out;
  }

  function compositeWhiteWithShadow(imageData, mask, w, h, opts) {
    const out = new ImageData(w, h);
    const src = imageData.data;
    const dst = out.data;

    let shadow = null;
    if (mask) shadow = boxBlurMask(mask, w, h, 8);

    const shadowOpacity = lerp(0.00, opts.shadowWeak ? 0.18 : 0.28, opts.strength);
    const shadowOffsetY = Math.round(lerp(0, 10, opts.strength));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const i = idx * 4;

        const a = mask ? mask[idx] : 1;

        let bgR = 255, bgG = 255, bgB = 255;

        if (shadow) {
          const sy = Math.min(h - 1, Math.max(0, y - shadowOffsetY));
          const sIdx = sy * w + x;
          const s = shadow[sIdx];
          const sh = (1 - a) * s;
          const dark = sh * shadowOpacity * 255;
          bgR = clamp255(bgR - dark);
          bgG = clamp255(bgG - dark);
          bgB = clamp255(bgB - dark);
        }

        const fr = src[i], fg = src[i + 1], fb = src[i + 2];

        dst[i] = fr * a + bgR * (1 - a);
        dst[i + 1] = fg * a + bgG * (1 - a);
        dst[i + 2] = fb * a + bgB * (1 - a);
        dst[i + 3] = 255;
      }
    }
    return out;
  }

  // -------------------- OCR (tesseract.js) --------------------
  async function ensureTesseract() {
    if (window.Tesseract) return true;
    await loadScript("https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js");
    return true;
  }

  function buildBrandDict() {
    return [
      { brand: "CHANEL", keys: ["CHANEL", "シャネル", "COCO", "CC", "MADE IN FRANCE"] },
      { brand: "HERMES", keys: ["HERMES", "HERMÈS", "エルメス", "PARIS", "MADE IN FRANCE"] },
      { brand: "LOUIS VUITTON", keys: ["LOUIS", "VUITTON", "LV", "ヴィトン", "LOUISVUITTON"] },
      { brand: "DIOR", keys: ["DIOR", "CHRISTIAN DIOR", "ディオール"] },
      { brand: "GUCCI", keys: ["GUCCI", "グッチ", "MADE IN ITALY"] },
      { brand: "PRADA", keys: ["PRADA", "プラダ", "MILANO"] },
      { brand: "CELINE", keys: ["CELINE", "セリーヌ", "PARIS"] }
    ];
  }

  function scoreBrand(ocrText) {
    const t = (ocrText || "").toUpperCase();
    const dict = buildBrandDict();
    const scored = dict.map(d => {
      let hits = 0;
      for (const k of d.keys) if (t.includes(k.toUpperCase())) hits++;
      const score = Math.min(0.99, hits / Math.max(4, d.keys.length));
      return { brand: d.brand, hits, score };
    }).filter(x => x.hits > 0).sort((a, b) => b.score - a.score);
    return scored;
  }

  function ocrRetakeGuide(ocrText) {
    const len = (ocrText || "").replace(/\s/g, "").length;
    if (len >= 8) return null;
    return [
      "撮り直しガイド（うまく読めない時）",
      "1) もっと寄る（タグ/刻印が画面の1/3以上）",
      "2) 斜めをやめる（真正面）",
      "3) 影を消す（白い紙の上で、明るい場所）",
      "4) ピントをタグに合わせる（タップしてピント固定）"
    ].join("\n");
  }

  // -------------------- Size estimation --------------------
  function refMM(refType) {
    switch (refType) {
      case "CARD": return 85.60;
      case "A4W": return 210;
      case "A4H": return 297;
      case "RULER100": return 100;
      default: return 85.60;
    }
  }

  function estimateObjectSizeFromMask(mask, w, h, mmPerPx) {
    if (!mask) return null;
    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const a = mask[y * w + x];
        if (a > 0.5) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return null;
    const pxW = (maxX - minX + 1);
    const pxH = (maxY - minY + 1);
    return { mmW: pxW * mmPerPx, mmH: pxH * mmPerPx };
  }

  // -------------------- Copy generation --------------------
  function generateCopy(mode, context) {
    const r = rand({ x: Date.now() ^ context.seed });
    const style = state.learning?.style || { sharp: 0.5, elegant: 0.5, short: 0.5 };

    const tone = (mode === "AUTO") ? (r() < 0.5 ? "ATTACK" : "ELEGANT") : mode;

    const vocab = {
      attack: {
        hooks: [
          "写真そのままでも勝てる個体ですが、白背景で“映え”まで仕上げました。",
          "即戦力。届いたらそのまま使える状態感です。",
          "探してる人には刺さるタイプ。先に言うと、早い者勝ちです。"
        ],
        pace: [
          "まずは写真で判断してください。細部は本文で補足します。",
          "長文が苦手な方へ：要点→状態→付属→注意の順で書きます。",
          "要点だけ詰めます。読みやすさ優先で。"
        ]
      },
      elegant: {
        hooks: [
          "白背景で輪郭と素材感が立つよう整えています。静かに良い個体です。",
          "余白のある佇まい。写真の印象どおり、品の良い雰囲気です。",
          "光の当たり方で表情が変わるタイプ。上品にまとまります。"
        ],
        pace: [
          "過不足なく、状態を丁寧に記します。",
          "写真→状態→付属→発送の順にまとめます。",
          "素材感が伝わるように、要点を落ち着いて記載します。"
        ]
      }
    };

    const brandLine = context.brandCandidates?.[0]
      ? `【候補】${context.brandCandidates[0].brand}（確度 ${(context.brandCandidates[0].score * 100).toFixed(0)}%）`
      : `【候補】${context.category || "不明"}（OCRが弱い場合あり）`;

    const ocrSnippet = (context.ocrText || "").trim().replace(/\s+/g, " ").slice(0, 80);
    const ocrLine = ocrSnippet ? `読み取り文字（参考）：${ocrSnippet}` : "読み取り文字：取得できず（撮り直し推奨）";

    const sizeLine = context.size
      ? `サイズ目安：W ${(context.size.mmW/10).toFixed(1)}cm × H ${(context.size.mmH/10).toFixed(1)}cm（基準物あり）`
      : "サイズ目安：未計測（基準物ありモードで測れます）";

    const conditionBits = [
      pick(r, ["角スレは写真をご確認ください。", "角は軽い使用感程度。", "角の状態は良好寄り。"]),
      pick(r, ["内側は大きな汚れは見当たりません。", "内側は使用に伴う擦れ程度。", "内側は比較的きれいです。"]),
      pick(r, ["金具は小傷あり。", "金具は微細なスレ程度。", "金具は写真の通りの状態です。"])
    ];

    const disclaim = pick(r, [
      "※状態は主観を含みます。気になる点は購入前にご質問ください。",
      "※写真優先でお願いします。見落としがある場合はご容赦ください。",
      "※すり替え防止のため、返品はご遠慮ください（不備があれば到着時にご連絡ください）。"
    ]);

    const ship = pick(r, [
      "丁寧に梱包し、追跡ありで発送します。",
      "防水＋緩衝で梱包し、最短で発送します。",
      "発送は追跡つき。梱包はしっかり行います。"
    ]);

    const hook = pick(r, tone === "ATTACK" ? vocab.attack.hooks : vocab.elegant.hooks);
    const pace = pick(r, tone === "ATTACK" ? vocab.attack.pace : vocab.elegant.pace);

    const sharpBias = (style.sharp - 0.5) * 0.4;
    const elegantBias = (style.elegant - 0.5) * 0.4;
    const exclaim = (tone === "ATTACK" ? (r() < 0.25 + sharpBias) : (r() < 0.06)) ? "。" : "。";
    const gentle = tone === "ELEGANT" ? (r() < 0.35 + elegantBias ? "ゆったり" : "丁寧に") : "テンポ良く";

    const long = [
      hook,
      pace,
      "",
      `${brandLine}`,
      `${sizeLine}`,
      `${ocrLine}`,
      "",
      `状態：${gentle}まとめます。`,
      `・${conditionBits[0]}`,
      `・${conditionBits[1]}`,
      `・${conditionBits[2]}`,
      "",
      `付属：${pick(r, ["写真に写っているものが全てです。", "付属はなし（本体のみ）です。", "保存袋等があれば同梱します（なければ本体のみ）。"])}`,
      `発送：${ship}`,
      "",
      disclaim
    ].join("\n");

    const short = [
      `${pick(r, ["即戦力の状態感。", "上品にまとまる個体。", "写真の印象どおりです。"])}${exclaim}`,
      brandLine,
      sizeLine,
      pick(r, ["状態は写真優先でお願いします。", "気になる点は購入前にどうぞ。", "丁寧梱包で発送します。"])
    ].join("\n");

    return { long, short };
  }

  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  // -------------------- Learning (local only) --------------------
  function loadLearning() {
    try {
      const raw = localStorage.getItem("whitemuse_learning_v1");
      if (!raw) return { salt: (Math.random() * 1e9) | 0, style: { sharp: 0.5, elegant: 0.5, short: 0.5 }, events: { used: 0, sold: 0 } };
      return JSON.parse(raw);
    } catch {
      return { salt: (Math.random() * 1e9) | 0, style: { sharp: 0.5, elegant: 0.5, short: 0.5 }, events: { used: 0, sold: 0 } };
    }
  }

  function saveLearning() {
    localStorage.setItem("whitemuse_learning_v1", JSON.stringify(state.learning));
  }

  function learnUsed() {
    state.learning.events.used = (state.learning.events.used || 0) + 1;
    const m = els.copyMode.value;
    if (m === "ATTACK") state.learning.style.sharp = clamp01(state.learning.style.sharp + 0.03);
    if (m === "ELEGANT") state.learning.style.elegant = clamp01(state.learning.style.elegant + 0.03);
    saveLearning();
  }

  function learnSold() {
    state.learning.events.sold = (state.learning.events.sold || 0) + 1;
    const txt = (els.copyLong.value || "");
    const hasFast = /早い者勝ち|即戦力|テンポ/.test(txt);
    const hasElegant = /上品|余白|佇まい|落ち着いて/.test(txt);
    if (hasFast) state.learning.style.sharp = clamp01(state.learning.style.sharp + 0.06);
    if (hasElegant) state.learning.style.elegant = clamp01(state.learning.style.elegant + 0.06);
    if ((els.copyShort.value || "").length > 20) state.learning.style.short = clamp01(state.learning.style.short + 0.03);
    saveLearning();
  }

  function clearLearning() {
    localStorage.removeItem("whitemuse_learning_v1");
    state.learning = loadLearning();
  }

  // -------------------- Rendering thumbs + viewer --------------------
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c])); }

  function renderThumbs() {
    els.thumbs.innerHTML = "";
    state.items.forEach((it, idx) => {
      const div = document.createElement("div");
      div.className = "thumb" + (idx === state.selectedIndex ? " active" : "");
      const img = document.createElement("img");
      img.src = it.thumbUrl;

      const meta = document.createElement("div");
      meta.className = "meta";
      meta.innerHTML = `<div class="name">${escapeHtml(it.name)}</div><div class="sub">${it.statusText || "未補正"}</div>`;

      div.appendChild(img);
      div.appendChild(meta);

      div.onclick = () => selectIndex(idx);
      els.thumbs.appendChild(div);
    });
  }

  function drawCanvasTo(dst, srcCanvas) {
    dst.width = srcCanvas.width;
    dst.height = srcCanvas.height;
    const dctx = dst.getContext("2d");
    dctx.clearRect(0, 0, dst.width, dst.height);
    dctx.drawImage(srcCanvas, 0, 0);
  }

  function updateBAClip() {
    const v = Number(els.baSlider.value) || 50;
    els.after.style.clipPath = `inset(0 0 0 ${v}%)`;
  }

  function tipText(it) {
    const lines = [];
    if (!it.mask) lines.push("背景除去：models/u2netp.onnx がまだ無いので、今は切り抜き未設定です。");
    else lines.push("背景除去：端末内で切り抜き済み。白背景＋自然影を合成しています。");

    if (!it.ocr || !it.ocr.text) lines.push("OCR：まだ。必要なら「OCRで文字を読む」を押してください。");
    else lines.push("OCR：読み取り済み。候補は断定ではなくスコア表示です。");

    if (!it.size) lines.push("サイズ：基準物ありON→画像を2回タップで測れます。");
    else lines.push("サイズ：基準物ありで推定済み。");

    return lines.join(" / ");
  }

  function selectIndex(idx) {
    state.selectedIndex = idx;
    renderThumbs();
    const it = state.items[idx];

    els.selectedName.textContent = it.name;

    drawCanvasTo(els.before, it.beforeCanvas);
    drawCanvasTo(els.after, it.afterCanvas);

    updateBAClip();
    showOcrForSelected();
    showSizeForSelected();
    els.tips.textContent = tipText(it);
  }

  // -------------------- Pipeline: load files --------------------
  async function loadFiles(files) {
    const list = Array.from(files || []).slice(0, 10);

    // ✅ 同じ写真を再選択できるように（iPhoneで「変化なし」で発火しない時がある）
    try { els.fileInput.value = ""; } catch (_) {}

    // ✅ 前回のobjectURLを片付け
    for (const it of state.items) {
      try { if (it.objectUrl) URL.revokeObjectURL(it.objectUrl); } catch (_) {}
    }

    state.items = [];
    state.selectedIndex = -1;

    if (list.length === 0) {
      renderThumbs();
      els.selectedName.textContent = "";
      els.tips.textContent = "";
      return;
    }

    showProgress(true, 2, "写真を読み込み中…");

    let i = 0;
    for (const f of list) {
      i++;
      const { img, url } = await fileToImage(f);

      const thumbC = drawToCanvas(img, 240);
      const thumbUrl = thumbC.toDataURL("image/jpeg", 0.85);

      const beforeCanvas = drawToCanvas(img, 1200);

      const afterCanvas = document.createElement("canvas");
      afterCanvas.width = beforeCanvas.width;
      afterCanvas.height = beforeCanvas.height;
      afterCanvas.getContext("2d").drawImage(beforeCanvas, 0, 0);

      state.items.push({
        name: f.name,
        file: f,
        img,
        objectUrl: url,
        thumbUrl,
        beforeCanvas,
        afterCanvas,
        mask: null,
        statusText: "読み込み完了",
        ocr: null,
        size: null
      });

      showProgress(true, Math.round((i / list.length) * 20), `読み込み ${i}/${list.length}`);
    }

    showProgress(false);
    renderThumbs();
    selectIndex(0);
  }

  async function processAll(withVariant = "ONE_TAP") {
    if (state.items.length === 0) return;

    const s = (Number(els.strength.value) || 0) / 100;
    const opts = {
      strength: s,
      edgePriority: state.style.edgePriority || (withVariant === "EDGE"),
      shadowWeak: state.style.shadowWeak || (withVariant === "SHADOW_WEAK"),
      whiteStrong: state.style.whiteStrong || (withVariant === "WHITE_STRONG")
    };

    showProgress(true, 0, "一括補正を開始…");

    let idx = 0;
    for (const it of state.items) {
      idx++;
      showProgress(true, Math.round((idx - 1) / state.items.length * 100), `補正中 ${idx}/${state.items.length}`);

      let mask = null;

      if (els.cloudToggle.checked && (els.cloudApiKey.value || "").trim()) {
        mask = await removeBackgroundCloud(it.beforeCanvas, els.cloudApiKey.value.trim());
      }
      if (!mask) mask = await removeBackgroundU2Net(it.beforeCanvas);

      it.mask = mask;

      const enhanced = enhance(it.beforeCanvas, mask, opts);

      const ac = document.createElement("canvas");
      ac.width = it.beforeCanvas.width;
      ac.height = it.beforeCanvas.height;
      ac.getContext("2d").putImageData(enhanced, 0, 0);

      it.afterCanvas = ac;
      it.statusText = mask ? "補正完了（切り抜きOK）" : "補正完了（切り抜き未設定）";
    }

    showProgress(false);
    renderThumbs();
    selectIndex(Math.max(0, state.selectedIndex));
  }

  // -------------------- OCR (selected) --------------------
  async function ocrSelected() {
    const it = state.items[state.selectedIndex];
    if (!it) return;

    await ensureTesseract();
    showProgress(true, 0, "OCR中（端末内）…");

    const c = it.afterCanvas;

    const crop = document.createElement("canvas");
    const cw = Math.round(c.width * 0.8);
    const ch = Math.round(c.height * 0.8);
    crop.width = cw; crop.height = ch;
    crop.getContext("2d").drawImage(
      c,
      Math.round(c.width*0.1), Math.round(c.height*0.1), cw, ch,
      0, 0, cw, ch
    );

    const dataUrl = crop.toDataURL("image/png");
    const { data } = await window.Tesseract.recognize(dataUrl, "eng+jpn", {
      logger: (m) => {
        if (m.status) showProgress(true, Math.round((m.progress || 0) * 100), `OCR: ${m.status} ${(m.progress||0)*100|0}%`);
      }
    });

    const text = (data.text || "").trim();
    const scored = scoreBrand(text);

    it.ocr = { text, scored };
    showProgress(false);
    showOcrForSelected();
  }

  function showOcrForSelected() {
    const it = state.items[state.selectedIndex];
    if (!it) return;

    const t = it.ocr?.text || "";
    const scored = it.ocr?.scored || [];

    if (!t) {
      els.ocrOut.textContent = "（まだ）OCR未実行です。";
      const g = ocrRetakeGuide("");
      if (g) { els.ocrGuide.hidden = false; els.ocrGuide.textContent = g; }
      else { els.ocrGuide.hidden = true; }
      return;
    }

    const lines = [];
    lines.push("▼ OCR結果（抜粋）");
    lines.push(t.slice(0, 600));
    lines.push("");
    lines.push("▼ 推定候補（断定しません）");
    if (scored.length === 0) {
      lines.push("候補なし（読み取りが弱い可能性）");
    } else {
      for (const s of scored.slice(0, 5)) {
        lines.push(`- ${s.brand} / 確度 ${(s.score * 100).toFixed(0)}%（ヒット数 ${s.hits}）`);
      }
    }

    els.ocrOut.textContent = lines.join("\n");

    const g = ocrRetakeGuide(t);
    if (g) { els.ocrGuide.hidden = false; els.ocrGuide.textContent = g; }
    else { els.ocrGuide.hidden = true; }
  }

  // -------------------- Calibration taps for size --------------------
  function enableCalibrationIfNeeded() {
    state.calib.active = els.refMode.checked;
    state.calib.p1 = null;
    state.calib.p2 = null;

    els.sizeOut.textContent = state.calib.active
      ? "基準物あり：プレビュー画像を2回タップ（基準物の両端）してください。"
      : "基準物なし：サイズは “目安” になります（MVPでは推奨しません）。";
  }

  function onViewerTap(e) {
    if (!state.calib.active) return;
    const it = state.items[state.selectedIndex];
    if (!it) return;

    // ✅ 重要：afterCanvas は pointer-events:none なので、beforeCanvas で座標を取る
    const rect = els.before.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * els.before.width;
    const y = (e.clientY - rect.top) / rect.height * els.before.height;

    if (!state.calib.p1) {
      state.calib.p1 = { x, y };
      els.sizeOut.textContent = "1回目OK。次は “基準物の反対側” をもう1回タップ。";
      return;
    }

    if (!state.calib.p2) {
      state.calib.p2 = { x, y };

      const dx = state.calib.p2.x - state.calib.p1.x;
      const dy = state.calib.p2.y - state.calib.p1.y;
      const distPx = Math.sqrt(dx*dx + dy*dy);

      const mm = refMM(els.refType.value);
      const mmPerPx = mm / (distPx || 1);

      const est = estimateObjectSizeFromMask(it.mask, it.afterCanvas.width, it.afterCanvas.height, mmPerPx);
      it.size = est ? { ...est, mmPerPx } : null;

      showSizeForSelected();
      return;
    }
  }

  function showSizeForSelected() {
    const it = state.items[state.selectedIndex];
    if (!it) return;

    if (!els.refMode.checked) {
      els.sizeOut.textContent = "基準物ありモードがOFFです。ONにすると “2タップ” で測れます。";
      return;
    }

    if (!it.size) {
      els.sizeOut.textContent = "まだ測れていません。プレビュー画像を2回タップして基準物の両端を指定してください。";
      return;
    }

    const wcm = (it.size.mmW / 10).toFixed(1);
    const hcm = (it.size.mmH / 10).toFixed(1);
    els.sizeOut.textContent = `推定サイズ（基準物あり）：W ${wcm}cm × H ${hcm}cm\n（※商品の写り方で多少の誤差は出ます）`;
  }

  // -------------------- Export --------------------
  async function exportAll() {
    if (state.items.length === 0) return;

    const preset = els.exportPreset.value;
    const cat = els.category.value;
    const date = nowYMD();

    // ✅ iPhoneは連続ダウンロードを止めることがあるので最初に注意
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) {
      alert("iPhoneの場合、保存が1枚ずつ出ます。\n出てきた保存画面は閉じずに、順番に保存してください。");
    }

    showProgress(true, 0, "書き出し準備…");

    let n = 0;
    for (const it of state.items) {
      n++;
      showProgress(true, Math.round((n - 1) / state.items.length * 100), `書き出し ${n}/${state.items.length}`);

      const fullCanvas = drawToCanvas(it.img, preset === "MERCARI" ? 2200 : 1800);

      let mask = null;
      if (els.cloudToggle.checked && (els.cloudApiKey.value || "").trim()) {
        mask = await removeBackgroundCloud(fullCanvas, els.cloudApiKey.value.trim());
      }
      if (!mask) mask = await removeBackgroundU2Net(fullCanvas);

      const s = (Number(els.strength.value) || 0) / 100;
      const opts = {
        strength: s,
        edgePriority: state.style.edgePriority,
        shadowWeak: state.style.shadowWeak,
        whiteStrong: state.style.whiteStrong
      };
      const enhanced = enhance(fullCanvas, mask, opts);

      const outC = document.createElement("canvas");
      outC.width = fullCanvas.width; outC.height = fullCanvas.height;
      outC.getContext("2d").putImageData(enhanced, 0, 0);

      const q = preset === "MERCARI" ? 0.94 : 0.90;

      const blob = await new Promise((res) => outC.toBlob(res, "image/jpeg", q));
      const seq = String(n).padStart(3, "0");
      const filename = `WhiteMuse_${cat}_${date}_${seq}.jpg`;

      downloadBlob(blob, filename);
    }

    showProgress(false);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2500);
  }

  // -------------------- Install help + icon generator --------------------
  function installHelp() {
    alert(
      [
        "iPhoneに入れる（ホーム画面に追加）",
        "",
        "1) iPhoneのSafariで WhiteMuse のURLを開く",
        "2) 下の『共有』ボタン（□に↑）を押す",
        "3) 『ホーム画面に追加』を押す",
        "4) 右上『追加』を押す",
        "",
        "成功すると：ホーム画面に WhiteMuse のアイコンが増えます。"
      ].join("\n")
    );
  }

  function generatePlaceholderIcons() {
    const mk = (size) => {
      const c = document.createElement("canvas");
      c.width = size; c.height = size;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(size*0.22, size*0.22, size*0.06, 0, Math.PI*2);
      ctx.fill();
      ctx.font = `bold ${Math.round(size*0.18)}px -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif`;
      ctx.fillText("White", size*0.18, size*0.55);
      ctx.fillText("Muse", size*0.18, size*0.75);
      return c;
    };

    mk(192).toBlob((b)=>downloadBlob(b, "icon.png"), "image/png");
    mk(512).toBlob((b)=>downloadBlob(b, "icon-512.png"), "image/png");
    alert("仮アイコンをダウンロードしました。\nGitHubに icon.png と icon-512.png をアップロードすると、iPhoneでアイコンが綺麗に出ます。");
  }

  // -------------------- Events --------------------
  els.fileInput.addEventListener("change", (e) => loadFiles(e.target.files));

  els.baSlider.addEventListener("input", updateBAClip);

  els.btnOneTap.addEventListener("click", () => processAll("ONE_TAP"));
  els.btnEdge.addEventListener("click", () => {
    state.style.edgePriority = true;
    state.style.shadowWeak = false;
    state.style.whiteStrong = false;
    processAll("EDGE");
  });
  els.btnShadowWeak.addEventListener("click", () => {
    state.style.shadowWeak = true;
    state.style.edgePriority = false;
    state.style.whiteStrong = false;
    processAll("SHADOW_WEAK");
  });
  els.btnWhiteStrong.addEventListener("click", () => {
    state.style.whiteStrong = true;
    state.style.edgePriority = false;
    state.style.shadowWeak = false;
    processAll("WHITE_STRONG");
  });

  els.btnOcr.addEventListener("click", ocrSelected);

  els.refMode.addEventListener("change", enableCalibrationIfNeeded);
  els.refType.addEventListener("change", () => { enableCalibrationIfNeeded(); showSizeForSelected(); });

  // ✅ 重要：afterCanvasはクリックできない（pointer-events:none）ので beforeCanvas に付ける
  els.before.addEventListener("click", onViewerTap);

  els.btnCopy.addEventListener("click", () => {
    const it = state.items[state.selectedIndex];
    const ctx = {
      seed: (it?.name || "").length * 99991,
      category: els.category.value,
      ocrText: it?.ocr?.text || "",
      brandCandidates: it?.ocr?.scored || [],
      size: it?.size || null
    };
    const { long, short } = generateCopy(els.copyMode.value, ctx);
    els.copyLong.value = long;
    els.copyShort.value = short;
  });

  els.btnUsed.addEventListener("click", () => { learnUsed(); alert("OK：この文で出品した（学習：端末内）"); });
  els.btnSold.addEventListener("click", () => { learnSold(); alert("OK：売れた（学習：端末内）"); });

  els.btnClearLearning.addEventListener("click", () => {
    if (confirm("学習データを削除しますか？（端末内の保存が消えます）")) {
      clearLearning();
      alert("学習データを削除しました。");
    }
  });

  els.btnDownloadAll.addEventListener("click", exportAll);
  els.btnInstallHelp.addEventListener("click", installHelp);
  els.btnGenerateIcons.addEventListener("click", generatePlaceholderIcons);

  // initial
  enableCalibrationIfNeeded();
  showOcrForSelected();
  showSizeForSelected();
  updateBAClip();

})();
