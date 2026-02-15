const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// あなたの新しい鍵（r8_R0a..）が、RenderのEnvironmentに正しく入っていれば動きます
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    // 【重要】バージョン番号を指定せず、モデル名だけで呼び出す形式に変更しました
    if (bg_type === 'white') {
      // 白背景にする
      const output = await replicate.run(
        "lucataco/remove-bg", // バージョン番号をあえて書かないことで最新を使わせます
        { input: { image: image_url } }
      );
      editedImage = output;
    } else {
      // 背景を変える
      const output = await replicate.run(
        "logerzz/background-remover",
        { input: { image: image_url, background_prompt: bg_type } }
      );
      editedImage = output;
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "ブランド鑑定士として分析し、詳細と推定価格を日本語で出力してください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    console.error(error);
    // エラーが起きた場合、その原因を画面にハッキリ出します
    res.status(500).json({ ok: false, error: "エラーが発生しました: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 最終起動`));