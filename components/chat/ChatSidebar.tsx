import type { ConversacionChat } from '@/lib/chat-types';
import {
  formatConversationTime,
  getConversationPreview,
} from '@/lib/chat-ui';

type ChatSidebarProps = {
  conversaciones: ConversacionChat[];
  activeChatId: string;
  isMobileOpen: boolean;
  onCreateConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
  onCloseMobileMenu: () => void;
};

export function ChatSidebar({
  conversaciones,
  activeChatId,
  isMobileOpen,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
  onCloseMobileMenu,
}: ChatSidebarProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/35 transition md:hidden ${
          isMobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onCloseMobileMenu}
        aria-hidden="true"
      />

      <aside
        className={`ui-panel fixed inset-y-0 left-0 z-40 flex w-[88vw] max-w-[320px] min-h-0 flex-col border-r border-slate-200 bg-white p-4 shadow-xl transition-transform md:static md:w-auto md:max-w-none md:translate-x-0 md:rounded-2xl md:border md:shadow-sm ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="mb-4 flex items-center justify-between md:hidden">
          <p className="text-sm font-semibold text-slate-900">Conversaciones</p>
          <button
            type="button"
            onClick={onCloseMobileMenu}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600"
          >
            Cerrar
          </button>
        </div>

        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-bold text-blue-600">🌤️ El Señor del Clima</h1>
          <p className="mt-2 text-sm text-slate-500">
            Tus conversaciones del clima quedan guardadas en esta sesión del navegador.
          </p>
          <button
            type="button"
            onClick={onCreateConversation}
            className="ui-panel mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Nueva conversación
          </button>
        </div>

        <div className="stable-scroll-area mt-4 min-h-0 flex-1 overflow-y-auto">
          {conversaciones.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              Aún no hay conversaciones. Crea una nueva para empezar.
            </div>
          ) : (
            <div className="space-y-3">
              {conversaciones.map((conversacion, index) => {
                const isActive = conversacion.id === activeChatId;

                return (
                  <div
                    key={conversacion.id}
                    className={`ui-panel ui-pop rounded-xl border p-3 transition ${
                      isActive
                        ? 'border-blue-300 bg-blue-50 shadow-sm'
                        : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectConversation(conversacion.id);
                          onCloseMobileMenu();
                        }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {conversacion.titulo || `Conversación ${index + 1}`}
                        </p>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                          {getConversationPreview(conversacion)}
                        </p>
                      </button>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[11px] text-slate-400">
                          {formatConversationTime(conversacion.updatedAt)}
                        </span>
                        <button
                          type="button"
                          onClick={() => onDeleteConversation(conversacion.id)}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}