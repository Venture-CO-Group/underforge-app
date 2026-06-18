import React, { useCallback, useEffect, useRef } from 'react';
import {
  Dimensions,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { FontFamily } from '../constants/Typography';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CARD_WIDTH = Math.round(SCREEN_WIDTH * 0.56);
const CARD_HEIGHT = Math.round(CARD_WIDTH * 1.35);
const CARD_GAP = 16;
const SNAP_INTERVAL = CARD_WIDTH + CARD_GAP;
const SIDE_PADDING = (SCREEN_WIDTH - CARD_WIDTH) / 2;

export interface GalleryItem {
  id: string;
  image: ImageSourcePropType;
  label: string;
}

interface CircularGalleryProps {
  items: GalleryItem[];
  onItemSelect: (id: string) => void;
  selectedItemId?: string;
}

interface CardProps {
  item: GalleryItem;
  index: number;
  scrollX: SharedValue<number>;
  isSelected: boolean;
  isLast: boolean;
  onPress: () => void;
}

const GalleryCard = React.memo<CardProps>(
  ({ item, index, scrollX, isSelected, isLast, onPress }) => {
    const centerOffset = index * SNAP_INTERVAL;

    const animatedStyle = useAnimatedStyle(() => {
      const distance = scrollX.value - centerOffset;
      const absDistance = Math.abs(distance);

      const scale = interpolate(
        absDistance,
        [0, SNAP_INTERVAL, SNAP_INTERVAL * 2],
        [1, 0.87, 0.76],
        Extrapolation.CLAMP
      );

      const translateY = interpolate(
        absDistance,
        [0, SNAP_INTERVAL, SNAP_INTERVAL * 2],
        [0, 22, 50],
        Extrapolation.CLAMP
      );

      const rotateZ = interpolate(
        distance,
        [-SNAP_INTERVAL * 2, -SNAP_INTERVAL, 0, SNAP_INTERVAL, SNAP_INTERVAL * 2],
        [7, 3.5, 0, -3.5, -7],
        Extrapolation.CLAMP
      );

      const opacity = interpolate(
        absDistance,
        [0, SNAP_INTERVAL, SNAP_INTERVAL * 2],
        [1, 0.65, 0.35],
        Extrapolation.CLAMP
      );

      return {
        transform: [{ translateY }, { scale }, { rotateZ: `${rotateZ}deg` }],
        opacity,
      };
    });

    return (
      <Pressable
        onPress={onPress}
        style={{ width: CARD_WIDTH, marginRight: isLast ? 0 : CARD_GAP }}
      >
        <Animated.View style={animatedStyle}>
          <View style={[styles.card, isSelected && styles.cardSelected]}>
            <Image
              source={item.image}
              style={styles.cardImage}
              resizeMode="cover"
            />
          </View>
          <Text
            style={[styles.cardLabel, isSelected && styles.cardLabelSelected]}
            numberOfLines={2}
          >
            {item.label}
          </Text>
        </Animated.View>
      </Pressable>
    );
  }
);

export const CircularGallery: React.FC<CircularGalleryProps> = ({
  items,
  onItemSelect,
  selectedItemId,
}) => {
  const scrollX = useSharedValue(0);
  const scrollRef = useRef<Animated.ScrollView>(null);

  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });

  const handleMomentumEnd = useCallback(
    (event: any) => {
      const offsetX = event.nativeEvent.contentOffset.x;
      const index = Math.round(offsetX / SNAP_INTERVAL);
      const clamped = Math.max(0, Math.min(index, items.length - 1));
      if (items[clamped]) {
        onItemSelect(items[clamped].id);
      }
    },
    [items, onItemSelect]
  );

  const scrollToIndex = useCallback((index: number) => {
    scrollRef.current?.scrollTo({ x: index * SNAP_INTERVAL, animated: true });
  }, []);

  useEffect(() => {
    if (selectedItemId) {
      const idx = items.findIndex((i) => i.id === selectedItemId);
      if (idx >= 0) {
        setTimeout(() => scrollToIndex(idx), 150);
      }
    } else if (items.length > 0) {
      onItemSelect(items[0].id);
    }
  }, []);

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_INTERVAL}
        decelerationRate="fast"
        contentContainerStyle={{
          paddingHorizontal: SIDE_PADDING,
          alignItems: 'flex-start',
        }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={handleMomentumEnd}
      >
        {items.map((item, index) => (
          <GalleryCard
            key={item.id}
            item={item}
            index={index}
            scrollX={scrollX}
            isSelected={selectedItemId === item.id}
            isLast={index === items.length - 1}
            onPress={() => {
              onItemSelect(item.id);
              scrollToIndex(index);
            }}
          />
        ))}
      </Animated.ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
  },
  card: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1A1A2E',
    borderWidth: 2.5,
    borderColor: 'transparent',
  },
  cardSelected: {
    borderColor: '#F47C3C',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  cardLabel: {
    fontFamily: FontFamily.bodySemiBold,
    color: '#9AA3A6',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 4,
    lineHeight: 20,
  },
  cardLabelSelected: {
    color: '#F47C3C',
    fontFamily: FontFamily.bodyBold,
  },
});
