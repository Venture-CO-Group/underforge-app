import * as LinkingExpo from "expo-linking";
import React from 'react';
import { Linking, StyleSheet, Text, TextStyle } from 'react-native';

interface MarkdownTextProps {
  text: string;
  style?: TextStyle | TextStyle[];
  boldStyle?: TextStyle;
  linkColor?: string;
}

interface TextSegment {
  text: string;
  isBold: boolean;
  isLink: boolean;
  url?: string;
}

const URL_REGEX = /https?:\/\/[^\s<>)]+/g;
const BOLD_REGEX = /\*\*([^*]+)\*\*/g;

/**
 * Parse text into segments handling both **bold** markdown and URLs.
 * This avoids the raw "**text**" asterisks showing up in the UI.
 */
function parseMarkdownText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];

  // First split by bold markers
  let lastBoldIndex = 0;
  let boldMatch: RegExpExecArray | null;
  const boldRegex = new RegExp(BOLD_REGEX.source, 'g');

  const rawSegments: { text: string; isBold: boolean }[] = [];

  while ((boldMatch = boldRegex.exec(text)) !== null) {
    // Text before the bold marker
    if (boldMatch.index > lastBoldIndex) {
      rawSegments.push({ text: text.substring(lastBoldIndex, boldMatch.index), isBold: false });
    }
    // Bold text (without ** markers)
    rawSegments.push({ text: boldMatch[1], isBold: true });
    lastBoldIndex = boldRegex.lastIndex;
  }

  // Remaining text after last bold
  if (lastBoldIndex < text.length) {
    rawSegments.push({ text: text.substring(lastBoldIndex), isBold: false });
  }

  // If no bold was found, use original text
  if (rawSegments.length === 0) {
    rawSegments.push({ text, isBold: false });
  }

  // Now split each segment by URLs
  for (const seg of rawSegments) {
    const urlRegex = new RegExp(URL_REGEX.source, 'g');
    let lastUrlIndex = 0;
    let urlMatch: RegExpExecArray | null;
    let hasUrl = false;

    while ((urlMatch = urlRegex.exec(seg.text)) !== null) {
      hasUrl = true;
      // Text before the URL
      if (urlMatch.index > lastUrlIndex) {
        segments.push({ text: seg.text.substring(lastUrlIndex, urlMatch.index), isBold: seg.isBold, isLink: false });
      }
      // The URL itself
      segments.push({ text: urlMatch[0], isBold: seg.isBold, isLink: true, url: urlMatch[0] });
      lastUrlIndex = urlRegex.lastIndex;
    }

    if (hasUrl) {
      // Remaining text after last URL
      if (lastUrlIndex < seg.text.length) {
        segments.push({ text: seg.text.substring(lastUrlIndex), isBold: seg.isBold, isLink: false });
      }
    } else {
      // No URL found, push as-is
      segments.push({ text: seg.text, isBold: seg.isBold, isLink: false });
    }
  }

  return segments;
}

/**
 * Renders text with inline **bold** markdown and clickable URLs.
 * Drop-in replacement for AutoLink where plan text may contain markdown.
 */
export const MarkdownText: React.FC<MarkdownTextProps> = ({
  text,
  style,
  boldStyle,
  linkColor = '#F47C3C'
}) => {
  if (!text) return null;

  const segments = parseMarkdownText(text);

  return (
    <Text style={style}>
      {segments.map((segment, index) => {
        if (segment.isLink && segment.url) {
          return (
            <Text
              key={index}
              style={[
                segment.isBold && (boldStyle || styles.bold),
                { color: linkColor, textDecorationLine: 'underline' as const }
              ]}
              onPress={() => {
                try {
                  LinkingExpo.openURL(segment.url!);
                } catch {
                  Linking.openURL(segment.url!);
                }
              }}
            >
              {segment.text}
            </Text>
          );
        }

        if (segment.isBold) {
          return (
            <Text key={index} style={boldStyle || styles.bold}>
              {segment.text}
            </Text>
          );
        }

        return <Text key={index}>{segment.text}</Text>;
      })}
    </Text>
  );
};

const styles = StyleSheet.create({
  bold: {
    fontWeight: '700',
  },
});
