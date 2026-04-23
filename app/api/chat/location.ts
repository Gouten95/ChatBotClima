import {
  DEFAULT_CITY_LAT,
  DEFAULT_CITY_LON,
  DEFAULT_CITY_NAME,
  KNOWN_STATE_NAMES,
  MAX_CITY_CANDIDATES,
} from './constants';
import type { OpenMeteoGeocodingResponse, ResolvedCity } from './types';

function hasComparisonIntent(message: string) {
  return /\b(compar|comparalo|compáralo|comparala|compárala|comparalos|compáralos|comparalas|compáralas|contra|versus|vs|igual que|mejor que|peor que|cual ciudad|cuál ciudad|peor clima|mejor clima|peor calidad|mejor calidad)\b/i.test(message);
}

export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function trimTrailingTimeWords(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\b(hoy|manana|ayer|ahora|ahorita|actualmente|este momento|esta tarde|esta noche|esta manana|manana en la tarde|manana por la tarde|por la manana|por la tarde|por la noche|el fin de semana|este fin de semana|pasado manana)\b.*$/i, '')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '')
    .trim();
}

function normalizeCityAlias(value: string) {
  const normalized = normalizeText(value);
  const aliases: Record<string, string> = {
    cdmx: 'Ciudad de Mexico',
    'ciudad de mexico': 'Ciudad de Mexico',
    'mexico city': 'Ciudad de Mexico',
    df: 'Ciudad de Mexico',
    'edo mex': 'Estado de Mexico',
    edomex: 'Estado de Mexico',
    bc: 'Baja California',
    bcs: 'Baja California Sur',
    camp: 'Campeche',
    chis: 'Chiapas',
    chih: 'Chihuahua',
    coah: 'Coahuila',
    col: 'Colima',
    dgo: 'Durango',
    gto: 'Guanajuato',
    gro: 'Guerrero',
    hgo: 'Hidalgo',
    jal: 'Jalisco',
    mich: 'Michoacan',
    mor: 'Morelos',
    nay: 'Nayarit',
    nl: 'Nuevo Leon',
    oax: 'Oaxaca',
    pue: 'Puebla',
    qro: 'Queretaro',
    qroo: 'Quintana Roo',
    slp: 'San Luis Potosi',
    sin: 'Sinaloa',
    son: 'Sonora',
    tab: 'Tabasco',
    tamps: 'Tamaulipas',
    tlax: 'Tlaxcala',
    ver: 'Veracruz',
    yuc: 'Yucatan',
    zac: 'Zacatecas',
    ca: 'California',
    tx: 'Texas',
    ny: 'New York',
    fl: 'Florida',
    wa: 'Washington',
    il: 'Illinois',
    az: 'Arizona',
    co: 'Colorado',
    nj: 'New Jersey',
    pa: 'Pennsylvania',
    ga: 'Georgia',
    nc: 'North Carolina',
    sc: 'South Carolina',
    va: 'Virginia',
    dc: 'District of Columbia',
  };

  return aliases[normalized] ?? value.trim();
}

function isLikelyCityCandidate(value: string) {
  const normalized = normalizeText(value);
  const blockedTerms = new Set([
    'salir',
    'ropa',
    'parque',
    'hoy',
    'manana',
    'ayer',
    'ahora',
    'ahorita',
    'actualmente',
    'clima',
    'tiempo',
    'pronostico',
    'temperatura',
    'lluvia',
    'humedad',
    'fin de semana',
    'esta tarde',
    'esta noche',
    'esta manana',
  ]);

  if (!normalized || blockedTerms.has(normalized)) {
    return false;
  }

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) {
    return false;
  }

  const invalidWordCount = words.filter((word) => blockedTerms.has(word)).length;
  return invalidWordCount < words.length;
}

function cleanCityCandidate(value: string) {
  return trimTrailingTimeWords(value)
    .replace(/^(la ciudad de|ciudad de|el clima de|clima de|el tiempo de|tiempo de)\s+/i, '')
    .replace(/^(voy a viajar a|viajo a|viajar a|me voy a|ire a|ir a|hacia)\s+/i, '')
    .replace(/^(y|tambien|ahora|comparame|compárame|compara|contra|vs)\s+/i, '')
    .replace(/[()]/g, '')
    .trim();
}

function addCandidate(candidates: string[], rawValue: string) {
  const cleaned = cleanCityCandidate(rawValue);
  const aliased = normalizeCityAlias(cleaned);

  if (!aliased || aliased.length < 2 || !isLikelyCityCandidate(aliased)) {
    return;
  }

  const normalized = normalizeText(aliased);
  if (candidates.some((item) => normalizeText(item) === normalized)) {
    return;
  }

  candidates.push(aliased);
}

