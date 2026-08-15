import { regionalPlaylistFallbacks } from '../data/regional-playlist-data.js';

type RegionalPlaylistInput = {
  lat?: number;
  lng?: number;
  placeText?: string;
};

function distanceScore(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number },
) {
  const latDistance = origin.lat - target.lat;
  const lngDistance = (origin.lng - target.lng) * Math.cos((origin.lat * Math.PI) / 180);

  return latDistance ** 2 + lngDistance ** 2;
}

export function findRegionalPlaylistId({
  lat,
  lng,
  placeText = '',
}: RegionalPlaylistInput) {
  const normalizedPlaceText = placeText.toLocaleLowerCase('ko-KR');
  const placeMatch = regionalPlaylistFallbacks.find((region) =>
    region.aliases.some((alias) =>
      normalizedPlaceText.includes(alias.toLocaleLowerCase('ko-KR')),
    ),
  );

  if (placeMatch) {
    return placeMatch.playlistId;
  }

  if (lat === undefined || lng === undefined) {
    return 'seoul-night';
  }

  const isInKorea = lat >= 32 && lat <= 39.5 && lng >= 124 && lng <= 132;

  if (!isInKorea) {
    return 'seoul-night';
  }

  const nearestRegion = regionalPlaylistFallbacks.reduce((nearest, region) =>
    distanceScore({ lat, lng }, region) < distanceScore({ lat, lng }, nearest)
      ? region
      : nearest,
  );

  return nearestRegion.playlistId;
}
