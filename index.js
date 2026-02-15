const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// 正しい鍵（r8_R0a..）を使って動かします
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    // 【2026年最新】最も安定している背景処理の「住所」に書き換えました
    if (bg_type === 'white') {
      // 白背景専用
      editedImage = await replicate.run(
        "cjwbw/rembg:fb8a3575979bc0319ca0f2a74c760b7d34cc8ec6c7475f4d455e9664c39179f8",
        { input: { image: image_url } }
      );
    } else {
      // 高級ホテルなどの背景合成用
      editedImage = await replicate.run(
        "logerzz/background-remover:77227ca3d052d91b40974955f1f9e9f694a50b8ef2f1e63a34a7428f55364842",
        { input: { image: image_url, background_prompt: bg_type } }
      );
    }

    // 鑑定と文章作成（Gemini）
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "あなたは高級ブランド鑑定士です。この商品のブランド、モデル、状態、推定価格を日本語で詳しく教えてください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    console.error("エラー詳細:", error);
    // 画面にエラー内容を表示するようにしました
    res.status(500).json({ ok: false, error: "AIの住所が違います: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 最終起動完了`));