function splitMultiLocationCandidate(value: string) {
  const cleaned = cleanCityCandidate(value);
  const commaCount = (cleaned.match(/,/g) || []).length;
  const separatorPattern = /\s+(?:vs|contra|versus|y|e|o)\s+/i;

  const recombineStateSegments = (segments: string[]) => {
    const merged: string[] = [];

    for (const segment of segments) {
      const trimmed = cleanCityCandidate(segment);
      if (!trimmed) continue;

      const normalized = normalizeText(trimmed);
      const previous = merged[merged.length - 1];

      if (previous && KNOWN_STATE_NAMES.has(normalized)) {
        merged[merged.length - 1] = `${previous}, ${trimmed}`;
        continue;
      }

      merged.push(trimmed);
    }

    return merged;
  };

  if (commaCount >= 1 && /\s+(?:y|e|vs|contra|versus)\s+/i.test(cleaned)) {
    return recombineStateSegments(
      cleaned.replace(/\s+(?:y|e|vs|contra|versus)\s+/gi, ',').split(','),
    );
  }

  if (commaCount >= 2) {
    return recombineStateSegments(cleaned.split(','));
  }

  if (separatorPattern.test(cleaned)) {
    return recombineStateSegments(cleaned.split(separatorPattern));
  }

  return [cleaned];
}

function isLikelyLocationList(value: string, message: string) {
  const cleaned = cleanCityCandidate(value);
  const commaCount = (cleaned.match(/,/g) || []).length;

  if (commaCount >= 2) {
    return true;
  }

  if (commaCount >= 1 && /\s+(?:y|e|vs|contra|versus)\s+/i.test(cleaned)) {
    return true;
  }

  return hasComparisonIntent(message) && /\s+(?:y|e|vs|contra|versus)\s+/i.test(cleaned);
}

function extractRequestedCities(mensajeUsuario: string, historialUsuario: unknown[]): string[] {
  const message = mensajeUsuario.replace(/[¿?]/g, ' ').replace(/\s+/g, ' ').trim();
  const candidates: string[] = [];
  const patterns = [
    /\b(?:clima|tiempo|pronostico|temperatura|lluvia|humedad|calidad del aire)[^!?]*\b(?:en|de)\s+([^!?]+)/i,
    /\ben\s+([^!?]+?)(?:\s+(?:hoy|mañana|manana|ayer|ahora|ahorita|actualmente|este|esta)\b|$)/i,
    /\bde\s+([^!?]+?)(?:\s+(?:hoy|mañana|manana|ayer|ahora|ahorita|actualmente|este|esta)\b|$)/i,
    /\b(?:viajar|viajo|ire|ir|voy)\s+(?:a|hacia)\s+([^!?]+)/i,
    /\bcompar(?:a|ame|áme)?\s+([^!?]+?)\s+(?:y|vs|contra)\s+([^!?]+)/i,
    /\bcompar[a-záéíóúñ]*\s+con\s+(?:el\s+clima\s+de\s+)?([^!?]+)/i,
    /\bentre\s+([^!?]+?)\s+y\s+([^!?]+)/i,
    /\b(?:cual|cuál)\s+ciudad[^!?]*\b(?:entre|de)\s+([^!?]+)/i,
    /^(?:y|tambien|ahora)\s+([^!?]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match) continue;

    for (const candidate of match.slice(1)) {
      if (typeof candidate === 'string') {
        const splitCandidates = isLikelyLocationList(candidate, message)
          ? splitMultiLocationCandidate(candidate)
          : [candidate];

        for (const splitCandidate of splitCandidates) {
          addCandidate(candidates, splitCandidate);
        }
      }
    }
  }

  const compactCompare = message.match(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ.\s]+?)\s+(?:vs|contra)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ.\s]+)\b/i);
  if (compactCompare) {
    addCandidate(candidates, compactCompare[1]);
    addCandidate(candidates, compactCompare[2]);
  }

  if (candidates.length === 0) {
    const shortFollowUp = message.match(/^(?:y|tambien|ahora)\s+en\s+([^,.!?]+)$/i);
    if (shortFollowUp?.[1]) {
      addCandidate(candidates, shortFollowUp[1]);
    }
  }

  for (let index = historialUsuario.length - 1; index >= 0 && candidates.length < MAX_CITY_CANDIDATES; index -= 1) {
    const item = historialUsuario[index];
    if (!item || typeof item !== 'object') continue;
    const role = (item as { role?: unknown }).role;
    const parts = (item as { parts?: unknown }).parts;
    if (role !== 'user' || !Array.isArray(parts)) continue;

    const previousText = parts
      .map((part) =>
        part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string'
          ? (part as { text: string }).text
          : '',
      )
      .join(' ')
      .trim();

    if (!previousText) continue;

    const previousCandidates = extractRequestedCities(previousText, []);
    if (previousCandidates.length > 0) {
      for (const previousCandidate of previousCandidates) {
        addCandidate(candidates, previousCandidate);
        if (candidates.length >= MAX_CITY_CANDIDATES) {
          break;
        }
      }

      if (candidates.length > 0 && !hasComparisonIntent(message)) {
        break;
      }
    }
  }

  return candidates.slice(0, MAX_CITY_CANDIDATES);
}

