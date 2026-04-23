export type FallbackMotivo =
  | 'quota_cooldown'
  | 'quota_exceeded'
  | 'service_overloaded'
  | 'service_overloaded_cooldown'
  | 'network_error'
  | 'network_error_cooldown';

export type ClimaDebug = {
  fuente: string;
  ciudad: string;
  actualizadoEn: string;
  temperaturaC: number | null;
  humedadPct: number | null;
  precipitacionMm: number | null;
  calidadAireAqi: number | null;
  calidadAireCategoria: string | null;
  pm25: number | null;
  pm10: number | null;
  error: string | null;
};

export type DailyWeatherResponse = {
  time?: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  precipitation_sum?: number[];
};

export type OpenMeteoForecastResponse = {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
  };
  daily?: DailyWeatherResponse;
};

export type OpenMeteoAirQualityResponse = {
  current?: {
    european_aqi?: number;
    us_aqi?: number;
    pm2_5?: number;
    pm10?: number;
    ozone?: number;
    nitrogen_dioxide?: number;
  };
};

export type OpenMeteoGeocodingResponse = {
  results?: Array<{
    name?: string;
    admin1?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  }>;
};

export type ResolvedCity = {
  requestedName: string;
  displayName: string;
  latitude: number;
  longitude: number;
};

export type CityWeatherContext = {
  city: ResolvedCity;
  climaDebug: ClimaDebug;
  contexto: string;
};

export type CitySummary = {
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