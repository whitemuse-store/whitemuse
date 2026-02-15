const express = require('express');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const path = require('path');

const app = express();
app.use(express.json({ limit: '100mb' }));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/process', async (req, res) => {
  try {
    const { image_url, bg_type } = req.body;
    if (!image_url) throw new Error("画像が届いていません");

    // 使用モデルを Gemini 2.0 Flash (または最新の Flash Image モデル) に設定
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const base64Data = image_url.split(',')[1];

    // 背景の指定を Gemini 向けの命令に変換
    let bgInstruction = bg_type === 'white' ? "pure plain white background" : bg_type;

    // 【命令】背景だけを変え、被写体は1ミリも変えずに、鑑定文と一緒に返して
    const prompt = `
      【画像編集命令】
      1. 被写体（バッグ・時計・宝飾品）の形状、質感、細部を100%維持してください。
      2. 背景のみを「${bgInstruction}」に差し替えた画像を出力してください。
      
      【鑑定・執筆命令】
      3. 画像の商品を分析し、以下を日本語でテキスト出力してください。
         - ブランド名・モデル名・素材
         - 高級感のある出品用紹介文
         - 市場相場に基づく推定価格
    `;

    // Gemini に画像と文章を同時に生成させる
    const result = await model.generateContent([
      {
        inlineData: { mimeType: "image/jpeg", data: base64Data }
      },
      { text: prompt }
    ]);

    const response = await result.response;
    
    // Gemini から返ってきた「文章」と「新しく作られた画像」を取り出す
    const description = response.text();
    // Gemini 2.0以降では response.candidates[0].content.parts から画像データが取得可能
    const generatedImagePart = response.candidates[0].content.parts.find(p => p.inlineData);
    const edited_image = generatedImagePart 
      ? `data:image/jpeg;base64,${generatedImagePart.inlineData.data}` 
      : image_url; // 万が一画像生成に失敗した場合は元の画像を表示

    res.json({ ok: true, edited_image: edited_image, description: description });

  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "Gemini処理エラー: " + error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse Gemini-Native 稼働中`));