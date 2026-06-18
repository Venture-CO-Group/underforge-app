import { ImageSourcePropType } from 'react-native';

// Wellness dimension images for plan sections
// Returns null when no image is available for a given dimension
export function getWellnessDimensionImage(dimension: string): ImageSourcePropType | null {
  switch (dimension) {
    case 'training':
    case 'nutrition':
    case 'sleep':
      return null;
    default:
      return null;
  }
}
