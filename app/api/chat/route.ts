import OpenAI from "openai";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const DEFAULT_QUOTA_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_OVERLOAD_COOLDOWN_MS = 45 * 1000;
const DEFAULT_CITY_NAME = "Culiacán, Sinaloa";
const DEFAULT_CITY_LAT = 24.8069;
const DEFAULT_CITY_LON = -107.3938;
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

type DailyWeatherResponse = {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
};

type OpenMeteoForecastResponse = {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
  };
  daily?: DailyWeatherResponse;
};

type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name?: string;
    admin1?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }>;
};

type ResolvedCity = {
  requestedName: string;
  displayName: string;
  latitude: number;
  longitude: number;
};

type CityWeatherContext = {
  city: ResolvedCity;
  climaDebug: ClimaDebug;
  contexto: string;
};

function buildQuotaFallbackMessage(ciudad: string) {
  const hora = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `El servicio de OpenAI está al límite en este momento (${hora}), pero no lo dejamos ahi. Para ${ciudad} te recomiendo ropa ligera y transpirable, y llevar una capa ligera por si cambia el viento al atardecer. Si vas a salir, hidratarte y buscar sombra en las horas mas fuertes del sol es la mejor estrategia. En cuanto se normalice el servicio, te doy un pronostico mas fino con todos los detalles.`;
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

function buildOverloadFallbackMessage(ciudad: string) {
  const hora = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `En este momento (${hora}) el servicio de OpenAI esta muy saturado y tarda en responder, pero seguimos al pendiente del clima. Para ${ciudad}: ropa ligera, agua a la mano y preferir sombra en horas de sol fuerte. Si sales al atardecer, lleva una capa ligera por cambio de viento. Intenta de nuevo en unos segundos y te doy un pronostico mas detallado.`;
}

function buildNetworkFallbackMessage(ciudad: string) {
  const hora = new Date().toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `A las ${hora} no pudimos conectar con OpenAI por un problema temporal de red, pero seguimos cubriendo el clima con datos alternos. Para ${ciudad}: ropa ligera, hidratarte bien y considerar sombra si sales al mediodia. Si tu plan es por la tarde, una capa ligera sigue siendo buena idea por cambios de viento.`;
}

function buildFallbackResponseBody(
  motivo: FallbackMotivo,
  reintentarEnSegundos: number,
  climaOpenMeteo: ClimaDebug,
) {
  const ciudad = climaOpenMeteo.ciudad || DEFAULT_CITY_NAME;
  const respuesta =
    motivo === "quota_cooldown" || motivo === "quota_exceeded"
      ? buildQuotaFallbackMessage(ciudad)
      : motivo === "network_error" || motivo === "network_error_cooldown"
        ? buildNetworkFallbackMessage(ciudad)
        : buildOverloadFallbackMessage(ciudad);

  return {
    respuesta,
    fallback: true,
    motivo,
    reintentarEnSegundos,
    climaOpenMeteo,
  };
}

function formatDailyClimateContext(daily: DailyWeatherResponse | undefined) {
  if (
    !daily ||
    !Array.isArray(daily.time) ||
    !Array.isArray(daily.temperature_2m_max) ||
    !Array.isArray(daily.temperature_2m_min) ||
    !Array.isArray(daily.precipitation_sum)
  ) {
    return "No hay resumen diario disponible para dias anteriores o proximos.";
  }

  const summaries: string[] = [];

  for (let index = 0; index < daily.time.length; index += 1) {
    const fecha = daily.time[index];
    const maxima = daily.temperature_2m_max[index];
    const minima = daily.temperature_2m_min[index];
    const precipitacion = daily.precipitation_sum[index];

    if (
      typeof fecha !== "string" ||
      typeof maxima !== "number" ||
      typeof minima !== "number" ||
      typeof precipitacion !== "number"
    ) {
      continue;
    }

    summaries.push(
      `${fecha}: min ${minima}°C, max ${maxima}°C, precipitacion ${precipitacion}mm`,
    );
  }

  return summaries.length > 0
    ? summaries.join(" | ")
    : "No hay resumen diario disponible para dias anteriores o proximos.";
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function trimTrailingTimeWords(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\b(hoy|manana|ayer|ahora|ahorita|actualmente|este momento|esta tarde|esta noche|esta manana|manana en la tarde|manana por la tarde|por la manana|por la tarde|por la noche|el fin de semana|este fin de semana|pasado manana)\b.*$/i, "")
    .replace(/^[\s,.-]+|[\s,.-]+$/g, "")
    .trim();
}

function normalizeCityAlias(value: string) {
  const normalized = normalizeText(value);
  const aliases: Record<string, string> = {
    cdmx: "Ciudad de Mexico",
    "ciudad de mexico": "Ciudad de Mexico",
    "mexico city": "Ciudad de Mexico",
    df: "Ciudad de Mexico",
    "edo mex": "Estado de Mexico",
  };

  return aliases[normalized] ?? value.trim();
}

function isLikelyCityCandidate(value: string) {
  const normalized = normalizeText(value);
  const blockedTerms = new Set([
    "salir",
    "ropa",
    "parque",
    "hoy",
    "manana",
    "ayer",
    "ahora",
    "ahorita",
    "actualmente",
    "clima",
    "tiempo",
    "pronostico",
    "temperatura",
    "lluvia",
    "humedad",
    "fin de semana",
    "esta tarde",
    "esta noche",
    "esta manana",
  ]);

  if (!normalized || blockedTerms.has(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) {
    return false;
  }

  const invalidWordCount = words.filter((word) => blockedTerms.has(word)).length;
  return invalidWordCount < words.length;
}

function cleanCityCandidate(value: string) {
  return trimTrailingTimeWords(value)
    .replace(/^(la ciudad de|ciudad de|el clima de|clima de|el tiempo de|tiempo de)\s+/i, "")
    .replace(/^(voy a viajar a|viajo a|viajar a|me voy a|ire a|ir a|hacia)\s+/i, "")
    .replace(/^(y|tambien|ahora|comparame|compárame|compara|contra|vs)\s+/i, "")
    .replace(/[()]/g, "")
    .trim();
}

function addCandidate(candidates: string[], rawValue: string) {
  const cleaned = cleanCityCandidate(rawValue);
  const aliased = normalizeCityAlias(cleaned);

  if (!aliased || aliased.length < 2 || !isLikelyCityCandidate(aliased)) {
    return;
  }

  const normalized = normalizeText(aliased);
  if (candidates.some((item) => normalizeText(item) === normalized)) {
    return;
  }

  candidates.push(aliased);
}

function extractRequestedCities(mensajeUsuario: string, historialUsuario: unknown[]): string[] {
  const message = mensajeUsuario.replace(/[¿?]/g, " ").replace(/\s+/g, " ").trim();
  const candidates: string[] = [];
  const patterns = [
    /\b(?:clima|tiempo|pronostico|temperatura|lluvia|humedad)[^.!?]*\ben\s+([^,.!?]+)/i,
    /\ben\s+([^,.!?]+?)(?:\s+(?:hoy|mañana|manana|ayer|ahora|ahorita|actualmente|este|esta)\b|$)/i,
    /\b(?:viajar|viajo|ire|ir|voy)\s+(?:a|hacia)\s+([^,.!?]+)/i,
    /\bcompar(?:a|ame|áme)?\s+([^,.!?]+?)\s+(?:y|vs|contra)\s+([^,.!?]+)/i,
    /\bentre\s+([^,.!?]+?)\s+y\s+([^,.!?]+)/i,
    /^(?:y|tambien|ahora)\s+([^,.!?]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;

    for (const candidate of match.slice(1)) {
      if (typeof candidate === "string") {
        addCandidate(candidates, candidate);
      }
    }
  }

  const compactCompare = message.match(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ.\s]+?)\s+(?:vs|contra)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ.\s]+)\b/i);
  if (compactCompare) {
    addCandidate(candidates, compactCompare[1]);
    addCandidate(candidates, compactCompare[2]);
  }

  if (candidates.length === 0) {
    const shortFollowUp = message.match(/^(?:y|tambien|ahora)\s+en\s+([^,.!?]+)$/i);
    if (shortFollowUp?.[1]) {
      addCandidate(candidates, shortFollowUp[1]);
    }
  }

  if (candidates.length === 0) {
    for (let index = historialUsuario.length - 1; index >= 0; index -= 1) {
      const item = historialUsuario[index];
      if (!item || typeof item !== "object") continue;
      const role = (item as { role?: unknown }).role;
      const parts = (item as { parts?: unknown }).parts;
      if (role !== "user" || !Array.isArray(parts)) continue;

      const previousText = parts
        .map((part) =>
          part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string"
            ? (part as { text: string }).text
            : "",
        )
        .join(" ")
        .trim();

      if (!previousText) continue;

      const previousCandidates = extractRequestedCities(previousText, []);
      if (previousCandidates.length > 0) {
        return previousCandidates.slice(0, 2);
      }
    }
  }

  return candidates.slice(0, 2);
}

