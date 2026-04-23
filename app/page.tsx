'use client';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';

// Tipo para que TypeScript no se queje del formato de memoria
type MensajeHistorial = {
  role: 'user' | 'model';
  parts: { text: string }[];
  origen?: 'openai' | 'fallback_cuota' | 'fallback_red' | 'fallback_saturacion';
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
          <div key={idx} className={`p-4 rounded-lg max-w-[85%] ${
            msg.role === 'user' ? 'bg-blue-200 self-end text-black' : 'bg-white self-start text-black shadow'
          }`}>
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
            {msg.role === 'model' ? (
              <div className="mt-2 text-[15px] leading-7">
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