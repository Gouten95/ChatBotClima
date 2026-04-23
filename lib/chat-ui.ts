import type {
  ConversacionChat,
  FallbackInfo,
  MensajeHistorial,
  ResumenCiudad,
} from '@/lib/chat-types';

export const CHAT_STORAGE_KEY = 'senor-del-clima-chat-session';
export const DEFAULT_CHAT_TITLE = 'Nueva conversación';

function createChatId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createConversation(title = DEFAULT_CHAT_TITLE): ConversacionChat {
  const now = new Date().toISOString();

  return {
    id: createChatId(),
    titulo: title,
    historial: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildConversationTitle(mensaje: string) {
  const limpio = mensaje.replace(/\s+/g, ' ').trim();

  if (!limpio) {
    return DEFAULT_CHAT_TITLE;
  }

  return limpio.length > 36 ? `${limpio.slice(0, 36).trim()}...` : limpio;
}

export function getConversationPreview(conversacion: ConversacionChat) {
  const ultimoMensaje = conversacion.historial[conversacion.historial.length - 1];
  const texto = ultimoMensaje?.parts?.[0]?.text?.trim();

  if (!texto) {
    return 'Sin mensajes todavía';
  }

  return texto.length > 60 ? `${texto.slice(0, 60).trim()}...` : texto;
}

export function formatConversationTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function moveConversationToTop(
  conversaciones: ConversacionChat[],
  updatedConversation: ConversacionChat,
) {
  return [
    updatedConversation,
    ...conversaciones.filter((conversacion) => conversacion.id !== updatedConversation.id),
  ];
}

export function getFallbackInfo(data: {
  motivo?: string;
  reintentarEnSegundos?: number;
}): FallbackInfo {
  if (
    data?.motivo === 'quota_cooldown' &&
    typeof data?.reintentarEnSegundos === 'number'
  ) {
    return {
      texto: `OpenAI sin cuota temporalmente. Reintenta en aprox ${data.reintentarEnSegundos}s.`,
      tono: 'text-amber-950 bg-amber-100',
      borde: 'border-amber-300',
    };
  }

  if (data?.motivo === 'quota_exceeded') {
    return {
      texto: 'OpenAI sin cuota temporalmente. Mostrando respuesta de respaldo.',
      tono: 'text-amber-950 bg-amber-100',
      borde: 'border-amber-300',
    };
  }

  if (
    (data?.motivo === 'network_error' || data?.motivo === 'network_error_cooldown') &&
    typeof data?.reintentarEnSegundos === 'number'
  ) {
    return {
      texto: `No hubo conexión estable con OpenAI. Reintenta en aprox ${data.reintentarEnSegundos}s.`,
      tono: 'text-sky-950 bg-sky-100',
      borde: 'border-sky-300',
    };
  }

  if (data?.motivo === 'network_error' || data?.motivo === 'network_error_cooldown') {
    return {
      texto: 'No hubo conexión estable con OpenAI. Mostrando respuesta con respaldo temporal.',
      tono: 'text-sky-950 bg-sky-100',
      borde: 'border-sky-300',
    };
  }

  if (
    (data?.motivo === 'service_overloaded' || data?.motivo === 'service_overloaded_cooldown') &&
    typeof data?.reintentarEnSegundos === 'number'
  ) {
    return {
      texto: `OpenAI con alta demanda en este momento. Reintenta en aprox ${data.reintentarEnSegundos}s.`,
      tono: 'text-orange-950 bg-orange-100',
      borde: 'border-orange-300',
    };
  }

  if (data?.motivo === 'service_overloaded' || data?.motivo === 'service_overloaded_cooldown') {
    return {
      texto: 'OpenAI con alta demanda en este momento. Mostrando respuesta de respaldo.',
      tono: 'text-orange-950 bg-orange-100',
      borde: 'border-orange-300',
    };
  }

  return {
    texto: 'Respuesta de respaldo temporal activa.',
    tono: 'text-gray-900 bg-gray-100',
    borde: 'border-gray-300',
  };
}

export function getOrigenMensaje(motivo?: string): MensajeHistorial['origen'] {
  if (motivo === 'quota_cooldown' || motivo === 'quota_exceeded') {
    return 'fallback_cuota';
  }

  if (motivo === 'network_error' || motivo === 'network_error_cooldown') {
    return 'fallback_red';
  }

  if (motivo === 'service_overloaded' || motivo === 'service_overloaded_cooldown') {
    return 'fallback_saturacion';
  }

  return 'openai';
}

export function getAirQualityVisual(categoria: string | null) {
  switch (categoria) {
    case 'buena':
      return { icono: '🍃', clases: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
    case 'aceptable':
      return { icono: '🌿', clases: 'bg-lime-100 text-lime-900 border-lime-300' };
    case 'moderada':
      return { icono: '🌤️', clases: 'bg-amber-100 text-amber-900 border-amber-300' };
    case 'mala':
      return { icono: '😷', clases: 'bg-orange-100 text-orange-900 border-orange-300' };
    case 'muy mala':
    case 'extremadamente mala':
      return { icono: '🚨', clases: 'bg-red-100 text-red-900 border-red-300' };
    default:
      return { icono: '🌫️', clases: 'bg-gray-100 text-gray-900 border-gray-300' };
  }
}

export function getAirQualityRecommendation(categoria: string | null) {
  switch (categoria) {
    case 'buena':
      return {
        texto: 'Conviene salir al aire libre.',
        clases: 'bg-emerald-50 text-emerald-900 border-emerald-200',
      };
    case 'aceptable':
      return {
        texto: 'Puedes salir con normalidad.',
        clases: 'bg-lime-50 text-lime-900 border-lime-200',
      };
    case 'moderada':
      return {
        texto: 'Sal con precaución si eres sensible al aire.',
        clases: 'bg-amber-50 text-amber-900 border-amber-200',
      };
    case 'mala':
      return {
        texto: 'Mejor limita actividad intensa al aire libre.',
        clases: 'bg-orange-50 text-orange-900 border-orange-200',
      };
    case 'muy mala':
    case 'extremadamente mala':
      return {
        texto: 'Conviene evitar actividades al aire libre.',
        clases: 'bg-red-50 text-red-900 border-red-200',
      };
    default:
      return {
        texto: 'Sin recomendación de aire disponible.',
        clases: 'bg-gray-50 text-gray-900 border-gray-200',
      };
  }
}

function getAirQualitySeverity(categoria: string | null) {
  switch (categoria) {
    case 'extremadamente mala':
      return 5;
    case 'muy mala':
      return 4;
    case 'mala':
      return 3;
    case 'moderada':
      return 2;
    case 'aceptable':
      return 1;
    case 'buena':
      return 0;
    default:
      return -1;
  }
}

export function getMessageAirTone(resumenCiudades?: ResumenCiudad[]) {
  const worstCategory = (resumenCiudades ?? []).reduce<string | null>((currentWorst, item) => {
    if (getAirQualitySeverity(item.calidadAireCategoria) > getAirQualitySeverity(currentWorst)) {
      return item.calidadAireCategoria;
    }

    return currentWorst;
  }, null);

  switch (worstCategory) {
    default:
      return {
        caja: 'bg-white border-gray-200 shadow',
        markdown: 'text-black',
      };
  }
}

export function formatMetric(value: number | null, suffix: string) {
  return value === null ? 'Sin dato' : `${value}${suffix}`;
}

export function getSummaryGridClass(resumenCiudades?: ResumenCiudad[]) {
  const total = resumenCiudades?.length ?? 0;

  if (total <= 1) {
    return 'grid-cols-1';
  }

  return 'grid-cols-1 md:grid-cols-2';
}

export function getMessageWidthClass(msg: MensajeHistorial) {
  if (msg.role === 'user') {
    return 'max-w-[85%]';
  }

  const total = msg.resumenCiudades?.length ?? 0;

  if (total <= 1) {
    return 'w-full max-w-[90%]';
  }

  if (total === 2) {
    return 'w-full max-w-[96%]';
  }

  return 'w-full max-w-full';
}

export function getSummaryCardSpanClass(index: number, resumenCiudades?: ResumenCiudad[]) {
  const total = resumenCiudades?.length ?? 0;

  if (total > 1 && total % 2 !== 0 && index === total - 1) {
    return 'md:col-span-2';
  }

  return '';
}

export function getClimateSeverityScore(resumen: ResumenCiudad) {
  const temperatura = resumen.temperaturaC ?? 0;
  const precipitacion = resumen.precipitacionMm ?? 0;
  const humedad = resumen.humedadPct ?? 0;

  const calor = temperatura > 32 ? (temperatura - 32) * 3 : 0;
  const frio = temperatura < 10 ? (10 - temperatura) * 2 : 0;
  const lluvia = precipitacion * 4;
  const bochorno = temperatura >= 28 && humedad >= 65 ? 6 : 0;

  return calor + frio + lluvia + bochorno;
}

export function getWorstAirRanking(resumenCiudades: ResumenCiudad[]) {
  return [...resumenCiudades].sort((left, right) => {
    const leftAqi = left.calidadAireAqi ?? -1;
    const rightAqi = right.calidadAireAqi ?? -1;
    return rightAqi - leftAqi;
  });
}

export function getWorstClimateRanking(resumenCiudades: ResumenCiudad[]) {
  return [...resumenCiudades].sort((left, right) => {
    return getClimateSeverityScore(right) - getClimateSeverityScore(left);
  });
}

export function getRankingMedal(index: number) {
  switch (index) {
    case 0:
      return '🥇';
    case 1:
      return '🥈';
    case 2:
      return '🥉';
    default:
      return '•';
  }
}