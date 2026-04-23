import type { ConversacionChat } from '@/lib/chat-types';
import {
  formatConversationTime,
  getConversationPreview,
} from '@/lib/chat-ui';

type ChatSidebarProps = {
  conversaciones: ConversacionChat[];
  activeChatId: string;
  onCreateConversation: () => void;
  onSelectConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
};

export function ChatSidebar({
  conversaciones,
  activeChatId,
  onCreateConversation,
  onSelectConversation,
  onDeleteConversation,
}: ChatSidebarProps) {
  return (
    <aside className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="border-b border-slate-200 pb-4">
        <h1 className="text-2xl font-bold text-blue-600">🌤️ El Señor del Clima</h1>
        <p className="mt-2 text-sm text-slate-500">
          Tus conversaciones del clima quedan guardadas en esta sesión del navegador.
        </p>
        <button
          type="button"
          onClick={onCreateConversation}
          className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Nueva conversación
        </button>
      </div>

      <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3">
          {conversaciones.map((conversacion, index) => {
            const isActive = conversacion.id === activeChatId;

            return (
              <div
                key={conversacion.id}
                className={`rounded-xl border p-3 transition ${
                  isActive
                    ? 'border-blue-300 bg-blue-50 shadow-sm'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conversacion.id)}
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
      </div>
    </aside>
  );
}