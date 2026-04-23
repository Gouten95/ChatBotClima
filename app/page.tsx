'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

type ResumenCiudad = {
  ciudad: string;
  temperaturaC: number | null;
  humedadPct: number | null;
  precipitacionMm: number | null;
  calidadAireAqi: number | null;
  calidadAireCategoria: string | null;
  pm25: number | null;
  pm10: number | null;
  fuente: string;
};

type MensajeHistorial = {
  role: 'user' | 'model';
  parts: { text: string }[];
  origen?: 'openai' | 'fallback_cuota' | 'fallback_red' | 'fallback_saturacion';
  resumenCiudades?: ResumenCiudad[];
};

type FallbackInfo = {
  texto: string;
  tono: string;
  borde: string;
};

function getFallbackInfo(data: {
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

function getOrigenMensaje(motivo?: string): MensajeHistorial['origen'] {
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

function getAirQualityVisual(categoria: string | null) {
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

function getAirQualityRecommendation(categoria: string | null) {
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

function getMessageAirTone(resumenCiudades?: ResumenCiudad[]) {
  const worstCategory = (resumenCiudades ?? []).reduce<string | null>((currentWorst, item) => {
    if (getAirQualitySeverity(item.calidadAireCategoria) > getAirQualitySeverity(currentWorst)) {
      return item.calidadAireCategoria;
    }

    return currentWorst;
  }, null);

  switch (worstCategory) {
    case 'moderada':
      return {
        caja: 'bg-amber-50 border-amber-200 shadow-amber-100/60',
        markdown: 'text-amber-950',
      };
    case 'mala':
      return {
        caja: 'bg-orange-50 border-orange-200 shadow-orange-100/60',
        markdown: 'text-orange-950',
      };
    case 'muy mala':
    case 'extremadamente mala':
      return {
        caja: 'bg-red-50 border-red-200 shadow-red-100/70',
        markdown: 'text-red-950',
      };
    case 'aceptable':
      return {
        caja: 'bg-lime-50 border-lime-200 shadow-lime-100/60',
        markdown: 'text-lime-950',
      };
    case 'buena':
      return {
        caja: 'bg-emerald-50 border-emerald-200 shadow-emerald-100/60',
        markdown: 'text-emerald-950',
      };
    default:
      return {
        caja: 'bg-white border-gray-200 shadow',
        markdown: 'text-black',
      };
  }
}

function formatMetric(value: number | null, suffix: string) {
  return value === null ? 'Sin dato' : `${value}${suffix}`;
}

export default function Home() {
  const [mensaje, setMensaje] = useState('');
  const [historial, setHistorial] = useState<MensajeHistorial[]>([]);
  const [cargando, setCargando] = useState(false);
  const [errorCritico, setErrorCritico] = useState(''); // Para mostrar tus errores de API
  const [avisoFallback, setAvisoFallback] = useState<FallbackInfo | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [historial, cargando, errorCritico, avisoFallback]);

  const enviarMensaje = async (e: React.FormEvent) => {
    e.preventDefault();
    const mensajeLimpio = mensaje.trim();
    if (!mensajeLimpio) return;

    setCargando(true);
    setErrorCritico('');
    setAvisoFallback(null);
    setMensaje('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Enviamos el mensaje Y el historial actual
        body: JSON.stringify({
          mensaje: mensajeLimpio,
          historial: historial.map(({ role, parts }) => ({ role, parts })),
        })
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data?.error || 'Error interno del servidor.');
      }

      if (data?.fallback) {
        setAvisoFallback(getFallbackInfo(data));
        if (data?.climaOpenMeteo) {
          console.info('Open-Meteo (debug):', data.climaOpenMeteo);
        }
      }

      // Actualizamos la pantalla con ambos mensajes
      setHistorial((prev) => [
        ...prev,
        { role: 'user', parts: [{ text: mensajeLimpio }] },
        {
          role: 'model',
          parts: [{ text: data.respuesta }],
          origen: data?.fallback ? getOrigenMensaje(data?.motivo) : 'openai',
          resumenCiudades: Array.isArray(data?.resumenCiudades) ? data.resumenCiudades : [],
        }
      ]);

    } catch (error) {
      console.error(error);
      const mensajeError = error instanceof Error ? error.message : 'Error desconocido';
      setErrorCritico(`Error: ${mensajeError}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="p-10 max-w-3xl mx-auto flex flex-col gap-6 font-sans h-screen">
      <h1 className="text-3xl font-bold text-blue-600">🌤️ El Señor del Clima</h1>
      
      {/* Caja de chat con historial */}
      <div
        ref={chatContainerRef}
        className="bg-gray-100 p-6 rounded-lg flex-1 overflow-y-auto border border-gray-300 flex flex-col gap-4"
      >
        {historial.length === 0 && !errorCritico && (
          <p className="text-gray-500 text-center mt-10">¡Hola! Soy el Señor del Clima. ¿En qué te ayudo hoy?</p>
        )}

        {avisoFallback && (
          <p className={`border rounded p-3 ${avisoFallback.tono} ${avisoFallback.borde}`}>
            {avisoFallback.texto}
          </p>
        )}

        {historial.map((msg, idx) => (
          <div
            key={idx}
            className={`p-4 rounded-lg max-w-[85%] border ${
              msg.role === 'user'
                ? 'bg-blue-200 border-blue-200 self-end text-black'
                : `${getMessageAirTone(msg.resumenCiudades).caja} self-start text-black`
            }`}
          >
            <div className="flex items-center gap-2">
              <strong>{msg.role === 'user' ? 'Tú' : 'Señor del Clima'}:</strong>
              {msg.role === 'model' && (
                <span
                  className={`text-xs px-2 py-0.5 rounded-full border ${
                    msg.origen === 'fallback_cuota'
                      ? 'bg-amber-100 text-amber-900 border-amber-300'
                      : msg.origen === 'fallback_red'
                        ? 'bg-sky-100 text-sky-900 border-sky-300'
                        : msg.origen === 'fallback_saturacion'
                          ? 'bg-orange-100 text-orange-900 border-orange-300'
                          : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                  }`}
                >
                  {msg.origen === 'fallback_cuota'
                    ? 'Respaldo por cuota'
                    : msg.origen === 'fallback_red'
                      ? 'Respaldo por red'
                      : msg.origen === 'fallback_saturacion'
                        ? 'Respaldo por saturación'
                        : 'OpenAI'}
                </span>
              )}
            </div>
            {msg.role === 'model' && Array.isArray(msg.resumenCiudades) && msg.resumenCiudades.length > 0 && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {msg.resumenCiudades.map((resumen) => {
                  const aire = getAirQualityVisual(resumen.calidadAireCategoria);
                  const recomendacionAire = getAirQualityRecommendation(resumen.calidadAireCategoria);

                  return (
                    <div key={resumen.ciudad} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900 leading-5">{resumen.ciudad}</p>
                          <p className="text-xs text-slate-500 mt-1">Fuente: {resumen.fuente}</p>
                        </div>
                        <span className={`rounded-full border px-2 py-1 text-xs font-medium ${aire.clases}`}>
                          {aire.icono} {resumen.calidadAireCategoria ?? 'Aire sin dato'}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700">
                        <div className="rounded-lg bg-white p-2 border border-slate-200">
                          <p className="text-xs text-slate-500">Temperatura</p>
                          <p className="font-semibold">{formatMetric(resumen.temperaturaC, '°C')}</p>
                        </div>
                        <div className="rounded-lg bg-white p-2 border border-slate-200">
                          <p className="text-xs text-slate-500">Humedad</p>
                          <p className="font-semibold">{formatMetric(resumen.humedadPct, '%')}</p>
                        </div>
                        <div className="rounded-lg bg-white p-2 border border-slate-200">
                          <p className="text-xs text-slate-500">Precipitación</p>
                          <p className="font-semibold">{formatMetric(resumen.precipitacionMm, ' mm')}</p>
                        </div>
                        <div className="rounded-lg bg-white p-2 border border-slate-200">
                          <p className="text-xs text-slate-500">AQI europeo</p>
                          <p className="font-semibold">{resumen.calidadAireAqi ?? 'Sin dato'}</p>
                        </div>
                      </div>

                      <div className="mt-2 flex gap-2 text-xs text-slate-600">
                        <span className="rounded-full bg-white px-2 py-1 border border-slate-200">
                          PM2.5: {formatMetric(resumen.pm25, ' µg/m3')}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 border border-slate-200">
                          PM10: {formatMetric(resumen.pm10, ' µg/m3')}
                        </span>
                      </div>

                      <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-medium ${recomendacionAire.clases}`}>
                        Recomendación aire: {recomendacionAire.texto}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {msg.role === 'model' ? (
              <div className={`mt-2 text-[15px] leading-7 ${getMessageAirTone(msg.resumenCiudades).markdown}`}>
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                    ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 space-y-1">{children}</ol>,
                    ul: ({ children }) => <ul className="mb-3 list-disc pl-5 space-y-1">{children}</ul>,
                    li: ({ children }) => <li>{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold text-gray-950">{children}</strong>,
                  }}
                >
                  {msg.parts[0].text}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="whitespace-pre-wrap mt-1">{msg.parts[0].text}</p>
            )}
          </div>
        ))}
        
        {cargando && <p className="text-gray-500 italic">Consultando los radares...</p>}
        {errorCritico && <p className="text-red-600 font-bold bg-red-100 p-3 rounded">{errorCritico}</p>}
        <div ref={chatBottomRef} />
      </div>

      <form onSubmit={enviarMensaje} className="flex gap-2 pb-10">
        <input
          type="text"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          placeholder="Ej: ¿Qué ropa me pongo para salir al parque?"
          className="border border-gray-300 rounded p-3 flex-1 text-gray-900 bg-white"
          disabled={cargando}
        />
        <button 
          type="submit" 
          disabled={cargando || !mensaje.trim()}
          className="bg-blue-600 text-white px-6 py-3 rounded hover:bg-blue-700 disabled:bg-blue-300"
        >
          Enviar
        </button>
      </form>
    </main>
  );
}