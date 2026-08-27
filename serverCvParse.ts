import mammoth from "mammoth";
import { Type, Schema } from "@google/genai";
import { getAI, generateContentResilient, GEMINI_MODEL } from './serverGemini';

/**
 * The ONE implementation of "read this CV and score it with Gemini".
 *
 * It used to exist twice — once inside the /api/parse-cv handler and once as the
 * backend worker's helper — and the two copies were already drifting. Both callers now
 * share this module: the endpoint translates CvParseError.status into its HTTP reply,
 * the worker marks the candidate 'error' with the message.
 */
export class CvParseError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function runCvParse(input: { pdfBase64?: string; mimeType?: string; fileUrl?: string }): Promise<any> {
  const { pdfBase64, fileUrl } = input;
  const mimeType = input.mimeType || 'application/pdf';
  let base64Data = pdfBase64;

  if (fileUrl) {
    let fileRes: Response;
    try {
      fileRes = await fetch(fileUrl);
    } catch (fetchErr) {
      console.error("Error fetching file from URL:", fetchErr);
      throw new CvParseError(400, "Failed to fetch file from URL");
    }
    if (!fileRes.ok) {
      console.error(`[parse-cv] Error fetching file from URL. Status: ${fileRes.status}`);
      throw new CvParseError(400, `No se pudo descargar el archivo del candidato. Código de error de Storage: ${fileRes.status}`);
    }
    const arrayBuffer = await fileRes.arrayBuffer();
    base64Data = Buffer.from(arrayBuffer).toString('base64');
  }

  if (!base64Data) {
    throw new CvParseError(400, "No PDF provided");
  }

  const cvSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      full_name: { type: Type.STRING, nullable: true },
      phone: { type: Type.STRING, nullable: true },
      email: { type: Type.STRING, nullable: true },
      city: { type: Type.STRING, nullable: true },
      experience_total_years: { type: Type.NUMBER, nullable: true },
      relevant_experience_summary: { type: Type.STRING },
      education_summary: { type: Type.STRING },
      strengths_detected: { type: Type.ARRAY, items: { type: Type.STRING } },
      risk_flags: { type: Type.ARRAY, items: { type: Type.STRING } },
      initial_score_1_to_5: { type: Type.NUMBER },
      recommendation: { type: Type.STRING, enum: ["advance", "review", "low_priority"] },
      justification: { type: Type.STRING }
    },
    required: ["relevant_experience_summary", "education_summary", "strengths_detected", "risk_flags", "initial_score_1_to_5", "recommendation", "justification"]
  };

  const prompt = `
  Eres un analista de reclutamiento asistido por IA dentro de un ATS.
  Tu rol es extraer, resumir y puntuar información de candidatos de forma estructurada a partir de su CV.
  El archivo adjunto puede ser un documento PDF, de Word o directamente una imagen/foto del currículum. Debes extraer el texto y analizarlo sin importar su formato de origen.
  No decides contrataciones finales.
  No afirmas diagnósticos psicológicos ni criminales.

  MUY IMPORTANTE:
  No extraigas ni asumas habilidades (skills) basadas únicamente en lo que el candidato escribe en su CV, ya que esto se evaluará posteriormente en la práctica mediante tests y entrevistas. Tu análisis debe centrarse en la experiencia demostrable, la educación, y las fortalezas o riesgos que se puedan deducir de su trayectoria.

  PUNTUACIÓN (ESTRELLAS):
  Califica el CV con una puntuación de estrellas desde 0.1 hasta 5.0 (ej. 3.5, 4.2, 4.8) en el campo 'initial_score_1_to_5'.
  Esta es una calificación preliminar basada únicamente en la estructura, experiencia demostrable y presentación del CV.

  Siempre devuelves JSON válido según el esquema entregado.
  Si faltan datos, lo indicas explícitamente en lugar de inventar.

  IMPORTANTE PARA EL TELÉFONO: Extrae el número de teléfono e incluye siempre el código de país. Si no lo tiene, asume +52. El formato ideal es solo números con el código de país (ej. +525551234567).

  Analiza el siguiente CV (que puede ser documento o imagen) y extrae la información solicitada.
  `;

  let contentsPart: any;
  if (mimeType.includes('wordprocessingml.document') || mimeType.includes('msword')) {
    contentsPart = { text: "Texto extraído del CV:\n" + (await mammoth.extractRawText({ buffer: Buffer.from(base64Data, 'base64') })).value };
  } else {
    contentsPart = { inlineData: { data: base64Data, mimeType } };
  }

  console.log(`[parse-cv] Sending request to Gemini... MimeType: ${mimeType}, Size: ${base64Data.length}`);

  const ai = getAI();
  if (!ai) {
    throw new CvParseError(400, "CLAVE INVÁLIDA: Tienes configurada la clave 'MY_GEMINI_API_KEY' en la pestaña 'Secrets'. Para solucionar esto: 1) Haz clic en 'Settings' (arriba a la derecha), 2) Entra a 'Secrets', 3) Busca 'GEMINI_API_KEY' y elimínalo haciendo clic en el icono de bote de basura. Si haces esto usarás la IA gratuita automáticamente.");
  }

  const response = await generateContentResilient(ai,{
    model: GEMINI_MODEL,
    contents: [prompt, contentsPart],
    config: {
      responseMimeType: "application/json",
      responseSchema: cvSchema,
      temperature: 0.2
    }
  });

  const resultText = response.text;
  if (!resultText) throw new Error("Empty response from Gemini");
  const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
  return JSON.parse(cleanJson);
}