async function resolveSingleCityCandidate(cityCandidate: string) {
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityCandidate)}&count=1&language=es&format=json`;
  const response = await fetch(geocodingUrl);

  if (!response.ok) {
    throw new Error('No se pudo ubicar la ciudad solicitada por un problema temporal.');
  }

  const data = (await response.json()) as OpenMeteoGeocodingResponse;
  const result = data.results?.[0];

  if (
    !result ||
    typeof result.latitude !== 'number' ||
    typeof result.longitude !== 'number' ||
    typeof result.name !== 'string'
  ) {
    throw new Error(`No pude ubicar la ciudad "${cityCandidate}". Intenta con un nombre mas especifico.`);
  }

  const displayName = [result.name, result.admin1, result.country]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(', ');

  return {
    requestedName: cityCandidate,
    displayName,
    latitude: result.latitude,
    longitude: result.longitude,
  } satisfies ResolvedCity;
}

export async function resolveRequestedCities(mensajeUsuario: string, historialUsuario: unknown[]) {
  const cityCandidates = extractRequestedCities(mensajeUsuario, historialUsuario);

  if (cityCandidates.length === 0) {
    return {
      cities: [
        {
          requestedName: DEFAULT_CITY_NAME,
          displayName: DEFAULT_CITY_NAME,
          latitude: DEFAULT_CITY_LAT,
          longitude: DEFAULT_CITY_LON,
        } satisfies ResolvedCity,
      ],
      requestedCities: [],
    };
  }

  const resolvedCities: ResolvedCity[] = [];

  for (const rawCandidate of cityCandidates) {
    if (isLikelyLocationList(rawCandidate, mensajeUsuario)) {
      const splitCandidates = splitMultiLocationCandidate(rawCandidate);

      for (const splitCandidate of splitCandidates) {
        try {
          const city = await resolveSingleCityCandidate(splitCandidate);
          if (!resolvedCities.some((item) => normalizeText(item.displayName) === normalizeText(city.displayName))) {
            resolvedCities.push(city);
          }
        } catch {
          continue;
        }
      }

      if (resolvedCities.length > 0) {
        if (resolvedCities.length >= MAX_CITY_CANDIDATES) {
          break;
        }

        continue;
      }
    }

    const candidateVariants = Array.from(
      new Set(
        [rawCandidate, rawCandidate.replace(/\s+y\s+/i, ', ')]
          .map((item) => cleanCityCandidate(item))
          .filter((item) => item.length > 0),
      ),
    );

    let resolved = false;

    for (const candidateVariant of candidateVariants) {
      try {
        const city = await resolveSingleCityCandidate(candidateVariant);
        if (!resolvedCities.some((item) => normalizeText(item.displayName) === normalizeText(city.displayName))) {
          resolvedCities.push(city);
        }
        resolved = true;
        break;
      } catch {
        continue;
      }
    }

    if (resolved) {
      continue;
    }

    const splitCandidates = splitMultiLocationCandidate(rawCandidate);
    if (splitCandidates.length > 1) {
      for (const splitCandidate of splitCandidates) {
        try {
          const city = await resolveSingleCityCandidate(splitCandidate);
          if (!resolvedCities.some((item) => normalizeText(item.displayName) === normalizeText(city.displayName))) {
            resolvedCities.push(city);
          }
        } catch {
          continue;
        }
      }
    }

    if (resolvedCities.length === 0) {
      return {
        error: `No pude ubicar la ciudad "${rawCandidate}". Intenta con un nombre mas especifico.`,
        status: 400,
      };
    }

    if (resolvedCities.length >= MAX_CITY_CANDIDATES) {
      break;
    }
  }

  if (resolvedCities.length === 0) {
    return {
      error: 'No pude ubicar las ciudades solicitadas. Intenta con nombres mas especificos.',
      status: 400,
    };
  }

  return {
    cities: resolvedCities.slice(0, MAX_CITY_CANDIDATES),
    requestedCities: cityCandidates.slice(0, MAX_CITY_CANDIDATES),
  };
}