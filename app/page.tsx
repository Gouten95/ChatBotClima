'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { ChatMessage } from '@/components/chat/ChatMessage';
import { ChatSidebar } from '@/components/chat/ChatSidebar';
import type { ConversacionChat, FallbackInfo, MensajeHistorial } from '@/lib/chat-types';
import {
  buildConversationTitle,
  CHAT_STORAGE_KEY,
  createConversation,
  DEFAULT_CHAT_TITLE,
  getFallbackInfo,
  getOrigenMensaje,
  moveConversationToTop,
} from '@/lib/chat-ui';

export default function Home() {
  const [mensaje, setMensaje] = useState('');
  const [conversaciones, setConversaciones] = useState<ConversacionChat[]>([]);
  const [activeChatId, setActiveChatId] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [cargando, setCargando] = useState(false);
  const [errorCritico, setErrorCritico] = useState('');
  const [avisoFallback, setAvisoFallback] = useState<FallbackInfo | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);
  const conversacionActiva = conversaciones.find((conversacion) => conversacion.id === activeChatId) ?? null;
  const historial = conversacionActiva?.historial ?? [];

  useEffect(() => {
    const rawSession = window.localStorage.getItem(CHAT_STORAGE_KEY)
      ?? window.sessionStorage.getItem(CHAT_STORAGE_KEY);
    if (!rawSession) {
      return;
    }

    try {
      const parsed = JSON.parse(rawSession) as {
        historial?: MensajeHistorial[];
        conversaciones?: ConversacionChat[];
        activeChatId?: string;
      };

      if (Array.isArray(parsed.conversaciones) && parsed.conversaciones.length > 0) {
        setConversaciones(parsed.conversaciones);
        setActiveChatId(parsed.activeChatId ?? parsed.conversaciones[0].id);
        return;
      }

      if (Array.isArray(parsed.historial)) {
        const migratedConversation: ConversacionChat = {
          ...createConversation(),
          titulo: parsed.historial[0]?.parts?.[0]?.text
            ? buildConversationTitle(parsed.historial[0].parts[0].text)
            : DEFAULT_CHAT_TITLE,
          historial: parsed.historial,
        };
        setConversaciones([migratedConversation]);
        setActiveChatId(migratedConversation.id);
        return;
      }
    } catch (error) {
      console.warn('No se pudo restaurar la sesion del chat.', error);
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
      window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (conversaciones.length === 0 || !activeChatId) {
      window.localStorage.removeItem(CHAT_STORAGE_KEY);
      window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify({ conversaciones, activeChatId }),
    );
  }, [conversaciones, activeChatId]);

  useEffect(() => {
    setErrorCritico('');
    setAvisoFallback(null);
  }, [activeChatId]);

  useEffect(() => {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';

    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [historial, cargando, errorCritico, avisoFallback]);

  const crearNuevaConversacion = () => {
    const nuevaConversacion = createConversation(`Conversación ${conversaciones.length + 1}`);
    setConversaciones((prev) => [nuevaConversacion, ...prev]);
    setActiveChatId(nuevaConversacion.id);
    setMobileMenuOpen(false);
    setMensaje('');
    setErrorCritico('');
    setAvisoFallback(null);
  };

  const eliminarConversacion = (conversationId: string) => {
    setConversaciones((prev) => {
      const remaining = prev.filter((conversacion) => conversacion.id !== conversationId);

      if (remaining.length === 0) {
        setActiveChatId('');
        setMensaje('');
        setErrorCritico('');
        setAvisoFallback(null);
        setMobileMenuOpen(false);
        return [];
      }

      if (conversationId === activeChatId) {
        setActiveChatId(remaining[0].id);
      }

      return remaining;
    });
  };

  const enviarMensaje = async (e: React.FormEvent) => {
    e.preventDefault();
    const mensajeLimpio = mensaje.trim();
    if (!mensajeLimpio || !conversacionActiva) return;

    setCargando(true);
    setErrorCritico('');
    setAvisoFallback(null);
    setMensaje('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensaje: mensajeLimpio,
          historial: conversacionActiva.historial.map(({ role, parts }) => ({ role, parts })),
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

      const nuevosMensajes: MensajeHistorial[] = [
        { role: 'user', parts: [{ text: mensajeLimpio }] },
        {
          role: 'model',
          parts: [{ text: data.respuesta }],
          origen: data?.fallback ? getOrigenMensaje(data?.motivo) : 'openai',
          resumenCiudades: Array.isArray(data?.resumenCiudades) ? data.resumenCiudades : [],
        },
      ];

      setConversaciones((prev) => {
        const actual = prev.find((conversacion) => conversacion.id === conversacionActiva.id);
        if (!actual) {
          return prev;
        }

        const updatedConversation: ConversacionChat = {
          ...actual,
          titulo:
            actual.historial.length === 0 || actual.titulo.startsWith('Conversación') || actual.titulo === DEFAULT_CHAT_TITLE
              ? buildConversationTitle(mensajeLimpio)
              : actual.titulo,
          historial: [...actual.historial, ...nuevosMensajes],
          updatedAt: new Date().toISOString(),
        };

        return moveConversationToTop(prev, updatedConversation);
      });

    } catch (error) {
      console.error(error);
      const mensajeError = error instanceof Error ? error.message : 'Error desconocido';
      setErrorCritico(`Error: ${mensajeError}`);
    } finally {
      setCargando(false);
    }
  };

  return (
    <main className="mx-auto grid h-screen max-w-7xl gap-4 p-0 md:p-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <ChatSidebar
        conversaciones={conversaciones}
        activeChatId={activeChatId}
        isMobileOpen={mobileMenuOpen}
        onCreateConversation={crearNuevaConversacion}
        onSelectConversation={setActiveChatId}
        onDeleteConversation={eliminarConversacion}
        onCloseMobileMenu={() => setMobileMenuOpen(false)}
      />

      <section className="flex min-h-0 flex-col bg-white p-4 shadow-sm md:rounded-2xl md:border md:border-slate-200 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="inline-flex rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 md:hidden"
              aria-label="Abrir menú de conversaciones"
            >
              <span className="text-lg leading-none">☰</span>
            </button>

            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                {conversacionActiva?.titulo || 'Sin conversación activa'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {conversacionActiva && conversacionActiva.historial.length > 0
                  ? `${conversacionActiva.historial.length} mensajes en esta conversación`
                  : 'Crea una nueva conversación para comenzar'}
              </p>
            </div>
          </div>

          <div>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 md:inline-flex">
              {conversaciones.length} conversaciones
            </span>
          </div>
        </div>

        <div
          ref={chatContainerRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-300 bg-gray-100 p-4 md:p-6"
        >
          {!conversacionActiva ? (
            <div
              className="flex h-full min-h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-8 text-center md:px-6"
            >
              <div className="flex w-full max-w-4xl flex-col items-center gap-6">
                <div
                  className="relative w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-sm"
                  style={{
                    maxWidth: 560,
                    aspectRatio: '1 / 1',
                  }}
                >
                  <Image
                    src="/BAKI-CLIMA-v2.png"
                    alt="Estado vacío del chat del Señor del Clima"
                    fill
                    className="object-contain"
                    sizes="(max-width: 768px) calc(100vw - 96px), 560px"
                    priority
                  />
                </div>
                <div className="mx-auto max-w-2xl">
                  <h3 className="text-xl font-semibold text-slate-900">Todavía no hay ningún chat activo</h3>
                  <p className="mt-3 text-sm leading-6 text-slate-500">
                    Este espacio se muestra mientras no exista una conversación seleccionada.
                  </p>
                  <p className="mt-4 text-sm text-slate-600">
                    Para empezar, usa el botón Nueva conversación del panel lateral.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {historial.length === 0 && !errorCritico && (
                <p className="mt-10 text-center text-gray-500">¡Hola! Soy el Señor del Clima. ¿En qué te ayudo hoy?</p>
              )}

              {avisoFallback && (
                <p className={`border rounded p-3 ${avisoFallback.tono} ${avisoFallback.borde}`}>
                  {avisoFallback.texto}
                </p>
              )}

              {historial.map((msg, idx) => (
                <ChatMessage key={idx} msg={msg} />
              ))}

              {cargando && <p className="text-gray-500 italic">Consultando los radares...</p>}
              {errorCritico && <p className="rounded bg-red-100 p-3 font-bold text-red-600">{errorCritico}</p>}
              <div ref={chatBottomRef} />
            </div>
          )}
        </div>

        <form onSubmit={enviarMensaje} className="mt-4 flex gap-2 pb-4 md:pb-0">
          <input
            type="text"
            value={mensaje}
            onChange={(e) => setMensaje(e.target.value)}
            placeholder="Ej: ¿Qué ropa me pongo para salir al parque?"
            className="flex-1 rounded-xl border border-gray-300 bg-white p-3 text-gray-900"
            disabled={cargando || !conversacionActiva}
          />
          <button
            type="submit"
            disabled={cargando || !mensaje.trim() || !conversacionActiva}
            className="rounded-xl bg-blue-600 px-6 py-3 text-white transition hover:bg-blue-700 disabled:bg-blue-300"
          >
            Enviar
          </button>
        </form>
      </section>
    </main>
  );
}