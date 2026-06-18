/**
 * Formats step details text with proper line breaks and bold headers.
 * Returns an array of text segments with formatting information.
 * 
 * Each segment represents one visual line. Inline **bold** markdown
 * is NOT parsed here - that is handled at render time by MarkdownText.
 */

export interface FormattedSegment {
  text: string;
  isBold: boolean;
}

/**
 * Strip **bold** markers from text (used for lines already marked as bold headers)
 */
function stripBoldMarkers(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1');
}

/** Normalize escaped newlines and ensure blank lines before numbered list items. */
function preprocessStepDetailsText(details: string): string {
  let text = details.replace(/\\n/g, '\n');
  text = text.replace(/([^\n])\n(\d+\.\s)/g, '$1\n\n$2');
  text = text.replace(/([^\n])(\d+\.\s+\*\*)/g, '$1\n\n$2');
  return text;
}

const NUMBERED_LIST_LINE = /^\d+\.\s/;

/**
 * Format a structured workout plan into displayable segments
 */
function formatWorkoutPlan(workout: any): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  
  // Day name / title
  if (workout.dayName) {
    segments.push({ text: `🏋️ ${workout.dayName}`, isBold: true });
    segments.push({ text: '', isBold: false }); // line break
  }
  
  // Estimated duration
  if (workout.estimatedDuration) {
    segments.push({ text: `⏱️ Duration: ${workout.estimatedDuration} minutes`, isBold: false });
  }
  
  // Warmup
  if (workout.warmup) {
    segments.push({ text: '', isBold: false }); // line break
    segments.push({ text: 'Warmup:', isBold: true });
    segments.push({ text: workout.warmup, isBold: false });
  }
  
  // Exercises
  if (workout.exercises && Array.isArray(workout.exercises)) {
    segments.push({ text: '', isBold: false }); // line break
    segments.push({ text: 'Exercises:', isBold: true });
    
    workout.exercises.forEach((exercise: any, index: number) => {
      const name = exercise.name || exercise.exerciseName || 'Exercise';
      const sets = exercise.sets ?? '-';
      const reps = exercise.reps ?? '-';
      const restSeconds = exercise.restTimeSeconds;
      const rir = exercise.rir;
      
      // Format: "1. Exercise Name: 3x8-10"
      let exerciseLine = `${index + 1}. ${name}: ${sets}×${reps}`;
      
      // Add rest time if available
      if (restSeconds) {
        const restDisplay = restSeconds >= 60 
          ? `${Math.floor(restSeconds / 60)}:${(restSeconds % 60).toString().padStart(2, '0')} rest`
          : `${restSeconds}s rest`;
        exerciseLine += ` (${restDisplay}`;
        if (rir !== undefined && rir !== null) {
          exerciseLine += `, RiR ${rir}`;
        }
        exerciseLine += ')';
      } else if (rir !== undefined && rir !== null) {
        exerciseLine += ` (RiR ${rir})`;
      }
      
      segments.push({ text: exerciseLine, isBold: false });
      
      // Add notes if present
      if (exercise.notes) {
        segments.push({ text: `   💡 ${exercise.notes}`, isBold: false });
      }
    });
  }
  
  // Cooldown
  if (workout.cooldown) {
    segments.push({ text: '', isBold: false }); // line break
    segments.push({ text: 'Cooldown:', isBold: true });
    segments.push({ text: workout.cooldown, isBold: false });
  }
  
  // Recovery hints
  if (workout.recoveryHints) {
    const hints = workout.recoveryHints;
    segments.push({ text: '', isBold: false }); // line break
    segments.push({ text: 'Recovery Tips:', isBold: true });
    
    if (hints.stretching) {
      segments.push({ text: `🧘 Stretching: ${hints.stretching}`, isBold: false });
    }
    if (hints.fasciaMassage) {
      segments.push({ text: `🏐 Foam Roll: ${hints.fasciaMassage}`, isBold: false });
    }
    if (hints.supplementation) {
      segments.push({ text: `💊 Nutrition: ${hints.supplementation}`, isBold: false });
    }
  }
  
  return segments;
}

