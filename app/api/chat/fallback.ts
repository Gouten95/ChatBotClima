import {
  DEFAULT_CITY_NAME,
  DEFAULT_OVERLOAD_COOLDOWN_MS,
  DEFAULT_QUOTA_COOLDOWN_MS,
} from './constants';
import type { CitySummary, ClimaDebug, FallbackMotivo } from './types';

function buildQuotaFallbackMessage(ciudad: string) {
  const hora = new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `El servicio de OpenAI está al límite en este momento (${hora}), pero no lo dejamos ahi. Para ${ciudad} te recomiendo ropa ligera y transpirable, y llevar una capa ligera por si cambia el viento al atardecer. Si vas a salir, hidratarte y buscar sombra en las horas mas fuertes del sol es la mejor estrategia. En cuanto se normalice el servicio, te doy un pronostico mas fino con todos los detalles.`;
}

function buildOverloadFallbackMessage(ciudad: string) {
  const hora = new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `En este momento (${hora}) el servicio de OpenAI esta muy saturado y tarda en responder, pero seguimos al pendiente del clima. Para ${ciudad}: ropa ligera, agua a la mano y preferir sombra en horas de sol fuerte. Si sales al atardecer, lleva una capa ligera por cambio de viento. Intenta de nuevo en unos segundos y te doy un pronostico mas detallado.`;
}

function buildNetworkFallbackMessage(ciudad: string) {
  const hora = new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return `A las ${hora} no pudimos conectar con OpenAI por un problema temporal de red, pero seguimos cubriendo el clima con datos alternos. Para ${ciudad}: ropa ligera, hidratarte bien y considerar sombra si sales al mediodia. Si tu plan es por la tarde, una capa ligera sigue siendo buena idea por cambios de viento.`;
}

export function getCooldownSecondsRemaining(providerCooldownUntil: number) {
  const ms = providerCooldownUntil - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / 1000);
}

export function parseRetryAfterMs(
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

export function getOpenAIErrorDebugInfo(error: unknown, detalle: string, status: number | null) {
  const errorRecord =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  const cause =
    errorRecord?.cause && typeof errorRecord.cause === 'object'
      ? (errorRecord.cause as Record<string, unknown>)
      : null;

  return {
    name: typeof errorRecord?.name === 'string' ? errorRecord.name : null,
    status,
    message: detalle,
    code: typeof errorRecord?.code === 'string' ? errorRecord.code : null,
    type: typeof errorRecord?.type === 'string' ? errorRecord.type : null,
    causeName: typeof cause?.name === 'string' ? cause.name : null,
    causeMessage: typeof cause?.message === 'string' ? cause.message : null,
  };
}

export function stringifyLogPayload(payload: unknown) {
  try {
    return JSON.stringify(payload);
  } catch {
    return '{"error":"No se pudo serializar el payload del log."}';
  }
}

function looksTruncatedResponse(value: string) {
  if (!value) return true;

  const trimmed = value.trim();
  const endsWithSentencePunctuation = /[.!?"”)]$/.test(trimmed);
  const hasOddBoldMarkers = (trimmed.match(/\*\*/g) || []).length % 2 !== 0;
  const hasOddItalicMarkers = (trimmed.match(/(?<!\*)\*(?!\*)/g) || []).length % 2 !== 0;

  return !endsWithSentencePunctuation || hasOddBoldMarkers || hasOddItalicMarkers;
}

export function ensureCompletedWeatherAnswer(value: string, ciudadesConsultadas: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return `**Recomendación final:** en ${ciudadesConsultadas}, mantén ropa adecuada al calor, hidratación constante y atención a la calidad del aire antes de salir.`;
  }

  if (!looksTruncatedResponse(trimmed)) {
    return trimmed;
  }

  return `${trimmed}\n\n**Recomendación final:** en ${ciudadesConsultadas}, revisa la calidad del aire y adapta tu salida, hidratación y ropa según la ciudad con condiciones más exigentes.`;
}

export function getTransientOpenAIErrorKind(error: unknown, detalle: string, status: number | null) {
  const errorName =
    error && typeof error === 'object' && typeof (error as { name?: unknown }).name === 'string'
      ? (error as { name: string }).name
      : '';
  const normalizedDetail = detalle.toLowerCase();

  if (
    normalizedDetail.includes('connection error') ||
    normalizedDetail.includes('fetch failed') ||
    normalizedDetail.includes('econnreset') ||
    normalizedDetail.includes('etimedout') ||
    normalizedDetail.includes('request timed out') ||
    errorName === 'APIConnectionError' ||
    errorName === 'APIConnectionTimeoutError'
  ) {
    return 'network_error' satisfies FallbackMotivo;
  }

  if (
    status === 503 ||
    detalle.includes('Service Unavailable') ||
    detalle.includes('high demand') ||
    detalle.includes('[503')
  ) {
    return 'service_overloaded' satisfies FallbackMotivo;
  }

  return null;
}

export function buildFallbackResponseBody(
  motivo: FallbackMotivo,
  reintentarEnSegundos: number,
  climaOpenMeteo: ClimaDebug,
  resumenCiudades: CitySummary[] = [],
) {
  const ciudad = climaOpenMeteo.ciudad || DEFAULT_CITY_NAME;
  const respuesta =
    motivo === 'quota_cooldown' || motivo === 'quota_exceeded'
      ? buildQuotaFallbackMessage(ciudad)
      : motivo === 'network_error' || motivo === 'network_error_cooldown'
        ? buildNetworkFallbackMessage(ciudad)
        : buildOverloadFallbackMessage(ciudad);

  return {
    respuesta,
    fallback: true,
    motivo,
    reintentarEnSegundos,
    climaOpenMeteo,
    resumenCiudades,
  };
}

export { DEFAULT_OVERLOAD_COOLDOWN_MS };