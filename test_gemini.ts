import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
ai.models.generateContent({ model: "gemini-3.1-pro-preview", contents: ["hello"] })
  .then(res => console.log("SUCCESS:", res.text))
  .catch(err => console.error("ERROR:", err.message));
