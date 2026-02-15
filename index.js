const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// 鍵を自動で掃除して読み込みます
const replicate = new Replicate({ auth: (process.env.REPLICATE_API_TOKEN || "").trim() });
const genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || "").trim());

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    // 【解決策】長い英数字（バージョン）を消して、モデル名だけで呼び出します。
    // これでReplicateが「今動く最新版」を勝手に選んでくれるので、住所エラーは起きません。
    if (bg_type === 'white') {
      editedImage = await replicate.run(
        "cjwbw/rembg", // 白背景専用
        { input: { image: image_url } }
      );
    } else {
      editedImage = await replicate.run(
        "logerzz/background-remover", // 高級ホテルなど
        { input: { image: image_url, background_prompt: bg_type } }
      );
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "ブランド鑑定士として分析し、詳細を日本語で出力してください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    res.status(500).json({ ok: false, error: "AIへの注文でエラー: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 稼働開始`));