export function formatStepDetails(details: string | any[] | object | undefined): FormattedSegment[] {
  if (!details) return [];
  
  // Handle array input
  if (Array.isArray(details)) {
    // Check if this is an array of workout objects (multiple workout days)
    const firstItem = details[0];
    if (firstItem && typeof firstItem === 'object' && 'exercises' in firstItem && Array.isArray(firstItem.exercises)) {
      // This is an array of workout plans (e.g., Push/Pull/Legs)
      const segments: FormattedSegment[] = [];
      details.forEach((workout, index) => {
        if (index > 0) {
          // Add spacing between workout days
          segments.push({ text: '', isBold: false });
          segments.push({ text: '────────────────', isBold: false });
          segments.push({ text: '', isBold: false });
        }
        segments.push(...formatWorkoutPlan(workout));
      });
      return segments;
    }
    
    // Otherwise, handle as text array (legacy format)
    return details.flatMap((d, index) => {
      const text = typeof d === 'object' && d.text ? d.text : d;
      if (typeof text === 'string') {
        return formatStepDetails(text);
      }
      return [];
    });
  }

  // Handle structured workout object (new format)
  if (typeof details === 'object' && !Array.isArray(details)) {
    const workout = details as any;
    
    // Check if this is a workout structure with exercises
    if (workout.exercises && Array.isArray(workout.exercises)) {
      return formatWorkoutPlan(workout);
    }
    
    // If it's an object with a text property, format the text
    if (workout.text && typeof workout.text === 'string') {
      return formatStepDetails(workout.text);
    }
    
    // Unknown object format - return empty
    return [];
  }

  if (typeof details !== 'string') return [];

  const normalized = preprocessStepDetailsText(details);

  // First, replace double newlines with a special marker
  let processed = normalized.replace(/\n\n+/g, '\n__DOUBLE_BREAK__\n');
  
  // Split by newlines to process each line
  const allLines = processed.split('\n');
  let previousWasBold = false;
  const result: FormattedSegment[] = [];

  for (let lineIndex = 0; lineIndex < allLines.length; lineIndex++) {
    const line = allLines[lineIndex];
    const trimmedLine = line.trim();
    
    // Handle double break marker
    if (trimmedLine === '__DOUBLE_BREAK__') {
      // Add an empty line
      if (result.length > 0 && result[result.length - 1].text !== '') {
        result.push({ text: '', isBold: false });
      }
      previousWasBold = false;
      continue;
    }
    
    // Empty lines
    if (trimmedLine === '') {
      if (result.length > 0 && result[result.length - 1].text !== '') {
        result.push({ text: '', isBold: false });
      }
      previousWasBold = false;
      continue;
    }
    
    // Never bold bullet points (lines starting with '-')
    if (trimmedLine.startsWith('-')) {
      result.push({ text: trimmedLine, isBold: false });
      previousWasBold = false;
      continue;
    }

    // Numbered list items: always separated by a visual line break
    if (NUMBERED_LIST_LINE.test(trimmedLine)) {
      if (result.length > 0 && result[result.length - 1].text !== '') {
        result.push({ text: '', isBold: false });
      }
      result.push({ text: trimmedLine, isBold: false });
      previousWasBold = false;
      continue;
    }
    
    // Check if previous line was bold - if so, don't bold this line
    if (previousWasBold) {
      result.push({ text: trimmedLine, isBold: false });
      previousWasBold = false;
      continue;
    }

    // Check if line has both a non-empty line before and after - if so, don't bold
    const previousLine = lineIndex > 0 ? allLines[lineIndex - 1].trim() : '';
    const nextLine = lineIndex < allLines.length - 1 ? allLines[lineIndex + 1].trim() : '';
    const hasPreviousLine = previousLine !== '' && previousLine !== '__DOUBLE_BREAK__';
    const hasNextLine = nextLine !== '' && nextLine !== '__DOUBLE_BREAK__';
    
    if (hasPreviousLine && hasNextLine) {
      result.push({ text: trimmedLine, isBold: false });
      previousWasBold = false;
      continue;
    }

    // Check if this line is a section header
    // Headers are lines that contain a colon and are followed by content
    if (trimmedLine.includes(':')) {
      // Check if immediate next line is empty - if so, don't bold
      const immediateNextLine = lineIndex < allLines.length - 1 ? allLines[lineIndex + 1].trim() : '';
      if (immediateNextLine === '' || immediateNextLine === '__DOUBLE_BREAK__') {
        // Next line is empty, don't bold this line
        result.push({ text: trimmedLine, isBold: false });
        previousWasBold = false;
        continue;
      }
      
      // Check if next non-empty line exists and if there's a blank line between
      let nextNonEmptyLine = '';
      let hasBlankLineBefore = false;
      for (let i = lineIndex + 1; i < allLines.length; i++) {
        const nextLine = allLines[i].trim();
        if (nextLine === '__DOUBLE_BREAK__') {
          hasBlankLineBefore = true;
          continue;
        }
        if (nextLine === '') {
          hasBlankLineBefore = true;
          continue;
        }
        if (nextLine !== '') {
          nextNonEmptyLine = nextLine;
          break;
        }
      }
      
      // If there's a next non-empty line, check if this looks like a header
      if (nextNonEmptyLine.length > 0) {
        const colonIndex = trimmedLine.indexOf(':');
        const beforeColon = trimmedLine.substring(0, colonIndex).trim();
        const afterColon = trimmedLine.substring(colonIndex + 1).trim();
        
        // Headers are lines that:
        // 1. End with ':' (like "Day 1 (Monday) - Upper Push:") OR
        // 2. Contain ':' and match header patterns
        if (trimmedLine.endsWith(':')) {
          // Line ends with colon - it's a header. Strip any ** since entire line is bold.
          result.push({ text: stripBoldMarkers(trimmedLine), isBold: true });
          previousWasBold = true;
          continue;
        } else {
          // Check if it matches header patterns
          const isHeaderPattern = /^(Day\s+\d+|Minutes\s+\d+[-–]\d+|Week\s+\d+)/i.test(beforeColon);
          
          // If it matches header pattern and has short descriptive text after colon
          if (isHeaderPattern && afterColon.length < 60 && afterColon.length > 0) {
            result.push({ text: stripBoldMarkers(trimmedLine), isBold: true });
            previousWasBold = true;
            continue;
          }
          
          // Also check if it's followed by blank line or bullet points and has short text after colon
          if ((hasBlankLineBefore || nextNonEmptyLine.startsWith('-')) && afterColon.length < 60 && afterColon.length > 0) {
            result.push({ text: stripBoldMarkers(trimmedLine), isBold: true });
            previousWasBold = true;
            continue;
          }
        }
      }
    }
    
    // Default: one segment per line. Inline **bold** is handled by MarkdownText at render time.
    result.push({ text: trimmedLine, isBold: false });
    previousWasBold = false;
  }
  
  return result;
}
