type MlRecommendationArtwork = {
  backgroundImageUrl?: string;
  coverImageUrl?: string;
};

export function createMlRecommendationArtwork(value: unknown): MlRecommendationArtwork {
  if (typeof value !== 'string') {
    return {};
  }

  const imageUrl = value.trim();

  if (!imageUrl) {
    return {};
  }

  return {
    backgroundImageUrl: imageUrl,
    coverImageUrl: imageUrl,
  };
}
