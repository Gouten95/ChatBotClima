import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_OVERLOAD_COOLDOWN_MS = 45 * 1000;
let providerCooldownUntil = 0;
let cooldownMotivo:
  | "quota_cooldown"
  | "service_overloaded_cooldown"
  | "network_error_cooldown" =
  "quota_cooldown";

type FallbackMotivo =
  | "quota_cooldown"
  | "quota_exceeded"
  | "service_overloaded"
  | "service_overloaded_cooldown"
  | "network_error"
  | "network_error_cooldown";

type ClimaDebug = {
  fuente: string;
  ciudad: string;
  actualizadoEn: string;
  temperaturaC: number | null;
  humedadPct: number | null;
  precipitacionMm: number | null;
  error: string | null;
};

function buildQuotaFallbackMessage() {
  const hora = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `El servicio de OpenAI está al límite en este momento (${hora}), pero no lo dejamos ahi. Para Culiacan te recomiendo ropa ligera y transpirable, y llevar una capa ligera por si cambia el viento al atardecer. Si vas a salir, hidratarte y buscar sombra en las horas mas fuertes del sol es la mejor estrategia. En cuanto se normalice el servicio, te doy un pronostico mas fino con todos los detalles.`;
}

function getCooldownSecondsRemaining() {
  const ms = providerCooldownUntil - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 1000);
}

function parseRetryAfterMs(
  errorMessage: string,
  fallbackMs = DEFAULT_QUOTA_COOLDOWN_MS,
) {
  const retryInSeconds = errorMessage.match(/retry in\s+([\d.]+)s/i);
  if (retryInSeconds?.[1]) {
    return Math.max(1, Math.ceil(Number(retryInSeconds[1]))) * 1000;
  }

  const retryDelaySeconds = errorMessage.match(/"retryDelay":"(\d+)s"/i);
  if (retryDelaySeconds?.[1]) {
    return Math.max(1, Number(retryDelaySeconds[1])) * 1000;
  }

  return fallbackMs;
}

function getOpenAIErrorDebugInfo(error: unknown, detalle: string, status: number | null) {
  const errorRecord =
    error && typeof error === "object" ? (error as Record<string, unknown>) : null;
  const cause =
    errorRecord?.cause && typeof errorRecord.cause === "object"
      ? (errorRecord.cause as Record<string, unknown>)
      : null;

  return {
    name: typeof errorRecord?.name === "string" ? errorRecord.name : null,
    status,
    message: detalle,
    code: typeof errorRecord?.code === "string" ? errorRecord.code : null,
    type: typeof errorRecord?.type === "string" ? errorRecord.type : null,
    causeName: typeof cause?.name === "string" ? cause.name : null,
    causeMessage: typeof cause?.message === "string" ? cause.message : null,
  };
}

function stringifyLogPayload(payload: unknown) {
  try {
    return JSON.stringify(payload);
  } catch {
    return '{"error":"No se pudo serializar el payload del log."}';
  }
}

function getTransientOpenAIErrorKind(error: unknown, detalle: string, status: number | null) {
  const errorName =
    error && typeof error === "object" && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name
      : "";
  const normalizedDetail = detalle.toLowerCase();

  if (
    normalizedDetail.includes("connection error") ||
    normalizedDetail.includes("fetch failed") ||
    normalizedDetail.includes("econnreset") ||
    normalizedDetail.includes("etimedout") ||
    normalizedDetail.includes("request timed out") ||
    errorName === "APIConnectionError" ||
    errorName === "APIConnectionTimeoutError"
  ) {
    return "network_error" satisfies FallbackMotivo;
  }

  if (
    status === 503 ||
    detalle.includes("Service Unavailable") ||
    detalle.includes("high demand") ||
    detalle.includes("[503")
  ) {
    return "service_overloaded" satisfies FallbackMotivo;
  }

  return null;
}

function buildOverloadFallbackMessage() {
  const hora = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `En este momento (${hora}) el servicio de OpenAI esta muy saturado y tarda en responder, pero seguimos al pendiente del clima. Para Culiacan: ropa ligera, agua a la mano y preferir sombra en horas de sol fuerte. Si sales al atardecer, lleva una capa ligera por cambio de viento. Intenta de nuevo en unos segundos y te doy un pronostico mas detallado.`;
}

