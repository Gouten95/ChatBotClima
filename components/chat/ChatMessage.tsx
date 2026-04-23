import ReactMarkdown from 'react-markdown';

import type { MensajeHistorial } from '@/lib/chat-types';
import {
  formatMetric,
  getAirQualityRecommendation,
  getAirQualityVisual,
  getClimateSeverityScore,
  getMessageAirTone,
  getMessageWidthClass,
  getRankingMedal,
  getSummaryCardSpanClass,
  getSummaryGridClass,
  getWorstAirRanking,
  getWorstClimateRanking,
} from '@/lib/chat-ui';

type ChatMessageProps = {
  msg: MensajeHistorial;
};

export function ChatMessage({ msg }: ChatMessageProps) {
  return (
    <div
      className={`p-4 rounded-lg border ${getMessageWidthClass(msg)} ${
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

      {msg.role === 'model' && Array.isArray(msg.resumenCiudades) && msg.resumenCiudades.length > 1 && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Comparación de ciudades</p>
              <p className="mt-1 text-xs text-slate-500">
                Resumen visual para detectar rápidamente qué ciudad está peor por aire o por clima actual.
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
              {msg.resumenCiudades.length} ciudades
            </span>
          </div>

          <div className="grid gap-3 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
              <p className="text-sm font-semibold text-slate-900">Ranking aire</p>
              <p className="mt-1 text-xs text-slate-500">Ordenado por AQI europeo más alto.</p>
              <div className="mt-3 space-y-2">
                {getWorstAirRanking(msg.resumenCiudades).map((resumen, index) => (
                  <div
                    key={`${resumen.ciudad}-air-rank`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {getRankingMedal(index)} {resumen.ciudad}
                      </p>
                      <p className="text-xs text-slate-500">
                        {resumen.calidadAireCategoria ?? 'Sin categoría de aire'}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">
                      AQI {resumen.calidadAireAqi ?? 'Sin dato'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
              <p className="text-sm font-semibold text-slate-900">Ranking clima</p>
              <p className="mt-1 text-xs text-slate-500">Basado en temperatura, precipitación y bochorno actual.</p>
              <div className="mt-3 space-y-2">
                {getWorstClimateRanking(msg.resumenCiudades).map((resumen, index) => (
                  <div
                    key={`${resumen.ciudad}-weather-rank`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {getRankingMedal(index)} {resumen.ciudad}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatMetric(resumen.temperaturaC, '°C')} · {formatMetric(resumen.precipitacionMm, ' mm')}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">
                      Puntaje {getClimateSeverityScore(resumen).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {msg.role === 'model' && Array.isArray(msg.resumenCiudades) && msg.resumenCiudades.length > 0 && (
        <div className={`mt-3 grid gap-3 w-full ${getSummaryGridClass(msg.resumenCiudades)}`}>
          {msg.resumenCiudades.map((resumen, index) => {
            const aire = getAirQualityVisual(resumen.calidadAireCategoria);
            const recomendacionAire = getAirQualityRecommendation(resumen.calidadAireCategoria);

            return (
              <div
                key={resumen.ciudad}
                className={`rounded-xl border border-slate-200 bg-slate-50 p-3 w-full min-w-0 ${getSummaryCardSpanClass(index, msg.resumenCiudades)}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold leading-5 text-slate-900">{resumen.ciudad}</p>
                    <p className="mt-1 text-xs text-slate-500">Fuente: {resumen.fuente}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-xs font-medium ${aire.clases}`}>
                    {aire.icono} {resumen.calidadAireCategoria ?? 'Aire sin dato'}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-700">
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">Temperatura</p>
                    <p className="font-semibold">{formatMetric(resumen.temperaturaC, '°C')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">Humedad</p>
                    <p className="font-semibold">{formatMetric(resumen.humedadPct, '%')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">Precipitación</p>
                    <p className="font-semibold">{formatMetric(resumen.precipitacionMm, ' mm')}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-xs text-slate-500">AQI europeo</p>
                    <p className="font-semibold">{resumen.calidadAireAqi ?? 'Sin dato'}</p>
                  </div>
                </div>

                <div className="mt-2 flex gap-2 text-xs text-slate-600">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                    PM2.5: {formatMetric(resumen.pm25, ' µg/m3')}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
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
        <p className="mt-1 whitespace-pre-wrap">{msg.parts[0].text}</p>
      )}
    </div>
  );
}