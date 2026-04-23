import type {
  CitySummary,
  CityWeatherContext,
  ClimaDebug,
  DailyWeatherResponse,
  OpenMeteoAirQualityResponse,
  OpenMeteoForecastResponse,
  ResolvedCity,
} from './types';

export function buildCitySummary(weatherContext: CityWeatherContext): CitySummary {
  return {
    ciudad: weatherContext.city.displayName,
    temperaturaC: weatherContext.climaDebug.temperaturaC,
    humedadPct: weatherContext.climaDebug.humedadPct,
    precipitacionMm: weatherContext.climaDebug.precipitacionMm,
    calidadAireAqi: weatherContext.climaDebug.calidadAireAqi,
    calidadAireCategoria: weatherContext.climaDebug.calidadAireCategoria,
    pm25: weatherContext.climaDebug.pm25,
    pm10: weatherContext.climaDebug.pm10,
    fuente: weatherContext.climaDebug.fuente,
  };
}

function formatDailyClimateContext(daily: DailyWeatherResponse | undefined) {
  if (
    !daily ||
    !Array.isArray(daily.time) ||
    !Array.isArray(daily.temperature_2m_max) ||
    !Array.isArray(daily.temperature_2m_min) ||
    !Array.isArray(daily.precipitation_sum)
  ) {
    return 'No hay resumen diario disponible para dias anteriores o proximos.';
  }

  const summaries: string[] = [];

  for (let index = 0; index < daily.time.length; index += 1) {
    const fecha = daily.time[index];
    const maxima = daily.temperature_2m_max[index];
    const minima = daily.temperature_2m_min[index];
    const precipitacion = daily.precipitation_sum[index];

    if (
      typeof fecha !== 'string' ||
      typeof maxima !== 'number' ||
      typeof minima !== 'number' ||
      typeof precipitacion !== 'number'
    ) {
      continue;
    }

    summaries.push(
      `${fecha}: min ${minima}°C, max ${maxima}°C, precipitacion ${precipitacion}mm`,
    );
  }

  return summaries.length > 0
    ? summaries.join(' | ')
    : 'No hay resumen diario disponible para dias anteriores o proximos.';
}

function getEuropeanAqiLabel(aqi: number | null) {
  if (aqi === null) return null;
  if (aqi <= 20) return 'buena';
  if (aqi <= 40) return 'aceptable';
  if (aqi <= 60) return 'moderada';
  if (aqi <= 80) return 'mala';
  if (aqi <= 100) return 'muy mala';
  return 'extremadamente mala';
}

function getAirQualityRecommendationText(categoria: string | null) {
  switch (categoria) {
    case 'buena':
      return 'Conviene salir al aire libre con normalidad.';
    case 'aceptable':
      return 'Puedes salir con normalidad, sin una limitacion importante por aire.';
    case 'moderada':
      return 'Conviene salir con precaucion si hay sensibilidad respiratoria.';
    case 'mala':
      return 'Mejor limitar actividad fisica intensa al aire libre.';
    case 'muy mala':
    case 'extremadamente mala':
      return 'Conviene evitar actividades al aire libre y reducir exposicion prolongada.';
    default:
      return 'No hay recomendacion por calidad del aire disponible.';
  }
}

export async function fetchWeatherContextForCity(city: ResolvedCity, fechaYHoraActual: string) {
  let climaDebug: ClimaDebug = {
    fuente: 'open-meteo-fallback',
    ciudad: city.displayName,
    actualizadoEn: fechaYHoraActual,
    temperaturaC: null,
    humedadPct: null,
    precipitacionMm: null,
    calidadAireAqi: null,
    calidadAireCategoria: null,
    pm25: null,
    pm10: null,
    error: null,
  };

  let contexto = `No hubo datos meteorologicos suficientes para ${city.displayName}.`;

  try {
    const urlClima = `https://api.open-meteo.com/v1/forecast?latitude=${city.latitude}&longitude=${city.longitude}&current=temperature_2m,relative_humidity_2m,precipitation&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&past_days=2&forecast_days=4&timezone=auto`;
    const urlCalidadAire = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${city.latitude}&longitude=${city.longitude}&current=european_aqi,us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto`;
    const [respuestaClima, respuestaCalidadAire] = await Promise.all([
      fetch(urlClima),
      fetch(urlCalidadAire),
    ]);

    if (!respuestaClima.ok) {
      climaDebug = {
        ...climaDebug,
        fuente: 'open-meteo-http-error',
        error: `HTTP ${respuestaClima.status}`,
      };

      return { city, climaDebug, contexto } satisfies CityWeatherContext;
    }

    const datosReales = (await respuestaClima.json()) as OpenMeteoForecastResponse;
    const temp = datosReales.current?.temperature_2m;
    const humedad = datosReales.current?.relative_humidity_2m;
    const lluvia = datosReales.current?.precipitation;
    const dailyContext = formatDailyClimateContext(datosReales.daily);
    let calidadAireContext = 'Calidad del aire no disponible.';
    let aqiEuropeo: number | null = null;
    let pm25: number | null = null;
    let pm10: number | null = null;

    if (respuestaCalidadAire.ok) {
      const airQuality = (await respuestaCalidadAire.json()) as OpenMeteoAirQualityResponse;
      aqiEuropeo =
        typeof airQuality.current?.european_aqi === 'number'
          ? airQuality.current.european_aqi
          : null;
      pm25 = typeof airQuality.current?.pm2_5 === 'number' ? airQuality.current.pm2_5 : null;
      pm10 = typeof airQuality.current?.pm10 === 'number' ? airQuality.current.pm10 : null;
      const categoriaAire = getEuropeanAqiLabel(aqiEuropeo);
      const recomendacionAire = getAirQualityRecommendationText(categoriaAire);

      calidadAireContext = categoriaAire
        ? `Calidad del aire actual: AQI europeo ${aqiEuropeo} (${categoriaAire}), PM2.5 ${pm25 ?? 'sin dato'} µg/m3, PM10 ${pm10 ?? 'sin dato'} µg/m3. Recomendacion por aire: ${recomendacionAire}`
        : 'Calidad del aire no disponible.';

      climaDebug = {
        ...climaDebug,
        calidadAireAqi: aqiEuropeo,
        calidadAireCategoria: categoriaAire,
        pm25,
        pm10,
      };
    }

    contexto = `${city.displayName}. Clima actual: ${typeof temp === 'number' ? `${temp}°C` : 'sin temperatura'}, Humedad: ${typeof humedad === 'number' ? `${humedad}%` : 'sin humedad'}, Precipitacion: ${typeof lluvia === 'number' ? `${lluvia}mm` : 'sin precipitacion'}. ${calidadAireContext} Resumen diario reciente y proximo: ${dailyContext}.`;
    climaDebug = {
      ...climaDebug,
      fuente: 'open-meteo',
      ciudad: city.displayName,
      actualizadoEn: fechaYHoraActual,
      temperaturaC: typeof temp === 'number' ? temp : null,
      humedadPct: typeof humedad === 'number' ? humedad : null,
      precipitacionMm: typeof lluvia === 'number' ? lluvia : null,
      error: null,
    };
  } catch (errorClima) {
    console.warn(
      `No se pudo obtener el clima real para ${city.displayName}, usando fallback.`,
      errorClima,
    );
    climaDebug = {
      ...climaDebug,
      fuente: 'open-meteo-error',
      error: errorClima instanceof Error ? errorClima.message : 'Error desconocido',
    };
  }

  return { city, climaDebug, contexto } satisfies CityWeatherContext;
}