function buildNetworkFallbackMessage() {
  const hora = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `A las ${hora} no pudimos conectar con OpenAI por un problema temporal de red, pero seguimos cubriendo el clima con datos alternos. Para Culiacan: ropa ligera, hidratarte bien y considerar sombra si sales al mediodia. Si tu plan es por la tarde, una capa ligera sigue siendo buena idea por cambios de viento.`;
}

function buildFallbackResponseBody(
  motivo: FallbackMotivo,
  reintentarEnSegundos: number,
  climaOpenMeteo: ClimaDebug,
) {
  const respuesta =
    motivo === "quota_cooldown" || motivo === "quota_exceeded"
      ? buildQuotaFallbackMessage()
      : motivo === "network_error" || motivo === "network_error_cooldown"
        ? buildNetworkFallbackMessage()
        : buildOverloadFallbackMessage();

  return {
    respuesta,
    fallback: true,
    motivo,
    reintentarEnSegundos,
    climaOpenMeteo,
  };
}

function mapHistorialToOpenAIMessages(historialUsuario: unknown[]) {
  const mensajes: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const item of historialUsuario) {
    if (!item || typeof item !== "object") continue;
    const roleRaw = (item as { role?: unknown }).role;
    const partsRaw = (item as { parts?: unknown }).parts;
    if (!Array.isArray(partsRaw)) continue;

    const text = partsRaw
      .map((part) =>
        part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .join("\n")
      .trim();

    if (!text) continue;

    if (roleRaw === "user") {
      mensajes.push({ role: "user", content: text });
    } else if (roleRaw === "model") {
      mensajes.push({ role: "assistant", content: text });
    }
  }

  return mensajes;
}

async function getSystemInstruction() {
  const promptPath = path.join(
    process.cwd(),
    "prompts",
    "system-instruction.txt",
  );

  try {
    const content = await readFile(promptPath, "utf-8");
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("El archivo de prompt está vacío.");
    }
    return trimmed;
  } catch (error) {
    console.warn("No se pudo leer prompts/system-instruction.txt", error);
    return "Actúa como asistente del clima. Responde únicamente sobre clima, con recomendaciones de ropa, salida y actividad al aire libre.";
  }
}

