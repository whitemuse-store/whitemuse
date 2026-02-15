const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// あなたが用意した正しい鍵（r8_R0a...）を使って動かします
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    if (bg_type === 'white') {
      // 【最新】最も安定している背景削除ツール（lucataco版）
      editedImage = await replicate.run(
        "lucataco/remove-bg:95fcc2a21d565684d2a43a8b5d4bc46197e33da0c68230a5ca54bc7030ce8741",
        { input: { image: image_url } }
      );
    } else {
      // 【最新】背景を別のものに変えるツール（logerzz版の最新）
      editedImage = await replicate.run(
        "logerzz/background-remover:77227ca3d052d91b40974955f1f9e9f694a50b8ef2f1e63a34a7428f55364842",
        { input: { image: image_url, background_prompt: bg_type } }
      );
    }

    // 鑑定執筆（Gemini 2.0 Flash）
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const result = await model.generateContent([
      "ブランド鑑定士として分析し、詳細と推定価格を日本語で出力してください。",
      { inlineData: { mimeType: "image/jpeg", data: image_url.split(',')[1] } }
    ]);

    res.json({ ok: true, edited_image: editedImage, description: result.response.text() });

  } catch (error) {
    console.error("エラー:", error);
    // 何が起きたかより分かりやすく表示するようにしました
    res.status(500).json({ ok: false, error: "道具の番号を確認中: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 最終起動完了`));