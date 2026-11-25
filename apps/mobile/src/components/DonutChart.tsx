import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {makeStyles, useTheme} from '../theme';

export interface DonutSegment {
  key: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  /** Ring outer diameter in dp. */
  size?: number;
  /** Ring thickness in dp. */
  thickness?: number;
  /** Solid backdrop of the card the chart sits on (masks + hole). */
  surface?: string;
  /** Center captions: big value + small label. */
  centerValue: string;
  centerLabel: string;
}

/**
 * Donut chart built from plain Views — no native chart/svg dependency (keeps
 * the RNOH path open). Angles: degrees clockwise, 0 at 12 o'clock.
 *
 * Each segment paints a full ring clipped to a rotated half-plane (a 180°
 * band that starts exactly at the segment's start angle), then overdraws the
 * unused tail of that band with the surface color. Segments are contiguous
 * from 0°; a muted remainder closes the ring back to 360°.
 */
export function DonutChart({
  segments,
  size = 180,
  thickness = 18,
  surface,
  centerValue,
  centerLabel,
}: DonutChartProps) {
  const {colors} = useTheme();
  const styles = useStyles();
  const surfaceColor = surface ?? colors.bgElevated;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  // Decompose into ≤180° sectors with explicit start angles.
  const sectors: {start: number; sweep: number; color: string}[] = [];
  if (total > 0) {
    let cursor = 0;
    for (const seg of segments) {
      const sweep = (seg.value / total) * 360;
      let left = sweep;
      let start = cursor;
      while (left > 0.01 && start < 360) {
        const chunk = Math.min(left, 360 - start, 180);
        if (chunk <= 0) {
          break;
        }
        sectors.push({start, sweep: chunk, color: seg.color});
        start += chunk;
        left -= chunk;
      }
      cursor += sweep;
    }
    if (cursor < 359.99) {
      sectors.push({start: cursor, sweep: 360 - cursor, color: colors.bgInput});
    }
  }

  /**
   * Exact wedge [startDeg, startDeg + sweepDeg] (0 < sweepDeg <= 180) built as
   * the intersection of two half-planes — never wraps past 360° or overdraws
   * earlier sectors:
   *  - Outer top-half rotated by (startDeg + 90) clips to [startDeg, startDeg + 180]
   *  - Inner top-half rotated by (sweepDeg - 180) relative to outer clips to
   *    [startDeg + sweepDeg - 180, startDeg + sweepDeg]
   *  - Their intersection is exactly [startDeg, startDeg + sweepDeg].
   */
  const wedge = (startDeg: number, sweepDeg: number, ringColor: string) => (
    <View style={StyleSheet.absoluteFill}>
      <View
        style={{
          ...StyleSheet.absoluteFillObject,
          transform: [{rotate: `${startDeg + 90}deg`}],
        }}>
        <View style={halfStyle(size)}>
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: size,
              height: size,
              transform: [{rotate: `${sweepDeg - 180}deg`}],
            }}>
            <View style={halfStyle(size)}>
              <View
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  borderWidth: thickness,
                  borderColor: ringColor,
                }}
              />
            </View>
          </View>
        </View>
      </View>
    </View>
  );

  const hole = size - thickness * 2;

  return (
    <View style={{width: size, height: size}}>
      {/* Muted base ring so an empty chart still reads as a ring. */}
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: thickness,
          borderColor: colors.bgInput,
        }}
      />
      {sectors.map((sector, i) => (
        <React.Fragment key={`sector-${i}`}>
          {wedge(sector.start, sector.sweep, sector.color)}
        </React.Fragment>
      ))}
      <View
        style={{
          position: 'absolute',
          top: thickness,
          left: thickness,
          width: hole,
          height: hole,
          borderRadius: hole / 2,
          backgroundColor: surfaceColor,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Text style={styles.centerValue}>{centerValue}</Text>
        <Text style={styles.centerLabel}>{centerLabel}</Text>
      </View>
    </View>
  );
}

/** The clipping half: top half of the square, kept in the rotated frame. */
function halfStyle(size: number) {
  return {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: size,
    height: size / 2,
    overflow: 'hidden' as const,
  };
}

const useStyles = makeStyles((colors, font) => ({
  centerValue: {...font.body, fontWeight: '600' as const, color: colors.text},
  centerLabel: {...font.faint, marginTop: 2},
}));