export async function POST(request: Request) {
  let climaDebug: ClimaDebug = {
    fuente: "no-consultado",
    ciudad: "Culiacán, Sinaloa",
    actualizadoEn: new Date().toLocaleString(),
    temperaturaC: null,
    humedadPct: null,
    precipitacionMm: null,
    error: null,
  };

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Falta configurar OPENAI_API_KEY en .env.local" },
        { status: 500 },
      );
    }
    const modelName = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // Recibimos el mensaje Y el historial
    const body = await request.json();
    const mensajeUsuario = body?.mensaje;
    const historialUsuario = Array.isArray(body?.historial) ? body.historial : [];

    if (typeof mensajeUsuario !== "string" || !mensajeUsuario.trim()) {
      return NextResponse.json(
        { error: "El mensaje no puede ir vacío." },
        { status: 400 },
      );
    }

    const openai = new OpenAI({ apiKey });
    const systemInstruction = await getSystemInstruction();

    // --- INICIO DE LA LLAMADA A LA API REAL ---
    const ciudad = "Culiacán, Sinaloa";
    const fechaYHoraActual = new Date().toLocaleString();
    let datosDelClimaAPI = "Datos no disponibles temporalmente.";

    climaDebug = {
      ...climaDebug,
      ciudad,
      actualizadoEn: fechaYHoraActual,
      fuente: "open-meteo-fallback",
    };

    try {
      // Coordenadas de Culiacán y parámetros de Open-Meteo
      const lat = 24.8069;
      const lon = -107.3938;
      const urlClima = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation&timezone=auto`;

      const respuestaClima = await fetch(urlClima);
      if (respuestaClima.ok) {
        const datosReales = await respuestaClima.json();
        const temp = datosReales.current.temperature_2m;
        const humedad = datosReales.current.relative_humidity_2m;
        const lluvia = datosReales.current.precipitation;

        datosDelClimaAPI = `${temp}°C, Humedad: ${humedad}%, Precipitación: ${lluvia}mm.`;
        climaDebug = {
          fuente: "open-meteo",
          ciudad,
          actualizadoEn: fechaYHoraActual,
          temperaturaC: temp,
          humedadPct: humedad,
          precipitacionMm: lluvia,
          error: null,
        };
      } else {
        climaDebug = {
          ...climaDebug,
          fuente: "open-meteo-http-error",
          error: `HTTP ${respuestaClima.status}`,
        };
      }
    } catch (errorClima) {
      console.warn(
        "No se pudo obtener el clima real, usando fallback.",
        errorClima,
      );
      climaDebug = {
        ...climaDebug,
        fuente: "open-meteo-error",
        error: errorClima instanceof Error ? errorClima.message : "Error desconocido",
      };
    }
    // --- FIN DE LA LLAMADA A LA API REAL ---

    // Si ya sabemos que la cuota está agotada, evitamos pegarle a OpenAI de nuevo.
    const cooldownSeconds = getCooldownSecondsRemaining();
    if (cooldownSeconds > 0) {
      return NextResponse.json(
        buildFallbackResponseBody(cooldownMotivo, cooldownSeconds, climaDebug),
        { status: 200 },
      );
    }

    // Inyectamos contexto secretamente
    const contextoSistema = `Hoy es ${fechaYHoraActual} en ${ciudad}. El clima actual es: ${datosDelClimaAPI}. Responde en un solo mensaje completo, sin cortar frases a la mitad, y termina con una recomendación final.`;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: systemInstruction },
      { role: "system", content: contextoSistema },
      ...mapHistorialToOpenAIMessages(historialUsuario),
      { role: "user", content: mensajeUsuario },
    ];

    const completion = await openai.chat.completions.create({
      model: modelName,
      messages,
      temperature: 0.3,
      max_tokens: 500,
    });

    let respuestaIA = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!respuestaIA) {
      respuestaIA = `Con los datos actuales en ${ciudad}, te recomiendo ropa ligera, hidratarte y evitar exposición prolongada al sol en horas de mayor intensidad.`;
    }

    return NextResponse.json({ respuesta: respuestaIA, provider: "openai" });
  } catch (error) {
    const detalle =
      error instanceof Error ? error.message : "Error desconocido";
    const status =
      error && typeof error === "object" && typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : null;
    const errorDebug = getOpenAIErrorDebugInfo(error, detalle, status);

    console.error(`Error al conectar con OpenAI: ${stringifyLogPayload(errorDebug)}`);

    if (
      status === 429 ||
      detalle.includes("Too Many Requests") ||
      detalle.includes("Quota exceeded") ||
      detalle.includes("insufficient_quota") ||
      detalle.toLowerCase().includes("rate limit")
    ) {
      const cooldownMs = parseRetryAfterMs(detalle);
      providerCooldownUntil = Date.now() + cooldownMs;
      cooldownMotivo = "quota_cooldown";
      console.info(
        `Fallback por cuota en OpenAI: ${stringifyLogPayload({
          error: errorDebug,
          climaOpenMeteo: climaDebug,
        })}`,
      );
      return NextResponse.json(
        buildFallbackResponseBody(
          "quota_exceeded",
          Math.ceil(cooldownMs / 1000),
          climaDebug,
        ),
        { status: 200 },
      );
    }

    const transientKind = getTransientOpenAIErrorKind(error, detalle, status);
    if (transientKind) {
      const cooldownMs = parseRetryAfterMs(detalle, DEFAULT_OVERLOAD_COOLDOWN_MS);
      providerCooldownUntil = Date.now() + cooldownMs;
      cooldownMotivo =
        transientKind === "network_error"
          ? "network_error_cooldown"
          : "service_overloaded_cooldown";
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
        ),
        { status: 200 },
      );
    }
    if (status === 401 || detalle.toLowerCase().includes("invalid api key")) {
      return NextResponse.json(
        {
          error: "La API key de OpenAI no es válida.",
        },
        { status: 401 },
      );
    }
    if (status === 404 && detalle.toLowerCase().includes("model")) {
      return NextResponse.json(
        {
          error: "El modelo de OpenAI configurado no está disponible para tu cuenta.",
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
