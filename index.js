const express = require('express');
const Replicate = require('replicate');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

// 道具の準備（Renderの設定画面から値を読み込みます）
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/process', async (req, res) => {
  try {
    const { image_url } = req.body;
    if (!image_url) return res.status(400).json({ ok: false, error: "画像URLがありません" });

    // 【1】写真編集：背景だけを真っ白にする（被写体は1ミリも変えません）
    // 使用AI: Replicate (remove-bg)
    const editedImage = await replicate.run(
      "lucataco/remove-bg:95fcc2a21d565684d2a43a8b5d4bc46197e33da0c68230a5ca54bc7030ce8741",
      { input: { image: image_url } }
    );

    // 【2】文章作成：最新のGeminiが写真を見て鑑定・執筆
    // 使用AI: Gemini 2.0 Flash (最新・高速)
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const prompt = `あなたは高級ブランド（バッグ・時計・宝飾品）専門の鑑定士です。
    画像の商品を分析し、以下の項目を日本語で出力してください。
    
    1. 【鑑定結果】ブランド名・モデル名・色・素材
    2. 【状態】写真から見える範囲での誠実な状態説明（角スレなど）
    3. 【出品文】プロが書いたような、購買意欲を高める上品な紹介文
    4. 【想定価格】現在の市場での推定販売価格
    
    ※注意：画像にない情報は書かないこと。形や色を加工する表現は避けること。`;

    // 画像と指示をGeminiに送る
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: Buffer.from(await fetch(image_url).then(r => r.arrayBuffer())).toString("base64")
        }
      }
    ]);
    
    const response = await result.response;

    res.json({
      ok: true,
      mode: "WhiteMuse_Hybrid_v1",
      result: {
        edited_image: editedImage, // きれいになった写真のURL
        description: response.text(), // Geminiが書いた文章
        status: "Success"
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: "WhiteMuseでエラーが発生しました", detail: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WhiteMuse 稼働中`));