import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Typography } from '../constants/Typography';
import { FoodAnalysis, FoodItemMacro } from '../lib/food-vision-service';

const MEAL_QTY_ACCESSORY_ID = 'mealQtyDone';

interface EditableItem {
  name: string;
  quantity: number;
  unit: string;
  // per-item macros at original quantity (from LLM)
  carbs: number;
  protein: number;
  fat: number;
  fiber: number;
}

interface MealQuantityEditorProps {
  analysis: FoodAnalysis;
  onAnalysisChange: (updated: FoodAnalysis) => void;
  readOnly?: boolean;
  inline?: boolean;
}

const DEFAULT_STEP = 5;
const OIL_STEP = 1;

function parseQuantities(raw: string): { name: string; quantity: number; unit: string }[] {
  if (!raw) return [];
  const items: { name: string; quantity: number; unit: string }[] = [];
  const re = /(.+?):\s*~?(\d+(?:\.\d+)?)\s*(g|ml|oz|pieces?|tbsp|tsp|cups?|slices?)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    items.push({
      name: m[1].replace(/^[,;]\s*/, '').trim(),
      quantity: parseFloat(m[2]),
      unit: m[3].toLowerCase(),
    });
  }
  return items;
}

function buildEditableItems(
  parsed: { name: string; quantity: number; unit: string }[],
  itemMacros: FoodItemMacro[] | undefined,
  analysis: FoodAnalysis,
): EditableItem[] {
  // Prefer the structured per-item macros as the source of truth: they carry
  // name + grams + macros and never drift from the free-text foodQuantities
  // string, which the LLM can emit with mismatched item counts, unrecognized
  // units, or commas in names. Build the rows straight from them, in grams.
  if (itemMacros && itemMacros.length > 0) {
    return itemMacros.map(im => ({
      name: im.name,
      quantity: im.grams,
      unit: 'g',
      carbs: im.carbs,
      protein: im.protein,
      fat: im.fat,
      fiber: im.fiber,
    }));
  }
  // No per-item breakdown: parse the quantity string and distribute the meal's
  // total macros across components by weight proportion.
  const totalWeight = parsed.reduce((s, p) => s + p.quantity, 0);
  return parsed.map(p => {
    const frac = totalWeight > 0 ? p.quantity / totalWeight : 0;
    return {
      ...p,
      carbs: analysis.carbs * frac,
      protein: analysis.protein * frac,
      fat: analysis.fat * frac,
      fiber: analysis.fiber * frac,
    };
  });
}

function serializeQuantities(items: EditableItem[]): string {
  return items.map(i => {
    const qty = formatQuantity(i.quantity);
    return `${i.name}: ~${qty}${i.unit}`;
  }).join(', ');
}

function serializeItemMacros(
  items: EditableItem[],
  originalQuantities: number[],
): FoodItemMacro[] {
  return items.map((item, i) => {
    const origQty = originalQuantities[i];
    const scale = origQty > 0 ? item.quantity / origQty : 1;
    const carbs = Math.round(item.carbs * scale);
    const protein = Math.round(item.protein * scale);
    const fat = Math.round(item.fat * scale);
    const fiber = Math.round(item.fiber * scale);
    return {
      name: item.name,
      grams: Math.round(item.quantity * 10) / 10,
      carbs,
      protein,
      fat,
      fiber,
    };
  });
}

function getStep(item: EditableItem): number {
  const nameLower = item.name.toLowerCase();
  if (nameLower.includes('oil')) return OIL_STEP;
  return DEFAULT_STEP;
}

function formatQuantity(quantity: number): string {
  const rounded = Math.round(quantity * 10) / 10;
  if (Math.abs(rounded - Math.round(rounded)) < 0.001) {
    return String(Math.round(rounded));
  }
  return rounded.toFixed(1);
}

function ItemNameLabel({
  name,
  revealed,
  onPress,
  onHoverIn,
  onHoverOut,
}: {
  name: string;
  revealed: boolean;
  onPress: () => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
}) {
  return (
    <Pressable
      style={styles.nameWrap}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityHint={revealed ? undefined : name}
    >
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {revealed && (
        <View style={styles.namePopover} pointerEvents="none">
          <Text style={styles.namePopoverText}>{name}</Text>
        </View>
      )}
    </Pressable>
  );
}

