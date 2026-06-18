import React from 'react';
import { StyleSheet, TextStyle, View, ViewStyle } from 'react-native';
import { formatStepDetails, FormattedSegment } from '../lib/step-details-formatter';
import { MarkdownText } from './MarkdownText';

interface FormattedStepDetailsProps {
  details: string | any[] | undefined;
  containerStyle?: ViewStyle;
  textStyle?: TextStyle;
  boldTextStyle?: TextStyle;
  linkColor?: string;
}

/**
 * Renders formatted step details with proper line breaks and bold headers.
 * Each segment is rendered as its own block-level element with spacing.
 */
export const FormattedStepDetails: React.FC<FormattedStepDetailsProps> = ({
  details,
  containerStyle,
  textStyle,
  boldTextStyle,
  linkColor = '#F47C3C'
}) => {
  const segments = formatStepDetails(details);

  if (segments.length === 0) {
    return null;
  }

  return (
    <View style={containerStyle}>
      {segments.map((segment: FormattedSegment, index: number) => {
        // Empty segments represent line breaks
        if (segment.text === '') {
          return <View key={index} style={styles.lineBreak} />;
        }

        const textStyleToUse = segment.isBold 
          ? [styles.text, textStyle, styles.boldText, boldTextStyle]
          : [styles.text, textStyle];

        return (
          <MarkdownText
            key={index}
            text={segment.text}
            style={textStyleToUse}
            boldStyle={boldTextStyle || styles.boldText}
            linkColor={linkColor}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  text: {
    fontSize: 16,
    color: '#9AA3A6',
    lineHeight: 22,
    marginBottom: 4,
  },
  boldText: {
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  lineBreak: {
    height: 12,
  },
});
