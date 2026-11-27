import React, {useEffect, useRef} from 'react';
import {Animated, StyleSheet} from 'react-native';

interface AnimatedScreenProps {
  children: React.ReactNode;
  style?: object;
}

/** Subtle 180ms slide-and-fade entrance for stacked sub-screens (pure RN Animated). */
export function AnimatedScreen({children, style}: AnimatedScreenProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 170,
        useNativeDriver: true,
      }),
      Animated.timing(translateX, {
        toValue: 0,
        duration: 190,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, translateX]);

  return (
    <Animated.View style={[styles.fill, style, {opacity, transform: [{translateX}]}]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
});