export const MealQuantityEditor: React.FC<MealQuantityEditorProps> = ({
  analysis,
  onAnalysisChange,
  readOnly = false,
  inline = false,
}) => {
  const { t } = useTranslation(['progress', 'common']);
  const parsed = useMemo(() => parseQuantities(analysis.foodQuantities), [analysis.foodQuantities]);
  const initialItems = useMemo(
    () => buildEditableItems(parsed, analysis.foodItemMacros, analysis),
    [analysis, parsed],
  );
  const analysisSignature = useMemo(() => JSON.stringify({
    foodQuantities: analysis.foodQuantities,
    carbs: analysis.carbs,
    protein: analysis.protein,
    fat: analysis.fat,
    fiber: analysis.fiber,
    calories: analysis.calories,
    foodItemMacros: analysis.foodItemMacros,
  }), [analysis]);

  const [items, setItems] = useState<EditableItem[]>(initialItems);
  const [revealedNameIndex, setRevealedNameIndex] = useState<number | null>(null);
  const [inputValues, setInputValues] = useState<string[]>(() => initialItems.map(item => formatQuantity(item.quantity)));
  const originalQuantities = useRef(initialItems.map(i => i.quantity));
  const baseAnalysis = useRef(analysis);
  const isFirstRender = useRef(true);
  const appliedAnalysisSignature = useRef(analysisSignature);

  useEffect(() => {
    if (appliedAnalysisSignature.current === analysisSignature) return;
    appliedAnalysisSignature.current = analysisSignature;
    setItems(initialItems);
    setRevealedNameIndex(null);
    setInputValues(initialItems.map(item => formatQuantity(item.quantity)));
    originalQuantities.current = initialItems.map(item => item.quantity);
    baseAnalysis.current = analysis;
    isFirstRender.current = true;
  }, [analysis, analysisSignature, initialItems]);

  // Derive macros from current item state
  const macros = useMemo(() => {
    let carbs = 0, protein = 0, fat = 0, fiber = 0;
    items.forEach((item, i) => {
      const origQty = originalQuantities.current[i];
      const scale = origQty > 0 ? item.quantity / origQty : 1;
      carbs += item.carbs * scale;
      protein += item.protein * scale;
      fat += item.fat * scale;
      fiber += item.fiber * scale;
    });
    carbs = Math.round(carbs);
    protein = Math.round(protein);
    fat = Math.round(fat);
    fiber = Math.round(fiber);
    const calories = Math.round(carbs * 4 + protein * 4 + fat * 9);
    return { carbs, protein, fat, fiber, calories };
  }, [items]);

  // Propagate to parent via effect (avoids setState-during-render)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    const base = baseAnalysis.current;
    onAnalysisChange({
      ...base,
      foodQuantities: serializeQuantities(items),
      foodItemMacros: serializeItemMacros(items, originalQuantities.current),
      ...macros,
    });
  }, [items, macros, onAnalysisChange]);

  const handleChange = useCallback((index: number, delta: number) => {
    Keyboard.dismiss();
    let updatedQuantity = 0;
    setItems(prev => {
      const next = [...prev];
      const step = getStep(next[index]);
      updatedQuantity = Math.max(0, Math.round((next[index].quantity + delta * step) * 10) / 10);
      next[index] = { ...next[index], quantity: updatedQuantity };
      return next;
    });
    setInputValues(prev => {
      const next = [...prev];
      next[index] = formatQuantity(updatedQuantity);
      return next;
    });
  }, []);

  const handleInputChange = useCallback((index: number, rawValue: string) => {
    const sanitized = rawValue.replace(',', '.').replace(/[^0-9.]/g, '');
    const dotIndex = sanitized.indexOf('.');
    const normalized = dotIndex === -1
      ? sanitized
      : `${sanitized.slice(0, dotIndex + 1)}${sanitized.slice(dotIndex + 1).replace(/\./g, '')}`;

    setInputValues(prev => {
      const next = [...prev];
      next[index] = normalized;
      return next;
    });

    if (normalized === '' || normalized === '.') return;

    const parsedValue = Number.parseFloat(normalized);
    if (!Number.isFinite(parsedValue)) return;

    const quantity = Math.max(0, Math.round(parsedValue * 10) / 10);
    setItems(prev => {
      const next = [...prev];
      next[index] = { ...next[index], quantity };
      return next;
    });
  }, []);

  const handleInputBlur = useCallback((index: number) => {
    setInputValues(prev => {
      const next = [...prev];
      const currentValue = next[index];
      const parsedValue = Number.parseFloat(currentValue);
      if (!Number.isFinite(parsedValue)) {
        next[index] = formatQuantity(items[index]?.quantity ?? 0);
        return next;
      }

      const quantity = Math.max(0, Math.round(parsedValue * 10) / 10);
      next[index] = formatQuantity(quantity);
      setItems(prevItems => {
        const updated = [...prevItems];
        updated[index] = { ...updated[index], quantity };
        return updated;
      });
      return next;
    });
  }, [items]);

  if (items.length === 0) return null;

  return (
    <View style={[styles.container, inline && styles.containerInline]}>
      <Text style={styles.heading}>{t('progress:estimatedQuantities')}</Text>
      {items.map((item, idx) => (
        <View key={idx} style={styles.row}>
          <ItemNameLabel
            name={item.name}
            revealed={revealedNameIndex === idx}
            onPress={() =>
              setRevealedNameIndex((current) => (current === idx ? null : idx))
            }
            onHoverIn={() => setRevealedNameIndex(idx)}
            onHoverOut={() =>
              setRevealedNameIndex((current) => (current === idx ? null : current))
            }
          />
          {readOnly ? (
            <Text style={styles.qtyReadOnly}>
              {formatQuantity(item.quantity)}{item.unit}
            </Text>
          ) : (
            <View style={styles.controls}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => handleChange(idx, -1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.btnText}>−</Text>
              </TouchableOpacity>
              <View style={styles.quantityInputWrapper}>
                <TextInput
                  value={inputValues[idx] ?? formatQuantity(item.quantity)}
                  onChangeText={(value) => handleInputChange(idx, value)}
                  onBlur={() => handleInputBlur(idx)}
                  keyboardType="decimal-pad"
                  inputAccessoryViewID={Platform.OS === 'ios' ? MEAL_QTY_ACCESSORY_ID : undefined}
                  style={styles.qtyInput}
                  textAlign="center"
                  maxLength={6}
                  selectTextOnFocus
                />
                <Text style={styles.qtyUnit}>{item.unit}</Text>
              </View>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => handleChange(idx, 1)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.btnText}>+</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ))}
      {Platform.OS === 'ios' && !readOnly && (
        <InputAccessoryView nativeID={MEAL_QTY_ACCESSORY_ID}>
          <View style={styles.accessoryBar}>
            <TouchableOpacity
              onPress={() => Keyboard.dismiss()}
              hitSlop={{ top: 8, bottom: 8, left: 16, right: 16 }}
            >
              <Text style={styles.accessoryDone}>{t('common:done')}</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111E1E',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 18,
    marginBottom: 2,
    overflow: 'visible',
  },
  containerInline: {
    marginHorizontal: 0,
    marginBottom: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  heading: {
    color: '#8E9A9A',
    fontSize: 11,
    fontFamily: Typography.fontFamily.semiBold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
    overflow: 'visible',
    zIndex: 0,
  },
  nameWrap: {
    flex: 1,
    marginRight: 12,
    position: 'relative',
    zIndex: 1,
  },
  name: {
    color: '#D4DADA',
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
  },
  namePopover: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: '100%',
    marginBottom: 4,
    backgroundColor: '#26393A',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  namePopoverText: {
    color: '#F2F2F7',
    fontSize: 14,
    fontFamily: Typography.fontFamily.regular,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#F47C3C',
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  quantityInputWrapper: {
    minWidth: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  qtyInput: {
    color: '#F2F2F7',
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    minWidth: 48,
    textAlign: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: '#1A2A2A',
  },
  qtyUnit: {
    color: '#8E9A9A',
    fontSize: 12,
    fontFamily: Typography.fontFamily.medium,
  },
  qtyReadOnly: {
    color: '#F2F2F7',
    fontSize: 14,
    fontFamily: Typography.fontFamily.semiBold,
    textAlign: 'right',
  },
  accessoryBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    backgroundColor: '#1A2A2A',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#26393A',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  accessoryDone: {
    color: '#F47C3C',
    fontSize: 16,
    fontFamily: Typography.fontFamily.semiBold,
  },
});
