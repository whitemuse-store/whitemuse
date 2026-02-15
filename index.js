const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

// 鍵の空白を徹底的に掃除して読み込みます
const repToken = (process.env.REPLICATE_API_TOKEN || "").trim();
const gemKey = (process.env.GEMINI_API_KEY || "").trim();

const replicate = new Replicate({ auth: repToken });
const genAI = new GoogleGenerativeAI(gemKey);

app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'index.html')); });

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    let editedImage;

    // バージョン番号（長い英数字）を使わず、モデル名だけで呼び出します。
    // これが2026年現在の、最も「住所エラー（422）」が起きにくい公式推奨の書き方です。
    if (bg_type === 'white') {
      editedImage = await replicate.run(
        "lucataco/remove-bg", 
        { input: { image: image_url } }
      );
    } else {
      editedImage = await replicate.run(
        "logerzz/background-remover",
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
    // ログに詳細を書き残すようにしました。失敗したら「Logs」を見てください。
    console.error("【重大エラー】", error.message);
    res.status(500).json({ ok: false, error: "AIエラー: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 最終起動`));