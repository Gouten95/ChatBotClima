export type ResumenCiudad = {
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

export type MensajeHistorial = {
  role: 'user' | 'model';
  parts: { text: string }[];
  origen?: 'openai' | 'fallback_cuota' | 'fallback_red' | 'fallback_saturacion';
  resumenCiudades?: ResumenCiudad[];
};

export type ConversacionChat = {
  id: string;
  titulo: string;
  historial: MensajeHistorial[];
  createdAt: string;
  updatedAt: string;
};

export type FallbackInfo = {
  texto: string;
  tono: string;
  borde: string;
};