async function resolveRequestedCities(mensajeUsuario: string, historialUsuario: unknown[]) {
  const cityCandidates = extractRequestedCities(mensajeUsuario, historialUsuario);

  if (cityCandidates.length === 0) {
    return {
      cities: [
        {
          requestedName: DEFAULT_CITY_NAME,
          displayName: DEFAULT_CITY_NAME,
          latitude: DEFAULT_CITY_LAT,
          longitude: DEFAULT_CITY_LON,
        } satisfies ResolvedCity,
      ],
      requestedCities: [],
    };
  }

  const resolvedCities = await Promise.all(
    cityCandidates.map(async (cityCandidate: string) => {
      const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityCandidate)}&count=1&language=es&format=json`;
      const response = await fetch(geocodingUrl);

      if (!response.ok) {
        throw new Error("No se pudo ubicar la ciudad solicitada por un problema temporal.");
      }

      const data = (await response.json()) as OpenMeteoGeocodingResponse;
      const result = data.results?.[0];

      if (
        !result ||
        typeof result.latitude !== "number" ||
        typeof result.longitude !== "number" ||
        typeof result.name !== "string"
      ) {
        throw new Error(`No pude ubicar la ciudad \"${cityCandidate}\". Intenta con un nombre mas especifico.`);
      }

      const displayName = [result.name, result.admin1, result.country]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .join(", ");

      return {
        requestedName: cityCandidate,
        displayName,
        latitude: result.latitude,
        longitude: result.longitude,
      } satisfies ResolvedCity;
    }),
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "No se pudo ubicar la ciudad solicitada.";

    return {
      error: message,
      status: message.includes("problema temporal") ? 503 : 400,
    };
  });

  if (!Array.isArray(resolvedCities)) {
    return resolvedCities;
  }

  return {
    cities: resolvedCities,
    requestedCities: cityCandidates,
  };
}

