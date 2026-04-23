import { readFile } from 'node:fs/promises';
import path from 'node:path';

import OpenAI from 'openai';

export function mapHistorialToOpenAIMessages(historialUsuario: unknown[]) {
  const mensajes: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const item of historialUsuario) {
    if (!item || typeof item !== 'object') continue;
    const roleRaw = (item as { role?: unknown }).role;
    const partsRaw = (item as { parts?: unknown }).parts;
    if (!Array.isArray(partsRaw)) continue;

    const text = partsRaw
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join('\n')
      .trim();

    if (!text) continue;

    if (roleRaw === 'user') {
      mensajes.push({ role: 'user', content: text });
    } else if (roleRaw === 'model') {
      mensajes.push({ role: 'assistant', content: text });
    }
  }

  return mensajes;
}

export async function getSystemInstruction() {
  const promptPath = path.join(process.cwd(), 'prompts', 'system-instruction.txt');

  try {
    const content = await readFile(promptPath, 'utf-8');
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('El archivo de prompt está vacío.');
    }
    return trimmed;
  } catch (error) {
    console.warn('No se pudo leer prompts/system-instruction.txt', error);
    return 'Actúa como asistente del clima. Responde únicamente sobre clima, con recomendaciones de ropa, salida y actividad al aire libre.';
  }
}