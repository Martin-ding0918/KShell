import React from 'react';
import {Text, View} from 'react-native';

export type IconName =
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'close'
  | 'more'
  | 'settings'
  | 'terminal'
  | 'qr'
  | 'link'
  | 'star'
  | 'star-filled'
  | 'pin'
  | 'lock'
  | 'eye-off'
  | 'bell'
  | 'bell-off'
  | 'download'
  | 'backup'
  | 'database'
  | 'refresh'
  | 'info'
  | 'image'
  | 'logout'
  | 'trash'
  | 'activity';

interface IconProps {
  name: IconName;
  size?: number;
  color: string;
}

/**
 * Lightweight zero-dependency linear icon primitives built with pure RN Views
 * (plus crisp typographic glyphs for star where geometry excels). Avoids adding
 * native vector/SVG dependencies that hit Windows 260-char codegen path limits.
 */
export function Icon({name, size = 20, color}: IconProps) {
  const s = size;
  const stroke = Math.max(1.5, Math.round(s * 0.09 * 10) / 10);
  const box = {width: s, height: s, alignItems: 'center' as const, justifyContent: 'center' as const};

  switch (name) {
    case 'chevron-left': {
      const side = s * 0.36;
      return (
        <View style={box}>
          <View
            style={{
              width: side,
              height: side,
              borderLeftWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
              transform: [{translateX: side * 0.2}, {rotate: '45deg'}],
            }}
          />
        </View>
      );
    }

    case 'chevron-right': {
      const side = s * 0.34;
      return (
        <View style={box}>
          <View
            style={{
              width: side,
              height: side,
              borderRightWidth: stroke,
              borderTopWidth: stroke,
              borderColor: color,
              transform: [{translateX: -side * 0.2}, {rotate: '45deg'}],
            }}
          />
        </View>
      );
    }

    case 'arrow-left': {
      const head = s * 0.34;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              width: s * 0.62,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: s * 0.22,
              width: head,
              height: head,
              borderLeftWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
        </View>
      );
    }

    case 'arrow-up': {
      const head = s * 0.32;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: s * 0.6,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: s * 0.22,
              width: head,
              height: head,
              borderLeftWidth: stroke,
              borderTopWidth: stroke,
              borderColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
        </View>
      );
    }

    case 'arrow-down': {
      const head = s * 0.32;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              width: stroke,
              height: s * 0.6,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: s * 0.22,
              width: head,
              height: head,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
        </View>
      );
    }

    case 'close': {
      const len = s * 0.68;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              width: len,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: len,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
              transform: [{rotate: '-45deg'}],
            }}
          />
        </View>
      );
    }

    case 'more': {
      const dot = Math.max(2.6, s * 0.14);
      const gap = s * 0.14;
      return (
        <View style={[box, {flexDirection: 'row', gap}]}>
          <View style={{width: dot, height: dot, borderRadius: dot, backgroundColor: color}} />
          <View style={{width: dot, height: dot, borderRadius: dot, backgroundColor: color}} />
          <View style={{width: dot, height: dot, borderRadius: dot, backgroundColor: color}} />
        </View>
      );
    }

    case 'settings': {
      const outer = s * 0.52;
      const inner = s * 0.22;
      const toothW = Math.max(2, s * 0.13);
      const toothH = s * 0.84;
      return (
        <View style={box}>
          {[0, 45, 90, 135].map(deg => (
            <View
              key={deg}
              style={{
                position: 'absolute',
                width: toothW,
                height: toothH,
                borderRadius: toothW / 2,
                borderTopWidth: stroke * 1.15,
                borderBottomWidth: stroke * 1.15,
                borderColor: color,
                transform: [{rotate: `${deg}deg`}],
              }}
            />
          ))}
          <View
            style={{
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: inner,
                height: inner,
                borderRadius: inner / 2,
                borderWidth: stroke,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'terminal': {
      const chev = s * 0.24;
      return (
        <View style={box}>
          <View
            style={{
              width: s * 0.86,
              height: s * 0.72,
              borderRadius: s * 0.16,
              borderWidth: stroke,
              borderColor: color,
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: s * 0.14,
            }}>
            <View
              style={{
                width: chev,
                height: chev,
                borderRightWidth: stroke,
                borderTopWidth: stroke,
                borderColor: color,
                transform: [{rotate: '45deg'}],
              }}
            />
            <View
              style={{
                width: s * 0.24,
                height: stroke,
                borderRadius: stroke,
                backgroundColor: color,
                marginLeft: s * 0.1,
                marginTop: s * 0.18,
              }}
            />
          </View>
        </View>
      );
    }

    case 'qr': {
      const corner = s * 0.34;
      const r = s * 0.08;
      const dot = Math.max(2, s * 0.14);
      return (
        <View style={box}>
          <View style={{width: s * 0.82, height: s * 0.82}}>
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: corner,
                height: corner,
                borderWidth: stroke,
                borderRadius: r,
                borderColor: color,
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: 0,
                right: 0,
                width: corner,
                height: corner,
                borderWidth: stroke,
                borderRadius: r,
                borderColor: color,
              }}
            />
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                width: corner,
                height: corner,
                borderWidth: stroke,
                borderRadius: r,
                borderColor: color,
              }}
            />
            <View
              style={{
                position: 'absolute',
                bottom: s * 0.18,
                right: s * 0.18,
                width: dot,
                height: dot,
                borderRadius: 1,
                backgroundColor: color,
              }}
            />
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: dot,
                height: dot,
                borderRadius: 1,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'link': {
      const pillW = s * 0.44;
      const pillH = s * 0.28;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              width: pillW,
              height: pillH,
              borderRadius: pillH / 2,
              borderWidth: stroke,
              borderColor: color,
              transform: [{translateX: -s * 0.12}, {translateY: s * 0.1}, {rotate: '-45deg'}],
            }}
          />
          <View
            style={{
              position: 'absolute',
              width: pillW,
              height: pillH,
              borderRadius: pillH / 2,
              borderWidth: stroke,
              borderColor: color,
              transform: [{translateX: s * 0.12}, {translateY: -s * 0.1}, {rotate: '-45deg'}],
            }}
          />
        </View>
      );
    }

    case 'star':
    case 'star-filled': {
      return (
        <View style={box}>
          <Text
            style={{
              color,
              fontSize: Math.round(s * 0.92),
              lineHeight: Math.round(s * 1.05),
              textAlign: 'center',
            }}>
            {name === 'star-filled' ? '★' : '☆'}
          </Text>
        </View>
      );
    }

    case 'pin': {
      return (
        <View style={box}>
          <View
            style={{
              width: s * 0.44,
              height: s * 0.14,
              borderRadius: stroke,
              backgroundColor: color,
              marginBottom: 1,
            }}
          />
          <View
            style={{
              width: s * 0.34,
              height: s * 0.28,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: s * 0.56,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              width: stroke,
              height: s * 0.26,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
        </View>
      );
    }

    case 'lock': {
      const shackleW = s * 0.42;
      const shackleH = s * 0.32;
      const bodyW = s * 0.68;
      const bodyH = s * 0.46;
      return (
        <View style={box}>
          <View
            style={{
              width: shackleW,
              height: shackleH,
              borderTopLeftRadius: shackleW / 2,
              borderTopRightRadius: shackleW / 2,
              borderTopWidth: stroke,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
              marginBottom: -stroke * 0.4,
            }}
          />
          <View
            style={{
              width: bodyW,
              height: bodyH,
              borderRadius: s * 0.12,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: stroke * 1.2,
                height: bodyH * 0.36,
                borderRadius: stroke,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'eye-off': {
      return (
        <View style={box}>
          <View
            style={{
              width: s * 0.78,
              height: s * 0.44,
              borderRadius: s * 0.35,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: s * 0.2,
                height: s * 0.2,
                borderRadius: s * 0.1,
                borderWidth: stroke,
                borderColor: color,
              }}
            />
          </View>
          <View
            style={{
              position: 'absolute',
              width: s * 0.86,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
              transform: [{rotate: '-40deg'}],
            }}
          />
        </View>
      );
    }

    case 'bell':
    case 'bell-off': {
      return (
        <View style={box}>
          <View
            style={{
              width: s * 0.56,
              height: s * 0.52,
              borderTopLeftRadius: s * 0.28,
              borderTopRightRadius: s * 0.28,
              borderTopWidth: stroke,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: s * 0.72,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
              marginTop: -stroke,
            }}
          />
          <View
            style={{
              width: s * 0.18,
              height: s * 0.12,
              borderBottomLeftRadius: s * 0.1,
              borderBottomRightRadius: s * 0.1,
              backgroundColor: color,
              marginTop: s * 0.05,
            }}
          />
          {name === 'bell-off' ? (
            <View
              style={{
                position: 'absolute',
                width: s * 0.86,
                height: stroke,
                borderRadius: stroke,
                backgroundColor: color,
                transform: [{rotate: '-42deg'}],
              }}
            />
          ) : null}
        </View>
      );
    }

    case 'download': {
      const head = s * 0.28;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              top: s * 0.14,
              width: stroke,
              height: s * 0.44,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: s * 0.34,
              width: head,
              height: head,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: s * 0.14,
              width: s * 0.72,
              height: s * 0.22,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderBottomLeftRadius: s * 0.1,
              borderBottomRightRadius: s * 0.1,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'backup': {
      const head = s * 0.26;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              top: s * 0.18,
              width: stroke,
              height: s * 0.44,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: s * 0.18,
              width: head,
              height: head,
              borderLeftWidth: stroke,
              borderTopWidth: stroke,
              borderColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
          <View
            style={{
              position: 'absolute',
              bottom: s * 0.14,
              width: s * 0.72,
              height: s * 0.24,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderBottomLeftRadius: s * 0.1,
              borderBottomRightRadius: s * 0.1,
              borderColor: color,
            }}
          />
        </View>
      );
    }

    case 'database': {
      return (
        <View style={[box, {gap: s * 0.08}]}>
          <View
            style={{
              width: s * 0.7,
              height: s * 0.22,
              borderRadius: s * 0.12,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: s * 0.7,
              height: s * 0.2,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderBottomLeftRadius: s * 0.12,
              borderBottomRightRadius: s * 0.12,
              borderColor: color,
              marginTop: -s * 0.14,
            }}
          />
          <View
            style={{
              width: s * 0.7,
              height: s * 0.2,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderBottomLeftRadius: s * 0.12,
              borderBottomRightRadius: s * 0.12,
              borderColor: color,
              marginTop: -s * 0.12,
            }}
          />
        </View>
      );
    }

    case 'refresh': {
      const ring = s * 0.68;
      const tip = s * 0.2;
      return (
        <View style={box}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              borderRightColor: 'transparent',
              transform: [{rotate: '-20deg'}],
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: s * 0.17,
              right: s * 0.18,
              width: tip,
              height: tip,
              borderTopWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
              transform: [{rotate: '15deg'}],
            }}
          />
        </View>
      );
    }

    case 'info': {
      const ring = s * 0.8;
      return (
        <View style={box}>
          <View
            style={{
              width: ring,
              height: ring,
              borderRadius: ring / 2,
              borderWidth: stroke,
              borderColor: color,
              alignItems: 'center',
              justifyContent: 'center',
              gap: s * 0.08,
            }}>
            <View
              style={{
                width: stroke * 1.1,
                height: stroke * 1.1,
                borderRadius: stroke,
                backgroundColor: color,
              }}
            />
            <View
              style={{
                width: stroke,
                height: s * 0.26,
                borderRadius: stroke,
                backgroundColor: color,
              }}
            />
          </View>
        </View>
      );
    }

    case 'image': {
      return (
        <View style={box}>
          <View
            style={{
              width: s * 0.82,
              height: s * 0.68,
              borderRadius: s * 0.14,
              borderWidth: stroke,
              borderColor: color,
              overflow: 'hidden',
            }}>
            <View
              style={{
                position: 'absolute',
                top: s * 0.12,
                left: s * 0.14,
                width: s * 0.14,
                height: s * 0.14,
                borderRadius: s * 0.07,
                backgroundColor: color,
              }}
            />
            <View
              style={{
                position: 'absolute',
                bottom: -s * 0.18,
                right: s * 0.08,
                width: s * 0.42,
                height: s * 0.42,
                borderTopWidth: stroke,
                borderLeftWidth: stroke,
                borderColor: color,
                transform: [{rotate: '45deg'}],
              }}
            />
          </View>
        </View>
      );
    }

    case 'logout': {
      const head = s * 0.24;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: s * 0.14,
              width: s * 0.36,
              height: s * 0.7,
              borderLeftWidth: stroke,
              borderTopWidth: stroke,
              borderBottomWidth: stroke,
              borderTopLeftRadius: s * 0.12,
              borderBottomLeftRadius: s * 0.12,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: s * 0.18,
              width: s * 0.42,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: s * 0.18,
              width: head,
              height: head,
              borderTopWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
              transform: [{rotate: '45deg'}],
            }}
          />
        </View>
      );
    }

    case 'trash': {
      return (
        <View style={box}>
          <View
            style={{
              width: s * 0.28,
              height: s * 0.1,
              borderTopLeftRadius: s * 0.06,
              borderTopRightRadius: s * 0.06,
              borderTopWidth: stroke,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderColor: color,
            }}
          />
          <View
            style={{
              width: s * 0.72,
              height: stroke,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              width: s * 0.56,
              height: s * 0.5,
              borderLeftWidth: stroke,
              borderRightWidth: stroke,
              borderBottomWidth: stroke,
              borderBottomLeftRadius: s * 0.1,
              borderBottomRightRadius: s * 0.1,
              borderColor: color,
              flexDirection: 'row',
              justifyContent: 'space-evenly',
              alignItems: 'center',
              paddingVertical: s * 0.08,
            }}>
            <View style={{width: stroke * 0.85, height: '80%', backgroundColor: color, borderRadius: stroke}} />
            <View style={{width: stroke * 0.85, height: '80%', backgroundColor: color, borderRadius: stroke}} />
          </View>
        </View>
      );
    }

    case 'activity': {
      return (
        <View style={[box, {flexDirection: 'row', alignItems: 'center', gap: s * 0.07}]}>
          <View style={{width: stroke, height: s * 0.24, borderRadius: stroke, backgroundColor: color}} />
          <View style={{width: stroke, height: s * 0.58, borderRadius: stroke, backgroundColor: color}} />
          <View style={{width: stroke, height: s * 0.36, borderRadius: stroke, backgroundColor: color}} />
          <View style={{width: stroke, height: s * 0.48, borderRadius: stroke, backgroundColor: color}} />
        </View>
      );
    }
  }
}