async function fetchWeatherContextForCity(city: ResolvedCity, fechaYHoraActual: string) {
  let climaDebug: ClimaDebug = {
    fuente: "open-meteo-fallback",
    ciudad: city.displayName,
    actualizadoEn: fechaYHoraActual,
    temperaturaC: null,
    humedadPct: null,
    precipitacionMm: null,
    error: null,
  };

  let contexto = `No hubo datos meteorologicos suficientes para ${city.displayName}.`;

  try {
    const urlClima = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,relative_humidity_2m,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&past_days=2&forecast_days=4&timezone=auto`;
    const respuestaClima = await fetch(urlClima);

    if (!respuestaClima.ok) {
      climaDebug = {
        ...climaDebug,
        fuente: "open-meteo-http-error",
        error: `HTTP ${respuestaClima.status}`,
      };

      return { city, climaDebug, contexto } satisfies CityWeatherContext;
    }

    const datosReales = (await respuestaClima.json()) as OpenMeteoForecastResponse;
    const temp = datosReales.current?.temperature_2m;
    const humedad = datosReales.current?.relative_humidity_2m;
    const lluvia = datosReales.current?.precipitation;
    const dailyContext = formatDailyClimateContext(datosReales.daily);

    contexto = `${city.displayName}. Clima actual: ${typeof temp === "number" ? `${temp}°C` : "sin temperatura"}, Humedad: ${typeof humedad === "number" ? `${humedad}%` : "sin humedad"}, Precipitacion: ${typeof lluvia === "number" ? `${lluvia}mm` : "sin precipitacion"}. Resumen diario reciente y proximo: ${dailyContext}.`;
    climaDebug = {
      fuente: "open-meteo",
      ciudad: city.displayName,
      actualizadoEn: fechaYHoraActual,
      temperaturaC: typeof temp === "number" ? temp : null,
      humedadPct: typeof humedad === "number" ? humedad : null,
      precipitacionMm: typeof lluvia === "number" ? lluvia : null,
      error: null,
    };
  } catch (errorClima) {
    console.warn(
      `No se pudo obtener el clima real para ${city.displayName}, usando fallback.`,
      errorClima,
    );
    climaDebug = {
      ...climaDebug,
      fuente: "open-meteo-error",
      error: errorClima instanceof Error ? errorClima.message : "Error desconocido",
    };
  }

  return { city, climaDebug, contexto } satisfies CityWeatherContext;
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
    ciudad: DEFAULT_CITY_NAME,
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

    const cityResolution = await resolveRequestedCities(mensajeUsuario, historialUsuario);
    if ("error" in cityResolution) {
      return NextResponse.json(
        { error: cityResolution.error },
        { status: cityResolution.status },
      );
    }

    const openai = new OpenAI({ apiKey });
    const systemInstruction = await getSystemInstruction();

    // --- INICIO DE LA LLAMADA A LA API REAL ---
    const fechaYHoraActual = new Date().toLocaleString();
    const weatherContexts = await Promise.all(
      cityResolution.cities.map((city) => fetchWeatherContextForCity(city, fechaYHoraActual)),
    );
    const datosDelClimaAPI = weatherContexts.map((item) => item.contexto).join("\n\n");
    const ciudadesConsultadas = weatherContexts.map((item) => item.city.displayName).join(" y ");
    climaDebug = {
      ...weatherContexts[0].climaDebug,
      ciudad: ciudadesConsultadas,
    };
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
    const contextoSistema = `Hoy es ${fechaYHoraActual}. Ciudades consultadas: ${ciudadesConsultadas}. Usa unicamente estos datos meteorologicos verificados: ${datosDelClimaAPI}. Puedes responder sobre clima actual, pasado cercano y futuro cercano solo si aparece en estos datos. Si hay varias ciudades, puedes compararlas de forma directa. Si te preguntan por una fecha, ciudad o periodo que no este respaldado por estos datos, dilo con claridad y no inventes. Responde en un solo mensaje completo, sin cortar frases a la mitad, y termina con una recomendacion final.`;

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
      max_completion_tokens: 500,
    });

    let respuestaIA = completion.choices?.[0]?.message?.content?.trim() || "";
    if (!respuestaIA) {
      respuestaIA = `Con los datos actuales en ${ciudadesConsultadas}, te recomiendo ropa ligera, hidratarte y evitar exposición prolongada al sol en horas de mayor intensidad.`;
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
