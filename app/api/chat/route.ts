import OpenAI from 'openai';
import { NextResponse } from 'next/server';

import { DEFAULT_CITY_NAME } from './constants';
import {
  buildFallbackResponseBody,
  DEFAULT_OVERLOAD_COOLDOWN_MS,
  ensureCompletedWeatherAnswer,
  getCooldownSecondsRemaining,
  getOpenAIErrorDebugInfo,
  getTransientOpenAIErrorKind,
  parseRetryAfterMs,
  stringifyLogPayload,
} from './fallback';
import { resolveRequestedCities } from './location';
import { getSystemInstruction, mapHistorialToOpenAIMessages } from './openai';
import type { ClimaDebug } from './types';
import { buildCitySummary, fetchWeatherContextForCity } from './weather';

let providerCooldownUntil = 0;
let cooldownMotivo:
  | 'quota_cooldown'
  | 'service_overloaded_cooldown'
  | 'network_error_cooldown' = 'quota_cooldown';

export async function POST(request: Request) {
  let climaDebug: ClimaDebug = {
    fuente: 'no-consultado',
    ciudad: DEFAULT_CITY_NAME,
    actualizadoEn: new Date().toLocaleString(),
    temperaturaC: null,
    humedadPct: null,
    precipitacionMm: null,
    calidadAireAqi: null,
    calidadAireCategoria: null,
    pm25: null,
    pm10: null,
    error: null,
  };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Falta configurar OPENAI_API_KEY en .env.local' },
        { status: 500 },
      );
    }

    const modelName = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const body = await request.json();
    const mensajeUsuario = body?.mensaje;
    const historialUsuario = Array.isArray(body?.historial) ? body.historial : [];

    if (typeof mensajeUsuario !== "string" || !mensajeUsuario.trim()) {
      return NextResponse.json(
        { error: 'El mensaje no puede ir vacío.' },
        { status: 400 },
      );
    }

    const cityResolution = await resolveRequestedCities(mensajeUsuario, historialUsuario);
    if ("error" in cityResolution) {
      return NextResponse.json(
        { error: cityResolution.error },
        { status: cityResolution.status },
      );
    }

    const openai = new OpenAI({ apiKey });
    const systemInstruction = await getSystemInstruction();
    const fechaYHoraActual = new Date().toLocaleString();
    const weatherContexts = await Promise.all(
      cityResolution.cities.map((city) => fetchWeatherContextForCity(city, fechaYHoraActual)),
    );
    const resumenCiudades = weatherContexts.map(buildCitySummary);
    const datosDelClimaAPI = weatherContexts.map((item) => item.contexto).join("\n\n");
    const ciudadesConsultadas = weatherContexts.map((item) => item.city.displayName).join(" y ");
    climaDebug = {
      ...weatherContexts[0].climaDebug,
      ciudad: ciudadesConsultadas,
    };

    const cooldownSeconds = getCooldownSecondsRemaining(providerCooldownUntil);
    if (cooldownSeconds > 0) {
      return NextResponse.json(
        buildFallbackResponseBody(cooldownMotivo, cooldownSeconds, climaDebug, resumenCiudades),
        { status: 200 },
      );
    }

    const contextoSistema = `Hoy es ${fechaYHoraActual}. Ciudades consultadas: ${ciudadesConsultadas}. Usa unicamente estos datos meteorologicos verificados: ${datosDelClimaAPI}. Puedes responder sobre clima actual, pasado cercano y futuro cercano solo si aparece en estos datos. Si hay varias ciudades, solo comparalas o ordénalas cuando el usuario lo pida de forma explicita. Si no lo pide, responde unicamente a la ciudad o solicitud principal sin comparar por iniciativa propia. Si te preguntan por una fecha, ciudad o periodo que no este respaldado por estos datos, dilo con claridad y no inventes. Responde en un solo mensaje completo, sin cortar frases a la mitad, y termina con una recomendacion final.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemInstruction },
      { role: 'system', content: contextoSistema },
      ...mapHistorialToOpenAIMessages(historialUsuario),
      { role: 'user', content: mensajeUsuario },
    ];

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature: 0.3,
      max_completion_tokens: 900,
    });

    let respuestaIA = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!respuestaIA) {
      respuestaIA = `Con los datos actuales en ${ciudadesConsultadas}, te recomiendo ropa ligera, hidratarte y evitar exposición prolongada al sol en horas de mayor intensidad.`;
    }
    respuestaIA = ensureCompletedWeatherAnswer(respuestaIA, ciudadesConsultadas);

    return NextResponse.json({
      respuesta: respuestaIA,
      provider: 'openai',
      resumenCiudades,
    });
  } catch (error) {
    const detalle =
      error instanceof Error ? error.message : 'Error desconocido';
    const status =
      error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : null;
    const errorDebug = getOpenAIErrorDebugInfo(error, detalle, status);

    console.error(`Error al conectar con OpenAI: ${stringifyLogPayload(errorDebug)}`);

    if (
      status === 429 ||
      detalle.includes('Too Many Requests') ||
      detalle.includes('Quota exceeded') ||
      detalle.includes('insufficient_quota') ||
      detalle.toLowerCase().includes('rate limit')
    ) {
      const cooldownMs = parseRetryAfterMs(detalle);
      providerCooldownUntil = Date.now() + cooldownMs;
      cooldownMotivo = 'quota_cooldown';
      console.info(
        `Fallback por cuota en OpenAI: ${stringifyLogPayload({
          error: errorDebug,
          climaOpenMeteo: climaDebug,
        })}`,
      );
      return NextResponse.json(
        buildFallbackResponseBody(
          'quota_exceeded',
          Math.ceil(cooldownMs / 1000),
          climaDebug,
          [],
        ),
        { status: 200 },
      );
    }

    const transientKind = getTransientOpenAIErrorKind(error, detalle, status);
    if (transientKind) {
      const cooldownMs = parseRetryAfterMs(detalle, DEFAULT_OVERLOAD_COOLDOWN_MS);
      providerCooldownUntil = Date.now() + cooldownMs;
      cooldownMotivo =
        transientKind === 'network_error'
          ? 'network_error_cooldown'
          : 'service_overloaded_cooldown';
      console.info(
        `Fallback transitorio de OpenAI: ${stringifyLogPayload({
          motivo: transientKind,
          error: errorDebug,
          climaOpenMeteo: climaDebug,
        })}`,
      );
      return NextResponse.json(
        buildFallbackResponseBody(
          transientKind,
          Math.ceil(cooldownMs / 1000),
          climaDebug,
          [],
        ),
        { status: 200 },
      );
    }

    if (status === 401 || detalle.toLowerCase().includes('invalid api key')) {
      return NextResponse.json(
        {
          error: 'La API key de OpenAI no es válida.',
        },
        { status: 401 },
      );
    }

    if (status === 404 && detalle.toLowerCase().includes('model')) {
      return NextResponse.json(
        {
          error: 'El modelo de OpenAI configurado no está disponible para tu cuenta.',
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: `No se pudo consultar OpenAI: ${detalle}` },
      { status: 500 },
    );
  }
}
